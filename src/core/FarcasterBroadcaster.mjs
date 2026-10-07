export function isHttpsUrl(value) {
  if (typeof value !== "string" || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

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
      `Rendered with LaunchCast.`,
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
    if (!isHttpsUrl(videoUrl)) return { success: false, status: "INVALID_VIDEO_URL" };
    if (!this.apiKey || !this.signerUuid) {
      return { success: false, status: "NOT_CONFIGURED", error: "Neynar credentials are required." };
    }
    const text = this.formatCast(storyboard, videoUrl, options.repoUrl);
    const channel = options.channelId || this.channelId;

    console.log(`[FarcasterBroadcaster] Staging cast to /${channel}...`);
    console.log(`--------------------------------------------------`);
    console.log(text);
    console.log(`--------------------------------------------------`);

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
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000)
      });

      if (!res.ok) {
        const rejected = [400, 401, 403, 404, 422].includes(res.status);
        return {
          success: false, status: rejected ? "REJECTED" : "OUTCOME_UNKNOWN",
          httpStatus: res.status, requiresReconciliation: !rejected
        };
      }
      const data = await res.json();
      if (typeof data?.cast?.hash !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(data.cast.hash)) {
        return { success: false, status: "OUTCOME_UNKNOWN", requiresReconciliation: true };
      }

      console.log(`[FarcasterBroadcaster] Provider accepted cast: ${data.cast.hash}`);
      return {
        success: true,
        status: "ACCEPTED",
        independentlyVerified: false,
        castHash: data.cast?.hash,
        url: `https://warpcast.com/~/conversations/${data.cast?.hash}`
      };
    } catch {
      return { success: false, status: "OUTCOME_UNKNOWN", requiresReconciliation: true };
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
