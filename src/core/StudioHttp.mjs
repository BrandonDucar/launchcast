import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { isWithin } from "./ProcessSafety.mjs";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function admitLocalRequest(req) {
  const protectedHeaders = new Set(["host", "origin", "range", "content-type", "content-length", "cookie", "x-launchcast-session", "sec-fetch-site"]);
  const seen = new Set();
  for (let i = 0; i < (req.rawHeaders || []).length; i += 2) {
    const key = req.rawHeaders[i].toLowerCase();
    if (protectedHeaders.has(key) && seen.has(key)) throw new HttpError(400, "Duplicate request header");
    seen.add(key);
  }
  const port = req.socket.localPort;
  const suffix = port === 80 ? "" : `:${port}`;
  const host = req.headers.host;
  if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) || ![`127.0.0.1${suffix}`, `localhost${suffix}`].includes(host)) {
    throw new HttpError(403, "Local Studio authority required");
  }
  if (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) throw new HttpError(403, "Foreign origin rejected");
  if (req.headers["sec-fetch-site"] !== undefined && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])) {
    throw new HttpError(403, "Foreign browser context rejected");
  }
  return `launchcast_session_${port}`;
}

export function requestPath(raw) {
  if (typeof raw !== "string" || raw.length > 8192 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("#")) throw new HttpError(400, "Invalid request target");
  let decoded;
  try { decoded = decodeURIComponent(raw.split("?")[0]); } catch { throw new HttpError(400, "Invalid request encoding"); }
  if (/[\\\x00-\x1f\x7f:]/.test(decoded) || decoded.split("/").some(part => part === "." || part === "..")) throw new HttpError(400, "Invalid request path");
  return decoded;
}

export function matchesSession(value, token) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}

export function cookieSession(cookie, name) {
  if (typeof cookie !== "string") return undefined;
  const values = cookie.split(";").map(item => item.trim()).filter(item => item.startsWith(name + "="));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}

export function parseJsonBody(req, limit = 64 * 1024) {
  if (![64 * 1024, 4 * 1024 * 1024].includes(limit)) throw new Error("Invalid internal request limit");
  const tooLarge = () => new HttpError(413, "Request body exceeds the route limit");
  if (typeof req.headers["content-type"] !== "string" || req.headers["content-type"].split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "application/json is required");
  }
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") throw new HttpError(415, "Compressed request bodies are not supported");
  const declared = req.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw tooLarge();
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = [];
    let settled = false;
    const timer = setTimeout(() => finish(new HttpError(408, "Request body timed out")), 10000);
    timer.unref?.();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener("data", data); req.removeListener("end", end);
      req.removeListener("aborted", aborted); req.removeListener("error", aborted);
      chunks = [];
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const data = chunk => {
      size += chunk.length;
      if (size > limit) return finish(tooLarge());
      chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      try {
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
        finish(null, value);
      } catch { finish(new HttpError(400, "A valid JSON object is required")); }
    };
    const aborted = () => finish(new HttpError(400, "Request body interrupted"));
    req.on("data", data); req.once("end", end); req.once("aborted", aborted); req.once("error", aborted);
  });
}

export function localScanTarget(target, roots) {
  if (typeof target !== "string" || !target || target.length > 4096 || /[\x00-\x1f]/.test(target) || /^[\\/]{2}/.test(target)) throw new HttpError(400, "Invalid local scan target");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(target) || target.startsWith("git@")) throw new HttpError(403, "Remote cloning is disabled in Studio; clone with the trusted CLI first");
  const resolved = path.resolve(target);
  const root = roots.find(candidate => isWithin(candidate, resolved));
  if (!root) throw new HttpError(403, "Scan target is outside the configured roots");
  try {
    let current = root;
    for (const component of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
      if (component.includes(":")) throw new Error("Invalid path component");
      current = path.join(current, component);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink target");
    }
    const real = fs.realpathSync(resolved);
    if (!isWithin(root, real) || !fs.statSync(real).isDirectory()) throw new Error("Invalid directory");
    return real;
  } catch { throw new HttpError(400, "Scan target must be an existing non-symlink directory within a configured root"); }
}

export function validateRepoData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid repository metadata");
  const text = (input, max) => input === undefined || (typeof input === "string" && input.length <= max && !/[\x00-\x1f]/.test(input));
  if (!text(value.name, 200) || !text(value.description, 2000) || !text(value.tagline, 2000)) throw new HttpError(400, "Repository copy exceeds its input bounds");
  if (value.features !== undefined && (!Array.isArray(value.features) || value.features.length > 8 || value.features.some(item => !item || typeof item.title !== "string" || !text(item.title, 200) || !text(item.description, 2000)))) throw new HttpError(400, "Invalid repository features");
  if (value.mediaAssets !== undefined && (!Array.isArray(value.mediaAssets) || value.mediaAssets.length > 100 || value.mediaAssets.some(item => !item || typeof item.name !== "string" || typeof item.path !== "string" || !text(item.name, 512) || !text(item.path, 4096)))) throw new HttpError(400, "Invalid repository media");
  return value;
}

export function byteRange(header, size) {
  if (header === undefined) return null;
  const match = typeof header === "string" && /^bytes=(\d*)-(\d*)$/.exec(header);
  const fail = () => { throw new HttpError(416, "Requested range is not satisfiable"); };
  if (!match || !size || (!match[1] && !match[2])) return fail();
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ([first, last].some(value => value !== undefined && !Number.isSafeInteger(value))) return fail();
  if (first === undefined) {
    if (!last) return fail();
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return fail();
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

export function serveFile(req, res, root, name, contentType) {
  let fd;
  try {
    const file = fs.realpathSync(path.join(root, name));
    if (!isWithin(root, file)) throw new HttpError(404, "File not found");
    const before = fs.statSync(file);
    if (!before.isFile()) throw new HttpError(404, "File not found");
    fd = fs.openSync(file, "r");
    const stat = fs.fstatSync(fd);
    if (stat.ino !== before.ino || stat.dev !== before.dev || !stat.isFile()) throw new HttpError(404, "File not found");
    let range;
    try { range = contentType === "video/mp4" ? byteRange(req.headers.range, stat.size) : null; }
    catch (error) { res.setHeader("Content-Range", `bytes */${stat.size}`); throw error; }
    const headers = { "Content-Type": contentType, "Content-Length": range ? range.end - range.start + 1 : stat.size };
    if (contentType === "video/mp4") headers["Accept-Ranges"] = "bytes";
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") { fs.closeSync(fd); fd = undefined; return res.end(); }
    const stream = fs.createReadStream(file, { fd, autoClose: true, ...(range || {}) });
    fd = undefined;
    stream.on("error", () => res.destroy());
    res.once("close", () => stream.destroy());
    return stream.pipe(res);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, "File not found");
  }
}
