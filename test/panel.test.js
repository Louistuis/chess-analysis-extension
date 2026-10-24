const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { arrowColour } = require('../src/overlay.js');
const {
  formatScore,
  evalBarFraction,
  wdlPercentages,
  formatWdl,
  formatOpening,
  formatHistoryRow,
  formatTechnical,
  formatGap,
  buildModel,
  buildSearching,
  withGameContext,
  renderPanel,
  AnalysisPanel,
} = require('../src/panel.js');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('scores read as pawns from White’s side, with a sign when positive', () => {
  assert.equal(formatScore({ type: 'cp', value: 35 }), '+0.35');
  assert.equal(formatScore({ type: 'cp', value: -120 }), '-1.20');
  assert.equal(formatScore({ type: 'cp', value: 0 }), '0.00');
  assert.equal(formatScore({ type: 'cp', value: 1 }), '+0.01');
  assert.equal(formatScore(null), '—');
});

test('mate scores read as M for White and -M for Black', () => {
  assert.equal(formatScore({ type: 'mate', value: 3 }), 'M3');
  assert.equal(formatScore({ type: 'mate', value: -2 }), '-M2');
  assert.equal(formatScore({ type: 'mate', value: 0 }), '#');
});

test('the eval bar fills in proportion to White’s chances', () => {
  assert.equal(evalBarFraction(null), 0.5);
  assert.equal(evalBarFraction({ type: 'cp', value: 0 }), 0.5);
  assert.ok(evalBarFraction({ type: 'cp', value: 400 }) > 0.9 && evalBarFraction({ type: 'cp', value: 400 }) < 0.92);
  assert.ok(Math.abs(evalBarFraction({ type: 'cp', value: 400 }) + evalBarFraction({ type: 'cp', value: -400 }) - 1) < 1e-9);
  assert.equal(evalBarFraction({ type: 'mate', value: 2 }), 1);
  assert.equal(evalBarFraction({ type: 'mate', value: -1 }), 0);
});

test('win/draw/loss turns permille into percentages, and reads as a dash without WDL', () => {
  assert.deepEqual(wdlPercentages({ win: 520, draw: 300, loss: 180, whitePov: true }), { win: 52, draw: 30, loss: 18 });
  assert.equal(wdlPercentages(null), null);
  assert.equal(formatWdl({ win: 520, draw: 300, loss: 180 }), 'W 52.0% · D 30.0% · L 18.0%');
  assert.equal(formatWdl({ win: 333, draw: 334, loss: 333 }), 'W 33.3% · D 33.4% · L 33.3%');
  assert.equal(formatWdl(null), '—');
});

test('the technical row shows the raw numbers, with dashes for anything missing', () => {
  assert.equal(
    formatTechnical({ depth: 12, seldepth: 18, nodes: 1234567, nps: 900000, hashfull: 3, time: 1234 }),
    'depth 12 · seldepth 18 · nodes 1234567 · nps 900000 · hashfull 3 · time 1234 ms',
  );
  assert.equal(
    formatTechnical({ depth: 4, seldepth: null, nodes: null, nps: null, hashfull: null, time: null }),
    'depth 4 · seldepth — · nodes — · nps — · hashfull — · time —',
  );
  assert.equal(formatTechnical(null), '');
});

test('the opening line names the opening, or says it is not in the bundled table', () => {
  assert.equal(formatOpening({ eco: 'B90', name: 'Sicilian Defence: Najdorf Variation', plies: 10 }), 'B90 · Sicilian Defence: Najdorf Variation');
  assert.equal(formatOpening(null), 'not in the bundled table');
});

test('a history row gives the move number of the position, the best move and its score', () => {
  const white = formatHistoryRow({ fen: START, san: 'e4', evaluation: { type: 'cp', value: 30, whitePov: true } });
  assert.deepEqual(white, { label: '1.', move: 'e4', score: '+0.30' });
  const black = formatHistoryRow({
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    san: 'c5',
    evaluation: { type: 'cp', value: -20, whitePov: true },
  });
  assert.deepEqual(black, { label: '1…', move: 'c5', score: '-0.20' });
  assert.equal(formatHistoryRow({ fen: START, san: null, evaluation: null }).move, '—');
});

test('a finished search becomes a panel model with a table row per line in SAN, cut to the number asked for', () => {
  const result = {
    evaluation: { type: 'cp', value: 40, whitePov: true },
    wdl: { win: 520, draw: 300, loss: 180, whitePov: true },
    lines: [
      { rank: 1, move: 'e2e4', pv: ['e2e4', 'e7e5', 'g1f3'], depth: 10, gap: 0, mateGap: false, evaluation: { type: 'cp', value: 40, whitePov: true } },
      { rank: 2, move: 'd2d4', pv: ['d2d4', 'd7d5'], depth: 10, gap: 15, mateGap: false, evaluation: { type: 'cp', value: 25, whitePov: true } },
      { rank: 3, move: 'g1f3', pv: ['g1f3'], depth: 10, gap: 30, mateGap: false, evaluation: { type: 'cp', value: 10, whitePov: true } },
    ],
    stats: { depth: 10, seldepth: 14, nodes: 20000, nps: 400000, hashfull: 0, time: 50 },
  };
  const model = buildModel(result, START, 2);
  assert.equal(model.status, 'ready');
  assert.deepEqual(model.table.map((row) => [row.rank, row.move, row.score, row.gap, row.depth]), [
    [1, 'e4', '+0.40', '0', '10'],
    [2, 'd4', '+0.25', '15', '10'],
  ]);
  assert.equal(model.table[0].pv, '1. e4 e5 2. Nf3', 'the whole line is kept for the row title');
  assert.equal(model.lines, undefined, 'the old list is gone');
  assert.deepEqual(model.evaluation, { type: 'cp', value: 40, whitePov: true });
  assert.deepEqual(model.wdl, { win: 520, draw: 300, loss: 180, whitePov: true });
  assert.deepEqual(model.stats, { depth: 10, seldepth: 14, nodes: 20000, nps: 400000, hashfull: 0, time: 50 });
});

test('a model with no WDL in the result carries null', () => {
  const model = buildModel({ evaluation: null, wdl: null, lines: [], stats: null }, START, 1);
  assert.equal(model.wdl, null);
});

test('while searching, the model carries only the live stats', () => {
  assert.deepEqual(buildSearching({ depth: 5, nodes: 3000, nps: 150000 }), {
    status: 'searching',
    evaluation: null,
    wdl: null,
    table: [],
    stats: { depth: 5, nodes: 3000, nps: 150000 },
  });
});

test('the game context adds the opening and one history row per recorded position', () => {
  const entries = [
    { fen: START, san: 'e4', evaluation: { type: 'cp', value: 30, whitePov: true } },
    { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', san: 'c5', evaluation: { type: 'cp', value: -20, whitePov: true } },
  ];
  const opening = { eco: 'B20', name: 'Sicilian Defence', plies: 2 };
  const model = withGameContext(buildSearching(null), opening, entries);
  assert.deepEqual(model.opening, opening);
  assert.deepEqual(model.history, [
    { label: '1.', move: 'e4', score: '+0.30' },
    { label: '1…', move: 'c5', score: '-0.20' },
  ]);
  assert.equal(withGameContext(buildSearching(null), null, []).opening, null);
});

// A finished model, rendered into a plain element.
function rendered(model) {
  const doc = new JSDOM('<body><div id="out"></div></body>').window.document;
  const container = doc.getElementById('out');
  renderPanel(container, model);
  return container;
}

test('the panel shows the eval bar, the best score, the lines table and the technical row', () => {
  const model = buildModel({
    evaluation: { type: 'cp', value: 40, whitePov: true },
    wdl: null,
    lines: [
      { rank: 1, move: 'e2e4', pv: ['e2e4', 'e7e5', 'g1f3'], depth: 10, gap: 0, mateGap: false, evaluation: { type: 'cp', value: 40, whitePov: true } },
      { rank: 2, move: 'd2d4', pv: ['d2d4', 'd7d5'], depth: 9, gap: 15, mateGap: false, evaluation: { type: 'cp', value: 25, whitePov: true } },
    ],
    stats: { depth: 10, seldepth: 14, nodes: 20000, nps: 400000, hashfull: 2, time: 300 },
  }, START, 2);
  const container = rendered(model);

  assert.equal(container.querySelector('.best-score').textContent, '+0.40');
  assert.equal(container.querySelector('.bar-white').style.width, (evalBarFraction({ type: 'cp', value: 40 }) * 100).toFixed(1) + '%');
  const rows = [...container.querySelectorAll('tr.line')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  assert.deepEqual(rows, [['1', 'e4', '+0.40', '0', '10'], ['2', 'd4', '+0.25', '15', '9']]);
  assert.deepEqual([...container.querySelectorAll('th')].map((th) => th.textContent), ['#', 'Move', 'Score', 'Gap', 'Depth']);
  assert.equal(container.querySelector('tr.line').title, '1. e4 e5 2. Nf3');
  assert.equal(container.querySelector('.technical').textContent, 'depth 10 · seldepth 14 · nodes 20000 · nps 400000 · hashfull 2 · time 300 ms');
  assert.match(container.textContent, /Scores are from White/);
});

test('the WDL bar and text show when the engine sent WDL, and the segments match the percentages', () => {
  const container = rendered(buildModel({
    evaluation: { type: 'cp', value: 0, whitePov: true },
    wdl: { win: 520, draw: 300, loss: 180, whitePov: true },
    lines: [],
    stats: null,
  }, START, 1));
  // The browser normalises "52.0%" to "52%", so compare the numbers.
  assert.equal(parseFloat(container.querySelector('.wdl-win').style.width), 52);
  assert.equal(parseFloat(container.querySelector('.wdl-draw').style.width), 30);
  assert.equal(parseFloat(container.querySelector('.wdl-loss').style.width), 18);
  assert.equal(container.querySelector('.wdl-text').textContent, 'Win / draw / loss for White: W 52.0% · D 30.0% · L 18.0%');
});

test('without WDL there is no WDL bar, and the text says so', () => {
  const container = rendered(buildModel({ evaluation: null, wdl: null, lines: [], stats: null }, START, 1));
  assert.equal(container.querySelector('.wdl'), null);
  assert.equal(container.querySelector('.wdl-text').textContent, 'Win / draw / loss for White: —');
});

test('the opening and the scrolling game history are shown with the newest row last', () => {
  const entries = [
    { fen: START, san: 'e4', evaluation: { type: 'cp', value: 30, whitePov: true } },
    { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', san: 'c5', evaluation: { type: 'cp', value: -20, whitePov: true } },
  ];
  const model = withGameContext(
    buildModel({ evaluation: { type: 'cp', value: 0, whitePov: true }, wdl: null, lines: [], stats: null }, START, 1),
    { eco: 'B20', name: 'Sicilian Defence', plies: 2 },
    entries,
  );
  const container = rendered(model);
  assert.equal(container.querySelector('.opening').textContent, 'Opening: B20 · Sicilian Defence');
  const rows = [...container.querySelectorAll('.history-row')].map((row) => [
    row.querySelector('.h-label').textContent,
    row.querySelector('.h-move').textContent,
    row.querySelector('.h-score').textContent,
  ]);
  assert.deepEqual(rows, [['1.', 'e4', '+0.30'], ['1…', 'c5', '-0.20']]);
  assert.ok(container.querySelector('.history').classList.contains('history'), 'the history is a list that scrolls via CSS');
});

test('the history section is left out when there is no history yet', () => {
  const container = rendered(withGameContext(buildSearching(null), null, []));
  assert.equal(container.querySelector('.history'), null);
  assert.equal(container.querySelector('.opening').textContent, 'Opening: not in the bundled table');
});

test('while searching the panel says so and shows the live stats', () => {
  const container = rendered(buildSearching({ depth: 7, seldepth: null, nodes: 80000, nps: 250000, hashfull: null, time: null }));
  assert.equal(container.querySelector('.best-score').textContent, 'Searching…');
  assert.equal(container.querySelectorAll('.line').length, 0);
  assert.equal(container.querySelector('.technical').textContent, 'depth 7 · seldepth — · nodes 80000 · nps 250000 · hashfull — · time —');
});

test('the gap column shows the centipawns behind the best line, or mate when a mate score is involved', () => {
  assert.equal(formatGap(0, false), '0');
  assert.equal(formatGap(160, false), '160');
  assert.equal(formatGap(9947, true), 'mate');
  assert.equal(formatGap(null, false), '—');
});

test('five lines make five table rows, each with its arrow colour and its gap', () => {
  const gaps = [0, 30, 160, 300, 440];
  const lines = gaps.map((gap, i) => ({
    rank: i + 1,
    move: ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'b1c3'][i],
    pv: [['e2e4'], ['d2d4'], ['g1f3'], ['c2c4'], ['b1c3']][i],
    depth: 12,
    gap,
    mateGap: false,
    evaluation: { type: 'cp', value: 40 - gap, whitePov: true },
  }));
  const model = buildModel({ evaluation: lines[0].evaluation, wdl: null, lines, stats: null }, START, 5);
  assert.deepEqual(model.table.map((row) => row.colour), gaps.map((gap) => arrowColour(gap)), 'each row has the colour of its arrow');
  assert.equal(model.table[0].colour, 'hsl(120, 70%, 42%)', 'the best line is green');
  assert.equal(model.table[4].colour, 'hsl(0, 70%, 42%)', 'a line 440 centipawns back is red');
  const container = rendered(model);
  const rows = [...container.querySelectorAll('tr.line')];
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((tr) => tr.querySelectorAll('td')[3].textContent), ['0', '30', '160', '300', '440']);
  assert.ok(rows.every((tr) => tr.querySelector('.dot')), 'each rank has its colour dot');
});

test('a mate gap shows as mate in the table', () => {
  const lines = [
    { rank: 1, move: 'e2e4', pv: ['e2e4'], depth: 8, gap: 0, mateGap: true, evaluation: { type: 'mate', value: 3, whitePov: true } },
    { rank: 2, move: 'd2d4', pv: ['d2d4'], depth: 8, gap: 9947, mateGap: true, evaluation: { type: 'cp', value: 50, whitePov: true } },
  ];
  const container = rendered(buildModel({ evaluation: lines[0].evaluation, wdl: null, lines, stats: null }, START, 2));
  const gaps = [...container.querySelectorAll('tr.line')].map((tr) => tr.querySelectorAll('td')[3].textContent);
  assert.deepEqual(gaps, ['mate', 'mate']);
});

test('the panel shows a message for an error or an idle board', () => {
  assert.equal(rendered({ status: 'error', message: 'Could not show the lines.' }).querySelector('.message').textContent, 'Could not show the lines.');
  assert.equal(rendered({ status: 'idle' }).querySelector('.message').textContent, 'Waiting for a position.');
});

test('the on-page panel sits in a shadow root and can be shown and hidden', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  const host = doc.querySelector('[data-analysis-panel]');
  assert.ok(host, 'the panel host is added to the page');
  assert.equal(host.style.display, '');
  assert.match(host.shadowRoot.querySelector('.panel').textContent, /Analysis/);
  assert.ok(host.shadowRoot.querySelector('style'), 'styles live inside the shadow root');

  panel.hide();
  assert.equal(host.style.display, 'none');
  panel.render(buildSearching({ depth: 3, nodes: null, nps: null }));
  assert.equal(host.style.display, '');
  assert.equal(doc.querySelectorAll('[data-analysis-panel]').length, 1, 'the same panel is reused');
});
