const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Engine } = require('../src/engine/engine.js');

const ENGINE = path.join(__dirname, '..', 'vendor', 'stockfish', 'stockfish-19-lite-single.js');
// Black to move after 1. e4: the scores below are from Black's side, as Stockfish reports them.
const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

// A worker that answers each command with the lines given by `reply`, one tick later, and records what it was sent.
function scriptedWorker(reply) {
  const sent = [];
  const worker = {
    onmessage: null,
    postMessage(command) {
      sent.push(command);
      const lines = reply(command) || [];
      setTimeout(() => {
        for (const line of lines) worker.onmessage({ data: line });
      }, 0);
    },
  };
  return { worker, sent };
}

const SEARCH = [
  'info depth 8 multipv 1 score cp -40 nodes 1000 nps 500000 wdl 600 300 100 pv g8f6 d2d4',
  'info depth 8 multipv 2 score cp -55 nodes 1100 nps 500000 pv d7d5 e4d5',
  'info depth 8 multipv 3 score mate 2 nodes 1200 nps 600000 pv e7e6',
  'bestmove g8f6 ponder d2d4',
];

function searchReply(command) {
  if (command === 'uci') return ['uciok'];
  if (command === 'isready') return ['readyok'];
  if (command.startsWith('go ')) return SEARCH;
  return [];
}

test('three lines come back best first, with scores from White’s side and their principal variations', async () => {
  const { worker, sent } = scriptedWorker(searchReply);
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const result = await engine.bestMove(FEN, 8, { lines: 3 });

  assert.ok(sent.includes('setoption name MultiPV value 3'), 'MultiPV is set before the search');
  assert.deepEqual(
    result.lines.map((line) => [line.rank, line.move, line.evaluation]),
    [
      [1, 'g8f6', { type: 'cp', value: 40, whitePov: true }],
      [2, 'd7d5', { type: 'cp', value: 55, whitePov: true }],
      [3, 'e7e6', { type: 'mate', value: -2, whitePov: true }], // Black mates in 2
    ],
  );
  assert.deepEqual(result.lines[0].pv, ['g8f6', 'd2d4']);
  assert.equal(result.move, 'g8f6', 'the best line is the bestmove');
  assert.deepEqual(result.evaluation, { type: 'cp', value: 40, whitePov: true });
  // Black is to move, so the engine's win and loss swap to White's side.
  assert.deepEqual(result.wdl, { win: 100, draw: 300, loss: 600, whitePov: true });
  assert.deepEqual(result.stats, { depth: 8, seldepth: null, nodes: 1200, nps: 600000, hashfull: null, time: null });
});

// Black to move, so every score below is from Black's side. The gap is how far each line is behind the best one.
const FIVE = [
  'info depth 8 multipv 1 score cp 40 nodes 1000 nps 500000 pv g8f6 d2d4',
  'info depth 8 multipv 2 score cp 10 nodes 1000 nps 500000 pv d7d5',
  'info depth 8 multipv 3 score cp -120 nodes 1000 nps 500000 pv e7e6',
  'info depth 8 multipv 4 score cp -260 nodes 1000 nps 500000 pv c7c5',
  'info depth 8 multipv 5 score cp -400 nodes 1000 nps 500000 pv h7h6',
  'bestmove g8f6',
];

test('five lines: MultiPV 5 is asked for, and each line says how many centipawns it is behind the best', async () => {
  const { worker, sent } = scriptedWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go ')) return FIVE;
    return [];
  });
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const result = await engine.bestMove(FEN, 8, { lines: 5 });
  assert.ok(sent.includes('setoption name MultiPV value 5'));
  assert.deepEqual(result.lines.map((line) => line.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(result.lines.map((line) => line.gap), [0, 30, 160, 300, 440]);
  assert.ok(result.lines.every((line) => line.mateGap === false), 'no mate score, so the gaps are plain centipawns');
});

test('a gap involving a mate is flagged, and the best line has no gap', async () => {
  const { worker } = scriptedWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go ')) {
      return [
        'info depth 8 multipv 1 score mate 3 nodes 1000 nps 500000 pv e7e6',
        'info depth 8 multipv 2 score cp 50 nodes 1000 nps 500000 pv d7d5',
        'bestmove e7e6',
      ];
    }
    return [];
  });
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const result = await engine.bestMove(FEN, 8, { lines: 2 });
  assert.deepEqual(result.lines.map((line) => line.mateGap), [true, true]);
  assert.equal(result.lines[0].gap, 0);
  assert.ok(result.lines[1].gap > 5000, 'a line that loses a mate is far behind');
});

test('asking for one line returns one line, even if the engine sends more', async () => {
  const { worker, sent } = scriptedWorker(searchReply);
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const result = await engine.bestMove(FEN, 8, { lines: 1 });
  assert.ok(sent.includes('setoption name MultiPV value 1'));
  assert.deepEqual(result.lines.map((line) => line.rank), [1]);
});

test('no lines option means one line', async () => {
  const { worker } = scriptedWorker(searchReply);
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const result = await engine.bestMove(FEN, 8);
  assert.equal(result.lines.length, 1);
});

test('progress is reported while the search runs, with depth, nodes and nodes per second', async () => {
  const { worker } = scriptedWorker(searchReply);
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const progress = [];
  await engine.bestMove(FEN, 8, { lines: 3, onProgress: (stats) => progress.push(stats) });
  assert.ok(progress.length >= 1, 'at least one progress report');
  assert.deepEqual(progress[0], { depth: 8, seldepth: null, nodes: 1000, nps: 500000, hashfull: null, time: null });
});

test('a search with no info lines still resolves, with empty lines and null stats', async () => {
  const { worker } = scriptedWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go ')) return ['bestmove e7e6'];
    return [];
  });
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const result = await engine.bestMove(FEN, 8, { lines: 3 });
  assert.equal(result.move, 'e7e6');
  assert.deepEqual(result.lines, []);
  assert.equal(result.evaluation, null);
  assert.equal(result.wdl, null);
  assert.deepEqual(result.stats, { depth: 8, seldepth: null, nodes: null, nps: null, hashfull: null, time: null });
});

test('the real engine returns three distinct lines from the start position', async () => {
  const proc = spawn(process.execPath, [ENGINE]);
  let buffer = '';
  const worker = { onmessage: null, postMessage: (command) => proc.stdin.write(command + '\n') };
  proc.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (worker.onmessage) worker.onmessage({ data: line });
  });
  try {
    const engine = new Engine(worker);
    const result = await engine.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 6, { lines: 3 });
    assert.deepEqual(result.lines.map((line) => line.rank), [1, 2, 3]);
    const moves = result.lines.map((line) => line.move);
    assert.equal(new Set(moves).size, 3, 'three different first moves');
    for (const move of moves) assert.match(move, /^[a-h][1-8][a-h][1-8]$/);
    assert.equal(result.lines[0].move, result.move);
    for (const line of result.lines) assert.ok(line.pv.length > 0, 'each line has a principal variation');
    assert.ok(result.stats.nodes > 0);
  } finally {
    proc.kill();
  }
});

test('with Black to move, a line where Black is mated is far behind, and a line where Black mates is the best', async () => {
  const { worker } = scriptedWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go ')) {
      return [
        'info depth 8 multipv 1 score mate 2 nodes 1000 nps 500000 pv d8h4',
        'info depth 8 multipv 2 score cp 30 nodes 1000 nps 500000 pv g8f6',
        'info depth 8 multipv 3 score mate -3 nodes 1000 nps 500000 pv a7a6',
        'bestmove d8h4',
      ];
    }
    return [];
  });
  const engine = new Engine(worker, { timeoutMs: 1000 });
  const result = await engine.bestMove(FEN, 8, { lines: 3 });
  const [best, middle, mated] = result.lines;
  assert.equal(best.gap, 0);
  assert.ok(middle.gap > 5000 && middle.gap < mated.gap, 'being mated is further behind than merely giving up a mate');
  assert.ok(result.lines.every((line) => line.gap >= 0));
  assert.ok(result.lines.every((line) => line.mateGap === true), 'a mate score is involved in each gap');
  // Scores are shown from White's side: Black mating in 2 is a negative mate for White.
  assert.deepEqual(best.evaluation, { type: 'mate', value: -2, whitePov: true });
  assert.deepEqual(mated.evaluation, { type: 'mate', value: 3, whitePov: true });
});
