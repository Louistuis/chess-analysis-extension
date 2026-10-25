const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Engine, parseInfo, toWhitePov, clampDepth, clampLines, validateFen } = require('../src/engine/engine.js');

const ENGINE = path.join(__dirname, '..', 'vendor', 'stockfish', 'stockfish-19-lite-single.js');

// Runs the real vendored engine as a child process, exposed with the same shape as a browser Worker.
function startEngine() {
  const proc = spawn(process.execPath, [ENGINE]);
  let buffer = '';
  const worker = {
    onmessage: null,
    postMessage: (command) => proc.stdin.write(command + '\n'),
  };
  proc.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (worker.onmessage) worker.onmessage({ data: line });
  });
  return { engine: new Engine(worker), stop: () => proc.kill() };
}

test('parseInfo reads the multipv rank, score, pv and stats', () => {
  const main = parseInfo('info depth 6 seldepth 11 multipv 1 score cp 17 nodes 2545 nps 31812 hashfull 0 time 80 pv e2e4 e7e5 g1f3');
  assert.deepEqual(main, {
    multipv: 1,
    depth: 6,
    seldepth: 11,
    score: { type: 'cp', value: 17 },
    pv: ['e2e4', 'e7e5', 'g1f3'],
    nodes: 2545,
    nps: 31812,
    hashfull: 0,
    time: 80,
    wdl: null,
  });
  // A line without multipv is the main line.
  assert.equal(parseInfo('info depth 4 score cp 9 pv d2d4').multipv, 1);
  // The second and third lines are returned too, with their rank.
  const second = parseInfo('info depth 6 multipv 2 score mate -3 pv d2d4 d7d5');
  assert.deepEqual(second, {
    multipv: 2,
    depth: 6,
    seldepth: null,
    score: { type: 'mate', value: -3 },
    pv: ['d2d4', 'd7d5'],
    nodes: null,
    nps: null,
    hashfull: null,
    time: null,
    wdl: null,
  });
  // Lines with no depth or score carry no search information.
  assert.equal(parseInfo('info string NNUE evaluation enabled'), null);
  assert.equal(parseInfo('info depth 6 nodes 100'), null);
});

test('clampLines keeps the number of lines between 1 and 5', () => {
  assert.equal(clampLines(0), 1);
  assert.equal(clampLines(2), 2);
  assert.equal(clampLines(5), 5);
  assert.equal(clampLines(9), 5);
  assert.equal(clampLines(undefined), 1);
});

test('toWhitePov flips the sign when black is to move', () => {
  assert.deepEqual(toWhitePov({ type: 'cp', value: 300 }, 'w'), { type: 'cp', value: 300, whitePov: true });
  assert.deepEqual(toWhitePov({ type: 'cp', value: 300 }, 'b'), { type: 'cp', value: -300, whitePov: true });
});

test('clampDepth keeps depth between 1 and 30 and defaults bad input', () => {
  assert.equal(clampDepth(0), 1);
  assert.equal(clampDepth(99), 30);
  assert.equal(clampDepth('abc'), 12);
  assert.equal(clampDepth(7.4), 7);
});

test('engine returns a legal-looking best move for the start position', async () => {
  const { engine, stop } = startEngine();
  try {
    const result = await engine.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 8);
    assert.match(result.move, /^[a-h][1-8][a-h][1-8]$/);
    assert.equal(result.depth, 8);
    assert.equal(result.evaluation.type, 'cp');
    assert.ok(Math.abs(result.evaluation.value) < 80, 'start position should be close to equal');
  } finally {
    stop();
  }
});

// A fake worker that answers UCI commands with the lines given by `reply`, one tick later.
function fakeWorker(reply) {
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

test('validateFen accepts a legal-shaped FEN and rejects bad input', () => {
  assert.equal(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(validateFen('  k7/8/8/8/8/8/8/K7   b  \n'), 'k7/8/8/8/8/8/8/K7 b');
  for (const bad of ['', 'nonsense', null, 'k7/8/8/8/8/8/8/K7 x', '8/8/8/8/8/8/8 w', 'k7/8/8/8/8/8/8/K6 w', 'k7/8/8/8/8/8/8/K9 w', 'k7/8/8/8/8/8/8/Kx w', 'k7/8/8/8/8/8/8/8 w']) {
    assert.throws(() => validateFen(bad), /Invalid position/, JSON.stringify(bad));
  }
});

test('validateFen rejects kings that stand next to each other', () => {
  assert.throws(() => validateFen('k7/1K6/8/8/8/8/8/8 w - - 0 1'), /kings are next to each other/); // touching diagonally
  assert.throws(() => validateFen('8/8/8/3kK3/8/8/8/8 w - - 0 1'), /kings are next to each other/); // touching sideways
  assert.doesNotThrow(() => validateFen('k7/8/8/8/8/8/1K6/8 w - - 0 1')); // two squares apart is fine
});

test('an illegal position is rejected before anything reaches the engine', async () => {
  const { worker, sent } = fakeWorker(() => []);
  const engine = new Engine(worker, { timeoutMs: 20 });
  await assert.rejects(engine.bestMove('not a fen', 5), /Invalid position/);
  assert.deepEqual(sent, []);
});

test('a timed-out search is stopped and its bestmove is drained', async () => {
  const { worker, sent } = fakeWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command === 'stop') return ['bestmove e2e4'];
    return [];
  });
  const engine = new Engine(worker, { timeoutMs: 30 });
  await assert.rejects(engine.bestMove('k7/8/8/8/8/8/8/K7 w - - 0 1', 5), /timed out waiting for bestmove/);
  assert.ok(sent.includes('stop'), 'the running search should be stopped');
  assert.equal(engine.waiters.length, 0, 'no listeners should be left behind');
});

test('a failed start is retried on the next request', async () => {
  let started = false;
  const { worker, sent } = fakeWorker((command) => {
    if (command === 'uci') return started ? ['uciok'] : [];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go ')) return ['info depth 4 multipv 1 score cp 10 pv e2e4', 'bestmove e2e4'];
    return [];
  });
  const engine = new Engine(worker, { timeoutMs: 30 });
  await assert.rejects(engine.bestMove('k7/8/8/8/8/8/8/K7 w - - 0 1', 4), /timed out waiting for uciok/);
  started = true;
  const result = await engine.bestMove('k7/8/8/8/8/8/8/K7 w - - 0 1', 4);
  assert.equal(result.move, 'e2e4');
  assert.equal(sent.filter((c) => c === 'uci').length, 2);
});

const FEN = 'k7/8/8/8/8/8/8/K7 w - - 0 1';

test('a worker error rejects the pending request at once, not at the timeout', async () => {
  const { worker } = fakeWorker(() => []);
  const engine = new Engine(worker, { timeoutMs: 5000 });
  const started = Date.now();
  const pending = engine.bestMove(FEN, 5);
  setTimeout(() => worker.onerror({ message: 'NetworkError: failed to fetch stockfish-19-lite-single.wasm' }), 5);
  await assert.rejects(pending, /Stockfish worker failed: NetworkError/);
  assert.ok(Date.now() - started < 1000, 'should not wait for the 5 s timeout');
});

test('a message the page cannot read rejects the pending request at once', async () => {
  const { worker } = fakeWorker(() => []);
  const engine = new Engine(worker, { timeoutMs: 5000 });
  const started = Date.now();
  const pending = engine.bestMove(FEN, 5);
  setTimeout(() => worker.onmessageerror({}), 5);
  await assert.rejects(pending, /could not be read/);
  assert.ok(Date.now() - started < 1000, 'should not wait for the 5 s timeout');
});

test('after a worker failure, onFatal runs and later requests fail fast', async () => {
  let fatal = null;
  const { worker, sent } = fakeWorker(() => []);
  const engine = new Engine(worker, { timeoutMs: 5000, onFatal: (err) => { fatal = err; } });
  const first = engine.bestMove(FEN, 5);
  setTimeout(() => worker.onerror({ message: 'boom' }), 5);
  await assert.rejects(first, /boom/);
  assert.match(fatal.message, /boom/);

  const sentBefore = sent.length;
  const started = Date.now();
  await assert.rejects(engine.bestMove(FEN, 5), /boom/);
  assert.ok(Date.now() - started < 1000, 'the dead worker should not be asked again');
  assert.equal(sent.length, sentBefore);
});

test('evaluation is from White’s point of view, with a mate in one', async () => {
  const { engine, stop } = startEngine();
  try {
    const whiteUpAQueen = await engine.bestMove('k7/8/8/8/8/8/8/KQ6 b - - 0 1', 6);
    assert.ok(whiteUpAQueen.evaluation.value > 500, 'White is ahead even when black is to move');

    const mateInOne = await engine.bestMove('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', 4);
    assert.deepEqual(mateInOne.evaluation, { type: 'mate', value: 1, whitePov: true });
    assert.equal(mateInOne.move, 'f7g7');
  } finally {
    stop();
  }
});

test('a position with one legal move returns that move', async () => {
  const { engine, stop } = startEngine();
  try {
    const result = await engine.bestMove('8/8/8/8/8/2k5/7r/K7 w - - 0 1', 6);
    assert.equal(result.move, 'a1b1');
  } finally {
    stop();
  }
});

test('black mate in one is reported as a mate for Black (negative from White’s side)', async () => {
  const { engine, stop } = startEngine();
  try {
    const result = await engine.bestMove('8/q7/8/8/8/6k1/8/7K b - - 0 1', 4);
    assert.equal(result.move, 'a7a1', 'the queen mates on the back rank');
    assert.deepEqual(result.evaluation, { type: 'mate', value: -1, whitePov: true });
  } finally {
    stop();
  }
});

test('checkmated position (no legal moves) rejects instead of returning a move', async () => {
  const { engine, stop } = startEngine();
  try {
    await assert.rejects(engine.bestMove('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', 4), /No legal moves/);
  } finally {
    stop();
  }
});

test('a superseded search is stopped at once and rejects, and the newer one is answered', async () => {
  const { engine, stop } = startEngine();
  try {
    const slow = engine.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 30, { supersede: true });
    slow.catch(() => {});
    await new Promise((r) => setTimeout(r, 300)); // let the long search get going
    const started = Date.now();
    const fast = await engine.bestMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 6, { supersede: true });
    await assert.rejects(slow, /superseded/);
    assert.ok(Date.now() - started < 5000, 'the depth 30 search must not run to its end');
    assert.match(fast.move, /^[a-h][1-8][a-h][1-8]/);
  } finally {
    stop();
  }
});

test('a request that is dropped while it waits is never sent to the engine', async () => {
  const { worker, sent } = fakeWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go')) return ['info depth 1 score cp 10 multipv 1 pv e2e4', 'bestmove e2e4'];
    return [];
  });
  const engine = new Engine(worker);
  const results = await Promise.allSettled([
    engine.bestMove(FEN, 1, { supersede: true }),
    engine.bestMove(FEN, 2, { supersede: true }),
    engine.bestMove(FEN, 3, { supersede: true }),
  ]);
  assert.equal(results[2].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.ok(sent.filter((c) => c.startsWith('go')).length <= 2, 'the middle request is skipped');
  assert.ok(sent.includes('go depth 3'));
});

test('the hash table is kept between searches: ucinewgame is sent once, at start-up, with the analysis options', async () => {
  const { worker, sent } = fakeWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go')) return ['info depth 1 score cp 10 multipv 1 pv e2e4', 'bestmove e2e4'];
    return [];
  });
  const engine = new Engine(worker);
  await engine.bestMove(FEN, 1);
  await engine.bestMove(FEN, 1);
  assert.equal(sent.filter((c) => c === 'ucinewgame').length, 1);
  assert.ok(sent.includes('setoption name UCI_AnalyseMode value true'));
  assert.ok(sent.some((c) => c.startsWith('setoption name Hash value ')));
});

test('onPartial reports the lines found so far, shaped like the final result, before the search ends', async () => {
  const { engine, stop } = startEngine();
  try {
    const partials = [];
    const result = await engine.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 10, { lines: 3, onPartial: (p) => partials.push(p) });
    assert.ok(partials.length >= 1, 'at least one partial result');
    const first = partials[0];
    assert.equal(first.lines.length, 3);
    assert.ok(first.lines.every((line) => /^[a-h][1-8][a-h][1-8]/.test(line.move)));
    assert.ok(first.depth <= result.depth);
    assert.equal(partials.every((p) => p.move === p.lines[0].move), true);
  } finally {
    stop();
  }
});

test('bound scores from a narrowed search window are not taken as a line’s score', async () => {
  const { worker } = fakeWorker((command) => {
    if (command === 'uci') return ['uciok'];
    if (command === 'isready') return ['readyok'];
    if (command.startsWith('go')) return ['info depth 5 multipv 1 score cp 10 pv e2e4', 'info depth 6 multipv 1 score cp 900 lowerbound pv d2d4', 'bestmove e2e4'];
    return [];
  });
  const result = await new Engine(worker).bestMove(FEN, 6);
  assert.equal(result.evaluation.value, 10);
});
