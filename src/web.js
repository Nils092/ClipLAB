// Minimaler Web-Rahmen auf Basis von node:http – keine externen Pakete nötig.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".mp4": "video/mp4",
};

function enhance(req, res) {
  const u = new URL(req.url, "http://x");
  req.path = decodeURIComponent(u.pathname);
  req.query = Object.fromEntries(u.searchParams);
  req.ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (obj) => { if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); };
  res.send = (text) => { if (!res.headersSent) res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end(String(text)); };
  res.redirect = (loc) => { res.statusCode = 302; res.setHeader("Location", loc); res.end(); };
  res.cookie = (name, value, o = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path || "/"}`];
    if (o.maxAge != null) parts.push(`Max-Age=${Math.floor(o.maxAge / 1000)}`);
    if (o.httpOnly) parts.push("HttpOnly");
    if (o.secure) parts.push("Secure");
    parts.push(`SameSite=${o.sameSite === "strict" ? "Strict" : "Lax"}`);
    const prev = res.getHeader("Set-Cookie") || [];
    res.setHeader("Set-Cookie", [...[].concat(prev), parts.join("; ")]);
  };
  res.clearCookie = (name, o = {}) => res.cookie(name, "", { ...o, maxAge: 0 });
  res.sendFile = (file, headers = {}) => sendFile(req, res, file, headers);
}

// Liefert Dateien mit Range-Unterstützung (wichtig für Video-Abrufe durch Instagram)
function sendFile(req, res, file, headers = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; return res.end("Nicht gefunden"); }
    const type = headers["Content-Type"] || MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Accept-Ranges", "bytes");
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    let start = 0, end = st.size - 1;
    if (range) {
      if (range[1]) start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), st.size - 1);
      if (!range[1] && range[2]) { start = Math.max(0, st.size - Number(range[2])); end = st.size - 1; }
      if (start > end || start >= st.size) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${st.size}`); return res.end(); }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${st.size}`);
    }
    res.setHeader("Content-Length", end - start + 1);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

async function readJson(req, limit = 200_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error("Anfrage zu groß"), { status: 413 }); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Ungültiges JSON"), { status: 400 }); }
}

// Multipart-Formular lesen (Clips bis maxBytes); nutzt die eingebaute Web-API von Node
async function readForm(req, maxBytes) {
  const len = Number(req.headers["content-length"] || 0);
  if (len > maxBytes) throw Object.assign(new Error(`Datei zu groß (max. ${Math.round(maxBytes / 1048576)} MB)`), { status: 413 });
  let size = 0;
  const guarded = Readable.from((async function* () { for await (const c of req) { size += c.length; if (size > maxBytes) throw Object.assign(new Error("Datei zu groß"), { status: 413 }); yield c; } })());
  const r = new Request("http://x/", { method: "POST", headers: { "content-type": req.headers["content-type"] || "" }, body: Readable.toWeb(guarded), duplex: "half" });
  return r.formData();
}

function createApp() {
  const routes = [];
  const add = (method) => (pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/\//g, "\\/").replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+?)"; }) + "\\/?$");
    routes.push({ method, re, keys, handlers });
  };
  let staticDir = null;
  const app = {
    get: add("GET"), post: add("POST"), put: add("PUT"), patch: add("PATCH"), delete: add("DELETE"),
    static(dir) { staticDir = dir; },
    listen(port, cb) {
      const server = http.createServer(async (req, res) => {
        enhance(req, res);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        try {
          const method = req.method === "HEAD" ? "GET" : req.method;
          for (const r of routes) {
            if (r.method !== method) continue;
            const m = r.re.exec(req.path);
            if (!m) continue;
            req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
            if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && /json/.test(req.headers["content-type"] || "")) req.body = await readJson(req);
            else req.body = req.body || {};
            let i = 0;
            const next = async () => { const h = r.handlers[i++]; if (h) await h(req, res, next); };
            await next();
            return;
          }
          if (staticDir && method === "GET") {
            let p = path.normalize(req.path).replace(/^(\.\.[/\\])+/, "");
            if (p === "/" || p === "\\") p = "/index.html";
            let file = path.join(staticDir, p);
            if (!file.startsWith(staticDir)) return res.status(403).send("Verboten");
            if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html";
            return sendFile(req, res, file);
          }
          res.status(404).json({ error: "Nicht gefunden" });
        } catch (e) {
          if (!e.status) console.error(e);
          if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : "Interner Fehler" });
          else res.end();
        }
      });
      server.requestTimeout = 30 * 60_000; // große Uploads
      return server.listen(port, cb);
    },
  };
  return app;
}

module.exports = { createApp, readForm };
