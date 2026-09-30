import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { RepoScanner, ScriptCompiler, AudioSynthesizer, VideoRenderer, WorkspaceConnector } from "./src/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3344;
const PUBLIC_DIR = path.join(__dirname, "public");
const OUTPUT_DIR = path.join(__dirname, "output");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".wav": "audio/wav"
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  // ─── API Routes ──────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/api/scan") {
    try {
      const { target } = await parseJsonBody(req);
      if (!target) return sendJson(res, 400, { ok: false, error: "target is required" });

      const scanner = new RepoScanner(target);
      const repoData = await scanner.scan();
      return sendJson(res, 200, { ok: true, repoData });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/compile") {
    try {
      const { repoData, docId } = await parseJsonBody(req);
      const workspace = new WorkspaceConnector();
      const brief = await workspace.fetchLaunchBrief(docId);
      const compiler = new ScriptCompiler();
      const storyboard = compiler.compile(repoData || {}, brief);
      return sendJson(res, 200, { ok: true, storyboard });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/render") {
    try {
      const { storyboard, format = "vertical" } = await parseJsonBody(req);
      if (!storyboard || !storyboard.beats) {
        return sendJson(res, 400, { ok: false, error: "Invalid storyboard payload" });
      }

      console.log(`[Server] Rendering "${storyboard.title}" (${format})...`);
      const synthesizer = new AudioSynthesizer({ outputDir: OUTPUT_DIR });
      const audio = await synthesizer.synthesize(storyboard);

      const renderer = new VideoRenderer({ outputDir: OUTPUT_DIR });
      const result = await renderer.render(storyboard, audio.audioPath, format);

      return sendJson(res, 200, {
        ok: true,
        result: {
          ...result,
          videoUrl: `/output/${path.basename(result.outputMp4)}`
        }
      });
    } catch (err) {
      console.error("[Server Render Error]:", err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/slides/export") {
    try {
      const { storyboard } = await parseJsonBody(req);
      const workspace = new WorkspaceConnector();
      const deck = await workspace.exportToGoogleSlides(storyboard || {});
      return sendJson(res, 200, { ok: true, deck });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // ─── Static Files (Output MP4s & Web Assets) ─────────────────
  let filePath;
  if (pathname.startsWith("/output/")) {
    filePath = path.join(OUTPUT_DIR, pathname.replace("/output/", ""));
  } else {
    filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  }

  // Range support for HTML5 video seeking
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range && ext === ".mp4") {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType
      });
      return file.pipe(res);
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("404 Not Found");
});

server.listen(PORT, () => {
  console.log(`\n🎬 LaunchCast Web Studio running at: http://localhost:${PORT}`);
  console.log(`   Interactive Studio UI: http://localhost:${PORT}`);
  console.log(`   Zero-Dependency Native Runtime (Node.js 22)\n`);
});
