// Owns the Stockfish Worker. The vendored build is the worker script itself: it reads UCI commands
// from postMessage and posts its output lines back, and it finds its .wasm next to its own URL.
// If the worker fails, the engine is dropped so the next request starts a fresh worker.
let engine = null;

function getEngine() {
  if (!engine) {
    const worker = new Worker(chrome.runtime.getURL('vendor/stockfish/stockfish-19-lite-single.js'));
    engine = new window.StockfishEngine.Engine(worker, {
      onFatal: () => {
        worker.terminate();
        engine = null;
      },
    });
  }
  return engine;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen' || message.type !== 'ENGINE_BEST_MOVE') return false;
  const { tabId, requestId } = message;
  getEngine()
    .bestMove(message.fen, message.depth, {
      lines: message.lines,
      elo: message.elo, // practice strength in Elo, or null for Full strength
      supersede: true, // a newer position makes this search pointless: stop it and start the new one at once
      onPartial: (partial) => {
        // The lines found so far, so the tab can show them before the search reaches its depth.
        chrome.runtime.sendMessage({ target: 'background', type: 'ENGINE_PARTIAL', tabId, requestId, result: partial }).catch(() => {});
      },
      onProgress: (stats) => {
        // Live stats go to the background, which passes them to the tab that asked.
        chrome.runtime.sendMessage({ target: 'background', type: 'ENGINE_PROGRESS', tabId, requestId, stats }).catch(() => {});
      },
    })
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // answer asynchronously
});
