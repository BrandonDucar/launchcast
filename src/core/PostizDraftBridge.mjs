/** Transport-independent bridge to Postiz MCP. Always creates drafts, never schedules. */
export function buildPostizDraft({ integrationId, content, media, settings = [], date = new Date().toISOString() }) {
  if (typeof integrationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(integrationId)) throw new Error('Invalid integration');
  if (typeof content !== 'string' || !content.trim() || content.length > 2000) throw new Error('Invalid draft text');
  if (!Array.isArray(media) || media.length < 1 || media.length > 10) throw new Error('Provider media receipts required');
  const attachments = media.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) throw new Error('Provider media ID required');
    const url = new URL(item.path);
    if (url.protocol !== 'https:' || url.hostname !== 'uploads.postiz.com' || url.username || url.password || url.port || url.search || url.hash || !/^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|mp4)$/i.test(url.pathname)) {
      throw new Error('Unqualified Postiz media URL');
    }
    return url.href;
  });
  if (!Array.isArray(settings) || settings.some(s => typeof s?.key !== 'string')) throw new Error('Invalid provider settings');
  if (!Number.isFinite(Date.parse(date))) throw new Error('Invalid date');
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return { socialPost: [{ type: 'draft', integrationId, date, isPremium: false, shortLink: false,
    postsAndComments: [{ content: content.split(/\r?\n/).map(line => `<p>${escape(line)}</p>`).join(''), attachments }], settings }] };
}

export async function stagePostizDraft(input, scheduleTool) {
  const payload = buildPostizDraft(input);
  let response;
  try { response = await scheduleTool(payload); }
  catch { return { state: 'OUTCOME_UNKNOWN', reconcileBeforeRetry: true, published: false }; }
  const output = response?.structuredContent?.output ?? response?.output;
  if (response?.isError || !Array.isArray(output) || output.length !== 1 || !output[0]?.postId || output[0].integration !== input.integrationId) {
    return { state: 'OUTCOME_UNKNOWN', reconcileBeforeRetry: true, published: false };
  }
  return { state: 'DRAFT_ACCEPTED', postId: output[0].postId, previewUrl: output[0].previewUrl,
    readback: 'REQUIRED', published: false };
}
