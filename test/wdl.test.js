const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Engine, parseInfo, toWhitePovWdl } = require('../src/engine/engine.js');

const ENGINE = path.join(__dirname, '..', 'vendor', 'stockfish', 'stockfish-19-lite-single.js');

test('parseInfo reads the win/draw/loss permille from an info line', () => {
  const info = parseInfo('info depth 8 multipv 1 score cp 20 wdl 550 300 150 pv e2e4 e7e5');
  assert.deepEqual(info.wdl, { win: 550, draw: 300, loss: 150 });
});

test('an info line without WDL has none', () => {
  assert.equal(parseInfo('info depth 8 multipv 1 score cp 20 pv e2e4').wdl, null);
});

test('WDL is turned into White’s side: with Black to move, win and loss swap', () => {
  const black = { win: 550, draw: 300, loss: 150 };
  assert.deepEqual(toWhitePovWdl(black, 'b'), { win: 150, draw: 300, loss: 550, whitePov: true });
  assert.deepEqual(toWhitePovWdl(black, 'w'), { win: 550, draw: 300, loss: 150, whitePov: true });
});

test('the real engine reports WDL for the best line, adding up to about 1000 permille', async () => {
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
    // Black to move after 1. e4: the engine's WDL is from Black's side, so it is turned into White's here.
    const result = await engine.bestMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 6, { lines: 2 });
    assert.ok(result.wdl, 'the engine sent WDL');
    assert.equal(result.wdl.whitePov, true);
    const total = result.wdl.win + result.wdl.draw + result.wdl.loss;
    assert.ok(Math.abs(total - 1000) <= 3, `win + draw + loss should be about 1000, got ${total}`);
    assert.ok(result.stats.seldepth >= result.stats.depth, 'the selective depth is at least the depth');
    assert.ok(result.stats.time === null || result.stats.time >= 0);
  } finally {
    proc.kill();
  }
});

test('flipping WDL to White’s side never changes the total', () => {
  for (const [win, draw, loss] of [[0, 1000, 0], [1000, 0, 0], [0, 0, 1000], [333, 334, 333], [1, 998, 1]]) {
    for (const side of ['w', 'b']) {
      const flipped = toWhitePovWdl({ win, draw, loss }, side);
      assert.equal(flipped.win + flipped.draw + flipped.loss, 1000);
      assert.equal(flipped.draw, draw);
    }
  }
});

test('a malformed or partial wdl field is ignored rather than half-read', () => {
  assert.equal(parseInfo('info depth 8 multipv 1 score cp 20 wdl 550 300 pv e2e4').wdl, null);
  assert.equal(parseInfo('info depth 8 multipv 1 score cp 20 wdl a b c pv e2e4').wdl, null);
});

test('parseInfo tags a lower ranked line with its rank, so its WDL can be told from the best line’s', () => {
  const info = parseInfo('info depth 8 multipv 2 score cp -10 wdl 100 400 500 pv d2d4');
  assert.equal(info.multipv, 2);
  assert.deepEqual(info.wdl, { win: 100, draw: 400, loss: 500 });
});

test('the real engine’s WDL adds up to exactly 1000 permille, including in a mate and in a lost position', async () => {
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
    for (const fen of [
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', // mate in one for White
      'k7/8/8/8/8/8/8/KQ6 b - - 0 1', // Black is lost
    ]) {
      const result = await engine.bestMove(fen, 6, { lines: 1 });
      assert.ok(result.wdl, 'WDL for ' + fen);
      assert.equal(result.wdl.win + result.wdl.draw + result.wdl.loss, 1000, fen);
    }
  } finally {
    proc.kill();
  }
});
