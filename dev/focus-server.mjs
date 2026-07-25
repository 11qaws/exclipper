/**
 * Serves the tuning tool and writes what it produces back into the source.
 *
 *   npm run dev:focus     →  http://localhost:5178/
 *
 * A page opened from file:// cannot write files, so copy-and-paste was the only
 * way to get values out of the tool — and a value that has to be pasted is a
 * value that gets pasted wrong, or not at all. This process gives the tool
 * somewhere to POST: it rewrites the crop table and the row height, then
 * regenerates every harness so what is on screen matches what ships.
 *
 * Dev-only. It binds to loopback and serves nothing outside the project.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, sep } from "node:path";

import { readRowMetrics, writeToken } from "./formTokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PROFILES = join(root, "src", "app", "streamerProfiles.ts");
const PORT = 5178;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const GENERATORS = ["gen-theme-list.mjs", "gen-forms.mjs", "gen-focus-picker.mjs"];

/** 표 블록만 바꾼다. 주변 주석은 건드리지 않는다. */
const CROP_BLOCK = /(const PORTRAIT_CROP_BY_NAME: Readonly<Record<string, PortraitCrop>> = \{)[\s\S]*?(\n\};)/;
const SUBTITLE_BLOCK = /(const SUBTITLE_BY_NAME: Readonly<Record<string, string>> = \{)[\s\S]*?(\n\};)/;
const PROFILE_FILE_BLOCK = /(const PROFILE_FILE_BY_NAME: Readonly<Record<string, string>> = \{)[\s\S]*?(\n\};)/;

/** 받아들이는 그림 형식. 브라우저가 확실히 그리는 것만 둔다. */
const IMAGE_EXTENSIONS = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 확대 배율의 허용 범위. 도구의 슬라이더와 같은 값이어야 한다. */
const ZOOM_RANGE = { min: 1, max: 3.5 };

function renderCrops(crops) {
  return crops
    .map((one) => {
      const focus = `${Math.round(one.x)}% ${Math.round(one.y)}%`;
      if (!(one.zoom >= ZOOM_RANGE.min && one.zoom <= ZOOM_RANGE.max)) {
        throw new Error(
          `${one.name} 의 확대가 범위를 벗어났다: ${one.zoom} (${ZOOM_RANGE.min}–${ZOOM_RANGE.max})`,
        );
      }
      const zoom = Number(one.zoom.toFixed(2));
      return `\n  ${JSON.stringify(one.name)}: { focus: ${JSON.stringify(focus)}, zoom: ${zoom} },`;
    })
    .join("");
}

/**
 * 이름은 요청에서 오는 값을 믿지 않고, 소스에 이미 있는 이름과 대조한다.
 *
 * 이 표의 키는 `participantRoster` 의 `displayName` 과 정확히 일치해야 동작한다.
 * 요청이 준 문자열을 그대로 쓰면 인코딩이 어긋난 클라이언트 하나가 조용히
 * 깨진 키를 심고, 그때부터 초점은 아무에게도 적용되지 않는다 — 화면은 그냥
 * 가운데로 잘린 채 멀쩡해 보인다.
 */
/**
 * 표의 키를 읽는다. **따옴표가 있을 수도 없을 수도 있다** — 한국어 이름은 식별자로
 * 쓸 수 있어 손으로 적으면 따옴표 없이 남고, 도구가 다시 쓰면 따옴표가 붙는다.
 * 한쪽만 보면 절반을 놓치고, 놓친 쪽은 "모르는 이름"으로 조용히 거절된다.
 */
const ENTRY_KEY = String.raw`(?:"([^"]+)"|([^\s:,{}"]+))\s*:\s*`;

function entryKeys(block, valuePattern) {
  return [...block.matchAll(new RegExp(ENTRY_KEY + valuePattern, "g"))].map(
    (m) => m[1] ?? m[2],
  );
}

function knownNames(source) {
  const block = CROP_BLOCK.exec(source);
  if (block === null) return new Set();
  return new Set(entryKeys(block[0], String.raw`\{\s*focus:`));
}

function renderStrings(entries) {
  return entries
    .map((one) => `\n  ${JSON.stringify(one.key)}: ${JSON.stringify(one.value)},`)
    .join("");
}

function assertKnown(source, names) {
  const known = knownNames(source);
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `모르는 이름이라 쓰지 않았다: ${unknown.join(", ")} (아는 이름: ${[...known].join(", ")})`,
    );
  }
  return known;
}

function writeCrops(crops) {
  const source = readFileSync(PROFILES, "utf8");
  if (!CROP_BLOCK.test(source) || !SUBTITLE_BLOCK.test(source)) {
    throw new Error("streamerProfiles.ts 에서 바꿔 쓸 표를 찾지 못했다.");
  }
  assertKnown(source, crops.map((one) => one.name));
  const subtitles = crops.map((one) => ({ key: one.name, value: String(one.subtitle ?? "") }));
  const next = source
    .replace(CROP_BLOCK, `$1${renderCrops(crops)}$2`)
    .replace(SUBTITLE_BLOCK, `$1${renderStrings(subtitles)}$2`);
  writeFileSync(PROFILES, next, "utf8");
}

/**
 * 새 그림을 받아 저장하고, 그 인물이 가리키는 파일명을 바꾼다.
 *
 * 파일명은 인물 id 로 고정한다 — 올린 파일 이름을 그대로 쓰면 경로가 섞이거나
 * 공백·한글이 들어가 배포에서만 404 가 난다. 확장자는 우리가 아는 형식에서만
 * 고르므로 요청이 정하지 못한다.
 */
function saveImage(id, contentType, bytes) {
  const extension = IMAGE_EXTENSIONS[contentType];
  if (extension === undefined) {
    throw new Error(`받지 않는 형식이다: ${contentType} (png · jpeg · webp 만)`);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`파일이 너무 크다: ${Math.round(bytes.length / 1024)}KB (최대 8MB)`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`쓸 수 없는 id 다: ${id}`);
  }

  const source = readFileSync(PROFILES, "utf8");
  const block = PROFILE_FILE_BLOCK.exec(source);
  if (block === null) {
    throw new Error("streamerProfiles.ts 에서 PROFILE_FILE_BY_NAME 을 찾지 못했다.");
  }
  const entries = [
    ...block[0].matchAll(new RegExp(ENTRY_KEY + String.raw`"([^"]+)"`, "g")),
  ].map((m) => ({ key: m[1] ?? m[2], value: m[3] }));
  const target = entries.find((one) => one.value.replace(/\.\w+$/, "") === id);
  if (target === undefined) {
    throw new Error(`아는 인물이 아니다: ${id}`);
  }

  const fileName = `${id}${extension}`;
  writeFileSync(join(root, "public", "streamers", fileName), bytes);

  /*
   * 확장자가 바뀌면 이전 파일을 지운다.
   *
   * 남겨 두면 404 가 나지 않는다 — 아직 옛 이름을 가리키는 곳이 있으면 옛 그림을
   * 멀쩡히 그리고, 화면은 정상으로 보이는데 바뀐 그림만 안 나온다. 그런 고장은
   * 원인을 찾기 어렵다. 되돌리기는 git 이 한다.
   */
  if (target.value !== fileName) {
    try {
      unlinkSync(join(root, "public", "streamers", target.value));
    } catch {
      // 이미 없으면 그만이다.
    }
  }
  target.value = fileName;
  writeFileSync(
    PROFILES,
    source.replace(PROFILE_FILE_BLOCK, `$1${renderStrings(entries)}$2`),
    "utf8",
  );
  return fileName;
}

function runGenerator(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", join("dev", script)], {
      cwd: root,
      shell: process.platform === "win32",
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} 실패 (exit ${code})`)),
    );
  });
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      // 무한정 받아 메모리를 채우지 않는다.
      if (total > MAX_IMAGE_BYTES) {
        request.destroy();
        reject(new Error("본문이 너무 크다 (최대 8MB)"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readBody(request) {
  return (await readRawBody(request)).toString("utf8");
}

async function upload(request, response) {
  try {
    const url = new URL(request.url, "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    const contentType = request.headers["content-type"] ?? "";
    const fileName = saveImage(id, contentType, await readRawBody(request));
    await Promise.all(GENERATORS.map(runGenerator));
    response.writeHead(200, { "content-type": MIME[".json"] });
    response.end(JSON.stringify({ ok: true, fileName }));
  } catch (cause) {
    response.writeHead(500, { "content-type": MIME[".json"] });
    response.end(JSON.stringify({ ok: false, error: String(cause?.message ?? cause) }));
  }
}

async function apply(request, response) {
  try {
    const payload = JSON.parse(await readBody(request));
    if (!Array.isArray(payload.crops) || payload.crops.length === 0) {
      throw new Error("crops 가 비어 있다.");
    }
    writeCrops(payload.crops);
    const rowHeight = writeToken("rowHeight", payload.rowHeight);
    const bleedWidth = writeToken("bleedWidth", payload.bleedWidth);
    const designWidth = writeToken("designWidth", payload.designWidth);
    const titleSize = writeToken("titleSize", payload.titleSize);
    const subSize = writeToken("subSize", payload.subSize);
    // 하네스를 다시 만들어야 화면과 소스가 같아진다. 여기서 빼먹으면 툴이
    // "반영됨" 이라고 말한 뒤에도 하네스는 옛 값을 보여 준다.
    await Promise.all(GENERATORS.map(runGenerator));
    response.writeHead(200, { "content-type": MIME[".json"] });
    response.end(
      JSON.stringify({ ok: true, rowHeight, bleedWidth, designWidth, titleSize, subSize }),
    );
  } catch (cause) {
    response.writeHead(500, { "content-type": MIME[".json"] });
    response.end(JSON.stringify({ ok: false, error: String(cause?.message ?? cause) }));
  }
}

function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const requested = url.pathname === "/" ? "/dev/focus-picker.html" : url.pathname;
  // 프로젝트 밖으로 나가는 경로는 거절한다.
  const target = normalize(join(root, decodeURIComponent(requested)));
  if (!target.startsWith(root + sep)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404).end("not found");
      return;
    }
    const dot = target.lastIndexOf(".");
    response.writeHead(200, {
      "content-type": MIME[target.slice(dot)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(data);
  });
}

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/apply") {
    void apply(request, response);
    return;
  }
  if (request.method === "POST" && request.url.startsWith("/upload")) {
    void upload(request, response);
    return;
  }
  serveStatic(request, response);
}).listen(PORT, "127.0.0.1", () => {
  const metrics = readRowMetrics();
  console.log(`초점 툴  http://localhost:${PORT}/`);
  console.log(`하네스   http://localhost:${PORT}/dev/theme-list.html`);
  console.log(
    `현재 행 ${metrics.designWidth}×${metrics.rowHeight}px · 사진 폭 ${metrics.bleedWidth}% · 적용은 툴에서 Ctrl+S`,
  );
});
