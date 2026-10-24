// Turns UCI moves from the engine (e.g. "e2e4", "e7e8q") into SAN for display (e.g. "e4", "e8=Q+"),
// using the vendored chess.js for legality and notation. Loaded as a classic script (sets globalThis.ChessSan)
// and also as a CommonJS module so it can be tested in Node.
(function (scope) {
  const Chess = typeof module !== 'undefined' && typeof require === 'function'
    ? require('../vendor/chess/chess.js').Chess
    : scope.Chess;

  const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

  // Plays the UCI moves from `fen` and returns their SAN. Stops at the first move that is not legal, so the result can be shorter than the input.
  function uciToSan(fen, uciMoves) {
    const game = new Chess(fen); // throws on a FEN chess.js can't read
    const san = [];
    for (const uci of uciMoves) {
      const match = UCI_MOVE.exec(uci);
      if (!match) break;
      let move;
      try {
        move = game.move({ from: match[1], to: match[2], promotion: match[3] });
      } catch (err) {
        break; // chess.js throws on a move that is not legal in this position
      }
      if (!move) break;
      san.push(move.san);
    }
    return san;
  }

  // Joins SAN moves with move numbers, e.g. "1. e4 e5 2. Nf3". A line that starts with Black's move is numbered "12... Nf6".
  function formatLine(fen, sanMoves) {
    const [, side, , , , fullmove] = fen.split(' ');
    let number = Number(fullmove) || 1;
    let whiteToMove = side !== 'b';
    const parts = [];
    sanMoves.forEach((san, index) => {
      if (whiteToMove) parts.push(number + '. ' + san);
      else parts.push(index === 0 ? number + '... ' + san : san);
      if (!whiteToMove) number++;
      whiteToMove = !whiteToMove;
    });
    return parts.join(' ');
  }

  const api = { uciToSan, formatLine };
  scope.ChessSan = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
