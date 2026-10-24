// Names the opening of a position, from the bundled table. Each line in the table is played through chess.js and every
// position on the way is keyed by its piece placement, side to move and castling rights, so the lookup needs only a FEN
// and no move history. Loaded as a classic script (sets globalThis.ChessOpenings) and also as a CommonJS module.
(function (scope) {
  const Chess = typeof module !== 'undefined' && typeof require === 'function'
    ? require('../vendor/chess/chess.js').Chess
    : scope.Chess;
  const OPENINGS = typeof module !== 'undefined' && typeof require === 'function'
    ? require('./openings-data.js').OPENINGS
    : scope.ChessOpeningsData.OPENINGS;

  let index = null;

  // Placement, side to move and castling: the parts of a FEN that identify a position for an opening.
  function positionKey(fen) {
    return fen.split(' ').slice(0, 3).join(' ');
  }

  function buildIndex() {
    const map = new Map();
    for (const [eco, name, moves] of OPENINGS) {
      const game = new Chess();
      moves.split(' ').forEach((san, i) => {
        game.move(san); // the table is written in legal moves; a bad entry throws here (and fails the tests)
        const plies = i + 1;
        const key = positionKey(game.fen());
        const existing = map.get(key);
        // A position reached by several lines is named after the deepest one; on a tie, the first listed wins.
        if (!existing || plies > existing.plies) map.set(key, { eco, name, plies });
      });
    }
    return map;
  }

  // The opening a single position belongs to, or null if it is not in the table.
  function openingFor(fen) {
    if (!index) index = buildIndex();
    return index.get(positionKey(fen)) || null;
  }

  // The deepest opening named by any position of the game so far (fens in the order they were seen).
  function openingForGame(fens) {
    let best = null;
    for (const fen of fens) {
      const found = openingFor(fen);
      if (found && (!best || found.plies > best.plies)) best = found;
    }
    return best;
  }

  const api = { openingFor, openingForGame, positionKey };
  scope.ChessOpenings = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
