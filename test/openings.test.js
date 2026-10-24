const test = require('node:test');
const assert = require('node:assert/strict');
const { Chess } = require('../vendor/chess/chess.js');
const { OPENINGS } = require('../src/openings-data.js');
const { openingFor, openingForGame, positionKey } = require('../src/openings.js');

// The FEN after playing SAN moves from the start position.
function fenAfter(moves) {
  const game = new Chess();
  for (const san of moves) game.move(san);
  return game.fen();
}

const NAJDORF = 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'.split(' ');

test('every line in the bundled table plays legally, and its final position is named', () => {
  for (const [eco, name, moves] of OPENINGS) {
    const list = moves.split(' ');
    const found = openingFor(fenAfter(list));
    assert.ok(found, `${eco} ${name} should be found`);
    assert.ok(found.plies >= list.length, `${eco} ${name} is named at least as deep as its line`);
  }
});

test('the Najdorf is named B90 at its own depth', () => {
  assert.deepEqual(openingFor(fenAfter(NAJDORF)), { eco: 'B90', name: 'Sicilian Defence: Najdorf Variation', plies: 10 });
});

test('a position on the way to a named line is named by the line it is on', () => {
  assert.deepEqual(openingFor(fenAfter(['e4', 'c5'])), { eco: 'B20', name: 'Sicilian Defence', plies: 2 });
  // After 3.d4 several Sicilian lines meet at the same depth; the first one listed names the position.
  assert.match(openingFor(fenAfter(['e4', 'c5', 'Nf3', 'd6', 'd4'])).name, /^Sicilian Defence/);
});

test('a position reached by a longer line keeps the longer name (E20, not E00)', () => {
  // d4 Nf6 c4 e6 is E00 "Indian Defence"; adding Nc3 Bb4 reaches the Nimzo-Indian, which is deeper.
  assert.equal(openingFor(fenAfter(['d4', 'Nf6', 'c4', 'e6'])).eco, 'E00');
  assert.deepEqual(openingFor(fenAfter(['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'])), { eco: 'E20', name: 'Nimzo-Indian Defence', plies: 6 });
});

test('the move counters do not matter: the same position is the same opening', () => {
  const late = fenAfter(['e4', 'c5']).replace(' 0 1', ' 17 42');
  assert.deepEqual(openingFor(late), { eco: 'B20', name: 'Sicilian Defence', plies: 2 });
  assert.equal(positionKey(late), 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq');
});

test('a position that is not in the table has no opening', () => {
  assert.equal(openingFor(fenAfter([])), null, 'the start position is not named');
  assert.equal(openingFor(fenAfter(['h4', 'h5', 'a4', 'a5'])), null);
});

test('the game is named by the deepest opening its positions reach', () => {
  // After 1.e4 c5 2.Nf3 d6 3.d4 the game is in the Sicilian; the deepest named position is at 3.d4 (5 plies), not at 1...c5.
  const fens = [0, 1, 2, 3, 4, 5].map((n) => fenAfter(['e4', 'c5', 'Nf3', 'd6', 'd4'].slice(0, n)));
  assert.match(openingForGame(fens).name, /^Sicilian Defence/);
  assert.equal(openingForGame(fens.slice(0, 3)).name, 'Sicilian Defence', 'after 1...c5 alone it is the plain Sicilian');
  const longer = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => fenAfter(NAJDORF.slice(0, n)));
  assert.equal(openingForGame(longer).eco, 'B90');
  assert.equal(openingForGame([]), null);
});

test('a transposition reaching the same position gets the same name', () => {
  const a = openingFor(fenAfter(['d4', 'Nf6', 'c4', 'e6']));
  const b = openingFor(fenAfter(['c4', 'e6', 'd4', 'Nf6']));
  assert.deepEqual(b, a);
});

test('only the pieces, side to move and castling rights count, not the en passant square', () => {
  const withEp = fenAfter(['e4', 'c5']).replace(' w KQkq - 0 1', ' w KQkq c6 0 2');
  assert.deepEqual(openingFor(withEp), openingFor(fenAfter(['e4', 'c5'])));
});

test('losing a castling right means leaving the named position', () => {
  const fen = fenAfter(['e4', 'c5']).replace(' KQkq ', ' Qkq ');
  assert.equal(openingFor(fen), null);
});

test('a garbage FEN has no opening and does not throw', () => {
  assert.doesNotThrow(() => openingFor('nonsense'));
  assert.equal(openingFor('nonsense'), null);
});
