const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { squareCenter, parseMove, arrowShape, arrowForMove, arrowColour, planArrows, motionFor, DIMMED_OPACITY, MAX_ARROWS, SuggestionTracker, SuggestionOverlay } = require('../src/overlay.js');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const closePoint = (actual, expected) => {
  close(actual.x, expected.x);
  close(actual.y, expected.y);
};

test('squareCenter puts a1 at the bottom left and h8 at the top right', () => {
  closePoint(squareCenter('a1', false), { x: 6.25, y: 93.75 });
  closePoint(squareCenter('h8', false), { x: 93.75, y: 6.25 });
  closePoint(squareCenter('e2', false), { x: 56.25, y: 81.25 });
});

test('squareCenter mirrors the board when it is flipped', () => {
  closePoint(squareCenter('h1', true), { x: 6.25, y: 6.25 });
  closePoint(squareCenter('a8', true), { x: 93.75, y: 93.75 });
  closePoint(squareCenter('e2', true), { x: 43.75, y: 18.75 });
});

test('squareCenter scales with the size it is given', () => {
  closePoint(squareCenter('a1', false, 800), { x: 50, y: 750 });
});

test('squareCenter rejects bad squares', () => {
  assert.throws(() => squareCenter('i1', false), /Bad square/);
  assert.throws(() => squareCenter('e9', false), /Bad square/);
});

test('parseMove reads from and to squares, including promotions', () => {
  assert.deepEqual(parseMove('e2e4'), { from: 'e2', to: 'e4' });
  assert.deepEqual(parseMove('e7e8q'), { from: 'e7', to: 'e8' });
  assert.throws(() => parseMove('e9e4'), /Bad move/);
  assert.throws(() => parseMove('e2'), /Bad move/);
});

test('parseMove rejects a promotion letter that is not a piece, and bad case', () => {
  assert.throws(() => parseMove('e7e8k'), /Bad move/);
  assert.throws(() => parseMove('a0a1'), /Bad move/);
  assert.throws(() => parseMove('E2E4'), /Bad move/);
});

test('every square has its own centre, inside the board', () => {
  const seen = new Set();
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      for (const flipped of [false, true]) {
        const p = squareCenter(file + rank, flipped);
        assert.ok(p.x > 0 && p.x < 100 && p.y > 0 && p.y < 100, file + rank);
      }
      const p = squareCenter(file + rank, false);
      const key = p.x + ',' + p.y;
      assert.ok(!seen.has(key), 'two squares share a centre: ' + file + rank);
      seen.add(key);
    }
  }
  assert.equal(seen.size, 64);
});

test('a flipped board is the same board turned half a turn', () => {
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      const square = file + rank;
      const normal = squareCenter(square, false);
      closePoint(squareCenter(square, true), { x: 100 - normal.x, y: 100 - normal.y });
    }
  }
});

test('arrowShape ends with its head tip on the target square centre', () => {
  const from = squareCenter('e2', false);
  const to = squareCenter('e4', false);
  const arrow = arrowShape(from, to);
  closePoint({ x: arrow.shaft.x1, y: arrow.shaft.y1 }, from);
  closePoint(arrow.head[1], to);
  // The shaft stops at the base of the head, 12 units back from the tip.
  close(arrow.shaft.y2 - to.y, 12);
  close(arrow.shaft.x2, to.x);
  // The head's two base corners are 6 units to either side of the shaft.
  close(arrow.head[0].x - arrow.shaft.x2, 6);
  close(arrow.head[2].x - arrow.shaft.x2, -6);
  close(arrow.head[0].y, arrow.shaft.y2);
});

test('arrowForMove draws to the flipped squares when the board is flipped', () => {
  const arrow = arrowForMove('e2e4', true);
  closePoint(arrow.head[1], squareCenter('e4', true));
  closePoint({ x: arrow.shaft.x1, y: arrow.shaft.y1 }, squareCenter('e2', true));
});

// The hue of an hsl() colour string such as "hsl(120, 70%, 42%)".
const hueOf = (colour) => Number(/^hsl\((\d+),/.exec(colour)[1]);

test('the colour scale runs from green for the best line, through yellow, to red at 300 centipawns or more behind', () => {
  assert.equal(hueOf(arrowColour(0)), 120, 'the best line is green');
  assert.equal(hueOf(arrowColour(150)), 60, 'halfway is yellow');
  assert.equal(hueOf(arrowColour(300)), 0, 'red from 300 centipawns behind');
  assert.equal(hueOf(arrowColour(1200)), 0, 'and stays red beyond that');
  assert.equal(hueOf(arrowColour(undefined)), 0, 'a gap that is not a number is the weakest');
});

test('the colour gets weaker, hue by hue, as the gap grows', () => {
  let previous = 121; // above green, so the first step only has to be no higher than the best line's hue
  for (let gap = 0; gap <= 300; gap += 10) {
    const hue = hueOf(arrowColour(gap));
    assert.ok(hue < previous, `hue falls at ${gap}`);
    previous = hue;
  }
});

test('five arrows ending on one square keep their labels apart, and their numbers too', () => {
  const sources = ['e2', 'd2', 'f2', 'g2', 'c2'];
  const plans = planArrows(sources.map((from, i) => ({ move: from + 'e4', label: '+0.' + i, gap: i * 10 })), false);
  const points = plans.flatMap((p) => [p.label, p.badge]);
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const dist = Math.hypot(plans[i].label.x - plans[j].label.x, plans[i].label.y - plans[j].label.y);
      assert.ok(dist >= 6, `labels ${i + 1} and ${j + 1} are ${dist.toFixed(1)} apart`);
      const badgeDist = Math.hypot(plans[i].badge.x - plans[j].badge.x, plans[i].badge.y - plans[j].badge.y);
      assert.ok(badgeDist >= 6, `numbers ${i + 1} and ${j + 1} are ${badgeDist.toFixed(1)} apart`);
    }
  }
  assert.equal(points.length, 10);
});

test('planArrows numbers the lines 1 to 5 in rank order and never draws more than five', () => {
  const arrows = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'b1c3', 'f2f4'].map((move, i) => ({ move, label: '+0.' + i, gap: i * 10 }));
  const plans = planArrows(arrows, false);
  assert.deepEqual(plans.map((p) => p.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(plans.map((p) => p.move), ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'b1c3']);
  assert.equal(MAX_ARROWS, 5);
});

test('each arrow is coloured by its own gap, and its number sits at the arrow tip', () => {
  const [best, weak] = planArrows([
    { move: 'e2e4', label: '+0.40', gap: 0 },
    { move: 'g1f3', label: '-2.10', gap: 300 },
  ], false);
  assert.equal(best.colour, arrowColour(0));
  assert.equal(weak.colour, arrowColour(300));
  closePoint(best.badge, squareCenter('e4', false));
  closePoint(weak.badge, squareCenter('f3', false));
});

test('the score label sits on the top-right corner of the end square', () => {
  const [plan] = planArrows([{ move: 'e2e4', label: '+0.40', gap: 0 }], false);
  const e4 = squareCenter('e4', false);
  assert.equal(plan.label.text, '+0.40');
  closePoint(plan.label, { x: e4.x + 6.25, y: e4.y - 6.25 });
});

test('a label with no text, such as a missing score, is left empty', () => {
  const [plan] = planArrows([{ move: 'e2e4', label: null, gap: 0 }], false);
  assert.equal(plan.label.text, '');
});

test('lines that end on the same square get numbers pushed apart and labels on different corners', () => {
  // Both end on f7 (Nxf7 and Qxf7 style moves), so the second one must not sit on the first's number or label.
  const [first, second] = planArrows([
    { move: 'g5f7', label: '+1.00', gap: 0 },
    { move: 'h8f7', label: '+0.90', gap: 10 },
  ], false);
  const f7 = squareCenter('f7', false);
  const BADGE_DIAMETER = 8.4; // two badges of radius 4.2 touch at this distance
  closePoint(first.badge, f7);
  assert.ok(Math.hypot(second.badge.x - f7.x, second.badge.y - f7.y) > BADGE_DIAMETER, 'the numbers do not overlap');
  assert.notDeepEqual(second.label, first.label, 'the labels are on different corners');
  closePoint(second.label, { x: f7.x + 6.25, y: f7.y + 6.25 }); // the second corner is bottom right
});

test('motion: arrows fade and slide in over 180 ms, and switch at once with reduced motion', () => {
  assert.deepEqual(motionFor(false), { fadeMs: 180, slide: 3 });
  assert.deepEqual(motionFor(true), { fadeMs: 0, slide: 0 });
  assert.ok(DIMMED_OPACITY > 0 && DIMMED_OPACITY < 1, 'faded arrows are visible but faint');
});

// Runs `fn` with a jsdom board and the globals the overlay reads (document, getComputedStyle, matchMedia) set to it.
function withBoard(reducedMotion, fn) {
  const dom = new JSDOM('<div id="board"></div>');
  const saved = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, matchMedia: globalThis.matchMedia };
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.matchMedia = () => ({ matches: reducedMotion });
  try {
    return fn(dom.window.document.getElementById('board'));
  } finally {
    Object.assign(globalThis, saved);
  }
}

test('with reduced motion the arrows are dimmed, then replaced, with no animation', () => {
  withBoard(true, (board) => {
    const overlay = new SuggestionOverlay();
    overlay.attach(board);
    overlay.show([{ move: 'e2e4', label: '+0.30', gap: 0 }], false);
    assert.equal(overlay.svg.querySelectorAll('g[data-rank]').length, 1);
    overlay.dim();
    assert.equal(overlay.svg.hasAttribute('data-stale'), true);
    assert.equal(overlay.svg.style.opacity, String(DIMMED_OPACITY));
    assert.equal(overlay.svg.querySelectorAll('g[data-rank]').length, 1, 'the faded arrow is still drawn');
    const hiddenTexts = [...overlay.svg.querySelectorAll('text')];
    assert.ok(hiddenTexts.length >= 2, 'the faded arrow has its number and label');
    assert.ok(hiddenTexts.every((t) => t.style.display === 'none'), 'but its number and score are hidden');
    overlay.show([{ move: 'g1f3', label: '+0.10', gap: 0 }], false);
    assert.ok([...overlay.svg.querySelectorAll('text')].every((t) => t.style.display !== 'none'), 'new numbers and scores show');
    assert.equal(overlay.svg.hasAttribute('data-stale'), false, 'the new arrows are not faded');
    assert.equal(overlay.svg.style.opacity, '1');
    assert.equal(overlay.svg.querySelectorAll('g[data-rank]').length, 1, 'replaced at once, no leftovers');
    assert.equal(overlay.svg.querySelector('g').style.opacity, '', 'no fade styles with reduced motion');
    overlay.clear();
    assert.equal(overlay.svg.querySelectorAll('g').length, 0);
  });
});

test('with motion allowed a new arrow starts faint and slides in, and the old one fades out before it is removed', async () => {
  await withBoard(false, async (board) => {
    const overlay = new SuggestionOverlay();
    overlay.attach(board);
    overlay.show([{ move: 'e2e4', label: '+0.30', gap: 0 }], false);
    overlay.show([{ move: 'g1f3', label: '+0.10', gap: 0 }], false);
    const groups = [...overlay.svg.querySelectorAll('g[data-rank]')];
    assert.equal(groups.length, 2, 'the old arrow is still there while it fades');
    assert.equal(groups[0].style.opacity, '0', 'the old arrow is fading out');
    assert.equal(groups[1].style.opacity, '0', 'the new arrow starts transparent');
    assert.match(groups[1].style.transform, /^translate\(/, 'and offset, ready to slide in');
    await new Promise((resolve) => setTimeout(resolve, 60)); // the next frame sets the new arrow in place
    assert.equal(groups[1].style.opacity, '1');
    await new Promise((resolve) => setTimeout(resolve, 200)); // the fade is over
    assert.deepEqual([...overlay.svg.querySelectorAll('g[data-rank]')], [groups[1]], 'only the new arrow is left');
  });
});

test('a flipped board puts the number and the label where the same squares are on the turned board', () => {
  const [plan] = planArrows([{ move: 'e2e4', label: '+0.40', gap: 0 }], true);
  closePoint(plan.badge, squareCenter('e4', true));
  const e4 = squareCenter('e4', true);
  closePoint(plan.label, { x: e4.x + 6.25, y: e4.y - 6.25 });
});

test('arrowShape refuses an arrow with no length', () => {
  assert.throws(() => arrowShape(squareCenter('e2', false), squareCenter('e2', false)), /two different squares/);
});

// A tracker whose requests the test resolves by hand, keyed by position.
function harness() {
  const pending = new Map();
  const asked = [];
  const shown = [];
  let hides = 0;
  let stales = 0;
  const tracker = new SuggestionTracker({
    ask: (fen) => {
      asked.push(fen);
      return new Promise((resolve, reject) => pending.set(fen, { resolve, reject }));
    },
    show: (result) => shown.push(result),
    hide: () => {
      hides++;
    },
    stale: () => {
      stales++;
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve)); // let the tracker make its requests
  return { tracker, pending, asked, shown, settle, hides: () => hides, stales: () => stales };
}

test('an answer for an older position is ignored when a newer one has arrived', async () => {
  const h = harness();
  h.tracker.update('A');
  h.tracker.update('B');
  await h.settle();
  h.pending.get('B').resolve({ ok: true, move: 'g1f3', fen: 'B' });
  await h.settle();
  h.pending.get('A').resolve({ ok: true, move: 'd2d4', fen: 'A' });
  await h.settle();
  assert.deepEqual(h.shown.map((r) => r.move), ['g1f3']);
});

test('an answer that arrives after the feature is turned off is ignored', async () => {
  const h = harness();
  h.tracker.update('A');
  await h.settle();
  h.tracker.disable();
  h.pending.get('A').resolve({ ok: true, move: 'e2e4', fen: 'A' });
  await h.settle();
  assert.deepEqual(h.shown, []);
});

test('an answer for a different FEN than the one asked about is not drawn', async () => {
  const h = harness();
  h.tracker.update('A');
  await h.settle();
  h.pending.get('A').resolve({ ok: true, move: 'e2e4', fen: 'somewhere else' });
  await h.settle();
  assert.deepEqual(h.shown, []);
});

test('the same position is not asked for twice, and the arrow is faded when the position changes', async () => {
  const h = harness();
  h.tracker.update('A');
  h.tracker.update('A');
  await h.settle();
  assert.deepEqual(h.asked, ['A']);
  h.pending.get('A').resolve({ ok: true, move: 'e2e4', fen: 'A' });
  await h.settle();
  assert.equal(h.shown.length, 1);
  const stalesBefore = h.stales();
  const hidesBefore = h.hides();
  h.tracker.update('B');
  assert.equal(h.stales(), stalesBefore + 1, 'the old arrow is faded as soon as the position changes');
  assert.equal(h.hides(), hidesBefore, 'and it stays on the board, faint, until the new position has an answer');
});

test('when the new position has no answer, the faded arrows are removed', async () => {
  const h = harness();
  h.tracker.update('A');
  await h.settle();
  h.pending.get('A').resolve({ ok: true, move: 'e2e4', fen: 'A' });
  await h.settle();
  h.tracker.update('B');
  await h.settle();
  const hidesBefore = h.hides();
  h.pending.get('B').reject(new Error('Engine unavailable'));
  await h.settle();
  assert.equal(h.hides(), hidesBefore + 1, 'a failed answer for the new position removes the old arrows');
});

test('a newer position makes an older failure harmless: only the latest position decides whether arrows are removed', async () => {
  const h = harness();
  h.tracker.update('A');
  await h.settle();
  h.tracker.update('B');
  await h.settle();
  const hidesBefore = h.hides();
  h.pending.get('A').reject(new Error('late failure'));
  await h.settle();
  assert.equal(h.hides(), hidesBefore, 'the failure for A does not touch the arrows for B');
});

test('a failed request leaves no arrow and does not throw', async () => {
  const h = harness();
  h.tracker.update('A');
  await h.settle();
  h.pending.get('A').reject(new Error('Engine unavailable'));
  await h.settle();
  assert.deepEqual(h.shown, []);
});

test('a result without a move is not drawn', async () => {
  const h = harness();
  h.tracker.update('A');
  await h.settle();
  h.pending.get('A').resolve({ ok: false, error: 'No legal moves in this position.', fen: 'A' });
  await h.settle();
  assert.deepEqual(h.shown, []);
});

test('the colour at a gap of 100 is a third of the way from green to red, and a mate gap is plain red', () => {
  assert.equal(hueOf(arrowColour(100)), 80);
  assert.equal(hueOf(arrowColour(300)), 0);
  assert.equal(hueOf(arrowColour(9947)), 0, 'a line that loses a mate is far behind, so it is red');
  assert.equal(hueOf(arrowColour(-5)), 120, 'a negative gap counts as the best line');
  assert.equal(hueOf(arrowColour(NaN)), 0);
});

test('the number on each arrow has a dark outline painted under the white fill, so it reads on yellow and orange', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body><div class="board"></div></body>');
  const saved = { document: global.document, getComputedStyle: global.getComputedStyle };
  global.document = dom.window.document;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  try {
    const { SuggestionOverlay } = require('../src/overlay.js');
    const overlay = new SuggestionOverlay();
    overlay.attach(dom.window.document.querySelector('.board'));
    overlay.show([
      { move: 'e2e4', label: '+0.4', gap: 0 },
      { move: 'd2d4', label: '+0.3', gap: 150 }, // yellow
      { move: 'g1f3', label: '+0.1', gap: 220 }, // orange
    ], false);
    const numbers = [...overlay.svg.querySelectorAll('g')].map((g) => g.querySelectorAll('text')[0]);
    assert.deepEqual(numbers.map((n) => n.textContent), ['1', '2', '3']);
    for (const n of numbers) {
      assert.equal(n.getAttribute('fill'), '#fff');
      assert.equal(n.getAttribute('stroke'), '#111');
      assert.ok(Number(n.getAttribute('stroke-width')) >= 0.6);
      assert.equal(n.getAttribute('paint-order'), 'stroke', 'the outline is drawn under the fill, so it does not thin the digit');
    }
  } finally {
    global.document = saved.document;
    global.getComputedStyle = saved.getComputedStyle;
  }
});
