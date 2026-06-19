"""Ken Burns slideshow renderer — simplified from reference/demo_v4.py."""
import math
import random
import subprocess
from pathlib import Path

from PIL import Image

FPS = 30
RESOLUTION = (1920, 1080)
PRESET = "fast"
CRF = 23
PIX_FMT = "yuv420p"
VIDEO_CODEC = "libx264"

DIRECTIONS_LANDSCAPE = [
    "zoom_in_center", "zoom_out_center",
    "pan_left_to_right", "pan_right_to_left",
    "pan_top_to_bottom", "pan_bottom_to_top",
]
DIRECTIONS_PORTRAIT = [
    "zoom_in_center", "zoom_out_center",
    "pan_top_to_bottom", "pan_bottom_to_top",
]

# Higher zoom factor over the same duration = faster perceived camera motion.
SPEED_PRESETS = {
    "slow": 1.06,
    "medium": 1.15,
    "fast": 1.28,
}


def get_image_dimensions(path):
    with Image.open(path) as img:
        return img.size


def is_portrait(w, h):
    return h > w


def get_optimal_scale_factor(w, h, target_min=6000):
    """
    Big pre-scale to defeat zoompan jitter.
    With small zoom deltas (e.g. 1.06 over 120 frames = 0.0005/frame), ffmpeg's
    zoompan quantizes to discrete pixel steps and the result visibly shakes.
    Pre-scaling so the source has min-dim >= ~6000px gives zoompan enough
    sub-pixel headroom that the motion stays smooth. Use ceil so we always
    meet the target (round can leave us short).
    """
    min_dim = min(w, h)
    if min_dim >= target_min:
        return 2.0
    raw = target_min / max(1, min_dim)
    return max(2.0, min(8.0, float(math.ceil(raw))))


def generate_zoompan_filter(direction, duration, fps, zoom_value):
    frames = int(duration * fps)
    zmin = 1.0
    res = f"{RESOLUTION[0]}x{RESOLUTION[1]}"

    if direction == "zoom_in_center":
        z = f"'{zmin}+({zoom_value - zmin})*on/{frames}'"
        x = "'iw/2-(iw/zoom/2)'"
        y = "'ih/2-(ih/zoom/2)'"
    elif direction == "zoom_out_center":
        z = f"'{zoom_value}-({zoom_value - zmin})*on/{frames}'"
        x = "'iw/2-(iw/zoom/2)'"
        y = "'ih/2-(ih/zoom/2)'"
    elif direction == "pan_left_to_right":
        z = f"'{zoom_value}'"
        x = f"'(iw-iw/zoom)*on/{frames}'"
        y = "'ih/2-(ih/zoom/2)'"
    elif direction == "pan_right_to_left":
        z = f"'{zoom_value}'"
        x = f"'(iw-iw/zoom)*(1-on/{frames})'"
        y = "'ih/2-(ih/zoom/2)'"
    elif direction == "pan_top_to_bottom":
        z = f"'{zoom_value}'"
        x = "'iw/2-(iw/zoom/2)'"
        y = f"'(ih-ih/zoom)*on/{frames}'"
    elif direction == "pan_bottom_to_top":
        z = f"'{zoom_value}'"
        x = "'iw/2-(iw/zoom/2)'"
        y = f"'(ih-ih/zoom)*(1-on/{frames})'"
    else:
        z = f"'{zmin}+({zoom_value - zmin})*on/{frames}'"
        x = "'iw/2-(iw/zoom/2)'"
        y = "'ih/2-(ih/zoom/2)'"

    return f"zoompan=z={z}:x={x}:y={y}:d={frames}:s={res}:fps={fps}"


def get_blur_composite_filter():
    """Portrait fallback: blurred background + centered foreground (from demo_v4.py)."""
    w, h = RESOLUTION
    return (
        f"split[orig][bg_src];"
        f"[bg_src]scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},gblur=sigma=40,eq=brightness=-0.15:saturation=0.6[bg];"
        f"[orig]scale=-1:{h}:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2"
    )


def get_landscape_crop(w, h):
    target_ratio = RESOLUTION[0] / RESOLUTION[1]
    img_ratio = w / h
    if abs(img_ratio - target_ratio) < 0.01:
        return None
    if img_ratio > target_ratio:
        cw, ch = int(h * target_ratio), h
        cx, cy = int((w - cw) / 2), 0
    else:
        cw, ch = w, int(w / target_ratio)
        cx, cy = 0, int((h - ch) / 2)
    return f"crop={cw}:{ch}:{cx}:{cy}"


def resolve_direction(direction, portrait):
    if direction != "random":
        return direction
    pool = DIRECTIONS_PORTRAIT if portrait else DIRECTIONS_LANDSCAPE
    return random.choice(pool)


def render_clip(image_path, duration, direction, speed, output_path):
    w, h = get_image_dimensions(image_path)
    portrait = is_portrait(w, h)
    direction = resolve_direction(direction, portrait)
    zoom_value = SPEED_PRESETS.get(speed, SPEED_PRESETS["medium"])
    zoompan = generate_zoompan_filter(direction, duration, FPS, zoom_value)

    if portrait:
        blur = get_blur_composite_filter()
        # Portrait composite is already 1920x1080; 3x → 5760x3240 for jitter-free zoompan.
        vf = f"{blur},scale=iw*3:ih*3:flags=lanczos,{zoompan},format={PIX_FMT}"
    else:
        scale = get_optimal_scale_factor(w, h)
        crop = get_landscape_crop(w, h)
        scale_filter = f"scale=iw*{scale}:ih*{scale}:flags=lanczos"
        vf = f"{crop + ',' if crop else ''}{scale_filter},{zoompan},format={PIX_FMT}"

    cmd = [
        "ffmpeg", "-loop", "1", "-i", str(image_path),
        "-vf", vf,
        "-c:v", VIDEO_CODEC, "-preset", PRESET, "-crf", str(CRF),
        "-pix_fmt", PIX_FMT, "-movflags", "+faststart",
        "-r", str(FPS), "-t", str(duration),
        "-y", str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {image_path}: {result.stderr[-500:]}")
    return direction


def concat_clips(clip_paths, output_path):
    output_path = Path(output_path)
    concat_txt = output_path.parent / f"_concat_{output_path.stem}.txt"
    with open(concat_txt, "w", encoding="utf-8") as f:
        for p in clip_paths:
            f.write(f"file '{Path(p).absolute()}'\n")
    cmd = [
        "ffmpeg", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
        "-c", "copy", "-movflags", "+faststart",
        "-y", str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    concat_txt.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {result.stderr[-500:]}")


def build_slideshow(slides, output_path, work_dir):
    """
    slides: list of {path, duration, direction, speed}
    Returns list of resolved directions (for logging).
    """
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    clip_paths = []
    resolved = []
    try:
        for i, cfg in enumerate(slides):
            clip_path = work_dir / f"clip_{i:03d}.mp4"
            direction = render_clip(
                cfg["path"],
                float(cfg.get("duration", 4.0)),
                cfg.get("direction", "random"),
                cfg.get("speed", "medium"),
                clip_path,
            )
            resolved.append(direction)
            clip_paths.append(clip_path)

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        concat_clips(clip_paths, output_path)
    finally:
        for p in clip_paths:
            Path(p).unlink(missing_ok=True)
    return resolved
