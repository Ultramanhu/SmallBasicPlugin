#!/usr/bin/env node
/*
 * Minimal static file server for the standalone web RunHost.
 *
 * A browser refuses to load WebAssembly (and Blazor's boot resources) from
 * file:// URLs, so the runhost/web distribution ships this dependency-free
 * server. It serves the folder it lives in, negotiates the precompressed
 * .br/.gz copies of the Blazor framework files, opens the default browser and
 * falls back to index.html for unknown routes (the same behaviour as the CLI
 * RunHost).
 *
 * Usage:
 *   node serve.mjs                # http://127.0.0.1:8321 + default browser
 *   node serve.mjs --no-open      # server only
 *   node serve.mjs --port 9000    # pick the first port to try
 *   PORT=9000 HOST=0.0.0.0 node serve.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const arguments_ = process.argv.slice(2);
const portArgumentIndex = arguments_.indexOf("--port");
const portArgument = portArgumentIndex >= 0 ? Number(arguments_[portArgumentIndex + 1]) : Number.NaN;
const preferredPort = Number.isFinite(portArgument) && portArgument > 0
  ? portArgument
  : Number(process.env.PORT ?? 8321);
const host = process.env.HOST ?? "127.0.0.1";
const openBrowserAfterStart = !arguments_.some((argument) => argument === "--no-open");

const MIME_TYPES = {
  ".br": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".dat": "application/octet-stream",
  ".dll": "application/octet-stream",
  ".gz": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdb": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2"
};

function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }

  const target = path.resolve(root, decoded.replace(/^\/+/, ""));
  if (target !== root && !target.startsWith(root + path.sep)) {
    return undefined;
  }

  return target;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(candidate) {
  return MIME_TYPES[path.extname(candidate).toLowerCase()] ?? "application/octet-stream";
}

function send(request, response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function handle(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  let file = resolvePath(url.pathname);
  if (!file) {
    send(request, response, 403, "Forbidden");
    return;
  }

  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, "index.html");
    }
  } catch {
    send(request, response, 404, "Not found");
    return;
  }

  const acceptEncoding = String(request.headers["accept-encoding"] ?? "");
  let served = file;
  let encoding;
  if (acceptEncoding.includes("br") && isFile(file + ".br")) {
    served = file + ".br";
    encoding = "br";
  } else if (acceptEncoding.includes("gzip") && isFile(file + ".gz")) {
    served = file + ".gz";
    encoding = "gzip";
  }

  if (!isFile(served)) {
    const fallback = path.join(root, "index.html");
    if (url.pathname.startsWith("/_framework/") || !isFile(fallback)) {
      send(request, response, 404, `Not found: ${url.pathname}`);
      return;
    }

    served = fallback;
    encoding = undefined;
  }

  const headers = {
    "Cache-Control": "no-cache",
    "Content-Length": String(fs.statSync(served).size),
    "Content-Type": contentTypeFor(isFile(file) ? file : served)
  };
  if (encoding) {
    headers["Content-Encoding"] = encoding;
    headers["Vary"] = "Accept-Encoding";
  }

  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(served).pipe(response);
}

// The page cannot boot Blazor from file://, so the friendliest entry point for a
// double-clicked run.cmd / 'node serve.mjs' is to also open the browser.
function openInBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    console.log(`Could not open a browser automatically. Open ${url} manually.`);
  }
}

function listen(server, port, attemptsLeft) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(server, port + 1, attemptsLeft - 1);
      return;
    }

    throw error;
  });
  server.listen(port, host, () => {
    const url = `http://${host}:${port}/`;
    console.log(`Small Basic web RunHost: ${url}`);
    console.log("Press Ctrl+C to stop.");
    if (openBrowserAfterStart) {
      console.log("Opening the default browser (use --no-open to skip).");
      openInBrowser(url);
    }
  });
}

listen(http.createServer(handle), preferredPort, 20);
