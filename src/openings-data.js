// A small, hand-picked set of common openings: [ECO code, name, moves in SAN]. It is not the full ECO table.
// src/openings.js plays each line and keys the resulting positions, so a line that is not legal is caught by the tests.
// Loaded as a classic script (sets globalThis.ChessOpeningsData) and also as a CommonJS module.
(function (scope) {
  const OPENINGS = [
    ['B00', "King's Pawn Game", 'e4'],
    ['A40', "Queen's Pawn Game", 'd4'],
    ['A04', 'Reti Opening', 'Nf3'],
    ['A10', 'English Opening', 'c4'],
    ['A20', 'English Opening: Reversed Sicilian', 'c4 e5'],
    ['A30', 'English Opening: Symmetrical Variation', 'c4 c5'],
    ['A07', "King's Indian Attack", 'Nf3 d5 g3'],
    ['A80', 'Dutch Defence', 'd4 f5'],
    ['B01', 'Scandinavian Defence', 'e4 d5'],
    ['B07', 'Pirc Defence', 'e4 d6 d4 Nf6 Nc3 g6'],
    ['B10', 'Caro-Kann Defence', 'e4 c6'],
    ['B12', 'Caro-Kann Defence: Advance Variation', 'e4 c6 d4 d5 e5'],
    ['B20', 'Sicilian Defence', 'e4 c5'],
    ['B22', 'Sicilian Defence: Alapin Variation', 'e4 c5 c3'],
    ['B23', 'Sicilian Defence: Closed', 'e4 c5 Nc3'],
    ['B33', 'Sicilian Defence: Sveshnikov Variation', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5'],
    ['B70', 'Sicilian Defence: Dragon Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'],
    ['B90', 'Sicilian Defence: Najdorf Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
    ['C00', 'French Defence', 'e4 e6'],
    ['C01', 'French Defence: Exchange Variation', 'e4 e6 d4 d5 exd5 exd5'],
    ['C11', 'French Defence: Classical Variation', 'e4 e6 d4 d5 Nc3 Nf6'],
    ['C15', 'French Defence: Winawer Variation', 'e4 e6 d4 d5 Nc3 Bb4'],
    ['C20', "King's Pawn Game", 'e4 e5'],
    ['C23', "Bishop's Opening", 'e4 e5 Bc4'],
    ['C30', "King's Gambit", 'e4 e5 f4'],
    ['C33', "King's Gambit Accepted", 'e4 e5 f4 exf4'],
    ['C41', 'Philidor Defence', 'e4 e5 Nf3 d6'],
    ['C42', 'Petrov Defence', 'e4 e5 Nf3 Nf6'],
    ['C45', 'Scotch Game', 'e4 e5 Nf3 Nc6 d4'],
    ['C50', 'Italian Game', 'e4 e5 Nf3 Nc6 Bc4'],
    ['C53', 'Italian Game: Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5'],
    ['C55', 'Italian Game: Two Knights Defence', 'e4 e5 Nf3 Nc6 Bc4 Nf6'],
    ['C60', 'Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5'],
    ['C70', 'Ruy Lopez: Morphy Defence', 'e4 e5 Nf3 Nc6 Bb5 a6'],
    ['D02', "Queen's Pawn Game: London System", 'd4 d5 Nf3 Nf6 Bf4'],
    ['D06', "Queen's Gambit", 'd4 d5 c4'],
    ['D10', 'Slav Defence', 'd4 d5 c4 c6'],
    ['D20', "Queen's Gambit Accepted", 'd4 d5 c4 dxc4'],
    ['D30', "Queen's Gambit Declined", 'd4 d5 c4 e6'],
    ['D43', 'Semi-Slav Defence', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6'],
    ['E00', 'Indian Defence', 'd4 Nf6 c4 e6'],
    ['E12', "Queen's Indian Defence", 'd4 Nf6 c4 e6 Nf3 b6'],
    ['E20', 'Nimzo-Indian Defence', 'd4 Nf6 c4 e6 Nc3 Bb4'],
    ['E60', "King's Indian Defence", 'd4 Nf6 c4 g6'],
  ];

  const api = { OPENINGS };
  scope.ChessOpeningsData = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
