// Answers requests from the popup with the current board position, and asks the engine for suggested lines.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'READ_FEN') {
    try {
      sendResponse(window.ChessReader.readPosition(document));
    } catch (err) {
      sendResponse({ ok: false, error: 'Could not read the board: ' + err.message });
    }
  }
  if (message && message.type === 'GET_BEST_MOVE') {
    let position;
    try {
      position = window.ChessReader.readPosition(document);
    } catch (err) {
      sendResponse({ ok: false, error: 'Could not read the board: ' + err.message });
      return false;
    }
    if (!position.ok) {
      sendResponse(position);
      return false;
    }
    chrome.runtime
      .sendMessage({ type: 'BEST_MOVE', fen: position.fen })
      .then((response) => sendResponse({ ...response, fen: position.fen }))
      .catch((err) => sendResponse({ ok: false, error: 'Could not reach the engine: ' + err.message }));
    return true; // answer asynchronously
  }
  return false;
});

// Shows the suggested lines as arrows over the board and in the analysis panel. Nothing here clicks or moves pieces.
(function showSuggestions() {
  const { ChessReader } = window;
  const { SuggestionTracker, SuggestionOverlay } = window.ChessOverlay;
  const { loadSettings, changedSettings } = window.ChessSettings;
  const { AnalysisPanel, buildModel, buildSearching, withGameContext, formatScore } = window.ChessPanel;
  const { GameHistory } = window.ChessHistory;
  const { openingForGame } = window.ChessOpenings;
  const { uciToSan } = window.ChessSan;
  const DEBOUNCE_MS = 300;
  const URL_CHECK_MS = 1000;

  const overlay = new SuggestionOverlay();
  // Remembers whether the panel is collapsed, across chess.com pages.
  const panel = new AnalysisPanel(document, {
    get: async () => (await chrome.storage.local.get({ panelCollapsed: false })).panelCollapsed,
    set: (value) => chrome.storage.local.set({ panelCollapsed: value }),
  });
  const history = new GameHistory(); // the positions seen in the current game, with their best moves
  let gamePath = location.pathname; // chess.com gives each game its own URL; a new game starts a fresh history
  // The game so far, worked out once per recorded position rather than on every progress update.
  let gameContext = { opening: null, entries: [] };
  const currentGameContext = () => ({ opening: openingForGame(history.fens()), entries: history.entries() });
  // The panel's model, with the game so far: the opening it is in, and the history of best moves.
  const withContext = (model) => withGameContext(model, gameContext.opening, gameContext.entries);
  // The best move as SAN for the position it is played in; null if it can't be read.
  const sanOf = (fen, uci) => {
    try {
      return uciToSan(fen, [uci])[0] || null;
    } catch (err) {
      return null;
    }
  };
  let enabled = false; // stays off until the stored setting is read, so no engine work starts early
  let lineCount = 3;
  let timer = null;
  let shown = null; // { arrows, flipped, fen } for the arrows currently on the board
  let lastModel = null; // the finished model on the panel, so it can be redrawn with a new game context
  let requestSeq = 0;
  let activeRequest = 0; // the search whose progress the panel may show; 0 when none

  // A new game (a new URL on chess.com) starts a fresh history. Checked on refresh and on a timer, so it also
  // happens on a quiet page where the board doesn't change.
  function checkGame() {
    if (location.pathname === gamePath) return;
    gamePath = location.pathname;
    history.clear();
    gameContext = currentGameContext();
    if (enabled && lastModel) panel.render(withContext(lastModel));
  }

  const tracker = new SuggestionTracker({
    ask: (fen) => {
      const requestId = ++requestSeq;
      activeRequest = requestId;
      panel.render(withContext(buildSearching(null)));
      return chrome.runtime.sendMessage({ type: 'BEST_MOVE', fen, requestId });
    },
    show: (result) => {
      activeRequest = 0; // the final answer is in; ignore any progress that arrives after it
      const board = ChessReader.findBoard(document);
      if (!board) return;
      const flipped = board.classList.contains('flipped');
      // One arrow per line, best first: the move, its score as the label, and its gap to the best line for the colour.
      const arrows = result.lines && result.lines.length
        ? result.lines.slice(0, lineCount).map((line) => ({ move: line.move, label: formatScore(line.evaluation), gap: line.gap }))
        : [{ move: result.move, label: formatScore(result.evaluation), gap: 0 }];
      overlay.attach(board);
      overlay.show(arrows, flipped);
      shown = { arrows, flipped, fen: result.fen };
      try {
        checkGame();
        history.record({ fen: result.fen, san: sanOf(result.fen, result.move), evaluation: result.evaluation });
        gameContext = currentGameContext();
        lastModel = buildModel(result, result.fen, lineCount);
        panel.setAnchor(board);
        panel.render(withContext(lastModel));
      } catch (err) {
        panel.render({ status: 'error', message: 'Could not show the lines for this position.' });
      }
    },
    hide: () => {
      overlay.clear();
      shown = null;
    },
  });

  // Nothing should be shown or asked for until the setting says so again.
  function turnOff() {
    tracker.disable();
    activeRequest = 0;
    lastModel = null;
    panel.hide();
  }

  function readBoard() {
    try {
      return ChessReader.readPosition(document);
    } catch (err) {
      return { ok: false };
    }
  }

  // Reads the board, asks for suggestions if the position changed, and redraws the arrows if the board was turned round.
  function refresh() {
    timer = null;
    checkGame();
    if (!enabled) return;
    const position = readBoard();
    if (!position.ok) {
      turnOff();
      return;
    }
    tracker.update(position.fen);
    const board = ChessReader.findBoard(document);
    if (board) panel.setAnchor(board);
    if (shown && board && board.classList.contains('flipped') !== shown.flipped) {
      const flipped = !shown.flipped;
      overlay.attach(board); // the board may have re-rendered and dropped the arrows' SVG
      overlay.show(shown.arrows, flipped);
      shown.flipped = flipped;
    }
  }

  // Chess.com updates the board in place, so watch the page and wait for it to settle before reading.
  const observer = new MutationObserver((mutations) => {
    // Ignore changes to the arrows themselves, or the arrows would trigger another refresh.
    if (mutations.every((m) => overlay.svg && overlay.svg.contains(m.target))) return;
    // Drop arrows for a position that is no longer on the board, without waiting for the debounce.
    if (shown && readBoard().fen !== shown.fen) {
      overlay.clear();
      shown = null;
    }
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  setInterval(checkGame, URL_CHECK_MS);

  // The panel sits beside the board, so it moves when the window is resized or scrolled.
  window.addEventListener('resize', () => panel.place());
  window.addEventListener('scroll', () => panel.place(), { passive: true });

  // Live stats from the engine, forwarded by the background worker for the search the panel is waiting on.
  // Only the technical row changes here; the history and the opening are left as they are.
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'ANALYSIS_PROGRESS' && enabled && message.requestId === activeRequest) {
      panel.updateStats(message.stats);
    }
    return false;
  });

  loadSettings().then((settings) => {
    enabled = settings.suggestionsEnabled;
    lineCount = settings.lines;
    refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = changedSettings(changes);
    if ('suggestionsEnabled' in changed) enabled = changed.suggestionsEnabled;
    if ('lines' in changed) lineCount = changed.lines;
    // Answers for the old setting no longer apply: drop them and ask again for the current position.
    if (!enabled) turnOff();
    else if ('depth' in changed || 'lines' in changed) turnOff();
    refresh();
  });
})();
