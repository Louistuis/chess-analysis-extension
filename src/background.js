// Routes analysis requests from content scripts to the offscreen document that runs Stockfish,
// and passes live search progress back to the tab that asked.
// Service workers can't create Workers, so the engine lives in an offscreen document.
importScripts('settings.js');

const OFFSCREEN_URL = 'offscreen/offscreen.html';
let offscreenReady = null;

function ensureOffscreen() {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (contexts.length === 0) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ['WORKERS'],
          justification: 'Run the Stockfish chess engine in a Web Worker.',
        });
      }
    })().catch((err) => {
      offscreenReady = null; // allow a retry on the next request
      throw err;
    });
  }
  return offscreenReady;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'ENGINE_PROGRESS') {
    // From the offscreen document: live stats for one search, sent on to the tab that asked for it.
    if (message.tabId !== undefined) {
      chrome.tabs
        .sendMessage(message.tabId, { type: 'ANALYSIS_PROGRESS', requestId: message.requestId, stats: message.stats })
        .catch(() => {}); // the tab may have closed or navigated
    }
    return false;
  }
  if (!message || message.type !== 'BEST_MOVE') return false;
  const tabId = sender.tab ? sender.tab.id : undefined;
  (async () => {
    await ensureOffscreen();
    // Read the settings for each search, so a change in the popup applies to the next search.
    const { depth, lines } = await ChessSettings.loadSettings();
    return chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'ENGINE_BEST_MOVE',
      fen: message.fen,
      depth,
      lines,
      tabId,
      requestId: message.requestId,
    });
  })()
    .then((response) => sendResponse({ ...response, fen: message.fen })) // echo the position so callers can match the answer
    .catch((err) => {
      offscreenReady = null; // the document may have been closed; check for it again on the next request
      sendResponse({ ok: false, error: 'Engine unavailable: ' + err.message });
    });
  return true; // answer asynchronously
});
