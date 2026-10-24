// Reads a chess.com board from the DOM and turns it into a FEN string.
// Loaded as a content script (sets window.ChessReader) and also as a
// CommonJS module so the FEN logic can be tested in Node.
(function (scope) {
  const BOARD_SELECTOR = 'wc-chess-board, chess-board, .board';
  const FILES = 'abcdefgh';

  // chess.com marks each piece with "wk", "bp", ... and each square with "square-11" (file 1-8, rank 1-8).
  function pieceLetter(el) {
    for (const token of el.classList) {
      if (/^[wb][pnbrqk]$/.test(token)) {
        return token[0] === 'w' ? token[1].toUpperCase() : token[1];
      }
    }
    return null;
  }

  function squareName(el) {
    for (const token of el.classList) {
      const match = /^square-([1-8])([1-8])$/.exec(token);
      if (match) return FILES[Number(match[1]) - 1] + match[2];
    }
    return null;
  }

  // Map of square name ("e4") to piece letter ("P", "n"), for pieces on the first board found.
  function readPieces(board) {
    const pieces = {};
    for (const el of board.querySelectorAll('.piece')) {
      const square = squareName(el);
      const letter = pieceLetter(el);
      if (square && letter) pieces[square] = letter;
    }
    return pieces;
  }

  // Side to move: the player whose clock is running. Falls back to move-list parity.
  function readSideToMove(doc, flipped, plies) {
    const running = doc.querySelector('.clock-player-turn');
    if (running) {
      const isBottom = running.classList.contains('clock-bottom');
      const isTop = running.classList.contains('clock-top');
      if (isBottom || isTop) {
        const bottomColor = flipped ? 'b' : 'w';
        const topColor = bottomColor === 'w' ? 'b' : 'w';
        return isBottom ? bottomColor : topColor;
      }
    }
    return plies % 2 === 0 ? 'w' : 'b';
  }

  // Approximation: a right is granted while the king and rook still stand on their home squares.
  // The DOM does not expose move history, so a king or rook that moved away and back is missed.
  function readCastling(pieces) {
    let rights = '';
    if (pieces.e1 === 'K') {
      if (pieces.h1 === 'R') rights += 'K';
      if (pieces.a1 === 'R') rights += 'Q';
    }
    if (pieces.e8 === 'k') {
      if (pieces.h8 === 'r') rights += 'k';
      if (pieces.a8 === 'r') rights += 'q';
    }
    return rights || '-';
  }

  // chess.com highlights the from and to squares of the last move. If a pawn went two
  // squares on the same file, the square it passed over is the en passant target.
  function readEnPassant(pieces, highlighted, sideToMove) {
    for (const to of highlighted) {
      const piece = pieces[to];
      if (!piece || piece.toLowerCase() !== 'p') continue;
      const pawnIsWhite = piece === 'P';
      if (pawnIsWhite === (sideToMove === 'w')) continue; // the pawn must belong to the side that just moved
      for (const from of highlighted) {
        if (from[0] !== to[0] || Math.abs(Number(from[1]) - Number(to[1])) !== 2) continue;
        const middle = to[0] + (Number(to[1]) + Number(from[1])) / 2;
        if (!pieces[middle]) return middle;
      }
    }
    return '-';
  }

  function placement(pieces) {
    const rows = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = '';
      let empty = 0;
      for (const file of FILES) {
        const piece = pieces[file + rank];
        if (piece) {
          if (empty) row += empty;
          empty = 0;
          row += piece;
        } else {
          empty++;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  function buildFen(position) {
    return [
      placement(position.pieces),
      position.sideToMove,
      position.castling,
      position.enPassant,
      position.halfmove,
      position.fullmove,
    ].join(' ');
  }

  // The first board on the page that has pieces on it, or null.
  function findBoard(doc) {
    return Array.from(doc.querySelectorAll(BOARD_SELECTOR)).find((el) => el.querySelector('.piece')) || null;
  }

  // Reads the first board on the page. Returns { ok: true, fen, position } or { ok: false, error }.
  function readPosition(doc) {
    const board = findBoard(doc);
    if (!board) return { ok: false, error: 'No chess board found on this page.' };

    const pieces = readPieces(board);
    if (!Object.values(pieces).includes('K')) {
      return { ok: false, error: 'Could not find the white king; the board markup may have changed.' };
    }
    if (!Object.values(pieces).includes('k')) {
      return { ok: false, error: 'Could not find the black king; the board markup may have changed.' };
    }

    const flipped = board.classList.contains('flipped');
    // Move-list ply count, used for side to move and the fullmove number. 0 if the page doesn't expose it.
    const plies = Math.max(0, ...Array.from(doc.querySelectorAll('[data-ply]'), (el) => Number(el.dataset.ply) || 0));
    const sideToMove = readSideToMove(doc, flipped, plies);
    const highlighted = Array.from(board.querySelectorAll('.highlight'), squareName).filter(Boolean);

    const position = {
      pieces,
      sideToMove,
      castling: readCastling(pieces),
      enPassant: readEnPassant(pieces, highlighted, sideToMove),
      halfmove: 0, // not shown on the page
      fullmove: Math.floor(plies / 2) + 1,
    };
    return { ok: true, fen: buildFen(position), position };
  }

  const api = { findBoard, readPosition, buildFen };
  scope.ChessReader = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
