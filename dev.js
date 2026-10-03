// Local preview server. Mimics how Vercel routes this project: static files
// from public/, and api/config.js as a function at /api/config.
//
// Only for local development - Vercel does not run this file.
//   node dev.js [port]

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");

// Minimal .env.local loader, so local runs match what Vercel injects.
// Re-run on every /api/config request so edits apply without a restart.
// Variables set in the shell still win over the files.
const SHELL_ENV = new Set(Object.keys(process.env));
const fromFiles = new Set();

function loadEnvFiles() {
  for (const k of fromFiles) delete process.env[k];
  fromFiles.clear();
  for (const file of [".env.local", ".env"]) {
    const p = path.join(__dirname, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || SHELL_ENV.has(m[1]) || fromFiles.has(m[1])) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      fromFiles.add(m[1]);
    }
  }
}
loadEnvFiles();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// The functions Vercel would build from api/*.js.
const API = {
  "/api/config": require("./api/config.js"),
  "/api/payments": require("./api/payments.js"),
  "/api/admin": require("./api/admin.js"),
};

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e5) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    const handler = API[url.pathname];
    if (handler) {
      loadEnvFiles();
      // Shim the request/response helpers Vercel's Node runtime provides.
      req.query = Object.fromEntries(url.searchParams);
      req.body = req.method === "POST" ? await readJsonBody(req) : undefined;
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (body) => {
        res.setHeader("Content-Type", MIME[".json"]);
        // Locally, never let the browser keep a stale response.
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(body));
      };
      return handler(req, res);
    }

    const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.statusCode = 404;
        return res.end("Not found");
      }
      res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
    });
  })
  .listen(PORT, () => {
    const ok = process.env.UPI_VPA && process.env.UPI_PAYEE_NAME;
    console.log("\n  Local preview:  http://localhost:" + PORT);
    console.log(
      ok
        ? "  Payee:          " + process.env.UPI_PAYEE_NAME + "  <" + process.env.UPI_VPA + ">"
        : "  No UPI_VPA / UPI_PAYEE_NAME found. Copy .env.example to .env.local and fill it in."
    );
    console.log(
      process.env.ADMIN_TOKEN
        ? "  Verify claims:  http://localhost:" + PORT + "/admin.html\n"
        : "  No ADMIN_TOKEN set, so /admin.html will refuse to load claims.\n"
    );
  });
