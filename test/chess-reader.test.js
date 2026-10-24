const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readPosition } = require('../src/chess-reader.js');

const START = {
  a1: 'wr', b1: 'wn', c1: 'wb', d1: 'wq', e1: 'wk', f1: 'wb', g1: 'wn', h1: 'wr',
  a2: 'wp', b2: 'wp', c2: 'wp', d2: 'wp', e2: 'wp', f2: 'wp', g2: 'wp', h2: 'wp',
  a7: 'bp', b7: 'bp', c7: 'bp', d7: 'bp', e7: 'bp', f7: 'bp', g7: 'bp', h7: 'bp',
  a8: 'br', b8: 'bn', c8: 'bb', d8: 'bq', e8: 'bk', f8: 'bb', g8: 'bn', h8: 'br',
};

// Builds a chess.com-like page. pieces: { e4: 'wp' }, opts: flipped, highlight: ['e2','e4'], clock, plies.
function page(pieces, opts = {}) {
  const sq = (name) => 'square-' + (('abcdefgh'.indexOf(name[0]) + 1) + name[1]);
  const els = Object.entries(pieces).map(([s, p]) => `<div class="piece ${p} ${sq(s)}"></div>`).join('');
  const hl = (opts.highlight || []).map((s) => `<div class="highlight ${sq(s)}"></div>`).join('');
  const clock = opts.clock ? `<div class="clock-player-turn ${opts.clock}"></div>` : '';
  const ply = opts.plies ? `<div data-ply="${opts.plies}"></div>` : '';
  const html = `<body>${clock}${ply}<wc-chess-board class="board${opts.flipped ? ' flipped' : ''}">${hl}${els}</wc-chess-board></body>`;
  return new JSDOM(html).window.document;
}
const read = (pieces, opts) => readPosition(page(pieces, opts));

test('start position', () => {
  const r = read(START);
  assert.equal(r.ok, true);
  assert.equal(r.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
});

test('en passant target after a double pawn push', () => {
  const pieces = { ...START };
  delete pieces.e2;
  pieces.e4 = 'wp';
  const r = read(pieces, { highlight: ['e2', 'e4'], clock: 'clock-top', plies: 1 });
  assert.equal(r.fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
});

test('en passant target after a black double pawn push', () => {
  const pieces = { ...START };
  delete pieces.e2;
  pieces.e4 = 'wp';
  delete pieces.d7;
  pieces.d5 = 'bp';
  const r = read(pieces, { highlight: ['e2', 'e4', 'd7', 'd5'], plies: 2 });
  assert.equal(r.fen, 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
});

test('the full-move number comes from the move list', () => {
  assert.equal(read(START, { plies: 2 }).fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2');
  assert.equal(read(START, { plies: 0 }).fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
});

test('no en passant when pawn moved one square', () => {
  const pieces = { ...START };
  delete pieces.e2;
  pieces.e3 = 'wp';
  const r = read(pieces, { highlight: ['e2', 'e3'], clock: 'clock-top', plies: 1 });
  assert.match(r.fen, / b KQkq - /);
});

test('black to move from the running clock', () => {
  const r = read(START, { clock: 'clock-top' });
  assert.match(r.fen, / b KQkq /);
});

test('black to move falls back to ply parity', () => {
  const r = read(START, { plies: 3 });
  assert.match(r.fen, / b KQkq - 0 2$/);
});

test('flipped board: bottom clock belongs to black', () => {
  assert.match(read(START, { flipped: true, clock: 'clock-bottom' }).fen, / b KQkq /);
  assert.match(read(START, { flipped: true, clock: 'clock-top' }).fen, / w KQkq /);
});

test('flipped board does not change piece placement', () => {
  assert.equal(read(START, { flipped: true }).fen.split(' ')[0], read(START).fen.split(' ')[0]);
});

test('castling rights drop when rooks or king have left', () => {
  const pieces = { ...START };
  delete pieces.h1;
  delete pieces.e8;
  pieces.d6 = 'bk';
  const r = read(pieces);
  assert.match(r.fen, / w Q - /);
});

test('missing board', () => {
  const r = readPosition(new JSDOM('<body><p>hi</p></body>').window.document);
  assert.equal(r.ok, false);
  assert.match(r.error, /No chess board/);
});

test('empty board element counts as missing', () => {
  const r = readPosition(page({}));
  assert.equal(r.ok, false);
});

test('missing white king', () => {
  const pieces = { ...START };
  delete pieces.e1;
  const r = read(pieces);
  assert.equal(r.ok, false);
  assert.match(r.error, /white king/);
});

test('missing black king', () => {
  const pieces = { ...START };
  delete pieces.e8;
  const r = read(pieces);
  assert.equal(r.ok, false);
  assert.match(r.error, /black king/);
});
