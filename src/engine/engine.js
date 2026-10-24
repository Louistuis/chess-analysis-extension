// Talks UCI to a Stockfish worker: give it a FEN, a depth and a number of lines, get back the best lines with evaluations.
// The worker is any object with postMessage(command) and an onmessage handler that receives output lines,
// so the same code runs against a browser Worker and against the engine process in Node tests.
// Loaded in the offscreen document (sets window.StockfishEngine) and as a CommonJS module.
(function (scope) {
  const DEFAULT_DEPTH = 12;
  const MAX_DEPTH = 30;
  const DEFAULT_LINES = 1;
  const MAX_LINES = 5;
  // A mate counts as this many centipawns, less its distance, when the gap between two lines is worked out.
  const MATE_SCORE_CP = 10000;
  const TIMEOUT_MS = 60000;
  const STOP_TIMEOUT_MS = 10000;
  const PROGRESS_INTERVAL_MS = 250;

  class Engine {
    constructor(worker, options = {}) {
      this.worker = worker;
      this.timeoutMs = options.timeoutMs || TIMEOUT_MS;
      this.onFatal = options.onFatal || null;
      this.failure = null;
      this.waiters = [];
      this.queue = Promise.resolve();
      this.ready = null;
      worker.onmessage = (event) => {
        const line = typeof event === 'string' ? event : event.data;
        // Copy the list first: a waiter may remove itself while we iterate.
        for (const waiter of this.waiters.slice()) waiter.onLine(String(line).trim());
      };
      // A worker that fails to load or crashes never answers, so reject pending requests now rather than at the timeout.
      worker.onerror = (event) => this.fail(new Error('Stockfish worker failed: ' + ((event && event.message) || 'the engine script or WebAssembly did not load.')));
      worker.onmessageerror = () => this.fail(new Error('Stockfish worker sent a message that could not be read.'));
    }

    send(command) {
      this.worker.postMessage(command);
    }

    fail(err) {
      if (this.failure) return;
      this.failure = err;
      for (const waiter of this.waiters.slice()) waiter.onError(err);
      if (this.onFatal) this.onFatal(err);
    }

    // Resolves with the first line for which `take` returns a value (non-undefined).
    waitFor(take, label, timeoutMs = this.timeoutMs) {
      return new Promise((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          this.removeWaiter(waiter);
        };
        const timer = setTimeout(() => {
          finish();
          reject(new Error('Engine timed out waiting for ' + label));
        }, timeoutMs);
        const waiter = {
          onLine: (line) => {
            const value = take(line);
            if (value === undefined) return;
            finish();
            resolve(value);
          },
          onError: (err) => {
            finish();
            reject(err);
          },
        };
        this.waiters.push(waiter);
      });
    }

    removeWaiter(waiter) {
      this.waiters = this.waiters.filter((item) => item !== waiter);
    }

    init() {
      if (!this.ready) {
        this.ready = (async () => {
          this.send('uci');
          await this.waitFor((line) => (line === 'uciok' ? true : undefined), 'uciok');
          this.send('isready');
          await this.waitFor((line) => (line === 'readyok' ? true : undefined), 'readyok');
        })().catch((err) => {
          this.ready = null; // a failed start is retried on the next request
          throw err;
        });
      }
      return this.ready;
    }

    // Returns { move, ponder, depth, pv, evaluation, lines, stats }.
    // `lines` holds up to options.lines entries, best first: { rank, move, pv, depth, evaluation, wdl, gap, mateGap }.
    // `gap` is how many centipawns the line is behind the best one, from the side to move (0 for the best line).
    // `mateGap` is true when a mate score is involved, so the gap is not a plain centipawn difference.
    // `move`, `pv`, `depth` and `evaluation` are the best line's. Evaluations are from White's point of view.
    // options.onProgress({ depth, nodes, nps }) is called while the search runs, at most every 250 ms.
    bestMove(fen, depth = DEFAULT_DEPTH, options = {}) {
      const task = this.queue.then(() => this.search(fen, clampDepth(depth), options));
      this.queue = task.catch(() => {});
      return task;
    }

    async search(fen, depth, options) {
      if (this.failure) throw this.failure;
      const normalized = validateFen(fen); // rejects bad input before the engine sees it
      const sideToMove = normalized.split(' ')[1];
      const lineCount = clampLines(options.lines);
      await this.init();
      this.send('ucinewgame');
      this.send('setoption name MultiPV value ' + lineCount);
      this.send('setoption name UCI_ShowWDL value true');
      this.send('position fen ' + normalized);
      this.send('go depth ' + depth);

      const best = new Map(); // MultiPV rank -> latest info for that rank
      let stats = null;
      let lastProgress = 0;
      let result;
      try {
        result = await this.waitFor((line) => {
          if (line.startsWith('info ')) {
            const parsed = parseInfo(line);
            if (!parsed) return undefined;
            best.set(parsed.multipv, parsed);
            if (parsed.nodes !== null) {
              stats = statsFrom(parsed);
              const now = Date.now();
              if (options.onProgress && now - lastProgress >= PROGRESS_INTERVAL_MS) {
                lastProgress = now;
                options.onProgress(stats);
              }
            }
            return undefined;
          }
          const match = /^bestmove (\S+)(?: ponder (\S+))?/.exec(line);
          if (match) return { move: match[1], ponder: match[2] || null };
          return undefined;
        }, 'bestmove');
      } catch (err) {
        // Stop the search that is still running, and wait for its bestmove, so that line can't be taken as the next answer.
        // A failed worker can't answer, so there is nothing to wait for.
        if (!this.failure) {
          this.send('stop');
          await this.waitFor((line) => (line.startsWith('bestmove') ? true : undefined), 'stop', STOP_TIMEOUT_MS).catch(() => {});
        }
        throw err;
      }

      if (result.move === '(none)') {
        throw new Error('No legal moves in this position.');
      }
      const ranked = [...best.values()]
        .filter((info) => info.multipv <= lineCount && info.pv.length > 0)
        .sort((a, b) => a.multipv - b.multipv);
      const bestInfo = ranked[0] || null;
      const lines = ranked.map((info) => ({
        rank: info.multipv,
        move: info.pv[0],
        pv: info.pv,
        depth: info.depth,
        evaluation: toWhitePov(info.score, sideToMove),
        wdl: info.wdl ? toWhitePovWdl(info.wdl, sideToMove) : null,
        gap: gapBetween(bestInfo.score, info.score),
        mateGap: info.score.type === 'mate' || bestInfo.score.type === 'mate',
      }));
      const top = lines[0] || null;
      return {
        move: result.move,
        ponder: result.ponder,
        depth: top ? top.depth : depth,
        pv: top ? top.pv : [],
        evaluation: top ? top.evaluation : null,
        wdl: top ? top.wdl : null,
        lines,
        stats: stats || statsFrom({ depth, seldepth: null, nodes: null, nps: null, hashfull: null, time: null }),
      };
    }
  }

  // Checks the parts of a FEN the engine needs: 8 ranks of 8 squares, one king each, and a side to move.
  // Returns the FEN rebuilt from whitespace-separated fields, so no stray newline can reach the engine.
  function validateFen(fen) {
    if (typeof fen !== 'string') throw new Error('Invalid position: FEN must be text.');
    const fields = fen.trim().split(/\s+/);
    if (fields.length < 2) throw new Error('Invalid position: FEN needs a side to move.');
    const [placement, side] = fields;
    if (side !== 'w' && side !== 'b') throw new Error('Invalid position: side to move must be w or b.');
    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new Error('Invalid position: FEN needs 8 ranks.');
    const kings = { K: [], k: [] };
    ranks.forEach((rank, row) => {
      let file = 0;
      for (const ch of rank) {
        if (/[1-8]/.test(ch)) file += Number(ch);
        else if (/[pnbrqkPNBRQK]/.test(ch)) {
          if (ch === 'K' || ch === 'k') kings[ch].push([file, row]);
          file++;
        } else throw new Error('Invalid position: unknown piece "' + ch + '".');
      }
      if (file !== 8) throw new Error('Invalid position: a rank does not have 8 squares.');
    });
    if (kings.K.length !== 1 || kings.k.length !== 1) throw new Error('Invalid position: each side needs exactly one king.');
    const [wf, wr] = kings.K[0];
    const [bf, br] = kings.k[0];
    if (Math.abs(wf - bf) <= 1 && Math.abs(wr - br) <= 1) throw new Error('Invalid position: the two kings are next to each other.');
    return fields.join(' ');
  }

  function clampDepth(depth) {
    const value = Math.round(Number(depth));
    if (!Number.isFinite(value)) return DEFAULT_DEPTH;
    return Math.min(MAX_DEPTH, Math.max(1, value));
  }

  // Number of principal variations to ask for: 1 to 5, default 1.
  function clampLines(lines) {
    const value = Math.round(Number(lines));
    if (!Number.isFinite(value)) return DEFAULT_LINES;
    return Math.min(MAX_LINES, Math.max(1, value));
  }

  // Parses one "info" line, e.g. "info depth 6 seldepth 11 multipv 2 score cp 17 nodes 2545 nps 31812 pv e2e4 e7e5".
  // Returns { multipv, depth, score, pv, nodes, nps }, or null if the line has no depth or score (e.g. "info string").
  // score is { type: 'cp' | 'mate', value } from the side to move's point of view. nodes and nps are null when absent.
  function parseInfo(line) {
    const depth = /\bdepth (\d+)/.exec(line);
    const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
    if (!depth || !score) return null;
    const multipv = /\bmultipv (\d+)/.exec(line);
    const seldepth = /\bseldepth (\d+)/.exec(line);
    const nodes = /\bnodes (\d+)/.exec(line);
    const nps = /\bnps (\d+)/.exec(line);
    const hashfull = /\bhashfull (\d+)/.exec(line);
    const time = /\btime (\d+)/.exec(line);
    const wdl = /\bwdl (\d+) (\d+) (\d+)/.exec(line);
    const pv = /\bpv (.+)$/.exec(line);
    return {
      multipv: multipv ? Number(multipv[1]) : 1,
      depth: Number(depth[1]),
      seldepth: seldepth ? Number(seldepth[1]) : null,
      score: { type: score[1], value: Number(score[2]) },
      pv: pv ? pv[1].trim().split(/\s+/) : [],
      nodes: nodes ? Number(nodes[1]) : null,
      nps: nps ? Number(nps[1]) : null,
      hashfull: hashfull ? Number(hashfull[1]) : null, // permille of the hash table in use
      time: time ? Number(time[1]) : null, // milliseconds
      // Win/draw/loss in permille (they add up to 1000), from the side to move's point of view. Sent when UCI_ShowWDL is on.
      wdl: wdl ? { win: Number(wdl[1]), draw: Number(wdl[2]), loss: Number(wdl[3]) } : null,
    };
  }

  // The fields the panel's technical row shows, taken from one info line.
  function statsFrom(info) {
    return {
      depth: info.depth,
      seldepth: info.seldepth,
      nodes: info.nodes,
      nps: info.nps,
      hashfull: info.hashfull,
      time: info.time,
    };
  }

  // A score from the side to move's point of view as one number of centipawns: a mate is worth MATE_SCORE_CP less its distance.
  function scoreInCp(score) {
    if (score.type === 'cp') return score.value;
    return Math.sign(score.value) * (MATE_SCORE_CP - Math.abs(score.value));
  }

  // How many centipawns `line` is behind `best`, both from the side to move's point of view. Never negative.
  function gapBetween(best, line) {
    return Math.max(0, Math.round(scoreInCp(best) - scoreInCp(line)));
  }

  function toWhitePov(score, sideToMove) {
    const sign = sideToMove === 'w' ? 1 : -1;
    return { type: score.type, value: score.value * sign, whitePov: true };
  }

  // Win/draw/loss from White's side: when Black is to move, the win and loss swap.
  function toWhitePovWdl(wdl, sideToMove) {
    if (sideToMove === 'w') return { ...wdl, whitePov: true };
    return { win: wdl.loss, draw: wdl.draw, loss: wdl.win, whitePov: true };
  }

  const api = { Engine, parseInfo, statsFrom, toWhitePov, toWhitePovWdl, clampDepth, clampLines, validateFen, DEFAULT_DEPTH, MAX_LINES };
  scope.StockfishEngine = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
