// Analysis panel: an eval bar from White's side, a table of the engine's lines (move, score, gap to the best, depth),
// win/draw/loss, the opening, the game's history of best moves, and a raw technical row. The formatting and placement
// functions are pure and tested in Node. AnalysisPanel draws the panel in a shadow root, so chess.com's CSS can't
// restyle it, and places it beside the board. Nothing here moves pieces or clicks anything.
// Loaded as a classic script (sets globalThis.ChessPanel) and also as a CommonJS module.
(function (scope) {
  const San = typeof module !== 'undefined' && typeof require === 'function' ? require('./san.js') : scope.ChessSan;
  const Overlay = typeof module !== 'undefined' && typeof require === 'function' ? require('./overlay.js') : scope.ChessOverlay;
  const PANEL_PLIES = 8; // moves of each line shown in the panel
  const PANEL_WIDTH = 240;
  const PANEL_ESTIMATE_HEIGHT = 420; // used until the panel has been drawn and can be measured
  const GAP = 12; // space between the board and the panel
  const MARGIN = 8; // space between the panel and the edge of the window

  // "+0.35", "-1.20", "0.00", "M3" (White mates in 3), "-M2" (Black mates in 2).
  function formatScore(evaluation) {
    if (!evaluation) return '—';
    if (evaluation.type === 'mate') {
      if (evaluation.value === 0) return '#';
      return evaluation.value > 0 ? 'M' + evaluation.value : '-M' + Math.abs(evaluation.value);
    }
    const pawns = evaluation.value / 100;
    if (Math.abs(pawns) < 0.005) return '0.00';
    return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
  }

  // Share of the bar that belongs to White, from 0 to 1. Centipawns use the usual logistic curve, so the bar stays
  // readable for big advantages; a mate fills the bar.
  function evalBarFraction(evaluation) {
    if (!evaluation) return 0.5;
    if (evaluation.type === 'mate') {
      if (evaluation.value > 0) return 1;
      if (evaluation.value < 0) return 0;
      return 0.5;
    }
    return 1 / (1 + Math.pow(10, -evaluation.value / 400));
  }

  // Win/draw/loss from the engine (permille, from White's side) as percentages: { win, draw, loss }, or null.
  function wdlPercentages(wdl) {
    if (!wdl) return null;
    return { win: wdl.win / 10, draw: wdl.draw / 10, loss: wdl.loss / 10 };
  }

  // "W 52.0% · D 30.0% · L 18.0%", or a dash when the engine sent no WDL.
  function formatWdl(wdl) {
    const shares = wdlPercentages(wdl);
    if (!shares) return '—';
    return `W ${shares.win.toFixed(1)}% · D ${shares.draw.toFixed(1)}% · L ${shares.loss.toFixed(1)}%`;
  }

  // "B90 · Sicilian Defence: Najdorf Variation", or a note when the position is not in the bundled table.
  function formatOpening(opening) {
    if (!opening) return 'not in the bundled table';
    return opening.eco + ' · ' + opening.name;
  }

  // One row of the game's history: the move number of the position (12. or 12…), the engine's best move there, and its score.
  function formatHistoryRow(entry) {
    const [, side, , , , fullmove] = entry.fen.split(' ');
    const number = fullmove || '1';
    return {
      label: side === 'b' ? number + '…' : number + '.',
      move: entry.san || '—',
      score: formatScore(entry.evaluation),
    };
  }

  // The raw numbers from the engine's last info line. Missing values show as a dash.
  function formatTechnical(stats) {
    if (!stats) return '';
    const value = (v) => (v === null || v === undefined ? '—' : String(v));
    return [
      'depth ' + value(stats.depth),
      'seldepth ' + value(stats.seldepth),
      'nodes ' + value(stats.nodes),
      'nps ' + value(stats.nps),
      'hashfull ' + value(stats.hashfull),
      'time ' + (stats.time === null || stats.time === undefined ? '—' : stats.time + ' ms'),
    ].join(' · ');
  }

  // Where the panel goes, in viewport pixels. `anchor` is the board's box ({ left, top, right, bottom }), or null.
  // The panel never overlaps the board. It tries, in order: beside the board (the side with more room, since chess.com's
  // side controls are usually on the right), below it, and above it. If none of those fits, it returns side 'hidden'.
  // With no board to avoid (anchor null) it goes to the top-right corner of the window.
  function placePanel(anchor, viewport, size, gap = GAP) {
    const maxLeft = Math.max(MARGIN, viewport.width - size.width - MARGIN);
    if (!anchor) return { left: maxLeft, top: MARGIN, side: 'corner' };
    const clampTop = (top) => Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewport.height - size.height - MARGIN));
    const clampLeft = (left) => Math.min(Math.max(MARGIN, left), maxLeft);
    const roomRight = viewport.width - anchor.right - gap - MARGIN;
    const roomLeft = anchor.left - gap - MARGIN;
    const fitsRight = roomRight >= size.width;
    const fitsLeft = roomLeft >= size.width;
    if (fitsRight || fitsLeft) {
      const side = fitsRight && (!fitsLeft || roomRight >= roomLeft) ? 'right' : 'left';
      // A board that starts off the window's left edge would put the panel off-screen, so keep it at least at the margin.
      const left = side === 'right' ? Math.max(MARGIN, anchor.right + gap) : anchor.left - gap - size.width;
      return { left, top: clampTop(anchor.top), side };
    }
    if (viewport.height - anchor.bottom - gap - MARGIN >= size.height) {
      return { left: clampLeft(anchor.left), top: Math.max(MARGIN, anchor.bottom + gap), side: 'below' };
    }
    if (anchor.top - gap - MARGIN >= size.height) {
      return { left: clampLeft(anchor.left), top: anchor.top - gap - size.height, side: 'above' };
    }
    return { left: 0, top: 0, side: 'hidden' };
  }

  // Small enough to sit in the gaps around the board when the full panel doesn't fit: just the header.
  const TAB_SIZE = { width: 120, height: 32 };

  // The gap to the best line: "0" for the best line, the centipawns behind it, or "mate" when a mate score is involved.
  function formatGap(gap, mateGap) {
    if (gap === null || gap === undefined) return '—';
    return mateGap ? 'mate' : String(gap);
  }

  // The panel's model for a finished search. `fen` is the position that was searched, so the PVs can be turned into SAN.
  // `table` has one row per line: rank, the move in SAN, score, gap to the best line, depth, the arrow's colour, and the
  // whole line as a title for the row.
  function buildModel(result, fen, lineCount) {
    const table = result.lines.slice(0, lineCount).map((line) => {
      const sans = San.uciToSan(fen, line.pv);
      return {
        rank: line.rank,
        move: sans[0] || line.move,
        score: formatScore(line.evaluation),
        gap: formatGap(line.gap, line.mateGap),
        depth: line.depth === undefined || line.depth === null ? '—' : String(line.depth),
        colour: Overlay.arrowColour(line.gap),
        pv: San.formatLine(fen, sans.slice(0, PANEL_PLIES)),
      };
    });
    return { status: 'ready', evaluation: result.evaluation, wdl: result.wdl || null, table, stats: result.stats };
  }

  // The panel's model while a search runs: only the live stats, because the lines for the old position are gone.
  function buildSearching(stats) {
    return { status: 'searching', evaluation: null, wdl: null, table: [], stats: stats || null };
  }

  // Adds what the game so far says to a model: the opening it is in, and the history of best moves.
  function withGameContext(model, opening, entries) {
    return { ...model, opening: opening || null, history: entries.map(formatHistoryRow) };
  }

  // Draws the panel's body. The header (title and collapse button) is kept by AnalysisPanel.
  function renderPanel(container, model) {
    const doc = container.ownerDocument;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    container.replaceChildren();

    if (model.status === 'error') {
      container.appendChild(el('div', 'message', model.message));
      return;
    }
    if (model.status === 'idle') {
      container.appendChild(el('div', 'message', 'Waiting for a position.'));
      return;
    }

    const bar = el('div', 'bar');
    const white = el('div', 'bar-white');
    white.style.width = (evalBarFraction(model.evaluation) * 100).toFixed(1) + '%';
    bar.appendChild(white);
    container.appendChild(bar);

    container.appendChild(el('div', 'best-score', model.status === 'searching' ? 'Searching…' : formatScore(model.evaluation)));

    const shares = wdlPercentages(model.wdl);
    if (shares) {
      const wdlBar = el('div', 'wdl');
      for (const [key, cls] of [['win', 'wdl-win'], ['draw', 'wdl-draw'], ['loss', 'wdl-loss']]) {
        const segment = el('div', cls);
        segment.style.width = shares[key].toFixed(1) + '%';
        wdlBar.appendChild(segment);
      }
      container.appendChild(wdlBar);
    }
    container.appendChild(el('div', 'wdl-text', 'Win / draw / loss for White: ' + formatWdl(model.wdl)));

    if (model.table && model.table.length) {
      const table = el('table', 'lines');
      const header = el('tr');
      for (const name of ['#', 'Move', 'Score', 'Gap', 'Depth']) header.appendChild(el('th', null, name));
      table.appendChild(header);
      for (const row of model.table) {
        const tr = el('tr', 'line');
        tr.title = row.pv;
        const rank = el('td', 'rank');
        const dot = el('span', 'dot');
        dot.style.background = row.colour;
        rank.append(dot, String(row.rank));
        tr.append(rank, el('td', 'move', row.move), el('td', 'score', row.score), el('td', 'gap', row.gap), el('td', 'depth', row.depth));
        table.appendChild(tr);
      }
      container.appendChild(table);
    }

    if (model.opening !== undefined) {
      container.appendChild(el('div', 'opening', 'Opening: ' + formatOpening(model.opening)));
    }

    if (model.history && model.history.length) {
      container.appendChild(el('div', 'section', 'Game so far (best move, score)'));
      const history = el('ol', 'history');
      for (const row of model.history) {
        const item = el('li', 'history-row');
        item.appendChild(el('span', 'h-label', row.label));
        item.appendChild(el('span', 'h-move', row.move));
        item.appendChild(el('span', 'h-score', row.score));
        history.appendChild(item);
      }
      container.appendChild(history);
      history.scrollTop = history.scrollHeight; // keep the newest position in view
    }

    container.appendChild(el('div', 'technical', formatTechnical(model.stats) || 'No search stats yet'));
    container.appendChild(el('div', 'note', "Scores are from White's side. For analysis only."));
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .panel { font: 12px/1.4 system-ui, sans-serif; color: #222; background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 8px; width: ${PANEL_WIDTH}px; box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,0.2); max-height: calc(100vh - 16px); overflow-y: auto; }
    .panel.tab { width: ${TAB_SIZE.width}px; padding: 4px 6px; }
    .panel.tab .header { margin-bottom: 0; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .title { font-weight: 600; }
    .toggle { font: inherit; line-height: 1; padding: 0 4px; border: 1px solid #ccc; border-radius: 3px; background: #f7f7f7; cursor: pointer; }
    .bar { position: relative; height: 12px; background: #333; border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
    .bar-white { position: absolute; left: 0; top: 0; bottom: 0; background: #f5f5f5; }
    .best-score { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    .wdl { display: flex; height: 8px; border-radius: 3px; overflow: hidden; margin-bottom: 2px; background: #eee; }
    .wdl > div { height: 100%; }
    .wdl-win { background: #6a9f5b; }
    .wdl-draw { background: #aaa; }
    .wdl-loss { background: #9b4d4d; }
    .wdl-text { color: #555; font-size: 11px; margin-bottom: 6px; }
    .lines { width: 100%; border-collapse: collapse; margin: 0 0 6px; font-size: 11px; }
    .lines th { text-align: left; color: #777; font-weight: 600; padding: 1px 3px; }
    .lines td { padding: 2px 3px; border-top: 1px solid #f0f0f0; white-space: nowrap; }
    .lines .rank { font-weight: 700; }
    .lines .move, .lines .score { font-weight: 600; }
    .lines .gap, .lines .depth { color: #444; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
    .opening { font-size: 11px; color: #333; margin-bottom: 6px; }
    .section { font-weight: 600; font-size: 11px; margin-top: 4px; }
    .history { list-style: none; margin: 2px 0 6px; padding: 0; max-height: 110px; overflow-y: auto; border-top: 1px solid #eee; }
    .history-row { display: flex; gap: 6px; padding: 1px 0; font-size: 11px; }
    .h-label { color: #777; min-width: 28px; }
    .h-move { font-weight: 600; min-width: 46px; }
    .h-score { color: #444; }
    .technical { color: #666; font-size: 10px; margin-top: 4px; word-break: break-word; }
    .note { color: #7a4b00; font-size: 10px; margin-top: 6px; }
    .message { color: #666; }
  `;

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };

  // The panel on the page. Created on first use, shown and hidden with the suggestions setting.
  // `store` (optional) has get() and set(value) for the collapsed state, so it is remembered between visits.
  class AnalysisPanel {
    constructor(doc, store = null) {
      this.doc = doc;
      this.store = store;
      this.host = null;
      this.panelEl = null;
      this.body = null;
      this.toggle = null;
      this.anchor = null;
      this.collapsed = false; // the user's choice
      this.tabMode = false; // no room for the open panel, so it is shown as a tab
      this.visible = false; // the suggestions are on and there is a position to show
    }

    ensure() {
      if (this.host) return;
      this.host = this.doc.createElement('div');
      this.host.setAttribute('data-analysis-panel', '');
      Object.assign(this.host.style, { position: 'fixed', left: '0px', top: '0px', zIndex: '2147483000' });
      const root = this.host.attachShadow({ mode: 'open' });
      const style = this.doc.createElement('style');
      style.textContent = PANEL_CSS;
      const panel = this.doc.createElement('div');
      panel.className = 'panel';
      this.panelEl = panel;
      const header = this.doc.createElement('div');
      header.className = 'header';
      const title = this.doc.createElement('span');
      title.className = 'title';
      title.textContent = 'Analysis';
      this.toggle = this.doc.createElement('button');
      this.toggle.type = 'button';
      this.toggle.className = 'toggle';
      this.toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed, true));
      header.append(title, this.toggle);
      this.body = this.doc.createElement('div');
      this.body.className = 'body';
      panel.append(header, this.body);
      root.append(style, panel);
      this.doc.body.appendChild(this.host);
      if (this.store) {
        Promise.resolve()
          .then(() => this.store.get())
          .then((collapsed) => this.setCollapsed(Boolean(collapsed), false))
          .catch(() => {}); // without the stored state the panel just starts open
      }
      this.setCollapsed(this.collapsed, false);
    }

    // Collapsed, the panel shows only its header. The choice is saved when the user makes it.
    setCollapsed(value, save) {
      this.collapsed = value;
      if (save && this.store) this.store.set(value).catch(() => {});
      this.place();
    }

    // The board the panel sits beside.
    setAnchor(board) {
      this.anchor = board || null;
      this.place();
    }

    // Moves the panel to where placePanel says, for the board's current box and the window's size.
    // It never overlaps the board: an open panel with no room is shown as the tab if the tab fits, and otherwise hidden.
    place() {
      if (!this.host) return;
      const view = this.doc.defaultView;
      const anchor = this.anchor && this.anchor.isConnected ? rectOf(this.anchor) : null;
      const viewport = { width: view.innerWidth, height: view.innerHeight };
      // The height is only measured while the body is drawn; a tab's small height would make the full panel look like it fits.
      const measured = this.body && !this.body.hidden && this.panelEl ? this.panelEl.offsetHeight : 0;
      const full = { width: PANEL_WIDTH, height: measured || PANEL_ESTIMATE_HEIGHT };
      let spot = placePanel(anchor, viewport, this.collapsed ? TAB_SIZE : full);
      this.tabMode = !this.collapsed && spot.side === 'hidden';
      if (this.tabMode) spot = placePanel(anchor, viewport, TAB_SIZE);
      this.syncBody();
      const shown = this.visible && spot.side !== 'hidden';
      this.host.style.display = shown ? '' : 'none';
      this.host.style.left = spot.left + 'px';
      this.host.style.top = spot.top + 'px';
      this.host.dataset.placement = shown ? spot.side : 'hidden';
    }

    // The body is folded away when the user has collapsed the panel, or when there is only room for the tab.
    syncBody() {
      const folded = this.collapsed || this.tabMode;
      if (this.body) this.body.hidden = folded;
      if (this.panelEl) this.panelEl.classList.toggle('tab', this.tabMode || this.collapsed);
      if (this.toggle) {
        this.toggle.textContent = folded ? '▸' : '▾';
        this.toggle.title = folded ? 'Show the analysis' : 'Hide the analysis';
        this.toggle.setAttribute('aria-expanded', String(!folded));
      }
    }

    render(model) {
      this.ensure();
      this.visible = true;
      renderPanel(this.body, model);
      this.place();
    }

    // Live stats only: the technical row is the one thing that changes on each progress tick, so the rest is left alone.
    updateStats(stats) {
      if (!this.body) return;
      const row = this.body.querySelector('.technical');
      if (row) row.textContent = formatTechnical(stats) || 'No search stats yet';
    }

    hide() {
      this.visible = false;
      if (this.host) this.host.style.display = 'none';
    }
  }

  const api = {
    formatScore,
    formatGap,
    evalBarFraction,
    wdlPercentages,
    formatWdl,
    formatOpening,
    formatHistoryRow,
    formatTechnical,
    placePanel,
    buildModel,
    buildSearching,
    withGameContext,
    renderPanel,
    AnalysisPanel,
  };
  scope.ChessPanel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
