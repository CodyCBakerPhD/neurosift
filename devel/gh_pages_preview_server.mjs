// Static server that mimics how GitHub Pages serves a project site, so a
// preview build can be exercised locally exactly as it will be served at
// https://<owner>.github.io/<repo>/.
//
// The two behaviors that matter, and that `vite preview` does not reproduce:
//
//   1. The site lives under /<repo>/, not at the domain root, so a wrong
//      base path shows up here as a 404 on the hashed assets.
//   2. There is no rewrite engine. The only fallback is the site's single
//      404.html, served with a 404 status. Deep links work only because
//      that file is a copy of index.html and the router resolves the route
//      client-side - which this server reproduces, status code included.
//
// Usage: node devel/gh_pages_preview_server.mjs <root-dir> <base-path> <port>

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const [, , rootDirArg, basePathArg, portArg] = process.argv;

if (!rootDirArg || !basePathArg || !portArg) {
  console.error(
    "usage: node devel/gh_pages_preview_server.mjs <root-dir> <base-path> <port>",
  );
  process.exit(1);
}

const rootDir = path.resolve(rootDirArg);
// e.g. "/neurosift/"
const basePath = basePathArg.endsWith("/") ? basePathArg : `${basePathArg}/`;
const port = Number(portArg);

// Pages serves one 404.html for the whole site: the one at the published
// root, which for this layout is the site's own directory.
const notFoundFile = path.join(rootDir, basePath, "404.html");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const contentTypeFor = (filePath) =>
  CONTENT_TYPES[path.extname(filePath).toLowerCase()] ||
  "application/octet-stream";

const fileAt = async (filePath) => {
  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return await fileAt(path.join(filePath, "index.html"));
    }
    return stats.isFile() ? filePath : null;
  } catch {
    return null;
  }
};

const send = (res, status, filePath) => {
  res.writeHead(status, { "content-type": contentTypeFor(filePath) });
  createReadStream(filePath).pipe(res);
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${port}`);

  // Anything outside the site's own directory is a different Pages site
  // (or nothing at all) - refuse it rather than quietly serving the app,
  // so a base-path mistake cannot look like it works.
  let resolved = null;
  if (pathname === basePath || pathname.startsWith(basePath)) {
    const candidate = path.join(rootDir, decodeURIComponent(pathname));
    // Reject traversal outside the root.
    if (candidate === rootDir || candidate.startsWith(rootDir + path.sep)) {
      resolved = await fileAt(candidate);
    }
  }

  if (resolved) {
    send(res, 200, resolved);
    return;
  }

  const fallback = await fileAt(notFoundFile);
  if (fallback) {
    // The status Pages itself returns for a deep link. The app still boots.
    send(res, 404, fallback);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("404 - and no 404.html was published either\n");
});

server.listen(port, () => {
  console.log("");
  console.log(
    `  Preview (GitHub Pages layout): http://localhost:${port}${basePath}`,
  );
  console.log(
    `  Deep link check:               http://localhost:${port}${basePath}dandi`,
  );
  console.log("");
  console.log("  Ctrl-C to stop.");
});
