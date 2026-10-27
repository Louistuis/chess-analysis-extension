const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluationToCp, winChance, moveBetween, classifyLoss, moveAccuracy, buildReview } = require('../src/review.js');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
const AFTER_E4_E5_F3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
const cp = (value) => ({ type: 'cp', value, whitePov: true });

test('win chance is 50 at equality, symmetrical, and flattens for big leads', () => {
  assert.equal(winChance(0), 50);
  assert.ok(Math.abs(winChance(200) + winChance(-200) - 100) < 1e-9);
  assert.ok(winChance(1500) < 100 && winChance(1500) > 99);
  assert.ok(winChance(300) - winChance(200) > winChance(1000) - winChance(900), 'the same pawn matters less when already winning');
});

test('a mate counts as a large lead for the side that mates', () => {
  assert.ok(evaluationToCp({ type: 'mate', value: 3 }) > 1000);
  assert.ok(evaluationToCp({ type: 'mate', value: -2 }) < -1000);
  assert.equal(evaluationToCp(null), null);
});

test('moveBetween finds the one legal move that connects two positions, and null when there is none', () => {
  assert.deepEqual(moveBetween(START, AFTER_E4), { san: 'e4', uci: 'e2e4', color: 'w' });
  assert.deepEqual(moveBetween(AFTER_E4, AFTER_E4_E5), { san: 'e5', uci: 'e7e5', color: 'b' });
  assert.equal(moveBetween(START, AFTER_E4_E5), null, 'two moves apart');
  assert.equal(moveBetween('not a fen', AFTER_E4), null);
});

test('losses are named by the win chance given away, and playing the engine’s move is always best', () => {
  assert.equal(classifyLoss(0.4, true), 'best');
  assert.equal(classifyLoss(2, false), 'good');
  assert.equal(classifyLoss(5, false), 'inaccuracy');
  assert.equal(classifyLoss(10, false), 'mistake');
  assert.equal(classifyLoss(15, false), 'blunder');
  assert.equal(classifyLoss(80, true), 'best', 'the engine’s own choice is never a mistake, whatever the noise between depths');
});

test('accuracy is 100 for no loss and falls as the loss grows', () => {
  assert.ok(moveAccuracy(0) > 99.9);
  assert.ok(moveAccuracy(10) < moveAccuracy(5));
  assert.ok(moveAccuracy(100) >= 0);
});

test('a review names each move played, who played it, and what it cost', () => {
  const entries = [
    { fen: START, san: 'e4', evaluation: cp(30) },
    { fen: AFTER_E4, san: 'e5', evaluation: cp(30) },
    { fen: AFTER_E4_E5, san: 'Nf3', evaluation: cp(25) },
    { fen: AFTER_E4_E5_F3, san: 'Nc6', evaluation: cp(900) }, // Black’s previous move threw the game away
  ];
  const review = buildReview(entries);
  assert.deepEqual(review.moves.map((m) => [m.label, m.played, m.kind]), [['1.', 'e4', 'best'], ['1…', 'e5', 'best'], ['2.', 'Nf3', 'best']]);
  assert.equal(review.accuracy.w, 100);
  assert.equal(review.graph.length, 4);
  assert.ok(review.graph[3] > 90);
});

test('a move that hands over the lead is a blunder for the side that played it, and is listed as notable', () => {
  const entries = [
    { fen: START, san: 'e4', evaluation: cp(30) },
    { fen: AFTER_E4, san: 'c5', evaluation: cp(30) },
    { fen: AFTER_E4_E5, san: 'Nf3', evaluation: cp(800) }, // after Black’s e5 White is suddenly winning
  ];
  const review = buildReview(entries);
  const blackMove = review.moves.find((m) => m.color === 'b');
  assert.equal(blackMove.played, 'e5');
  assert.equal(blackMove.kind, 'blunder');
  assert.equal(blackMove.mark, '??');
  assert.equal(blackMove.best, 'c5');
  assert.equal(blackMove.notable, true);
  assert.equal(review.counts.b.blunder, 1);
  assert.equal(review.counts.w.blunder, 0);
});

test('positions that no single move connects, or that have no evaluation, are skipped', () => {
  const review = buildReview([
    { fen: START, san: 'e4', evaluation: cp(30) },
    { fen: AFTER_E4_E5, san: 'Nf3', evaluation: cp(20) },
    { fen: AFTER_E4_E5_F3, san: 'Nc6', evaluation: null },
  ]);
  assert.deepEqual(review.moves, []);
  assert.deepEqual(review.accuracy, { w: null, b: null });
});

const { estimateElo, fairPlaySignal } = require('../src/review.js');

test('an Elo estimate needs enough moves, falls as the average loss grows, and is wider with fewer moves', () => {
  assert.equal(estimateElo(20, 5), null);
  const strong = estimateElo(15, 30);
  const weak = estimateElo(80, 30);
  assert.ok(strong.rating > weak.rating + 800);
  assert.ok(estimateElo(40, 10).spread > estimateElo(40, 40).spread);
  assert.equal(strong.rating % 50, 0);
});

test('the fair-play signal waits for enough moves, then separates normal play from engine-like play', () => {
  assert.equal(fairPlaySignal({ moves: 6, matchRate: 1, acpl: 0 }).level, 'collecting');
  assert.equal(fairPlaySignal({ moves: 20, matchRate: 0.55, acpl: 35 }).level, 'normal');
  assert.equal(fairPlaySignal({ moves: 20, matchRate: 0.8, acpl: 15 }).level, 'elevated');
  assert.equal(fairPlaySignal({ moves: 20, matchRate: 0.92, acpl: 6 }).level, 'high');
  assert.equal(fairPlaySignal({ moves: 20, matchRate: 0.95, acpl: 40 }).level, 'normal', 'matching moves that still lose a lot is not engine play');
});

test('opening moves and already decided positions are left out of the per-side figures', () => {
  const cpv = (value) => ({ type: 'cp', value });
  const review = buildReview([
    { fen: START, san: 'e4', evaluation: cpv(30) },
    { fen: AFTER_E4, san: 'e5', evaluation: cpv(30) },
    { fen: AFTER_E4_E5, san: 'Nf3', evaluation: cpv(30) },
  ]);
  assert.equal(review.sides.w.moves, 0, 'move 1 and 2 are book');
  assert.equal(review.sides.w.elo, null);
  assert.equal(review.sides.b.signal.level, 'collecting');
});
