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
import { readFile, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, sep } from "node:path";

import { readRowHeight, writeRowHeight } from "./formTokens.mjs";

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

/** `PORTRAIT_CROP_BY_NAME = { ... };` 블록만 바꾼다. 주변 주석은 건드리지 않는다. */
const CROP_BLOCK = /(const PORTRAIT_CROP_BY_NAME: Readonly<Record<string, PortraitCrop>> = \{)[\s\S]*?(\n\};)/;

function renderCrops(crops) {
  return crops
    .map((one) => {
      const focus = `${Math.round(one.x)}% ${Math.round(one.y)}%`;
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
function knownNames(source) {
  const block = CROP_BLOCK.exec(source);
  if (block === null) return new Set();
  return new Set([...block[0].matchAll(/"([^"]+)":\s*\{\s*focus:/g)].map((m) => m[1]));
}

function writeCrops(crops) {
  const source = readFileSync(PROFILES, "utf8");
  if (!CROP_BLOCK.test(source)) {
    throw new Error("streamerProfiles.ts 에서 PORTRAIT_CROP_BY_NAME 을 찾지 못했다.");
  }
  const known = knownNames(source);
  const unknown = crops.filter((one) => !known.has(one.name)).map((one) => one.name);
  if (unknown.length > 0) {
    throw new Error(
      `모르는 이름이라 쓰지 않았다: ${unknown.join(", ")} (아는 이름: ${[...known].join(", ")})`,
    );
  }
  writeFileSync(PROFILES, source.replace(CROP_BLOCK, `$1${renderCrops(crops)}$2`), "utf8");
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

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function apply(request, response) {
  try {
    const payload = JSON.parse(await readBody(request));
    if (!Array.isArray(payload.crops) || payload.crops.length === 0) {
      throw new Error("crops 가 비어 있다.");
    }
    writeCrops(payload.crops);
    const height = writeRowHeight(payload.rowHeight);
    // 하네스를 다시 만들어야 화면과 소스가 같아진다. 여기서 빼먹으면 툴이
    // "반영됨" 이라고 말한 뒤에도 하네스는 옛 값을 보여 준다.
    await Promise.all(GENERATORS.map(runGenerator));
    response.writeHead(200, { "content-type": MIME[".json"] });
    response.end(JSON.stringify({ ok: true, rowHeight: height }));
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
  serveStatic(request, response);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`초점 툴  http://localhost:${PORT}/`);
  console.log(`하네스   http://localhost:${PORT}/dev/theme-list.html`);
  console.log(`현재 행 높이 ${readRowHeight()}px · 적용은 툴에서 Ctrl+S`);
});
