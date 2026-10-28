// Только тестовый сервер: эмулирует Pages без SPA rewrite и с настоящим HTTP 404.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("dist");
const base = "/moya-kuhnya/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!path.startsWith(base)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let file = resolve(root, path.slice(base.length) || "index.html");
    if (!file.startsWith(root + "/")) {
      res.writeHead(403);
      res.end();
      return;
    }
    let status = 200;
    try {
      if (!(await stat(file)).isFile()) throw new Error();
    } catch {
      file = resolve(root, "404.html");
      status = 404;
    }
    const content = await readFile(file);
    res.writeHead(status, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end();
  }
}).listen(4177, "127.0.0.1");
