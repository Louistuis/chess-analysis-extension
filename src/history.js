// The positions seen in this game so far, with the engine's best move and evaluation for each.
// A position seen again (for example after going back in the moves) updates its entry rather than adding another.
// Loaded as a classic script (sets globalThis.ChessHistory) and also as a CommonJS module.
(function (scope) {
  const DEFAULT_LIMIT = 300;

  class GameHistory {
    constructor(limit = DEFAULT_LIMIT) {
      this.limit = limit;
      this.items = [];
    }

    // Placement, side, castling and en passant: the same position, whatever the move counters say.
    static keyOf(fen) {
      return fen.split(' ').slice(0, 4).join(' ');
    }

    // Records the best move and evaluation for a position. The oldest entries are dropped past the limit.
    record({ fen, san, evaluation }) {
      const key = GameHistory.keyOf(fen);
      const entry = { key, fen, san, evaluation: evaluation || null };
      const index = this.items.findIndex((item) => item.key === key);
      if (index >= 0) {
        this.items[index] = entry;
      } else {
        this.items.push(entry);
        if (this.items.length > this.limit) this.items.shift();
      }
      return entry;
    }

    // Every recorded entry, in the order the positions were first seen.
    entries() {
      return this.items.slice();
    }

    // The FEN of every recorded position, for looking up the game's opening.
    fens() {
      return this.items.map((item) => item.fen);
    }

    clear() {
      this.items = [];
    }
  }

  const api = { GameHistory, DEFAULT_LIMIT };
  scope.ChessHistory = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
