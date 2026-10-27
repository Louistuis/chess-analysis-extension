// Reviews the game so far from the positions the engine has seen: which move was played between two positions,
// how much it cost the player who made it, and an accuracy score for each side. Nothing here moves pieces or clicks.
// The cost is measured in win chance rather than centipawns, so losing 1.0 pawns matters less when already winning.
// Loaded as a classic script (sets globalThis.ChessReview) and also as a CommonJS module.
(function (scope) {
  const Chess = typeof module !== 'undefined' && typeof require === 'function'
    ? require('../vendor/chess/chess.js').Chess
    : scope.Chess;

  const WIN_K = 0.00368208; // the logistic constant lichess uses to turn centipawns into win chance
  const MATE_CP = 1500; // a mate counts as this many centipawns when win chance is worked out
  const INACCURACY = 5; // win chance lost, in percentage points
  const MISTAKE = 10;
  const BLUNDER = 15;
  const BOOK_FULLMOVES = 4; // moves up to this number are opening theory: left out of the strength and fair-play figures
  const DECIDED_CP = 800; // once the game is this lopsided, obvious moves would flatter either side
  const MAX_LOSS_CP = 500; // one move can cost at most this much in the average, so one oversight doesn't swamp it
  const MIN_MOVES_FOR_ESTIMATE = 8;
  const MIN_MOVES_FOR_SIGNAL = 12;

  // Centipawns from White's side for an evaluation { type, value }; a mate counts as a large lead.
  function evaluationToCp(evaluation) {
    if (!evaluation) return null;
    if (evaluation.type === 'mate') return evaluation.value === 0 ? 0 : Math.sign(evaluation.value) * MATE_CP;
    return Math.max(-MATE_CP, Math.min(MATE_CP, evaluation.value));
  }

  // Win chance for White in percent, 0 to 100, from centipawns from White's side.
  function winChance(cp) {
    return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * cp)) - 1);
  }

  // Win chance for White in percent for an evaluation, or null without one.
  function whiteWinChance(evaluation) {
    const cp = evaluationToCp(evaluation);
    return cp === null ? null : winChance(cp);
  }

  // The move that leads from one position to the next, as { san, uci, color }, or null if no single legal move does.
  // Compared by piece placement and side to move only, because the reader's castling and en passant fields can differ
  // slightly from chess.js's.
  function moveBetween(prevFen, nextFen) {
    const target = nextFen.split(' ').slice(0, 2).join(' ');
    let game;
    try {
      game = new Chess(prevFen);
    } catch (err) {
      return null;
    }
    const color = prevFen.split(' ')[1] === 'b' ? 'b' : 'w';
    for (const move of game.moves({ verbose: true })) {
      const probe = new Chess(prevFen);
      probe.move(move);
      if (probe.fen().split(' ').slice(0, 2).join(' ') === target) {
        return { san: move.san, uci: move.from + move.to + (move.promotion || ''), color };
      }
    }
    return null;
  }

  // Names the cost of a move by the win chance it gave away, in percentage points.
  function classifyLoss(loss, playedBest) {
    if (playedBest) return 'best';
    if (loss >= BLUNDER) return 'blunder';
    if (loss >= MISTAKE) return 'mistake';
    if (loss >= INACCURACY) return 'inaccuracy';
    return 'good';
  }

  // Accuracy of one move from the win chance it lost (lichess's curve): 100 for no loss, falling quickly with the loss.
  function moveAccuracy(loss) {
    const value = 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669;
    return Math.max(0, Math.min(100, value));
  }

  // Rough playing strength from the average centipawn loss per move. The curve is a published rule of thumb for engine
  // analysis at moderate depth, so treat it as a ballpark: it ignores how hard the positions were.
  function estimateElo(acpl, moves) {
    if (moves < MIN_MOVES_FOR_ESTIMATE) return null;
    const rating = Math.max(400, Math.min(3000, 3100 * Math.exp(-0.01 * acpl)));
    const spread = 100 + 750 / Math.sqrt(moves);
    const round50 = (value) => Math.round(value / 50) * 50;
    return { rating: round50(rating), spread: round50(spread), moves };
  }

  // A hint about whether a side's moves look like an engine's: how often they match the engine's first choice and how
  // little they lose. It is not proof: forced and one-sided positions, and strong players, also score high.
  function fairPlaySignal(stats) {
    if (!stats || stats.moves < MIN_MOVES_FOR_SIGNAL) {
      return { level: 'collecting', text: `Collecting moves (${stats ? stats.moves : 0} of ${MIN_MOVES_FOR_SIGNAL})` };
    }
    if (stats.matchRate >= 0.85 && stats.acpl <= 12) return { level: 'high', text: 'Very engine-like play' };
    if (stats.matchRate >= 0.75 && stats.acpl <= 20) return { level: 'elevated', text: 'Unusually engine-like play' };
    return { level: 'normal', text: 'Nothing unusual' };
  }

  const MARKS = { best: '', good: '', inaccuracy: '?!', mistake: '?', blunder: '??' };
  const NAMES = { best: 'Best', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };

  // `entries` are { fen, san, evaluation } in the order the positions were seen (san is the engine's best move there).
  // Returns:
  //   moves: one per pair of consecutive positions that one legal move connects:
  //          { label, color, played, mark, kind, name, loss, best, notable }
  //   counts: { w, b } each { inaccuracy, mistake, blunder }
  //   accuracy: { w, b } in percent, or null for a side that has not moved yet
  //   graph: White's win chance in percent for every position with an evaluation, for drawing a graph
  function buildReview(entries) {
    const moves = [];
    const counts = { w: { inaccuracy: 0, mistake: 0, blunder: 0 }, b: { inaccuracy: 0, mistake: 0, blunder: 0 } };
    const scores = { w: [], b: [] };
    const tally = { w: { moves: 0, matches: 0, loss: 0 }, b: { moves: 0, matches: 0, loss: 0 } };
    for (let i = 0; i + 1 < entries.length; i++) {
      const before = entries[i];
      const after = entries[i + 1];
      const beforeChance = whiteWinChance(before.evaluation);
      const afterChance = whiteWinChance(after.evaluation);
      if (beforeChance === null || afterChance === null) continue;
      const played = moveBetween(before.fen, after.fen);
      if (!played) continue;
      // From the mover's side: how much win chance the move gave up compared with the engine's choice.
      const sign = played.color === 'w' ? 1 : -1;
      const loss = Math.max(0, sign * (beforeChance - afterChance));
      const kind = classifyLoss(loss, before.san === played.san);
      if (counts[played.color][kind] !== undefined) counts[played.color][kind]++;
      scores[played.color].push(moveAccuracy(loss));
      const [, side, , , , fullmove] = before.fen.split(' ');
      // Strength and fair-play figures use only moves in a position that was still open and past the opening.
      const beforeCp = evaluationToCp(before.evaluation);
      const afterCp = evaluationToCp(after.evaluation);
      const decided = Math.abs(beforeCp) > DECIDED_CP && Math.abs(afterCp) > DECIDED_CP && Math.sign(beforeCp) === Math.sign(afterCp);
      if (Number(fullmove || 1) > BOOK_FULLMOVES && !decided) {
        const cpLoss = Math.min(MAX_LOSS_CP, Math.max(0, sign * (beforeCp - afterCp)));
        const t = tally[played.color];
        t.moves++;
        t.loss += played.san === before.san ? 0 : cpLoss;
        if (before.san === played.san) t.matches++;
      }
      moves.push({
        label: (fullmove || '1') + (side === 'b' ? '…' : '.'),
        color: played.color,
        played: played.san,
        mark: MARKS[kind],
        kind,
        name: NAMES[kind],
        loss: Math.round(loss * 10) / 10,
        best: before.san || null,
        notable: kind === 'inaccuracy' || kind === 'mistake' || kind === 'blunder',
      });
    }
    const mean = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
    const graph = entries.map((entry) => whiteWinChance(entry.evaluation)).filter((value) => value !== null);
    const sides = {};
    for (const colour of ['w', 'b']) {
      const t = tally[colour];
      const stats = t.moves
        ? { moves: t.moves, matchRate: t.matches / t.moves, acpl: Math.round(t.loss / t.moves) }
        : { moves: 0, matchRate: null, acpl: null };
      sides[colour] = { ...stats, elo: stats.moves ? estimateElo(stats.acpl, stats.moves) : null, signal: fairPlaySignal(stats) };
    }
    return { moves, counts, accuracy: { w: mean(scores.w), b: mean(scores.b) }, graph, sides };
  }

  const api = { evaluationToCp, winChance, whiteWinChance, moveBetween, classifyLoss, moveAccuracy, buildReview, estimateElo, fairPlaySignal, INACCURACY, MISTAKE, BLUNDER };
  scope.ChessReview = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
