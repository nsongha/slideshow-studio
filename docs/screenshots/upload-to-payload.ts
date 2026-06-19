/**
 * Upload UI screenshots to the songha.net Payload media collection, then
 * insert them into the "slideshow-studio" post (both vi and en locales).
 *
 * Run from this directory: `npx tsx upload-to-payload.ts`
 *
 * Idempotent on the post (always rewrites content). Media uploads create new
 * rows each run — fine for a one-off.
 */
import fs from "node:fs";
import path from "node:path";

const SONGHA_NET = "/Users/songha/Documents/Projects/songha.net";
const SHOTS_DIR = "/Users/songha/Documents/Projects/SlideShow Automation/.claude/worktrees/happy-noyce-80bb29/docs/screenshots";
const SLUG = "slideshow-studio";

const SHOTS: Array<{ file: string; altVi: string; altEn: string }> = [
  {
    file: "01-hero.png",
    altVi: "Giao diện chính: asset manager, controls, output gallery",
    altEn: "Main UI: asset manager, controls, output gallery",
  },
  {
    file: "02-video-playing.png",
    altVi: "Player phát video — preview tự resize theo aspect của output đang chọn",
    altEn: "Video playing — preview resizes to match the selected output's aspect",
  },
  {
    file: "04-image-preview.png",
    altVi: "Click bất kỳ thumbnail asset nào để xem full-size trong khung preview",
    altEn: "Click any asset thumbnail to inspect it full-size in the preview pane",
  },
];

type Block =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "code"; language: string; text: string }
  | { type: "img"; mediaId: number | string; alt: string };

function textNode(text: string, format = 0) {
  return {
    type: "text",
    version: 1,
    text,
    format,
    mode: "normal",
    detail: 0,
    style: "",
  };
}

function lexicalDoc(blocks: Block[]) {
  return {
    root: {
      type: "root",
      version: 1,
      direction: "ltr" as const,
      format: "" as const,
      indent: 0,
      children: blocks.map((b) => {
        if (b.type === "h2") {
          return {
            type: "heading",
            version: 1,
            direction: "ltr",
            format: "",
            indent: 0,
            tag: "h2",
            children: [textNode(b.text)],
          };
        }
        if (b.type === "p") {
          return {
            type: "paragraph",
            version: 1,
            direction: "ltr",
            format: "",
            indent: 0,
            children: [textNode(b.text)],
          };
        }
        if (b.type === "ul") {
          return {
            type: "list",
            version: 1,
            direction: "ltr",
            format: "",
            indent: 0,
            listType: "bullet",
            start: 1,
            tag: "ul",
            children: b.items.map((item, i) => ({
              type: "listitem",
              version: 1,
              direction: "ltr",
              format: "",
              indent: 0,
              value: i + 1,
              children: [textNode(item)],
            })),
          };
        }
        if (b.type === "code") {
          return {
            type: "code",
            version: 1,
            direction: "ltr",
            format: "",
            indent: 0,
            language: b.language,
            children: [textNode(b.text)],
          };
        }
        // img — Payload lexical upload node
        return {
          type: "upload",
          version: 3,
          relationTo: "media",
          value: b.mediaId,
          fields: null,
        };
      }),
    },
  };
}

function vi(mediaIds: (number | string)[]): Block[] {
  return [
    {
      type: "p",
      text: "Slideshow Studio là một web app nhỏ tôi viết cuối tuần — drop một folder ảnh vào, nhận lại một video MP4 1080p với hiệu ứng Ken Burns mượt. Không build step, không framework JS, không database. FastAPI ở backend, một trang HTML vanilla ở frontend, và ffmpeg làm phần nặng. Dùng nội bộ cho mấy bộ ảnh fashion / sản phẩm — chỗ mà mình muốn motion sạch, framing đoán trước được, và render một click.",
    },
    { type: "img", mediaId: mediaIds[0], alt: SHOTS[0].altVi },
    { type: "h2", text: "Vấn đề khó nhằn nhất: ảnh bị rung" },
    {
      type: "p",
      text: "Ai từng xài filter zoompan của ffmpeg đều biết cảm giác này: zoom rất chậm trong vài giây, và thay vì pan mượt như mơ, video lại nhảy từng pixel một như cảnh phim cũ chiếu trên đầu phim 8mm. Lý do là zoompan tính toán tâm crop theo từng frame bằng số nguyên — với một camera slow (zoom 1.06 trong 4 giây = delta 0.0005 mỗi frame), độ phân giải nguồn 1920×1280 đơn giản là không đủ để biểu diễn chuyển động mịn. Mỗi frame, tâm crop dịch đúng 0 hoặc 1 pixel chứ không có chỗ ở giữa.",
    },
    {
      type: "p",
      text: "Cách fix của tôi rất ngu mà hiệu quả: scale ảnh nguồn lên ≥ 6000 px ở cạnh ngắn trước khi đưa vào zoompan. Khi đó delta 0.0005 mỗi frame nằm dưới ngưỡng 1 pixel hiển thị, ffmpeg nội suy mượt, và output 1080p sạch tinh. Một dòng code, render chậm hơn vài giây, nhưng đổi lại không còn ai hỏi 'video sao giật vậy'.",
    },
    { type: "h2", text: "Crop hay letterbox" },
    {
      type: "p",
      text: "Mỗi ảnh có thể có aspect ratio khác output. Hai trường phái: cắt cho khớp (cover) hoặc bóp vào trong và thêm viền (contain). Tôi cho cả hai làm option. Khi bạn chọn Crop, ảnh được crop để fill khung — đơn giản, đẹp với ảnh cùng tỉ lệ. Khi chọn Letterbox, ảnh giữ nguyên ratio, hai dải còn lại được phủ một bản blur của chính ảnh đó. Trick là pool hướng Ken Burns cũng phải đổi: nếu đang letterbox và ảnh là dọc, các hướng pan ngang sẽ kéo ánh nhìn người xem chạy qua dải blur — xấu. Nên tôi thiên hướng pan theo trục dài, mọi thứ stay in frame.",
    },
    { type: "img", mediaId: mediaIds[1], alt: SHOTS[1].altVi },
    { type: "h2", text: "Stack đủ dùng, không hơn" },
    {
      type: "ul",
      items: [
        "Backend: FastAPI + Uvicorn, ~140 dòng code REST + serve static.",
        "Renderer: ffmpeg + ffprobe, gọi qua subprocess. Pipeline ~190 dòng.",
        "Frontend: một file HTML duy nhất, Tailwind từ CDN, SortableJS từ CDN cho drag-reorder. Không bundler, không node_modules.",
      ],
    },
    {
      type: "p",
      text: "Tôi cố tình tránh framework. Đây là tool nội bộ, một người dùng, chạy localhost. Mỗi lớp abstraction là một thứ phải debug khi pin của laptop sắp hết và bạn đang dí một deliverable lúc 11 giờ đêm. Vanilla JS + một CDN cho Tailwind đủ để có giao diện tử tế trong 30 phút, và 6 tháng sau quay lại vẫn đọc được.",
    },
    { type: "h2", text: "Những chi tiết UX nhỏ" },
    {
      type: "p",
      text: "Một số thứ tôi tự cho mình thời gian polish vì tự dùng:",
    },
    {
      type: "ul",
      items: [
        "Drag-to-reorder dùng FLIP animation — ảnh trượt vào vị trí mới chứ không nhảy. SortableJS lo nặng, tôi chỉ thêm vài transition.",
        "Hover thumbnail mới hiện nút replace/delete, click vào ảnh sẽ mở full-size preview. Không có nút nào chiếm chỗ khi không cần.",
        "Output gallery hiện thumbnail từng video đã render, double-click filename để rename inline, hover hiện × để xóa và ↓ để download. Preview tự resize theo aspect của video đang chọn.",
        "Slider duration 1–10 giây, dropdown speed slow/medium/fast, dropdown ratio 1:1 / 16:9 / 9:16 / 4:3 / 3:4. Mỗi setting đều có preview trực tiếp ở khung lớn.",
      ],
    },
    { type: "img", mediaId: mediaIds[2], alt: SHOTS[2].altVi },
    { type: "h2", text: "Render pipeline" },
    {
      type: "p",
      text: "Mỗi slide chạy một trong hai nhánh, rồi build_slideshow concat lại với -c copy nên không có lần encode thứ hai:",
    },
    {
      type: "code",
      language: "bash",
      text: "crop:      [crop ratio] → scale ≥6000px → zoompan → encode\nletterbox: blur-composite → scale 3x → zoompan → encode",
    },
    {
      type: "p",
      text: "Hướng Ken Burns được random cho mỗi slide từ một pool {pan ngang, pan dọc, zoom in, zoom out}. Pool được lọc theo ảnh hiện tại — đứng thì ưu tiên pan dọc, ngang thì pan ngang, vuông thì cả bốn đều đẹp.",
    },
    { type: "h2", text: "Sau dự án này" },
    {
      type: "p",
      text: "Code mở MIT trên GitHub. Tôi có thể sẽ thêm preset 'random' cho duration để mỗi slide có thời lượng khác nhau, và một option chèn nhạc nền với crossfade ở đầu / cuối. Nhưng cốt lõi đã ổn: drop ảnh, click render, nhận video không rung. Đôi khi đó là tất cả những gì cần.",
    },
  ];
}

function en(mediaIds: (number | string)[]): Block[] {
  return [
    {
      type: "p",
      text: "Slideshow Studio is a small weekend app I built: drop in a folder of images, get back a 1080p Ken Burns MP4. No build step, no JavaScript framework, no database. FastAPI on the backend, a single vanilla HTML page on the frontend, ffmpeg doing the heavy lifting. I use it for fashion / product rolls where I want clean motion, predictable framing, and a one-click render.",
    },
    { type: "img", mediaId: mediaIds[0], alt: SHOTS[0].altEn },
    { type: "h2", text: "The hardest problem: the image shakes" },
    {
      type: "p",
      text: "Anyone who has used ffmpeg's zoompan filter knows the feeling: you slow-pan an image over a few seconds, and instead of buttery motion you get pixel-by-pixel hops like an old film loop. The reason is that zoompan computes the crop center per frame using integer math — with a slow camera (zoom 1.06 over 4 seconds = a delta of 0.0005 per frame), a 1920×1280 source simply doesn't have enough resolution to represent smooth motion. Every frame the center moves exactly 0 or 1 pixel; there is no in-between.",
    },
    {
      type: "p",
      text: "My fix is dumb but effective: pre-scale the source so its short edge is ≥ 6000 px before feeding it to zoompan. At that resolution the per-frame delta lives well below one displayed pixel, ffmpeg interpolates smoothly, and the 1080p output is clean. One line of code, a few extra seconds per render, and nobody asks 'why does the video judder' anymore.",
    },
    { type: "h2", text: "Crop or letterbox" },
    {
      type: "p",
      text: "Every image can have a different aspect ratio from the output. Two schools of thought: cover-crop or contain-with-bars. I expose both as a toggle. In Crop mode the image fills the frame and may lose subject — clean and simple when ratios match. In Letterbox mode the image keeps its ratio and the remaining bands are filled with a blurred copy of itself. The subtle bit is that the Ken Burns direction pool has to change too: if you letterbox a vertical image and then pan horizontally, the viewer's eye runs straight across the blurred bands. So I bias the pool toward the long axis — everything stays in frame.",
    },
    { type: "img", mediaId: mediaIds[1], alt: SHOTS[1].altEn },
    { type: "h2", text: "Stack: just enough" },
    {
      type: "ul",
      items: [
        "Backend: FastAPI + Uvicorn, about 140 lines of REST + static serving.",
        "Renderer: ffmpeg + ffprobe over subprocess. ~190-line pipeline.",
        "Frontend: a single HTML file, Tailwind from a CDN, SortableJS from a CDN for drag-reorder. No bundler, no node_modules.",
      ],
    },
    {
      type: "p",
      text: "I went out of my way to avoid frameworks. This is an internal tool, one user, runs on localhost. Every layer of abstraction is something I'd have to debug when my battery is dying and I'm chasing an 11 PM deliverable. Vanilla JS plus a Tailwind CDN gets me a respectable UI in 30 minutes, and 6 months from now I can still read it.",
    },
    { type: "h2", text: "Small UX touches" },
    {
      type: "p",
      text: "A few things I let myself polish, because I'm also the user:",
    },
    {
      type: "ul",
      items: [
        "Drag-to-reorder uses a FLIP animation — thumbnails slide into place instead of snapping. SortableJS does the heavy lifting; I just added a few transitions.",
        "Replace/delete buttons appear only on hover; clicking a thumbnail opens a full-size preview. Nothing fights for space when it isn't needed.",
        "The output gallery shows a thumbnail per rendered video, double-click the filename to rename inline, hover reveals × to delete and ↓ to download. The preview resizes to each video's native aspect when you switch.",
        "Per-slide duration is a 1–10 second slider; speed is a Slow/Medium/Fast dropdown; output ratio is 1:1, 16:9, 9:16, 4:3, 3:4. Every setting previews live in the main viewport.",
      ],
    },
    { type: "img", mediaId: mediaIds[2], alt: SHOTS[2].altEn },
    { type: "h2", text: "Render pipeline" },
    {
      type: "p",
      text: "Each slide runs one of two paths, then build_slideshow concatenates the clips with -c copy so there is no second re-encode:",
    },
    {
      type: "code",
      language: "bash",
      text: "crop:      [crop ratio] → scale ≥6000px → zoompan → encode\nletterbox: blur-composite → scale 3x → zoompan → encode",
    },
    {
      type: "p",
      text: "The Ken Burns direction is randomized per slide from a pool of {pan horizontal, pan vertical, zoom in, zoom out}. The pool is filtered by the current image — portrait biases vertical, landscape biases horizontal, square gets all four.",
    },
    { type: "h2", text: "What's next" },
    {
      type: "p",
      text: "The code is MIT on GitHub. I might add a 'random' duration preset so each slide gets a different length, and an option to drop in a music track with crossfades at the head and tail. But the core is solid: drop images, click render, get a non-shaking video. Some days that's all you need.",
    },
  ];
}

async function main() {
  // Load .env.local from songha.net so Payload can connect
  const envFile = path.join(SONGHA_NET, ".env.local");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  }
  if (process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL.replace(":5432/", ":6543/").replace(
        /[?&]pgbouncer=true/,
        "",
      ) +
      (process.env.DATABASE_URL.includes("?")
        ? "&pgbouncer=true"
        : "?pgbouncer=true");
  }

  // Need to cd into songha.net so payload.config.ts resolves from the right cwd.
  process.chdir(SONGHA_NET);

  const { getPayload } = await import("payload");
  const { default: config } = await import(
    path.join(SONGHA_NET, "payload.config.ts")
  );
  const payload = await getPayload({ config });

  console.log("→ Uploading screenshots…");
  const mediaIds: (number | string)[] = [];
  for (const s of SHOTS) {
    const buf = fs.readFileSync(path.join(SHOTS_DIR, s.file));
    const m = await payload.create({
      collection: "media",
      overrideAccess: true,
      data: { alt: s.altEn },
      file: {
        name: `slideshow-studio-${s.file}`,
        data: buf,
        mimetype: "image/png",
        size: buf.length,
      },
    });
    console.log(`  ✓ ${s.file} → media id=${m.id}`);
    mediaIds.push(m.id);
  }

  // Find post by slug
  const existing = await payload.find({
    collection: "posts",
    where: { slug: { equals: SLUG } },
    limit: 1,
    overrideAccess: true,
  });
  if (existing.docs.length === 0) {
    throw new Error(`Post slug="${SLUG}" not found — run seed-post-slideshow-studio.ts first`);
  }
  const postId = existing.docs[0].id;
  console.log(`→ Updating post id=${postId} (vi + en) with embedded screenshots…`);

  await payload.update({
    collection: "posts",
    id: postId,
    data: { content: lexicalDoc(vi(mediaIds)), thumbnail: mediaIds[0] },
    locale: "vi",
    overrideAccess: true,
  });
  await payload.update({
    collection: "posts",
    id: postId,
    data: { content: lexicalDoc(en(mediaIds)) },
    locale: "en",
    overrideAccess: true,
  });

  console.log("\nDone. Visit:");
  console.log(`  https://www.songha.net/blog/${SLUG}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
