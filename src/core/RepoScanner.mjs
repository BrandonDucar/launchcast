import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Scans a local directory or clones a GitHub URL to extract technical & narrative signals.
 */
export class RepoScanner {
  /**
   * @param {string} targetPathOrUrl - Local directory path or GitHub git/https URL
   */
  constructor(targetPathOrUrl) {
    this.target = targetPathOrUrl;
    this.localPath = null;
    this.isCloned = false;
  }

  /**
   * Resolves target to a local directory path.
   */
  async resolve() {
    if (this.target.startsWith("http://") || this.target.startsWith("https://") || this.target.startsWith("git@")) {
      const tempDir = path.join(process.cwd(), ".launchcast_cache", "repo_" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      console.log(`[RepoScanner] Cloning ${this.target} -> ${tempDir}...`);
      execSync(`git clone --depth 1 "${this.target}" "${tempDir}"`, { stdio: "inherit" });
      this.localPath = tempDir;
      this.isCloned = true;
    } else {
      this.localPath = path.resolve(this.target);
    }

    if (!fs.existsSync(this.localPath)) {
      throw new Error(`Target path does not exist: ${this.localPath}`);
    }

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
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        result.name = pkg.name || result.name;
        result.description = pkg.description || "";
        result.techStack = Object.keys(pkg.dependencies || {});
      } catch (e) {}
    }

    // 2. Read README.md
    const readmeNames = ["README.md", "readme.md", "README.MD", "Readme.md"];
    let readmeContent = "";
    for (const rName of readmeNames) {
      const rPath = path.join(this.localPath, rName);
      if (fs.existsSync(rPath)) {
        readmeContent = fs.readFileSync(rPath, "utf8");
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
  discoverMediaAssets(dir, depth = 0) {
    if (depth > 3) return [];
    const media = [];
    const searchDirs = ["media", "public", "assets", "docs", "static", "images"];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && (depth === 0 ? searchDirs.includes(entry.name.toLowerCase()) : true)) {
          media.push(...this.discoverMediaAssets(fullPath, depth + 1));
        } else if (entry.isFile() && /\.(png|webp|jpg|jpeg|svg|mp4)$/i.test(entry.name)) {
          media.push({
            name: entry.name,
            path: fullPath,
            ext: path.extname(entry.name).toLowerCase()
          });
        }
      }
    } catch (e) {}

    return media;
  }
}
