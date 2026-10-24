const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { placePanel, buildSearching, withGameContext, AnalysisPanel } = require('../src/panel.js');

const SIZE = { width: 240, height: 300 };
const box = (left, top, right, bottom) => ({ left, top, right, bottom });

test('the panel goes beside the board, on the side with more room', () => {
  // Room on the right only.
  assert.deepEqual(placePanel(box(300, 100, 900, 700), { width: 1280, height: 800 }, SIZE), { left: 912, top: 100, side: 'right' });
  // Room on both sides: the left has more, so it goes left (chess.com's controls are usually on the right).
  assert.deepEqual(placePanel(box(380, 100, 800, 700), { width: 1100, height: 800 }, SIZE), { left: 380 - 12 - 240, top: 100, side: 'left' });
  // Room on the left only.
  assert.equal(placePanel(box(400, 100, 1000, 700), { width: 1024, height: 800 }, SIZE).side, 'left');
});

test('with no room beside the board, the panel goes below it', () => {
  const spot = placePanel(box(100, 50, 600, 500), { width: 700, height: 1000 }, SIZE);
  assert.deepEqual(spot, { left: 100, top: 512, side: 'below' });
});

test('with no room beside, below or above, the panel is hidden rather than covering the board', () => {
  assert.equal(placePanel(box(20, 20, 1000, 700), { width: 1024, height: 800 }, SIZE).side, 'hidden');
  // Only a corner of the window is free and it is over the board: still hidden, never on top of the board.
  assert.equal(placePanel(box(0, 0, 1024, 768), { width: 1024, height: 768 }, SIZE).side, 'hidden', 'a board that fills the window');
  // With no board to avoid, the panel goes to the top-right corner.
  assert.deepEqual(placePanel(null, { width: 1024, height: 800 }, SIZE), { left: 1024 - 240 - 8, top: 8, side: 'corner' });
});

test('when the open panel has no room, the collapsed tab still fits beside the board and does not overlap it', () => {
  // The board runs to the right edge, with a strip free below it. The full panel doesn't fit there, the tab does.
  const board = box(100, 0, 1024, 600);
  const viewport = { width: 1024, height: 768 };
  assert.equal(placePanel(board, viewport, SIZE).side, 'hidden');
  const tab = placePanel(board, viewport, { width: 120, height: 32 });
  assert.deepEqual(tab, { left: 100, top: 612, side: 'below' });
  assert.ok(tab.top >= board.bottom, 'the tab sits below the board');
});

// Whether a placed box, of the given size, overlaps the board's box.
function overlaps(spot, size, board) {
  const right = spot.left + size.width;
  const bottom = spot.top + size.height;
  return spot.left < board.right && right > board.left && spot.top < board.bottom && bottom > board.top;
}

test('wherever a placement is shown, it is inside the window and never overlaps the board', () => {
  const viewports = [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 700, height: 1000 }, { width: 500, height: 500 }];
  const sizes = [SIZE, { width: 120, height: 32 }];
  let shown = 0;
  for (const viewport of viewports) {
    for (let left = -40; left < viewport.width; left += 60) {
      for (let top = -40; top < viewport.height; top += 60) {
        for (const width of [200, 450, viewport.width]) {
          for (const height of [150, 400, viewport.height]) {
            const board = box(left, top, left + width, top + height);
            for (const size of sizes) {
              const spot = placePanel(board, viewport, size);
              if (spot.side === 'hidden') continue;
              shown++;
              assert.ok(spot.left >= 0 && spot.top >= 0, `inside the top-left: ${JSON.stringify({ board, spot })}`);
              assert.ok(spot.left + size.width <= viewport.width && spot.top + size.height <= viewport.height, `inside the window: ${JSON.stringify({ board, spot })}`);
              assert.ok(!overlaps(spot, size, board), `covers the board: ${JSON.stringify({ board, spot, viewport })}`);
            }
          }
        }
      }
    }
  }
  assert.ok(shown > 1000, 'the grid exercised many placements');
});

test('the panel is hidden while the board fills the window, and shown again once there is room', () => {
  const doc = new JSDOM('<body><div id="board"></div></body>').window.document;
  const board = doc.getElementById('board');
  const window = doc.defaultView;
  board.getBoundingClientRect = () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight });
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  panel.setAnchor(board);
  const host = doc.querySelector('[data-analysis-panel]');
  assert.equal(host.style.display, 'none');
  assert.equal(host.dataset.placement, 'hidden');

  board.getBoundingClientRect = () => ({ left: 300, top: 80, right: 700, bottom: 680, width: 400, height: 600 });
  panel.place();
  assert.equal(host.style.display, '');
  assert.equal(host.dataset.placement, 'right');
});

test('an open panel with no room is shown as the tab, with only its header', () => {
  const doc = new JSDOM('<body><div id="board"></div></body>').window.document;
  const board = doc.getElementById('board');
  // Board fills most of the window; a strip is free below it.
  board.getBoundingClientRect = () => ({ left: 100, top: 0, right: 1024, bottom: 600, width: 924, height: 600 });
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  panel.setAnchor(board);
  const host = doc.querySelector('[data-analysis-panel]');
  assert.equal(host.dataset.placement, 'below', 'the tab goes in the free strip');
  assert.equal(panel.body.hidden, true, 'only the header shows');
  assert.equal(host.shadowRoot.querySelector('.panel').classList.contains('tab'), true);
});

test('the panel stays inside the window when the board is scrolled up or far down', () => {
  assert.equal(placePanel(box(300, -200, 900, 400), { width: 1280, height: 800 }, SIZE).top, 8, 'never above the top edge');
  assert.equal(placePanel(box(300, 700, 900, 1300), { width: 1280, height: 800 }, SIZE).top, 800 - 300 - 8, 'never below the bottom edge');
});

// A DOM document for the panel, plus a store that remembers the collapsed state.
function panelWithStore(initial = false) {
  const doc = new JSDOM('<body></body>').window.document;
  const saved = [];
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (value) => {
      saved.push(value);
      store.value = value;
    },
  };
  return { doc, store, saved, panel: new AnalysisPanel(doc, store) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the collapse button hides the body, remembers the choice, and the choice comes back on the next visit', async () => {
  const { doc, saved, panel, store } = panelWithStore(false);
  panel.render(withGameContext(buildSearching(null), null, []));
  await flush();
  const host = doc.querySelector('[data-analysis-panel]');
  const toggle = host.shadowRoot.querySelector('.toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.body.hidden, false);

  toggle.click();
  assert.equal(panel.body.hidden, true, 'the body is hidden when collapsed');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(saved, [true], 'the choice is saved');

  // A new panel (the next page visit) reads the saved state and starts collapsed.
  const next = new AnalysisPanel(doc, store);
  next.render(withGameContext(buildSearching(null), null, []));
  await flush();
  assert.equal(next.body.hidden, true);
});

test('a panel with no store starts open', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  assert.equal(panel.body.hidden, false);
});

test('a progress update changes only the technical row, and keeps the history rows as they were', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const panel = new AnalysisPanel(doc);
  const entries = [
    { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', san: 'e4', evaluation: { type: 'cp', value: 30, whitePov: true } },
    { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', san: 'c5', evaluation: { type: 'cp', value: -20, whitePov: true } },
  ];
  panel.render(withGameContext(buildSearching(null), null, entries));
  const firstRow = panel.body.querySelector('.history-row');
  const historyList = panel.body.querySelector('.history');

  panel.updateStats({ depth: 9, seldepth: 12, nodes: 50000, nps: 300000, hashfull: 1, time: 160 });
  assert.equal(panel.body.querySelector('.technical').textContent, 'depth 9 · seldepth 12 · nodes 50000 · nps 300000 · hashfull 1 · time 160 ms');
  assert.equal(panel.body.querySelector('.history-row'), firstRow, 'the same row element, not a rebuilt one');
  assert.equal(panel.body.querySelector('.history'), historyList, 'the same list element');
});

test('a progress update with no stats shows the placeholder', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  panel.updateStats(null);
  assert.equal(panel.body.querySelector('.technical').textContent, 'No search stats yet');
});

test('setAnchor places the panel beside the board when the board is on the page', () => {
  const doc = new JSDOM('<body><div id="board"></div></body>').window.document;
  const board = doc.getElementById('board');
  board.getBoundingClientRect = () => ({ left: 100, top: 80, right: 700, bottom: 680, width: 600, height: 600 });
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  panel.setAnchor(board);
  const host = doc.querySelector('[data-analysis-panel]');
  // jsdom's window is 1024 wide: there is no room on the right (1024 - 700 - 12 = 312 is enough, so it goes right).
  assert.equal(host.dataset.placement, 'right');
  assert.equal(host.style.left, 700 + 12 + 'px');
  assert.equal(host.style.top, 80 + 'px');
});
