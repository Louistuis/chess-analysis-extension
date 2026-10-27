const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Engine, practiceElo, strengthCommands } = require('../src/engine/engine.js');

const ENGINE = path.join(__dirname, '..', 'vendor', 'stockfish', 'stockfish-19-lite-single.js');
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LIMIT_ON = 'setoption name UCI_LimitStrength value true';
const LIMIT_OFF = 'setoption name UCI_LimitStrength value false';

// A worker that answers like the engine for one short search, and records every command it is sent.
function recordingWorker() {
  const sent = [];
  const reply = (command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go ')) return ['info depth 6 multipv 1 score cp 20 nodes 900 nps 100000 pv e2e4 e7e5', 'bestmove e2e4'];
    return [];
  };
  const worker = {
    onmessage: null,
    postMessage(command) {
      sent.push(command);
      const lines = reply(command);
      setTimeout(() => {
        for (const line of lines) worker.onmessage({ data: line });
      }, 0);
    },
  };
  return { worker, sent };
}

test('a practice rating is kept when it is a whole number from 1320 to 2800, and anything else is Full strength', () => {
  assert.equal(practiceElo(1500), 1500);
  assert.equal(practiceElo('1700'), 1700);
  assert.equal(practiceElo(1320), 1320);
  assert.equal(practiceElo(2800), 2800);
  assert.equal(practiceElo(null), null);
  assert.equal(practiceElo(undefined), null);
  assert.equal(practiceElo('weak'), null);
  assert.equal(practiceElo(800), null, 'below the range');
  assert.equal(practiceElo(2900), null, 'above the range');
});

test('a practice rating sends the UCI limit on and the rating', () => {
  assert.deepEqual(strengthCommands(1500), [LIMIT_ON, 'setoption name UCI_Elo value 1500']);
});

test('Full strength, and any bad value, switches the limit off and sends no rating', () => {
  for (const value of [null, undefined, 'weak', 900, 9999]) {
    assert.deepEqual(strengthCommands(value), [LIMIT_OFF], `for ${String(value)}`);
  }
});

test('a search sends the strength commands before its go, so the rating applies to that search', async () => {
  const { worker, sent } = recordingWorker();
  const engine = new Engine(worker, { timeoutMs: 1000 });
  await engine.bestMove(FEN, 6, { lines: 1, elo: 1500 });
  const go = sent.indexOf('go depth 6');
  assert.ok(go > 0, 'the search was started');
  assert.ok(sent.indexOf(LIMIT_ON) < go, 'the limit is on before the search');
  assert.ok(sent.indexOf('setoption name UCI_Elo value 1500') < go, 'the rating is set before the search');
});

test('moving from a practice rating to Full strength turns the limit off for the next search, and back again sets the new rating', async () => {
  const { worker, sent } = recordingWorker();
  const engine = new Engine(worker, { timeoutMs: 1000 });
  await engine.bestMove(FEN, 6, { lines: 1, elo: 1500 });

  const second = sent.length;
  await engine.bestMove(FEN, 6, { lines: 1, elo: null });
  const fullStrength = sent.slice(second);
  assert.ok(fullStrength.includes(LIMIT_OFF), 'Full strength is sent');
  assert.ok(!fullStrength.some((command) => command.startsWith('setoption name UCI_Elo')), 'no rating is sent at Full strength');

  const third = sent.length;
  await engine.bestMove(FEN, 6, { lines: 1, elo: 2100 });
  const rated = sent.slice(third);
  assert.ok(rated.includes(LIMIT_ON), 'the limit is switched back on');
  assert.ok(rated.includes('setoption name UCI_Elo value 2100'), 'with the new rating');
});

test('the vendored engine advertises UCI_LimitStrength and UCI_Elo, with a floor of 1320 that the practice range sits inside', async () => {
  const proc = spawn(process.execPath, [ENGINE]);
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += String(chunk);
  });
  try {
    proc.stdin.write('uci\n');
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const check = setInterval(() => {
        if (buffer.includes('uciok')) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - started > 10000) {
          clearInterval(check);
          reject(new Error('the engine did not answer uci'));
        }
      }, 20);
    });
    assert.match(buffer, /option name UCI_LimitStrength type check/);
    const elo = /option name UCI_Elo type spin default \d+ min (\d+) max (\d+)/.exec(buffer);
    assert.ok(elo, 'UCI_Elo is advertised');
    const min = Number(elo[1]);
    const max = Number(elo[2]);
    assert.equal(min, 1320);
    assert.ok(min <= practiceElo(1320) && practiceElo(2800) <= max, 'the practice range is inside the engine range');
  } finally {
    proc.kill();
  }
});
