const test = require('node:test');
const assert = require('node:assert/strict');
const { GameHistory, DEFAULT_LIMIT } = require('../src/history.js');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E4_C5 = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2';

test('positions are listed in the order they were first seen', () => {
  const history = new GameHistory();
  history.record({ fen: START, san: 'e4', evaluation: { type: 'cp', value: 30, whitePov: true } });
  history.record({ fen: AFTER_E4, san: 'c5', evaluation: { type: 'cp', value: -20, whitePov: true } });
  history.record({ fen: AFTER_E4_C5, san: 'Nf3', evaluation: { type: 'cp', value: 25, whitePov: true } });
  assert.deepEqual(history.entries().map((entry) => entry.san), ['e4', 'c5', 'Nf3']);
  assert.deepEqual(history.fens(), [START, AFTER_E4, AFTER_E4_C5]);
});

test('a position seen again updates its entry instead of adding another', () => {
  const history = new GameHistory();
  history.record({ fen: START, san: 'e4', evaluation: { type: 'cp', value: 30, whitePov: true } });
  history.record({ fen: AFTER_E4, san: 'c5', evaluation: { type: 'cp', value: -20, whitePov: true } });
  // Going back to the start and seeing a new best move there.
  history.record({ fen: START, san: 'd4', evaluation: { type: 'cp', value: 35, whitePov: true } });
  assert.equal(history.entries().length, 2);
  assert.deepEqual(history.entries()[0], {
    key: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    fen: START,
    san: 'd4',
    evaluation: { type: 'cp', value: 35, whitePov: true },
  });
});

test('the same position with different move counters is one entry', () => {
  const history = new GameHistory();
  history.record({ fen: START, san: 'e4', evaluation: null });
  history.record({ fen: START.replace(' 0 1', ' 0 9'), san: 'd4', evaluation: null });
  assert.equal(history.entries().length, 1);
  assert.equal(history.entries()[0].san, 'd4');
});

test('a missing evaluation is kept as null, and the best move can be missing too', () => {
  const history = new GameHistory();
  const entry = history.record({ fen: START, san: null, evaluation: undefined });
  assert.deepEqual(entry.evaluation, null);
  assert.equal(entry.san, null);
});

test('past the limit the oldest positions are dropped', () => {
  const history = new GameHistory(2);
  history.record({ fen: START, san: 'e4', evaluation: null });
  history.record({ fen: AFTER_E4, san: 'c5', evaluation: null });
  history.record({ fen: AFTER_E4_C5, san: 'Nf3', evaluation: null });
  assert.deepEqual(history.entries().map((entry) => entry.san), ['c5', 'Nf3']);
});

test('the default limit is generous enough for a long game', () => {
  assert.equal(new GameHistory().limit, DEFAULT_LIMIT);
  assert.ok(DEFAULT_LIMIT >= 200);
});

test('entries() returns a copy, so the caller cannot change the history', () => {
  const history = new GameHistory();
  history.record({ fen: START, san: 'e4', evaluation: null });
  history.entries().pop();
  assert.equal(history.entries().length, 1);
});

test('clear empties the history', () => {
  const history = new GameHistory();
  history.record({ fen: START, san: 'e4', evaluation: null });
  history.clear();
  assert.deepEqual(history.entries(), []);
});

test('exactly at the limit nothing is dropped, one more drops only the oldest', () => {
  const history = new GameHistory(3);
  const fens = [START, AFTER_E4, AFTER_E4_C5];
  fens.forEach((fen, i) => history.record({ fen, san: 'm' + i, evaluation: null }));
  assert.equal(history.entries().length, 3);
  history.record({ fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2', san: 'm3', evaluation: null });
  assert.deepEqual(history.entries().map((e) => e.san), ['m1', 'm2', 'm3']);
});

test('updating a position that is already listed never evicts anything', () => {
  const history = new GameHistory(2);
  history.record({ fen: START, san: 'a', evaluation: null });
  history.record({ fen: AFTER_E4, san: 'b', evaluation: null });
  for (let i = 0; i < 5; i++) history.record({ fen: START, san: 'again' + i, evaluation: null });
  assert.equal(history.entries().length, 2);
});

test('after clear the history starts again from nothing and the limit still applies', () => {
  const history = new GameHistory(2);
  history.record({ fen: START, san: 'a', evaluation: null });
  history.clear();
  assert.equal(history.entries().length, 0);
  history.record({ fen: START, san: 'a', evaluation: null });
  history.record({ fen: AFTER_E4, san: 'b', evaluation: null });
  history.record({ fen: AFTER_E4_C5, san: 'c', evaluation: null });
  assert.deepEqual(history.entries().map((e) => e.san), ['b', 'c']);
});
