import fs from "node:fs";
import path from "node:path";
import { FarcasterBroadcaster, isHttpsUrl } from "./FarcasterBroadcaster.mjs";

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
      `> *Rendered with [LaunchCast](https://github.com/BrandonDucar/launchcast).*`,
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
    return {
      success: false,
      status: "NOT_IMPLEMENTED",
      provider: "google-drive",
      error: "Google Drive upload is not implemented. The rendered file remains local."
    };
  }

  /**
   * Publishes the video as a YouTube Short.
   * @param {string} filePath - Local MP4 path
   * @param {object} metadata - Title, description, tags
   */
  async publishToYouTube(filePath, metadata = {}) {
    return {
      success: false,
      status: "NOT_IMPLEMENTED",
      provider: "youtube",
      error: "YouTube upload is not implemented. No video has been published."
    };
  }
}

function acceptedPublicVideo(result, provider) {
  if (result?.success !== true || result.publiclyAccessible !== true) return undefined;
  const id = provider === "youtube" ? result.videoId : result.fileId;
  const link = provider === "youtube" ? result.watchUrl : result.shareableLink;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id) || !isHttpsUrl(link)) return undefined;
  const url = new URL(link);
  const matches = provider === "youtube"
    ? ["youtube.com", "www.youtube.com"].includes(url.hostname) && url.pathname === `/shorts/${id}`
    : url.hostname === "drive.google.com" && url.pathname === `/file/d/${id}/view`;
  return matches ? link : undefined;
}

async function attempt(operation) {
  try {
    return await operation();
  } catch {
    // A transport exception may occur after a provider has accepted an effect.
    return { success: false, status: "OUTCOME_UNKNOWN", requiresReconciliation: true };
  }
}

/** Distribute only to explicitly requested targets; unavailable uploads never fan out. */
export async function distributeVideo(filePath, storyboard, options = {}, adapters = {}) {
  if (!options.publish && !options.farcaster) return { status: "NOT_REQUESTED", success: null };
  const distributor = adapters.distributor || new DistributionEngine(options);
  const broadcaster = adapters.broadcaster || new FarcasterBroadcaster(options);
  const result = { status: "INCOMPLETE", success: false, readmeUpdated: false };

  if (options.publish) {
    result.driveUpload = await attempt(() => distributor.uploadToGoogleDrive(filePath));
    result.ytShort = await attempt(() => distributor.publishToYouTube(filePath, { title: storyboard.title }));
  }

  const videoUrl = acceptedPublicVideo(result.ytShort, "youtube")
    || acceptedPublicVideo(result.driveUpload, "drive");

  if (options.farcaster) {
    result.farcasterCast = videoUrl
      ? await attempt(() => broadcaster.broadcastCast(storyboard, videoUrl, {
          repoUrl: options.repoUrl, channelId: options.channelId || "dev"
        }))
      : { success: false, status: "BLOCKED", reason: "NO_ACCEPTED_PUBLIC_VIDEO" };
  }

  if (options.publish && options.localPath && videoUrl) {
    try {
      result.readmeUpdated = distributor.injectIntoReadme(
        options.localPath, distributor.generateReadmeEmbed(storyboard.title, videoUrl)
      );
    } catch {
      result.readmeError = "README_UPDATE_FAILED";
    }
  }

  const uploadsComplete = !options.publish || (
    Boolean(acceptedPublicVideo(result.driveUpload, "drive"))
    && Boolean(acceptedPublicVideo(result.ytShort, "youtube"))
  );
  const castComplete = !options.farcaster || result.farcasterCast?.success === true;
  const readmeComplete = !options.publish || !options.localPath || result.readmeUpdated === true;
  result.success = uploadsComplete && castComplete && readmeComplete;
  result.status = result.success ? "COMPLETED" : "INCOMPLETE";
  return result;
}
