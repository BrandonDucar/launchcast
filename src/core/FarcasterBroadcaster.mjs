import fs from "node:fs";

/**
 * Handles broadcasting 30s launch videos and interactive Frame embeds directly to Farcaster.
 */
export class FarcasterBroadcaster {
  constructor(options = {}) {
    this.apiKey = options.neynarApiKey || process.env.NEYNAR_API_KEY;
    this.signerUuid = options.signerUuid || process.env.NEYNAR_SIGNER_UUID;
    this.channelId = options.channelId || "dev"; // e.g. /dev, /launch, /build
  }

  /**
   * Formats the cast text with 4-beat summary, video link, and repository URL.
   * @param {object} storyboard - Compiled 4-beat storyboard
   * @param {string} videoUrl - Public video URL or IPFS/Arweave link
   * @param {string} [repoUrl] - GitHub repository link
   */
  formatCast(storyboard, videoUrl, repoUrl) {
    const hook = storyboard.beats[0]?.voiceoverScript || "New release in 30 seconds.";
    const title = storyboard.projectName || "Open-Source Innovation";

    return [
      `🎬 30s Launch Reel: ${title}`,
      ``,
      `"${hook}"`,
      ``,
      `⚡ Compiled directly from codebase AST via @launchcast.`,
      repoUrl ? `🔗 Repo: ${repoUrl}` : "",
      videoUrl ? `📹 Watch: ${videoUrl}` : ""
    ].filter(Boolean).join("\n");
  }

  /**
   * Casts the launch video to Farcaster via Neynar.
   * @param {object} storyboard
   * @param {string} videoUrl - Publicly accessible MP4 URL
   * @param {object} [options]
   */
  async broadcastCast(storyboard, videoUrl, options = {}) {
    const text = this.formatCast(storyboard, videoUrl, options.repoUrl);
    const channel = options.channelId || this.channelId;

    console.log(`[FarcasterBroadcaster] Staging cast to /${channel}...`);
    console.log(`--------------------------------------------------`);
    console.log(text);
    console.log(`--------------------------------------------------`);

    if (!this.apiKey || !this.signerUuid) {
      console.log(`ℹ️ [FarcasterBroadcaster] Simulated Mode (No NEYNAR_API_KEY or NEYNAR_SIGNER_UUID provided).`);
      return {
        status: "SIMULATED_SUCCESS",
        channel,
        castText: text,
        embeds: [{ url: videoUrl }],
        note: "To broadcast live, provide NEYNAR_API_KEY and NEYNAR_SIGNER_UUID in environment."
      };
    }

    try {
      const payload = {
        signer_uuid: this.signerUuid,
        text,
        channel_id: channel,
        embeds: videoUrl ? [{ url: videoUrl }] : []
      };

      const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api_key": this.apiKey
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to post cast");

      console.log(`✅ [FarcasterBroadcaster] Cast published! Hash: ${data.cast?.hash}`);
      return {
        status: "PUBLISHED",
        castHash: data.cast?.hash,
        url: `https://warpcast.com/~/conversations/${data.cast?.hash}`
      };
    } catch (err) {
      console.error(`❌ [FarcasterBroadcaster Error]:`, err.message);
      return { status: "FAILED", error: err.message };
    }
  }

  /**
   * Generates a Farcaster Frame v2 / Mini-App manifest payload for interactive storyboard viewing.
   */
  generateFrameManifest(storyboard, appUrl) {
    return {
      name: `LaunchCast — ${storyboard.projectName}`,
      iconUrl: `${appUrl}/icon.png`,
      homeUrl: appUrl,
      imageUrl: `${appUrl}/frame_preview.png`,
      buttonTitle: "▶ Watch 30s Launch Reel",
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#07090e"
    };
  }
}
