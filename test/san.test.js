const test = require('node:test');
const assert = require('node:assert/strict');
const { uciToSan, formatLine } = require('../src/san.js');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('UCI moves become SAN, with check and mate marks', () => {
  assert.deepEqual(uciToSan(START, ['e2e4', 'e7e5', 'g1f3']), ['e4', 'e5', 'Nf3']);
  // Qa8 gives check along the eighth rank.
  assert.deepEqual(uciToSan('7k/P7/8/8/8/8/8/K7 w - - 0 1', ['a7a8q']), ['a8=Q+']);
});

test('castling is written as O-O and O-O-O', () => {
  assert.deepEqual(uciToSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1']), ['O-O']);
  assert.deepEqual(uciToSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1c1']), ['O-O-O']);
});

test('conversion stops at the first move that is not legal', () => {
  assert.deepEqual(uciToSan(START, ['e2e4', 'e2e3', 'd7d5']), ['e4']);
  assert.deepEqual(uciToSan(START, ['e2e4', 'zz9z9', 'e7e5']), ['e4']);
  assert.deepEqual(uciToSan(START, []), []);
});

test('a FEN that chess.js cannot read throws', () => {
  assert.throws(() => uciToSan('not a fen', ['e2e4']));
});

test('a line starting with White is numbered from the move number', () => {
  assert.equal(formatLine(START, ['e4', 'e5', 'Nf3']), '1. e4 e5 2. Nf3');
});

test('a line starting with Black is numbered with dots', () => {
  const blackToMove = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
  assert.equal(formatLine(blackToMove.replace(' w ', ' b '), ['Nf6', 'Nc3']), '2... Nf6 3. Nc3');
  assert.equal(formatLine(START.replace(' w ', ' b ').replace(' 0 1', ' 0 12'), ['Nf6', 'Nc3']), '12... Nf6 13. Nc3');
});

test('an empty line formats to an empty string', () => {
  assert.equal(formatLine(START, []), '');
});

test('captures are written with x, and pawn captures with the file', () => {
  assert.deepEqual(uciToSan(START, ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3']), ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3']);
});

test('en passant is written as a pawn capture', () => {
  // White pawn e5, Black has just played d7d5: exd6 e.p. is legal.
  assert.deepEqual(uciToSan('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', ['d7d5', 'e5d6']), ['d5', 'exd6']);
  // With the target square in the FEN, it works from the start of the line too.
  assert.deepEqual(uciToSan('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', ['e5d6']), ['exd6']);
});

test('promotions: queen, underpromotion, and promotion with a capture', () => {
  const fen = '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  assert.deepEqual(uciToSan(fen, ['a7a8q']), ['a8=Q']); // the knight on b8 blocks the check
  assert.deepEqual(uciToSan(fen, ['a7a8n']), ['a8=N']);
  assert.deepEqual(uciToSan(fen, ['a7b8r']), ['axb8=R+']);
  assert.deepEqual(uciToSan('4k3/8/8/8/8/8/p7/4K3 b - - 0 1', ['a2a1b']), ['a1=B']);
});

test('Black castles too, and a promotion given without its letter is not a legal move', () => {
  assert.deepEqual(uciToSan('r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1', ['e8g8']), ['O-O']);
  assert.deepEqual(uciToSan('r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1', ['e8c8']), ['O-O-O']);
  assert.deepEqual(uciToSan('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7a8']), []);
});

test('two pieces that can reach the same square are told apart', () => {
  assert.deepEqual(uciToSan('4k3/8/8/8/8/8/4K3/R6R w - - 0 1', ['a1d1']), ['Rad1']);
  assert.deepEqual(uciToSan('4k3/8/8/8/8/8/4K3/R6R w - - 0 1', ['h1d1']), ['Rhd1']);
});

test('a checkmating move ends with #', () => {
  assert.deepEqual(uciToSan('7k/8/7K/8/8/8/8/6Q1 w - - 0 1', ['g1g7']), ['Qg7#']);
});
