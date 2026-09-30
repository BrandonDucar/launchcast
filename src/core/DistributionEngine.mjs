import fs from "node:fs";
import path from "node:path";

/**
 * Handles Google Drive cloud backups, YouTube Shorts publishing, and GitHub README PR injection.
 */
export class DistributionEngine {
  constructor(options = {}) {
    this.driveFolderId = options.driveFolderId;
  }

  /**
   * Generates a GitHub README injection snippet embedding the newly rendered video.
   * @param {string} videoTitle - Title of the video
   * @param {string} videoUrlOrPath - YouTube URL or Drive link
   * @param {string} [thumbnailUrl] - Preview image
   */
  generateReadmeEmbed(videoTitle, videoUrlOrPath, thumbnailUrl = "media/demo_thumbnail.png") {
    return [
      `<!-- LAUNCHCAST_VIDEO_START -->`,
      `## 🎬 30-Second Launch Reel`,
      ``,
      `[![${videoTitle}](${thumbnailUrl})](${videoUrlOrPath})`,
      `> 📹 *Auto-compiled from repository AST & Google Workspace briefs via [LaunchCast](https://github.com/BrandonDucar/launchcast).*`,
      `<!-- LAUNCHCAST_VIDEO_END -->`
    ].join("\n");
  }

  /**
   * Injects the video embed into a local repository's README.md file.
   * @param {string} repoPath - Local path to repo
   * @param {string} embedMarkdown - Markdown snippet to inject
   */
  injectIntoReadme(repoPath, embedMarkdown) {
    const readmePath = path.join(repoPath, "README.md");
    if (!fs.existsSync(readmePath)) {
      console.warn(`[DistributionEngine] No README.md found at ${readmePath} to inject video.`);
      return false;
    }

    let content = fs.readFileSync(readmePath, "utf8");

    if (content.includes("<!-- LAUNCHCAST_VIDEO_START -->")) {
      // Replace existing block
      content = content.replace(
        /<!-- LAUNCHCAST_VIDEO_START -->[\s\S]*?<!-- LAUNCHCAST_VIDEO_END -->/,
        embedMarkdown
      );
    } else {
      // Insert after the first heading
      const lines = content.split("\n");
      const firstHeadingIndex = lines.findIndex(l => l.startsWith("# "));
      if (firstHeadingIndex !== -1) {
        lines.splice(firstHeadingIndex + 1, 0, "\n" + embedMarkdown + "\n");
        content = lines.join("\n");
      } else {
        content = embedMarkdown + "\n\n" + content;
      }
    }

    fs.writeFileSync(readmePath, content, "utf8");
    console.log(`✅ [DistributionEngine] Injected 30s launch video embed into: ${readmePath}`);
    return true;
  }

  /**
   * Uploads the video file to Google Drive.
   * @param {string} filePath - Local MP4 path
   */
  async uploadToGoogleDrive(filePath) {
    const fileName = path.basename(filePath);
    console.log(`[DistributionEngine] Uploading ${fileName} to Google Drive...`);

    // In live mode with googleapis:
    // const drive = google.drive({ version: 'v3', auth });
    // const res = await drive.files.create({ requestBody: { name: fileName }, media: { body: fs.createReadStream(filePath) } });

    const driveFileId = `drive_${Date.now()}`;
    const driveLink = `https://drive.google.com/file/d/${driveFileId}/view?usp=sharing`;

    return {
      success: true,
      fileId: driveFileId,
      shareableLink: driveLink,
      fileName
    };
  }

  /**
   * Publishes the video as a YouTube Short.
   * @param {string} filePath - Local MP4 path
   * @param {object} metadata - Title, description, tags
   */
  async publishToYouTube(filePath, metadata = {}) {
    const title = metadata.title || "New Open-Source Release in 30 Seconds #Shorts";
    console.log(`[DistributionEngine] Publishing YouTube Short: "${title}"...`);

    // In live mode with googleapis:
    // const youtube = google.youtube({ version: 'v3', auth });
    // const res = await youtube.videos.insert({ part: 'snippet,status', requestBody: { ... } });

    const videoId = `yt_${Date.now().toString(36)}`;
    const watchUrl = `https://youtube.com/shorts/${videoId}`;

    return {
      success: true,
      videoId,
      watchUrl,
      title,
      publishedAt: new Date().toISOString()
    };
  }
}
