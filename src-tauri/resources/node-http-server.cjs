"use strict";

// Built-in static file server shipped with Extension Sync ("Node 服务管理" mode).
// Launched by the Rust backend as `node node-http-server.cjs [--host <addr>] --port <n>`
// with the service folder as the working directory. Zero npm dependencies so it
// works offline.
//
// Contract with the app UI: once listening, prints a single line
//   HTTP_SERVER_READY http://<host>:<port>
// on stdout; the frontend parses it to show the URL and an "open in browser"
// button. Host defaults to 127.0.0.1; with 0.0.0.0 the READY line carries the
// first detectable LAN IPv4 instead of the bind address so the URL is directly
// shareable, and every other interface is listed via HTTP_SERVER_ALSO lines.

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

function parsePort(argv) {
  const flagIndex = argv.indexOf("--port");
  if (flagIndex === -1 || argv[flagIndex + 1] === undefined) return 0;
  const parsed = Number(argv[flagIndex + 1]);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 0;
}

function parseHost(argv) {
  const flagIndex = argv.indexOf("--host");
  if (flagIndex === -1 || argv[flagIndex + 1] === undefined) return "127.0.0.1";
  const parsed = String(argv[flagIndex + 1]).trim();
  return parsed || "127.0.0.1";
}

// Reachable IPv4 addresses for the READY URL when binding all interfaces.
// Virtual adapters (vEthernet/Hyper-V/WSL/VPN) often put odd subnets first, so
// typical LAN ranges are preferred over everything else.
function lanIPv4Addresses() {
  const found = new Set();
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue; // link-local, unreachable
      found.add(info.address);
    }
  }
  const rank = (address) => {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return [...found].sort((a, b) => rank(a) - rank(b));
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
};

const ROOT = path.resolve(process.cwd());
const PORT = parsePort(process.argv.slice(2));
const HOST = parseHost(process.argv.slice(2));

function mimeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}

// Resolves a URL pathname inside ROOT; returns null when the target would escape it.
function safeResolve(urlPathname) {
  if (urlPathname.includes("\0")) return null;
  const resolved = path.resolve(ROOT, `.${urlPathname}`);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

function sendText(res, status, body, headers) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...(headers || {}) });
  res.end(body);
}

function sendFile(res, req, filePath, stat) {
  res.writeHead(200, {
    "Content-Type": mimeFor(filePath),
    "Content-Length": stat.size,
    "Cache-Control": "no-cache",
    "Last-Modified": stat.mtime.toUTCString(),
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

async function renderDirectory(res, urlPathname, dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const items = entries
    .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  const rows = await Promise.all(
    items.map(async (item) => {
      let detail = "";
      try {
        const stat = await fs.promises.stat(path.join(dirPath, item.name));
        const size = item.isDir ? "-" : formatSize(stat.size);
        const mtime = stat.mtime.toISOString().slice(0, 19).replace("T", " ");
        detail = `<span class="meta">${size} · ${mtime}</span>`;
      } catch {}
      const href = encodeURIComponent(item.name) + (item.isDir ? "/" : "");
      return `<li><a href="${href}">${escapeHtml(item.name)}${item.isDir ? "/" : ""}</a>${detail}</li>`;
    }),
  );
  const parentRow =
    urlPathname === "/"
      ? ""
      : `<li><a href="../">&#x21B0; 上一级</a></li>`;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Index of ${escapeHtml(urlPathname)}</title>
<style>
  body { font: 14px/1.6 ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif; max-width: 860px; margin: 32px auto; padding: 0 16px; color: #1f2937; }
  h1 { font-size: 15px; font-weight: 600; margin-bottom: 12px; word-break: break-all; }
  ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid #e5e7eb; }
  li { display: flex; align-items: center; gap: 12px; padding: 6px 4px; border-bottom: 1px solid #e5e7eb; }
  a { color: #2563eb; text-decoration: none; word-break: break-all; }
  a:hover { text-decoration: underline; }
  .meta { margin-left: auto; color: #6b7280; font-size: 12px; white-space: nowrap; }
</style>
</head>
<body>
<h1>Index of ${escapeHtml(urlPathname)}</h1>
<ul>${parentRow}${rows.join("")}</ul>
</body>
</html>`;
  sendText(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
}

async function handle(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    sendText(res, 400, "Bad Request");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, 400, "Bad Request");
    return;
  }
  const target = safeResolve(pathname);
  if (!target) {
    sendText(res, 403, "Forbidden");
    return;
  }
  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) sendText(res, 404, "Not Found");
    else if (error && error.code === "EACCES") sendText(res, 403, "Forbidden");
    else sendText(res, 500, "Internal Server Error");
    return;
  }
  if (stat.isDirectory()) {
    if (!pathname.endsWith("/")) {
      res.writeHead(301, { Location: encodeURI(pathname) + "/" });
      res.end();
      return;
    }
    const indexPath = path.join(target, "index.html");
    try {
      const indexStat = await fs.promises.stat(indexPath);
      if (indexStat.isFile()) {
        sendFile(res, req, indexPath, indexStat);
        return;
      }
    } catch {}
    await renderDirectory(res, pathname, target);
    return;
  }
  if (stat.isFile()) {
    sendFile(res, req, target, stat);
    return;
  }
  sendText(res, 403, "Forbidden");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(`internal error: ${error && error.message ? error.message : error}`);
    if (!res.headersSent) sendText(res, 500, "Internal Server Error");
    else res.destroy();
  });
  res.on("finish", () => {
    let target = req.url || "/";
    try {
      target = decodeURIComponent(target.split("?")[0]);
    } catch {}
    console.log(
      `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${req.method} ${res.statusCode} ${target}`,
    );
  });
});

server.on("error", (error) => {
  console.error(`HTTP 服务启动失败: ${error && error.message ? error.message : error}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : PORT;
  if (HOST === "0.0.0.0" || HOST === "::") {
    // The bind address itself is not a shareable URL, so report the first
    // reachable LAN IPv4 instead; remaining interfaces follow via HTTP_SERVER_ALSO.
    const lan = lanIPv4Addresses();
    console.log(`HTTP_SERVER_READY http://${lan[0] || "127.0.0.1"}:${port}`);
    for (const extra of lan.slice(1)) {
      console.log(`HTTP_SERVER_ALSO http://${extra}:${port}`);
    }
    if (lan.length === 0) {
      console.error("未检测到局域网 IPv4 地址，仅本机可直接访问");
    }
  } else {
    console.log(`HTTP_SERVER_READY http://${HOST}:${port}`);
  }
  console.log(`HTTP_SERVER_ROOT ${ROOT}`);
});
