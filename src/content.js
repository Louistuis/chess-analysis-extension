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
  const { AnalysisPanel, buildModel, buildSearching, withGameContext, withPracticeStrength, formatScore } = window.ChessPanel;
  const { GameHistory } = window.ChessHistory;
  const { openingForGame } = window.ChessOpenings;
  const { uciToSan } = window.ChessSan;
  const DEBOUNCE_MS = 150;
  const CACHE_LIMIT = 200;
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
  // The side the person at the board plays: the one at the bottom, so Black when the board is turned round.
  const userColour = () => {
    const board = ChessReader.findBoard(document);
    return board && board.classList.contains('flipped') ? 'b' : 'w';
  };
  // The model also says the practice strength, when one is set, so the person can tell the lines are from a weaker engine.
  const withContext = (model) => withPracticeStrength(withGameContext(model, gameContext.opening, gameContext.entries, userColour()), practiceElo);
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
  let depthSetting = 12;
  let practiceElo = null; // the practice strength in Elo, or null for Full strength
  const cache = new Map(); // finished searches by position, depth and lines, so a position seen again shows at once
  let activeFen = null; // the position the running search is for
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

  const cacheKey = (fen) => `${GameHistory.keyOf(fen)}|${depthSetting}|${lineCount}`;

  // Draws one arrow per line, best first: the move, its score as the label, and its gap to the best line for the colour.
  // Returns the board, or null if there is none to draw on.
  function drawArrows(result) {
    const board = ChessReader.findBoard(document);
    if (!board) return null;
    const flipped = board.classList.contains('flipped');
    const arrows = result.lines && result.lines.length
      ? result.lines.slice(0, lineCount).map((line) => ({ move: line.move, label: formatScore(line.evaluation), gap: line.gap }))
      : [{ move: result.move, label: formatScore(result.evaluation), gap: 0 }];
    overlay.attach(board);
    overlay.show(arrows, flipped);
    shown = { arrows, flipped, fen: result.fen };
    return board;
  }

  // The lines the engine has so far for the running search: arrows and panel update before it reaches its depth.
  function showPartial(partial) {
    if (!activeFen) return;
    // The board may have moved on while the old search was still sending lines; those lines are for a past position.
    if (readBoard().fen !== activeFen) return;
    const result = { ...partial, fen: activeFen };
    const board = drawArrows(result);
    if (!board) return;
    try {
      panel.setAnchor(board);
      panel.render(withContext(buildModel(result, activeFen, lineCount, { partial: true, targetDepth: depthSetting })));
    } catch (err) {
      // A line the panel can't read is skipped; the next update or the final answer replaces it.
    }
  }

  const tracker = new SuggestionTracker({
    ask: (fen) => {
      const hit = cache.get(cacheKey(fen));
      if (hit) {
        cache.delete(cacheKey(fen)); // re-inserted by show(), which keeps the most recently used last
        activeRequest = 0; // lines still arriving from the search for the previous position are no longer wanted
        activeFen = null;
        return Promise.resolve({ ...hit, fen });
      }
      const requestId = ++requestSeq;
      activeRequest = requestId;
      activeFen = fen;
      panel.render({ ...withContext(buildSearching(null)), targetDepth: depthSetting });
      return chrome.runtime.sendMessage({ type: 'BEST_MOVE', fen, requestId });
    },
    show: (result) => {
      activeRequest = 0; // the final answer is in; ignore any progress that arrives after it
      activeFen = null;
      cache.set(cacheKey(result.fen), result);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      // The board may have moved on while this search finished; its lines are cached but belong to a past position.
      if (readBoard().fen !== result.fen) return;
      const board = drawArrows(result);
      if (!board) return;
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
    // The position changed: the old arrows stay on the board, faint, until the new position has an answer.
    stale: () => {
      overlay.dim();
      if (shown) shown.stale = true;
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
    activeFen = null;
    cache.clear(); // answers for the old depth or number of lines no longer apply
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
      if (shown.stale) overlay.dim(); // redrawing the faint arrows for a new board view keeps them faint
      shown.flipped = flipped;
    }
  }

  // Chess.com updates the board in place, so watch the page and wait for it to settle before reading.
  const observer = new MutationObserver((mutations) => {
    // Ignore changes to the arrows themselves, or the arrows would trigger another refresh.
    if (mutations.every((m) => overlay.svg && overlay.svg.contains(m.target))) return;
    // The arrows are for a position that is no longer on the board: fade them now, without waiting for the debounce.
    if (shown && !shown.stale && readBoard().fen !== shown.fen) {
      overlay.dim();
      shown.stale = true;
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
    if (message && message.type === 'ANALYSIS_PARTIAL' && enabled && message.requestId === activeRequest) {
      showPartial(message.result);
    }
    return false;
  });

  loadSettings().then((settings) => {
    enabled = settings.suggestionsEnabled;
    lineCount = settings.lines;
    depthSetting = settings.depth;
    practiceElo = settings.elo;
    refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = changedSettings(changes);
    if ('suggestionsEnabled' in changed) enabled = changed.suggestionsEnabled;
    if ('lines' in changed) lineCount = changed.lines;
    if ('depth' in changed) depthSetting = changed.depth;
    if ('elo' in changed) practiceElo = changed.elo;
    // Answers for the old setting no longer apply: drop them and ask again for the current position.
    if (!enabled) turnOff();
    else if ('depth' in changed || 'lines' in changed || 'elo' in changed) turnOff();
    refresh();
  });
})();
