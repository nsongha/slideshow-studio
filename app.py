"""FastAPI backend for the slideshow generator."""
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

import slideshow

BASE_DIR = Path(__file__).parent
IMAGES_DIR = BASE_DIR / "images"
OUTPUT_DIR = BASE_DIR / "output"
THUMBS_DIR = OUTPUT_DIR / "thumbs"
WORK_DIR = BASE_DIR / ".work"
STATIC_DIR = BASE_DIR / "static"

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGES = 30
VALID_VIDEO_NAME = re.compile(r"^[\w\-. ]{1,80}$")

IMAGES_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
THUMBS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Slideshow Automation")


class GenerateRequest(BaseModel):
    filenames: List[str]
    duration: float = 4.0
    speed: str = "medium"
    ratio: str = "16:9"


class RenameRequest(BaseModel):
    new_name: str


def _count_images() -> int:
    return sum(
        1 for f in IMAGES_DIR.iterdir() if f.suffix.lower() in ALLOWED_EXT
    )


def _check_video_name(name: str) -> Path:
    if "/" in name or "\\" in name:
        raise HTTPException(400, "Invalid filename")
    return OUTPUT_DIR / name


def _thumb_path(video_name: str) -> Path:
    return THUMBS_DIR / f"{Path(video_name).stem}.jpg"


def _generate_thumb(video: Path, thumb: Path) -> bool:
    cmd = [
        "ffmpeg", "-ss", "0.5", "-i", str(video),
        "-vframes", "1", "-vf", "scale=320:-1",
        "-y", str(thumb),
    ]
    result = subprocess.run(cmd, capture_output=True)
    return result.returncode == 0 and thumb.exists()


def _safe_name(name: str) -> Path:
    """Reject path traversal — only allow plain filenames inside IMAGES_DIR."""
    if "/" in name or "\\" in name or name in ("", ".", ".."):
        raise HTTPException(400, "Invalid filename")
    return IMAGES_DIR / name


@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/images")
def list_images():
    files = sorted(
        f.name for f in IMAGES_DIR.iterdir() if f.suffix.lower() in ALLOWED_EXT
    )
    return {"images": files, "max": MAX_IMAGES}


@app.get("/api/images/{name}")
def get_image(name: str):
    target = _safe_name(name)
    if not target.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(target)


@app.post("/api/images")
async def upload_image(file: UploadFile = File(...)):
    if _count_images() >= MAX_IMAGES:
        raise HTTPException(400, f"Image limit reached ({MAX_IMAGES})")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type: {ext}")
    stem = Path(file.filename).stem or "upload"
    dest = IMAGES_DIR / f"{stem}{ext}"
    if dest.exists():
        dest = IMAGES_DIR / f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": dest.name}


@app.put("/api/images/{name}")
async def replace_image(name: str, file: UploadFile = File(...)):
    target = _safe_name(name)
    if not target.exists():
        raise HTTPException(404, "Image not found")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type: {ext}")
    target.unlink()
    new_path = IMAGES_DIR / f"{target.stem}{ext}"
    with open(new_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": new_path.name}


@app.delete("/api/images/{name}")
def delete_image(name: str):
    target = _safe_name(name)
    if not target.exists():
        raise HTTPException(404, "Image not found")
    target.unlink()
    return {"ok": True}


@app.post("/api/generate")
def generate(req: GenerateRequest):
    if not req.filenames:
        raise HTTPException(400, "No slides provided")
    if req.ratio not in slideshow.RATIO_RESOLUTIONS:
        raise HTTPException(400, f"Invalid ratio: {req.ratio}")

    configs = []
    for name in req.filenames:
        path = _safe_name(name)
        if not path.exists():
            raise HTTPException(404, f"Image not found: {name}")
        configs.append({
            "path": str(path),
            "duration": req.duration,
            "direction": "random",
            "speed": req.speed,
        })

    output_name = f"slideshow_{uuid.uuid4().hex[:8]}.mp4"
    output_path = OUTPUT_DIR / output_name
    work_dir = WORK_DIR / uuid.uuid4().hex[:8]

    try:
        directions = slideshow.build_slideshow(configs, output_path, work_dir, ratio=req.ratio)
    finally:
        if work_dir.exists():
            shutil.rmtree(work_dir, ignore_errors=True)

    return {"video": output_name, "directions": directions, "ratio": req.ratio}


@app.get("/api/outputs")
def list_outputs():
    files = [
        f for f in OUTPUT_DIR.iterdir()
        if f.is_file() and f.suffix.lower() == ".mp4"
    ]
    files.sort(key=lambda f: f.stat().st_mtime)
    return {"outputs": [f.name for f in files]}


@app.get("/api/output/{name}/thumb")
def get_thumb(name: str):
    video = _check_video_name(name)
    if not video.exists():
        raise HTTPException(404, "Video not found")
    thumb = _thumb_path(name)
    if not thumb.exists():
        if not _generate_thumb(video, thumb):
            raise HTTPException(500, "Failed to generate thumb")
    return FileResponse(thumb, media_type="image/jpeg")


@app.get("/api/output/{name}")
def get_output(name: str):
    target = _check_video_name(name)
    if not target.exists():
        raise HTTPException(404, "Video not found")
    return FileResponse(target, media_type="video/mp4")


@app.delete("/api/output/{name}")
def delete_output(name: str):
    target = _check_video_name(name)
    if not target.exists():
        raise HTTPException(404, "Video not found")
    target.unlink()
    _thumb_path(name).unlink(missing_ok=True)
    return {"ok": True}


@app.put("/api/output/{name}")
def rename_output(name: str, req: RenameRequest):
    video = _check_video_name(name)
    if not video.exists():
        raise HTTPException(404, "Video not found")
    new_stem = Path(req.new_name).stem.strip()
    if not new_stem or not VALID_VIDEO_NAME.match(new_stem):
        raise HTTPException(400, "Invalid name (letters, numbers, _, -, ., space; max 80)")
    new_name = f"{new_stem}.mp4"
    new_path = OUTPUT_DIR / new_name
    if new_path.exists() and new_path != video:
        raise HTTPException(400, "Name already exists")
    video.rename(new_path)
    old_thumb = _thumb_path(name)
    if old_thumb.exists():
        old_thumb.rename(_thumb_path(new_name))
    return {"filename": new_name}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
