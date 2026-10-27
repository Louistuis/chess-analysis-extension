// Draws the engine's suggested move as an arrow over a chess.com board. It only shows the move: it never clicks or moves pieces.
// Loaded as a content script (sets window.ChessOverlay) and also as a CommonJS module so the math can be tested in Node.
(function (scope) {
  const FILES = 'abcdefgh';
  const BOARD_UNITS = 100; // the arrow is drawn in a 100 x 100 space, so it scales with the board
  const HEAD_LENGTH = 12;
  const HEAD_HALF_WIDTH = 6;

  // Centre of a square on the board, in board units. Square "a1" is bottom-left, unless the board is flipped.
  function squareCenter(square, flipped, size = BOARD_UNITS) {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]);
    if (file < 0 || !(rank >= 1 && rank <= 8)) throw new Error('Bad square: ' + square);
    const col = flipped ? 7 - file : file;
    const row = flipped ? rank - 1 : 8 - rank;
    const cell = size / 8;
    return { x: (col + 0.5) * cell, y: (row + 0.5) * cell };
  }

  // Parses a UCI move such as "e2e4" or "e7e8q" into its from and to squares.
  function parseMove(uci) {
    const match = /^([a-h][1-8])([a-h][1-8])[qrbn]?$/.exec(String(uci));
    if (!match) throw new Error('Bad move: ' + uci);
    return { from: match[1], to: match[2] };
  }

  // The shaft runs from the centre of the from-square to the base of a head whose tip is the centre of the to-square.
  function arrowShape(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) throw new Error('An arrow needs two different squares.');
    const ux = dx / length;
    const uy = dy / length;
    const base = { x: to.x - ux * HEAD_LENGTH, y: to.y - uy * HEAD_LENGTH };
    const perpX = -uy * HEAD_HALF_WIDTH;
    const perpY = ux * HEAD_HALF_WIDTH;
    return {
      shaft: { x1: from.x, y1: from.y, x2: base.x, y2: base.y },
      head: [
        { x: base.x + perpX, y: base.y + perpY },
        { x: to.x, y: to.y },
        { x: base.x - perpX, y: base.y - perpY },
      ],
    };
  }

  // Turns a suggestion into arrow geometry for a board. Throws on a bad move string.
  function arrowForMove(uci, flipped) {
    const { from, to } = parseMove(uci);
    return arrowShape(squareCenter(from, flipped), squareCenter(to, flipped));
  }

  // Keeps only the answer for the newest position. Older answers, and answers that arrive after the feature is turned off, are ignored.
  class SuggestionTracker {
    constructor({ ask, show, hide, stale }) {
      this.ask = ask; // (fen) => Promise<{ ok, move, fen, ... }>
      this.show = show; // (result) => void
      this.hide = hide; // () => void: remove the arrows
      this.stale = stale || (() => {}); // () => void: the arrows are for an old position; keep them faint until the answer
      this.fen = null;
      this.latest = 0;
    }

    // Call on every board change. Does nothing if the position is the same as the last one.
    update(fen) {
      if (fen === this.fen) return;
      this.fen = fen;
      this.stale(); // the old arrows stay faint until this position has an answer, so the board doesn't flicker
      const id = ++this.latest;
      Promise.resolve()
        .then(() => this.ask(fen))
        .then((result) => {
          if (id !== this.latest) return; // a newer position, or the feature was turned off
          if (result && result.ok && result.fen === fen) this.show(result);
          else this.hide(); // no answer for this position: don't leave the old arrows behind
        })
        .catch(() => {
          // A failed request leaves no arrow for this position.
          if (id === this.latest) this.hide();
        });
    }

    disable() {
      this.latest++;
      this.fen = null;
      this.hide();
    }
  }

  // Draws the arrow in an SVG laid over the board element. Pointer events pass through to the board.
  class SuggestionOverlay {
    constructor() {
      this.board = null;
      this.svg = null;
    }

    attach(board) {
      if (this.board === board && this.svg && this.svg.isConnected) return;
      this.detach();
      this.board = board;
      if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${BOARD_UNITS} ${BOARD_UNITS}`);
      svg.setAttribute('data-suggestion-overlay', '');
      Object.assign(svg.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '10',
        overflow: 'visible',
      });
      board.appendChild(svg);
      this.svg = svg;
    }

    detach() {
      if (this.svg) this.svg.remove();
      this.svg = null;
      this.board = null;
    }

    // arrows: { move, label, gap } for each line, best first. Each arrow is numbered at its tip, coloured by its gap,
    // and has its score label at the end square. See planArrows for where things go.
    show(arrows, flipped) {
      if (!this.svg) return;
      const motion = motionFor(prefersReducedMotion());
      const groups = planArrows(arrows, flipped).map((plan) => {
        const group = svgNode('g', { 'data-rank': plan.number });
        const shaft = svgNode('line', {
          x1: plan.shaft.x1,
          y1: plan.shaft.y1,
          x2: plan.shaft.x2,
          y2: plan.shaft.y2,
          stroke: plan.colour,
          'stroke-opacity': ARROW_OPACITY,
          'stroke-width': ARROW_WIDTH,
          'stroke-linecap': 'round',
        });
        const head = svgNode('polygon', {
          points: plan.head.map((p) => `${p.x},${p.y}`).join(' '),
          fill: plan.colour,
          'fill-opacity': ARROW_OPACITY,
        });
        const badge = svgNode('circle', { cx: plan.badge.x, cy: plan.badge.y, r: BADGE_RADIUS, fill: plan.colour, stroke: '#fff', 'stroke-width': 0.8 });
        const number = svgNode('text', {
          x: plan.badge.x,
          y: plan.badge.y,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'font-size': BADGE_FONT,
          'font-weight': 700,
          fill: '#fff',
          stroke: '#111', // a dark outline keeps the white number readable on the yellow and orange arrows
          'stroke-width': NUMBER_OUTLINE,
          'paint-order': 'stroke',
        }, String(plan.number));
        group.append(shaft, head, badge, number);
        if (plan.label.text) {
          group.appendChild(svgNode('text', {
            x: plan.label.x,
            y: plan.label.y,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            'font-size': LABEL_FONT,
            'font-weight': 600,
            fill: '#fff',
            stroke: '#111',
            'stroke-width': 0.6,
            'paint-order': 'stroke',
          }, plan.label.text));
        }
        if (motion.fadeMs > 0) {
          // Starts a little behind the arrow's own direction and transparent, then slides and fades into place.
          group.style.transition = `opacity ${motion.fadeMs}ms ease, transform ${motion.fadeMs}ms ease`;
          group.style.opacity = '0';
          group.style.transform = `translate(${-plan.direction.x * motion.slide}px, ${-plan.direction.y * motion.slide}px)`;
        }
        return group;
      });
      const previous = [...this.svg.children];
      this.svg.removeAttribute('data-stale');
      this.svg.style.opacity = '1';
      if (motion.fadeMs === 0) {
        this.svg.replaceChildren(...groups);
        return;
      }
      // The old arrows fade out while the new ones fade and slide in.
      for (const old of previous) {
        old.style.opacity = '0';
        setTimeout(() => old.remove(), motion.fadeMs);
      }
      this.svg.append(...groups);
      requestFrame(() => {
        for (const group of groups) {
          group.style.opacity = '1';
          group.style.transform = 'translate(0px, 0px)';
        }
      });
    }

    // The arrows are for an earlier position: they stay on the board, faint, until the new position has an answer.
    dim() {
      if (!this.svg) return;
      this.svg.setAttribute('data-stale', '');
      // The numbers and score labels go too: a score on a faded arrow would read as a suggestion for the new position.
      for (const text of this.svg.querySelectorAll('text')) text.style.display = 'none';
      const motion = motionFor(prefersReducedMotion());
      this.svg.style.transition = motion.fadeMs > 0 ? `opacity ${motion.fadeMs}ms ease` : 'none';
      this.svg.style.opacity = String(DIMMED_OPACITY);
    }

    clear() {
      if (!this.svg) return;
      this.svg.replaceChildren();
      this.svg.removeAttribute('data-stale');
      this.svg.style.opacity = '1';
    }
  }

  const DIMMED_OPACITY = 0.35;
  // How long arrows take to fade, and how far (in board units) they slide in from behind their own direction.
  // With reduced motion they switch at once.
  function motionFor(reduced) {
    return reduced ? { fadeMs: 0, slide: 0 } : { fadeMs: 180, slide: 3 };
  }

  // True when the person has asked the system for less motion.
  function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Runs `fn` on the next frame, or after a short delay where there are no animation frames.
  function requestFrame(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Creates an SVG element with the given attributes, and text if given.
  function svgNode(tag, attributes, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const MAX_ARROWS = 5; // one arrow per line, numbered 1 to 5
  const ARROW_WIDTH = 3.2;
  const ARROW_OPACITY = 0.9;
  const BADGE_RADIUS = 4.2;
  const BADGE_FONT = 4.4;
  const NUMBER_OUTLINE = 0.9;
  const BADGE_SPACING = 2 * BADGE_RADIUS + 1; // how far back a number sits when another arrow already ends on the square
  const LABEL_FONT = 3.4;
  const LABEL_RING_STEP = 7; // how much further out each extra label on the same corner goes
  const GAP_FOR_RED = 300; // centipawns behind the best line at which an arrow is fully red
  // The corners of the end square the score label can sit on, as signs of the offset from the centre (x right, y down).
  const LABEL_CORNERS = [
    { x: 1, y: -1 }, // top right
    { x: 1, y: 1 }, // bottom right
    { x: -1, y: -1 }, // top left
    { x: -1, y: 1 }, // bottom left
  ];

  // The colour of an arrow by its gap to the best line in centipawns: green at 0 (the best line), through yellow, to red
  // at 300 or more. A gap that is not a number is drawn as red, the weakest.
  function arrowColour(gap) {
    const amount = Number.isFinite(gap) ? gap : GAP_FOR_RED;
    const share = Math.min(1, Math.max(0, amount / GAP_FOR_RED));
    const hue = Math.round(120 * (1 - share));
    return `hsl(${hue}, 70%, 42%)`;
  }

  // Works out where each numbered arrow, its number and its score label go. `arrows` are in rank order, best first,
  // as { move, label, gap }. The number sits at the arrow's tip. If another arrow already ends on the same square, its
  // number is pushed back along its own arrow, and its label goes on the next corner of that square, so they stay apart.
  function planArrows(arrows, flipped) {
    const cell = BOARD_UNITS / 8;
    const endings = new Map(); // end square -> how many arrows have ended there so far
    return arrows.slice(0, MAX_ARROWS).map((arrow, index) => {
      const { to } = parseMove(arrow.move);
      const geometry = arrowForMove(arrow.move, flipped);
      const tip = geometry.head[1];
      const shared = endings.get(to) || 0;
      endings.set(to, shared + 1);
      const length = Math.hypot(tip.x - geometry.shaft.x1, tip.y - geometry.shaft.y1);
      const ux = (tip.x - geometry.shaft.x1) / length;
      const uy = (tip.y - geometry.shaft.y1) / length;
      const back = shared * BADGE_SPACING;
      const corner = LABEL_CORNERS[shared % LABEL_CORNERS.length];
      // With more arrows than corners, a label goes further out on a corner it shares, so it doesn't land on another label.
      const reach = cell / 2 + Math.floor(shared / LABEL_CORNERS.length) * LABEL_RING_STEP;
      const centre = squareCenter(to, flipped);
      return {
        number: index + 1,
        move: arrow.move,
        colour: arrowColour(arrow.gap),
        direction: { x: ux, y: uy }, // unit vector from the start of the shaft to the tip
        shaft: geometry.shaft,
        head: geometry.head,
        badge: { x: tip.x - ux * back, y: tip.y - uy * back },
        label: {
          x: centre.x + corner.x * reach,
          y: centre.y + corner.y * reach,
          text: arrow.label === undefined || arrow.label === null ? '' : String(arrow.label),
        },
      };
    });
  }

  const api = { squareCenter, parseMove, arrowShape, arrowForMove, arrowColour, planArrows, motionFor, MAX_ARROWS, DIMMED_OPACITY, SuggestionTracker, SuggestionOverlay };
  scope.ChessOverlay = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
