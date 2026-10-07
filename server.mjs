import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RepoScanner, ScriptCompiler, AudioSynthesizer, VideoRenderer } from "./src/index.mjs";
import { StudioMediaScope } from "./src/core/StudioMediaScope.mjs";
import { validateStoryboard, prepareOutputDir } from "./src/core/ProcessSafety.mjs";
import { HttpError, admitLocalRequest, requestPath, matchesSession, cookieSession, parseJsonBody, localScanTarget, validateRepoData, serveFile } from "./src/core/StudioHttp.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_FILES = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/index.html", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "application/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]]]);
const POST_ROUTES = new Set(["/api/scan", "/api/compile", "/api/render", "/api/slides/export"]);

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export function createStudioServer(options = {}) {
  const publicDir = fs.realpathSync(options.publicDir || path.join(ROOT, "public"));
  const outputDir = prepareOutputDir(options.outputDir || path.join(ROOT, "output"));
  const configuredRoots = options.scanRoots || [process.cwd()];
  if (!Array.isArray(configuredRoots) || configuredRoots.length < 1 || configuredRoots.length > 16) throw new Error("Configure 1 to 16 local scan roots");
  const scanRoots = configuredRoots.map(root => {
    const real = fs.realpathSync(root);
    if (!fs.statSync(real).isDirectory()) throw new Error("Scan root must be a directory");
    return real;
  });
  const token = randomBytes(32).toString("hex");
  const scannedMedia = new StudioMediaScope();
  const completedOutputs = new Set();
  let busy = false;

  const server = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const cookieName = admitLocalRequest(req);
      const pathname = requestPath(req.url);
      if (req.method === "GET" && pathname === "/api/session") {
        res.setHeader("Set-Cookie", `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
        return json(res, 200, { ok: true, token, mode: "LOCAL_SINGLE_USER" });
      }
      if (req.method === "POST") {
        if (!POST_ROUTES.has(pathname)) throw new HttpError(404, "Route not found");
        if (!matchesSession(req.headers["x-launchcast-session"], token)) throw new HttpError(401, "Reload Studio to establish a local session");
        if (busy) throw new HttpError(429, "Studio is already processing a request");
        busy = true;
        try {
          // Full scan metadata can include 100 multibyte paths plus package metadata.
          const body = await parseJsonBody(req, pathname === "/api/compile" ? 4 * 1024 * 1024 : 64 * 1024);
          if (pathname === "/api/scan") {
            const scanner = new RepoScanner(localScanTarget(body.target, scanRoots));
            const repoData = await scanner.scan();
            scannedMedia.register(scanner.localPath, repoData.mediaAssets);
            return json(res, 200, { ok: true, repoData });
          }
          if (pathname === "/api/compile") {
            if (body.docId) throw new HttpError(501, "Google Docs import is not implemented; no document was read");
            const storyboard = new ScriptCompiler().compile(validateRepoData(body.repoData));
            return json(res, 200, { ok: true, storyboard });
          }
          if (pathname === "/api/slides/export") throw new HttpError(501, "Google Slides export is not implemented; no deck was created");

          const { storyboard, format = "vertical" } = body;
          if (!["vertical", "landscape"].includes(format)) throw new HttpError(400, "Invalid video format");
          try { validateStoryboard(storyboard); } catch { throw new HttpError(400, "Invalid storyboard"); }
          let allowedMediaRoots;
          try { allowedMediaRoots = scannedMedia.rootsFor(storyboard); } catch { throw new HttpError(400, "Scan the repository before using its media"); }
          const renderer = new VideoRenderer({ outputDir, allowedMediaRoots });
          try { for (const beat of storyboard.beats) renderer.mediaInput(beat.mediaAsset); }
          catch { throw new HttpError(400, "Invalid or unavailable scanned media"); }
          const audio = await new AudioSynthesizer({ outputDir }).synthesize(storyboard);
          const result = await renderer.render(storyboard, audio.audioPath, format);
          const name = path.basename(result.outputMp4);
          completedOutputs.add(name);
          while (completedOutputs.size > 100) completedOutputs.delete(completedOutputs.values().next().value);
          return json(res, 200, { ok: true, result: { ...result, outputMp4: name, videoUrl: `/output/${name}` } });
        } finally { busy = false; }
      }
      if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed");
      const asset = PUBLIC_FILES.get(pathname);
      if (asset) return serveFile(req, res, publicDir, asset[0], asset[1]);
      if (pathname.startsWith("/output/")) {
        if (!matchesSession(cookieSession(req.headers.cookie, cookieName), token) && !matchesSession(req.headers["x-launchcast-session"], token)) throw new HttpError(401, "Local Studio session required");
        const name = pathname.slice("/output/".length);
        if (!/^launch_reel_(vertical|landscape)_[a-f0-9-]{36}\.mp4$/.test(name) || !completedOutputs.has(name)) throw new HttpError(404, "Completed render not found in this session");
        return serveFile(req, res, outputDir, name, "video/mp4");
      }
      throw new HttpError(404, "Route not found");
    } catch (error) {
      req.resume();
      if (res.headersSent) return res.destroy();
      res.setHeader("Connection", "close");
      return json(res, error instanceof HttpError ? error.status : 500, { ok: false, error: error instanceof HttpError ? error.message : "Local Studio operation failed" });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 16;
  return server;
}

export function startStudio(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3344);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid Studio port");
  const scanRoots = options.scanRoots || (process.env.LAUNCHCAST_SCAN_ROOTS ? JSON.parse(process.env.LAUNCHCAST_SCAN_ROOTS) : [process.cwd()]);
  const server = createStudioServer({ ...options, scanRoots });
  server.listen(port, "127.0.0.1", () => console.log(`[LaunchCast] Local Studio: http://127.0.0.1:${server.address().port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) startStudio();
