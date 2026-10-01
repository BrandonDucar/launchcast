import fs from "node:fs";
import path from "node:path";
import { isWithin, regularInput, runProcess } from "./ProcessSafety.mjs";

function publicGitHubTarget(target) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(target)) {
    throw new Error("Remote scan requires a public https://github.com/owner/repo URL; clone private repositories separately");
  }
  const name = target.split("/").at(-1);
  if (name === "." || name === "..") throw new Error("Invalid repository name");
  return target;
}

/**
 * Scans a local directory or clones a GitHub URL to extract technical & narrative signals.
 */
export class RepoScanner {
  /**
   * @param {string} targetPathOrUrl - Local directory path or public GitHub HTTPS URL
   */
  constructor(targetPathOrUrl, options = {}) {
    this.target = targetPathOrUrl;
    this.localPath = null;
    this.isCloned = false;
    this.cacheRoot = path.resolve(options.cacheRoot || path.join(process.cwd(), ".launchcast_cache"));
  }

  /**
   * Resolves target to a local directory path.
   */
  async resolve() {
    if (typeof this.target !== "string" || this.target.length < 1 || this.target.length > 4096 || /[\x00-\x1f]/.test(this.target)) {
      throw new Error("Invalid scan target");
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(this.target) || this.target.startsWith("git@")) {
      const target = publicGitHubTarget(this.target);
      fs.mkdirSync(this.cacheRoot, { recursive: true });
      const root = fs.realpathSync(this.cacheRoot);
      const job = fs.mkdtempSync(path.join(root, "repo-"));
      const empty = path.join(job, "empty");
      fs.mkdirSync(empty);
      const env = {};
      // No ambient Git rewrites, credentials, hooks, filters, proxy or SSH settings.
      for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"]) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
      }
      Object.assign(env, { HOME: empty, USERPROFILE: empty, XDG_CONFIG_HOME: empty,
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(empty, "no-config"),
        GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_LFS_SKIP_SMUDGE: "1" });
      try {
        runProcess("git", ["-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "protocol.allow=never",
          "-c", "protocol.https.allow=always", "-c", `core.hooksPath=${empty}`, "clone", "--depth", "1", "--single-branch", "--no-tags",
          `--template=${empty}`, "--", target, path.join(job, "source")], { cwd: job, env, timeout: 60000 });
        this.localPath = fs.realpathSync(path.join(job, "source"));
        if (!isWithin(job, this.localPath) || !fs.statSync(this.localPath).isDirectory()) throw new Error("Clone did not produce a directory");
        this.isCloned = true;
      } catch (error) {
        if (path.dirname(job) === root && path.basename(job).startsWith("repo-")) fs.rmSync(job, { recursive: true, force: true });
        throw error;
      }
    } else {
      if (/^[\\/]{2}/.test(this.target)) throw new Error("Network paths are not supported");
      this.localPath = fs.realpathSync(path.resolve(this.target));
    }

    if (!fs.statSync(this.localPath).isDirectory()) throw new Error("Scan target must be a directory");

    return this.localPath;
  }

  /**
   * Extracts structured metadata from the repository.
   */
  async scan() {
    await this.resolve();

    const result = {
      name: path.basename(this.localPath),
      tagline: "",
      description: "",
      architecture: [],
      features: [],
      mediaAssets: [],
      techStack: [],
      stats: { files: 0, commits: 0 }
    };

    // 1. Read package.json / Cargo.toml if available
    const pkgPath = path.join(this.localPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(this.readMetadata(pkgPath));
        result.name = typeof pkg.name === "string" ? pkg.name.slice(0, 200) : result.name;
        result.description = typeof pkg.description === "string" ? pkg.description.slice(0, 2000) : "";
        result.techStack = Object.keys(pkg.dependencies || {});
      } catch (e) {}
    }

    // 2. Read README.md
    const readmeNames = ["README.md", "readme.md", "README.MD", "Readme.md"];
    let readmeContent = "";
    for (const rName of readmeNames) {
      const rPath = path.join(this.localPath, rName);
      if (fs.existsSync(rPath)) {
        readmeContent = this.readMetadata(rPath);
        break;
      }
    }

    if (readmeContent) {
      this.parseReadme(readmeContent, result);
    }

    // 3. Scan for existing images, logos, demo videos
    result.mediaAssets = this.discoverMediaAssets(this.localPath);

    return result;
  }

  readMetadata(file) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Metadata symlinks are not supported");
    return fs.readFileSync(regularInput(file, [this.localPath], 1024 * 1024), "utf8");
  }

  /**
   * Parses markdown README to extract headings, bullets, and tagline.
   */
  parseReadme(markdown, result) {
    const lines = markdown.split("\n");
    let foundFirstHeading = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Heading 1 (# Name)
      if (line.startsWith("# ") && !foundFirstHeading) {
        result.name = line.replace("# ", "").replace(/[^\w\s\-\.\_]/g, "").trim();
        foundFirstHeading = true;
        continue;
      }

      // Blockquotes (> "When plans change...")
      if (line.startsWith("> ") && !result.tagline) {
        result.tagline = line.replace(/^>\s*(\*\*)?/, "").replace(/(\*\*)?$/, "").trim();
        continue;
      }

      // Feature bullet points (- **Feature**: Description)
      if (line.match(/^[-*]\s+\*\*(.*?)\*\*:?\s*(.*)/)) {
        const match = line.match(/^[-*]\s+\*\*(.*?)\*\*:?\s*(.*)/);
        if (match && result.features.length < 8) {
          result.features.push({
            title: match[1].trim(),
            description: match[2].trim()
          });
        }
      }
    }

    if (!result.tagline && result.description) {
      result.tagline = result.description;
    }
  }

  /**
   * Scans directories for image assets (.png, .webp, .jpg, .svg).
   */
  discoverMediaAssets(dir, depth = 0, budget = { entries: 0, media: 0 }) {
    if (depth > 3 || budget.entries >= 2000 || budget.media >= 100) return [];
    const media = [];
    const searchDirs = ["media", "public", "assets", "docs", "static", "images"];

    try {
      const entries = fs.opendirSync(dir);
      try { for (let entry; (entry = entries.readSync()) !== null;) {
        if (++budget.entries > 2000 || budget.media >= 100) break;
        if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && (depth === 0 ? searchDirs.includes(entry.name.toLowerCase()) : true)) {
          media.push(...this.discoverMediaAssets(fullPath, depth + 1, budget));
        } else if (entry.isFile() && /\.(png|webp|jpg|jpeg|svg|mp4)$/i.test(entry.name)) {
          budget.media++;
          media.push({
            name: entry.name,
            path: fullPath,
            ext: path.extname(entry.name).toLowerCase()
          });
        }
      } } finally { entries.closeSync(); }
    } catch (e) {}

    return media;
  }
}
