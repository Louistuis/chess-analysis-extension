// Analysis panel: an eval bar from White's side, a table of the engine's lines (move, score, gap to the best, depth),
// win/draw/loss, the opening, the game's history of best moves, and a raw technical row. The formatting and placement
// functions are pure and tested in Node. AnalysisPanel draws the panel in a shadow root, so chess.com's CSS can't
// restyle it, and places it beside the board. Nothing here moves pieces or clicks anything.
// Loaded as a classic script (sets globalThis.ChessPanel) and also as a CommonJS module.
(function (scope) {
  const San = typeof module !== 'undefined' && typeof require === 'function' ? require('./san.js') : scope.ChessSan;
  const Overlay = typeof module !== 'undefined' && typeof require === 'function' ? require('./overlay.js') : scope.ChessOverlay;
  const Review = typeof module !== 'undefined' && typeof require === 'function' ? require('./review.js') : scope.ChessReview;
  const PANEL_PLIES = 8; // moves of each line shown in the panel
  const PREVIEW_PLIES = 5; // moves of each line shown under its row
  const PANEL_WIDTH = 280;
  const STATS_INTERVAL_MS = 400; // the live numbers in the panel update at most this often
  const PANEL_ESTIMATE_HEIGHT = 520; // used until the panel has been drawn and can be measured
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

  // A plain-words verdict on a position from White's side, e.g. "White is slightly better", "Black mates in 3".
  function describeEval(evaluation) {
    if (!evaluation) return '';
    if (evaluation.type === 'mate') {
      if (evaluation.value === 0) return 'Checkmate';
      const winner = evaluation.value > 0 ? 'White' : 'Black';
      return winner + ' mates in ' + Math.abs(evaluation.value);
    }
    const pawns = Math.abs(evaluation.value) / 100;
    if (pawns < 0.2) return 'Equal position';
    const side = evaluation.value > 0 ? 'White' : 'Black';
    if (pawns < 0.6) return side + ' is slightly better';
    if (pawns < 1.5) return side + ' is better';
    if (pawns < 3.5) return side + ' is much better';
    return side + ' is winning';
  }

  // What a line is worth compared with the best one, from its gap in centipawns.
  function lineQuality(rank, gap, mateGap) {
    if (rank === 1 || gap === 0) return 'Best';
    if (mateGap) return 'Much worse';
    if (gap <= 15) return 'Equally strong';
    if (gap <= 60) return 'Playable';
    if (gap <= 150) return 'Worse';
    return 'Poor';
  }

  // "Depth 9 of 14" and the share of the way there, from 0 to 1.
  function depthProgress(depth, target) {
    if (!Number.isFinite(depth) || !Number.isFinite(target) || target <= 0) return null;
    return { text: 'Depth ' + Math.min(depth, target) + ' of ' + target, fraction: Math.max(0, Math.min(1, depth / target)) };
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
  // `options.partial` marks a search still running: the lines are what the engine has found so far, and
  // `options.targetDepth` is the depth it is working towards.
  function buildModel(result, fen, lineCount, options = {}) {
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
        preview: San.formatLine(fen, sans.slice(0, PREVIEW_PLIES)),
        quality: lineQuality(line.rank, line.gap, line.mateGap),
      };
    });
    const searching = Boolean(options.partial);
    return {
      status: searching ? 'searching' : 'ready',
      evaluation: result.evaluation,
      wdl: result.wdl || null,
      table,
      stats: result.stats,
      verdict: describeEval(result.evaluation),
      best: table.length ? { move: table[0].move, colour: table[0].colour } : null,
      progress: searching ? depthProgress(result.depth, options.targetDepth) : null,
      targetDepth: options.targetDepth || null,
    };
  }

  // The panel's model while a search runs: only the live stats, because the lines for the old position are gone.
  function buildSearching(stats) {
    return { status: 'searching', evaluation: null, wdl: null, table: [], stats: stats || null };
  }

  // Adds what the game so far says to a model: the opening it is in, and the history of best moves.
  // `userColor` ('w' or 'b') is the side the person at the board plays, so the other side is the one checked.
  // "Practice strength: ~1500 Elo" while the engine plays at a set strength; nothing at Full strength.
  function formatStrength(elo) {
    return elo === null || elo === undefined ? null : `Practice strength: ~${elo} Elo`;
  }

  // Adds the practice-strength line to a model, so the panel says the lines come from a limited engine.
  function withPracticeStrength(model, elo) {
    return { ...model, strength: formatStrength(elo) };
  }

  // Runs `fn` at most once per `intervalMs`. The first call runs at once; calls in between keep only the latest value,
  // which runs when the interval is up, so fast progress ticks don't make the numbers jitter. `cancel()` drops a waiting value.
  function throttle(fn, intervalMs, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let last = -Infinity;
    let timer = null;
    let pending = null; // { value } while a call is waiting for its turn
    const run = () => {
      timer = null;
      const next = pending;
      pending = null;
      if (!next) return;
      last = now();
      fn(next.value);
    };
    const throttled = (value) => {
      pending = { value };
      if (timer !== null) return;
      const wait = intervalMs - (now() - last);
      if (wait <= 0) run();
      else timer = setTimer(run, wait);
    };
    throttled.cancel = () => {
      pending = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
    };
    return throttled;
  }

  function withGameContext(model, opening, entries, userColor = 'w') {
    return { ...model, opening: opening || null, history: entries.map(formatHistoryRow), review: Review.buildReview(entries), userColor };
  }

  // "≈ 1650 ± 250", or a note while there are too few moves for an estimate.
  function formatElo(elo) {
    return elo ? `≈ ${elo.rating} ± ${elo.spread}` : 'not enough moves yet';
  }

  // The figures behind an opponent check, e.g. "match 62% · avg loss 31 cp".
  function formatSideStats(side) {
    if (!side || !side.moves) return 'no moves analysed yet';
    return `${side.moves} moves · engine match ${Math.round(side.matchRate * 100)}% · avg loss ${side.acpl} cp`;
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

    const searching = model.status === 'searching';
    const bar = el('div', 'bar');
    const white = el('div', 'bar-white');
    white.style.width = (evalBarFraction(model.evaluation) * 100).toFixed(1) + '%';
    bar.append(white, el('div', 'bar-mid'));
    container.appendChild(bar);

    const top = el('div', 'top');
    top.appendChild(el('div', 'best-score', searching && !model.evaluation ? 'Searching…' : formatScore(model.evaluation)));
    const side = el('div', 'top-side');
    if (model.verdict) side.appendChild(el('div', 'verdict', model.verdict));
    if (model.best) {
      const best = el('div', 'bestmove');
      const dot = el('span', 'dot');
      dot.style.background = model.best.colour;
      best.append(dot, 'Best move ', el('strong', null, model.best.move));
      side.appendChild(best);
    }
    top.appendChild(side);
    container.appendChild(top);
    if (model.strength) container.appendChild(el('div', 'strength', model.strength));

    if (searching && model.progress) {
      const progress = el('div', 'progress');
      const fill = el('div', 'progress-fill');
      fill.style.width = (model.progress.fraction * 100).toFixed(0) + '%';
      progress.appendChild(fill);
      container.appendChild(progress);
      container.appendChild(el('div', 'progress-text', 'Still thinking · ' + model.progress.text));
    }

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
        // The line itself and what it is worth next to the best one, so the numbers above need no decoding.
        const detail = el('tr', 'line-detail');
        const cell = el('td');
        cell.colSpan = 5;
        cell.append(el('span', 'quality', row.quality), ' ', el('span', 'preview', row.preview));
        detail.appendChild(cell);
        table.appendChild(detail);
      }
      container.appendChild(table);
    }

    const review = model.review;
    if (review && review.graph.length >= 2) {
      container.appendChild(el('div', 'section', 'Evaluation through the game'));
      container.appendChild(drawGraph(doc, review.graph));
    }

    if (model.opening !== undefined) {
      container.appendChild(el('div', 'opening', 'Opening: ' + formatOpening(model.opening)));
    }

    if (review && review.moves.length) {
      container.appendChild(el('div', 'section', 'Game review'));
      const summary = el('div', 'review-summary');
      for (const [colour, name] of [['w', 'White'], ['b', 'Black']]) {
        const counts = review.counts[colour];
        const accuracy = review.accuracy[colour];
        const part = el('div', 'review-side');
        part.appendChild(el('strong', null, name + ' ' + (accuracy === null ? '—' : accuracy + '%')));
        part.appendChild(el('span', 'review-counts', `${counts.inaccuracy} inacc · ${counts.mistake} mist · ${counts.blunder} blun`));
        summary.appendChild(part);
      }
      container.appendChild(summary);
      const notable = review.moves.filter((move) => move.notable);
      if (notable.length) {
        const list = el('ul', 'review-list');
        for (const move of notable) {
          const item = el('li', 'review-row ' + move.kind);
          item.append(el('span', 'r-label', move.label), el('span', 'r-move', move.played + move.mark), el('span', 'r-name', move.name));
          if (move.best) item.appendChild(el('span', 'r-best', 'best ' + move.best));
          list.appendChild(item);
        }
        container.appendChild(list);
        list.scrollTop = list.scrollHeight;
      }
    }

    if (review && review.sides && review.moves.length) {
      const user = model.userColor === 'b' ? 'b' : 'w';
      const enemy = user === 'w' ? 'b' : 'w';
      const name = (colour) => (colour === 'w' ? 'White' : 'Black');
      container.appendChild(el('div', 'section', 'Opponent check (' + name(enemy) + ')'));
      const box = el('div', 'opp');
      const signal = review.sides[enemy].signal;
      const head = el('div', 'opp-head');
      head.append(el('span', 'opp-level ' + signal.level, signal.text));
      box.appendChild(head);
      box.appendChild(el('div', 'opp-stats', formatSideStats(review.sides[enemy])));
      box.appendChild(el('div', 'opp-elo', 'Estimated rating ' + formatElo(review.sides[enemy].elo)));
      box.appendChild(el('div', 'opp-you', 'You (' + name(user) + '): ' + formatElo(review.sides[user].elo)));
      box.appendChild(el('div', 'opp-note', 'A hint from the moves seen so far, not proof. Strong players and forced positions also match the engine often. Ratings are rough.'));
      container.appendChild(box);
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

  // White's win chance through the game as a small area graph: white above the line, grey below, a dot on the newest position.
  function drawGraph(doc, points) {
    const ns = 'http://www.w3.org/2000/svg';
    const width = 100;
    const height = 36;
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'graph');
    svg.setAttribute('preserveAspectRatio', 'none');
    const step = width / (points.length - 1);
    const coords = points.map((value, index) => [index * step, height - (value / 100) * height]);
    const area = doc.createElementNS(ns, 'polygon');
    area.setAttribute('class', 'graph-area');
    area.setAttribute('points', [`0,${height}`, ...coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`), `${width},${height}`].join(' '));
    const mid = doc.createElementNS(ns, 'line');
    mid.setAttribute('class', 'graph-mid');
    mid.setAttribute('x1', '0');
    mid.setAttribute('x2', String(width));
    mid.setAttribute('y1', String(height / 2));
    mid.setAttribute('y2', String(height / 2));
    const line = doc.createElementNS(ns, 'polyline');
    line.setAttribute('class', 'graph-line');
    line.setAttribute('points', coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
    const [lastX, lastY] = coords[coords.length - 1];
    const dot = doc.createElementNS(ns, 'circle');
    dot.setAttribute('class', 'graph-dot');
    dot.setAttribute('cx', lastX.toFixed(2));
    dot.setAttribute('cy', lastY.toFixed(2));
    dot.setAttribute('r', '1.8');
    svg.append(area, mid, line, dot);
    return svg;
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .panel { --fg: #1f2328; --muted: #656d76; --bg: #fff; --line: #e4e7eb; --soft: #f4f5f7; --edge: #d0d4da;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: var(--fg); background: var(--bg); border: 1px solid var(--edge); border-radius: 10px; padding: 10px; width: ${PANEL_WIDTH}px; box-sizing: border-box; box-shadow: 0 4px 18px rgba(0,0,0,0.22); max-height: calc(100vh - 16px); overflow-y: auto; }
    @media (prefers-color-scheme: dark) {
      .panel { --fg: #e6e8eb; --muted: #9aa3ad; --bg: #262522; --line: #3a3936; --soft: #302f2c; --edge: #45433f; }
    }
    .panel.tab { width: ${TAB_SIZE.width}px; padding: 4px 8px; }
    .panel.tab .header { margin-bottom: 0; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .title { font-weight: 650; letter-spacing: 0.2px; }
    .toggle { font: inherit; line-height: 1; padding: 2px 6px; color: var(--fg); border: 1px solid var(--edge); border-radius: 5px; background: var(--soft); cursor: pointer; }
    .bar { position: relative; height: 10px; background: #3b3a37; border-radius: 5px; overflow: hidden; margin-bottom: 8px; }
    .bar-white { position: absolute; left: 0; top: 0; bottom: 0; background: #f2f2f2; transition: width 0.25s ease; }
    .bar-mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: rgba(120,120,120,0.7); }
    .top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .best-score { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 72px; }
    .top-side { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .verdict { font-weight: 600; }
    .bestmove { color: var(--muted); }
    .bestmove strong { color: var(--fg); font-size: 13px; }
    .progress { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
    .progress-fill { height: 100%; background: #3b82f6; transition: width 0.2s ease; }
    .progress-text { color: var(--muted); font-size: 10px; margin: 2px 0 8px; }
    .wdl { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 2px; background: var(--line); }
    .wdl > div { height: 100%; }
    .wdl-win { background: #6a9f5b; }
    .wdl-draw { background: #9aa0a6; }
    .wdl-loss { background: #b05a5a; }
    .wdl-text { color: var(--muted); font-size: 10.5px; margin-bottom: 8px; }
    .lines { width: 100%; border-collapse: collapse; margin: 0 0 8px; font-size: 11.5px; }
    .lines th { text-align: left; color: var(--muted); font-weight: 600; padding: 1px 3px; font-size: 10.5px; }
    .lines td { padding: 3px 3px 0; white-space: nowrap; }
    .lines tr.line td { border-top: 1px solid var(--line); }
    .lines .rank { font-weight: 700; }
    .lines .move, .lines .score { font-weight: 650; }
    .lines .gap, .lines .depth { color: var(--muted); }
    .lines .line-detail td { white-space: normal; padding: 0 3px 4px 15px; color: var(--muted); font-size: 10.5px; }
    .quality { font-weight: 600; color: var(--fg); }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
    .graph { display: block; width: 100%; height: 44px; margin: 3px 0 8px; border-radius: 5px; background: #3b3a37; }
    .graph-area { fill: #f2f2f2; }
    .graph-mid { stroke: rgba(130,130,130,0.8); stroke-width: 0.4; vector-effect: non-scaling-stroke; }
    .graph-line { fill: none; stroke: #3b82f6; stroke-width: 1.4; vector-effect: non-scaling-stroke; }
    .graph-dot { fill: #3b82f6; stroke: #fff; stroke-width: 0.5; vector-effect: non-scaling-stroke; }
    .opening { font-size: 11px; margin-bottom: 8px; }
    .section { font-weight: 650; font-size: 11px; margin-top: 4px; }
    .review-summary { display: flex; gap: 8px; margin: 3px 0 4px; }
    .review-side { flex: 1; display: flex; flex-direction: column; background: var(--soft); border-radius: 6px; padding: 4px 6px; }
    .review-counts { color: var(--muted); font-size: 10px; }
    .review-list { list-style: none; margin: 0 0 8px; padding: 0; max-height: 100px; overflow-y: auto; }
    .review-row { display: flex; gap: 6px; padding: 2px 0; font-size: 11px; border-top: 1px solid var(--line); }
    .r-label { color: var(--muted); min-width: 30px; }
    .r-move { font-weight: 650; min-width: 52px; }
    .r-best { color: var(--muted); margin-left: auto; }
    .review-row.inaccuracy .r-name { color: #b08900; }
    .review-row.mistake .r-name { color: #d9730d; }
    .review-row.blunder .r-name { color: #d64545; }
    .opp { background: var(--soft); border-radius: 6px; padding: 5px 7px; margin: 3px 0 8px; }
    .opp-level { display: inline-block; font-weight: 650; padding: 1px 7px; border-radius: 9px; background: var(--line); }
    .opp-level.normal { background: #cfe8cf; color: #1e4d1e; }
    .opp-level.elevated { background: #f7e2a8; color: #6b4b00; }
    .opp-level.high { background: #f4c1c1; color: #7a1f1f; }
    .opp-stats, .opp-elo, .opp-you { margin-top: 3px; }
    .opp-you, .opp-note { color: var(--muted); }
    .opp-note { font-size: 10px; margin-top: 3px; }
    .history { list-style: none; margin: 2px 0 6px; padding: 0; max-height: 110px; overflow-y: auto; border-top: 1px solid var(--line); }
    .history-row { display: flex; gap: 6px; padding: 1px 0; font-size: 11px; }
    .h-label { color: var(--muted); min-width: 28px; }
    .h-move { font-weight: 600; min-width: 46px; }
    .h-score { color: var(--muted); }
    .technical { color: var(--muted); font-size: 10px; margin-top: 4px; word-break: break-word; }
    .note { color: #a1650a; font-size: 10px; margin-top: 6px; }
    .message { color: var(--muted); }
    .strength { display: inline-block; font-size: 10.5px; color: var(--muted); background: var(--soft); border-radius: 4px; padding: 1px 6px; margin: -2px 0 8px; }
    @media (prefers-reduced-motion: reduce) {
      .panel *, .panel { transition: none !important; animation: none !important; }
    }
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
      this.targetDepth = null;
      // Live stats arrive often; the panel redraws its numbers at most every STATS_INTERVAL_MS.
      this.statsThrottle = throttle((stats) => this.applyStats(stats), STATS_INTERVAL_MS);
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
      this.targetDepth = model.targetDepth || null;
      this.statsThrottle.cancel(); // stats waiting from the last search would otherwise land on this model
      renderPanel(this.body, model);
      this.place();
    }

    // Live stats only: the technical row and the depth bar change on each progress tick, so the rest is left alone.
    // Throttled, so the numbers update a few times a second rather than on every tick.
    updateStats(stats) {
      this.statsThrottle(stats);
    }

    applyStats(stats) {
      if (!this.body) return;
      const row = this.body.querySelector('.technical');
      if (row) row.textContent = formatTechnical(stats) || 'No search stats yet';
      const fill = this.body.querySelector('.progress-fill');
      const text = this.body.querySelector('.progress-text');
      const progress = stats && this.targetDepth ? depthProgress(stats.depth, this.targetDepth) : null;
      if (fill && text && progress) {
        fill.style.width = (progress.fraction * 100).toFixed(0) + '%';
        text.textContent = 'Still thinking · ' + progress.text;
      }
    }

    hide() {
      this.visible = false;
      if (this.host) this.host.style.display = 'none';
    }
  }

  const api = {
    formatScore,
    describeEval,
    lineQuality,
    depthProgress,
    formatGap,
    evalBarFraction,
    wdlPercentages,
    formatWdl,
    formatOpening,
    formatElo,
    formatSideStats,
    formatHistoryRow,
    formatTechnical,
    placePanel,
    buildModel,
    buildSearching,
    withGameContext,
    formatStrength,
    withPracticeStrength,
    throttle,
    renderPanel,
    AnalysisPanel,
  };
  scope.ChessPanel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
