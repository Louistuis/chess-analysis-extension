// Runs the real content script, background and offscreen/engine code in separate contexts,
// wired together by a fake chrome.runtime that behaves like Chrome's messaging (no faked reply shapes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const src = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ENGINE = path.join(root, 'vendor', 'stockfish', 'stockfish-19-lite-single.js');

const START = {
  a1: 'wr', b1: 'wn', c1: 'wb', d1: 'wq', e1: 'wk', f1: 'wb', g1: 'wn', h1: 'wr',
  a2: 'wp', b2: 'wp', c2: 'wp', d2: 'wp', e2: 'wp', f2: 'wp', g2: 'wp', h2: 'wp',
  a7: 'bp', b7: 'bp', c7: 'bp', d7: 'bp', e7: 'bp', f7: 'bp', g7: 'bp', h7: 'bp',
  a8: 'br', b8: 'bn', c8: 'bb', d8: 'bq', e8: 'bk', f8: 'bb', g8: 'bn', h8: 'br',
};
const sq = (name) => 'square-' + ('abcdefgh'.indexOf(name[0]) + 1) + name[1];

function boardHtml(pieces) {
  const els = Object.entries(pieces).map(([s, p]) => `<div class="piece ${p} ${sq(s)}" data-sq="${s}"></div>`).join('');
  return `<body><div id="moves" data-ply="0"></div><wc-chess-board class="board">${els}</wc-chess-board></body>`;
}

// Delivers a message to the listeners of every context except the sender, like chrome.runtime.sendMessage.
function makeBus() {
  const contexts = [];
  const bus = {
    messages: [],
    responses: [], // every answer sent back, with the message it answers
    add(name, listeners) { contexts.push({ name, listeners }); },
    send(from, message) {
      bus.messages.push({ from, message });
      return new Promise((resolve) => {
        let pending = 0;
        let done = false;
        const reply = (value) => { if (!done) { done = true; bus.responses.push({ from, message, value }); resolve(value); } };
        for (const ctx of contexts) {
          if (ctx.name === from) continue;
          for (const listener of ctx.listeners) {
            const sender = { id: from, tab: from === 'content' ? { id: 7 } : undefined };
            const keep = listener(message, sender, (value) => reply(value));
            if (keep === true) pending++;
          }
        }
        if (pending === 0) setTimeout(() => reply(undefined), 0);
      });
    },
  };
  return bus;
}

function fakeChrome(bus, name, extra = {}) {
  const listeners = [];
  bus.add(name, listeners);
  return {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (message) => bus.send(name, message),
      getURL: (p) => 'chrome-extension://test/' + p,
    },
    ...extra,
  };
}

function setup({ enabled = true, depth = 12, lines = 3, empty = false } = {}) {
  const bus = makeBus();
  const procs = [];
  const stored = empty ? {} : { suggestionsEnabled: enabled, depth, lines }; // what chrome.storage.local holds, shared by all contexts

  // Content script, in a jsdom page.
  const dom = new JSDOM(boardHtml(START), { runScripts: 'outside-only', url: 'https://www.chess.com/game/live/1' });
  const storageListeners = [];
  dom.window.chrome = fakeChrome(bus, 'content', {
    storage: {
      local: { get: async (defaults) => ({ ...defaults, ...stored }) },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  });

  // Offscreen document: real engine.js + offscreen.js, with a Worker that runs the real Stockfish file in Node.
  let offscreenCreated = 0;
  const offscreenSandbox = {
    console, setTimeout, clearTimeout, Promise,
    Worker: class {
      constructor(url) {
        assert.equal(url, 'chrome-extension://test/vendor/stockfish/stockfish-19-lite-single.js');
        const proc = spawn(process.execPath, [ENGINE]);
        procs.push(proc);
        this.proc = proc;
        let buffer = '';
        proc.stdout.on('data', (chunk) => {
          buffer += String(chunk);
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) if (this.onmessage) this.onmessage({ data: line });
        });
      }
      postMessage(command) { this.proc.stdin.write(command + '\n'); }
      terminate() { this.proc.kill(); }
    },
  };
  offscreenSandbox.window = offscreenSandbox;
  offscreenSandbox.chrome = fakeChrome(bus, 'offscreen');
  vm.createContext(offscreenSandbox);
  const loadOffscreen = () => {
    vm.runInContext(src('src/engine/engine.js'), offscreenSandbox);
    vm.runInContext(src('offscreen/offscreen.js'), offscreenSandbox);
  };

  // Background service worker.
  const bgSandbox = { console, setTimeout, clearTimeout, Promise };
  bgSandbox.chrome = fakeChrome(bus, 'background', {
    offscreen: {
      createDocument: async (options) => {
        assert.equal(options.url, 'offscreen/offscreen.html');
        offscreenCreated++;
        loadOffscreen();
      },
    },
    storage: {
      local: { get: async (defaults) => ({ ...defaults, ...stored }) },
    },
    // chrome.tabs.sendMessage(tabId, message): delivered to the page's content script (and anything else listening).
    tabs: { sendMessage: (tabId, message) => bus.send('background', message) },
  });
  bgSandbox.chrome.runtime.getContexts = async () => (offscreenCreated ? [{}] : []);
  bgSandbox.importScripts = (file) => vm.runInContext(src('src/' + file), bgSandbox); // service worker's importScripts
  vm.createContext(bgSandbox);
  vm.runInContext(src('src/background.js'), bgSandbox);

  // Load the content scripts in the manifest's order.
  for (const file of ['src/chess-reader.js', 'src/overlay.js', 'src/settings.js', 'vendor/chess/chess.js', 'src/san.js', 'src/openings-data.js', 'src/openings.js', 'src/history.js', 'src/review.js', 'src/panel.js', 'src/content.js']) {
    dom.window.eval(src(file));
  }

  const document = dom.window.document;
  const arrow = () => document.querySelector('[data-suggestion-overlay]');
  const arrowDrawn = () => !!arrow() && !!arrow().querySelector('line') && !!arrow().querySelector('polygon');
  return {
    bus, dom, document, arrow, arrowDrawn, storageListeners, stored,
    offscreenCreated: () => offscreenCreated,
    stop: () => { for (const p of procs) p.kill(); dom.window.close(); },
  };
}

async function until(check, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Timed out waiting for ' + label);
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('an arrow is drawn for the start position, cleared when the position changes, and drawn again for the new one', async () => {
  const t = setup();
  try {
    await until(t.arrowDrawn, 'the first arrow');
    assert.equal(t.offscreenCreated(), 1, 'the background should have created the offscreen document');
    const first = t.bus.messages.find((m) => m.message.type === 'BEST_MOVE');
    assert.equal(first.from, 'content');
    assert.equal(first.message.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const firstPoints = t.arrow().querySelector('polygon').getAttribute('points');

    // Play 1. e4 on the page: the arrow for the old position must go away straight away.
    const pawn = t.document.querySelector('[data-sq="e2"]');
    pawn.className = 'piece wp ' + sq('e4');
    await until(() => !t.arrowDrawn(), 'the arrow to clear', 2000);

    await until(t.arrowDrawn, 'the arrow for the new position');
    const secondRequest = t.bus.messages.filter((m) => m.from === 'content' && m.message.type === 'BEST_MOVE').pop();
    assert.match(secondRequest.message.fen, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR /);
    assert.notEqual(t.arrow().querySelector('polygon').getAttribute('points'), firstPoints);
  } finally {
    t.stop();
  }
});

test('the arrow is cleared and stays cleared when the board can no longer be read', async () => {
  const t = setup();
  try {
    await until(t.arrowDrawn, 'the first arrow');
    t.document.querySelector('[data-sq="e8"]').remove(); // black king gone: unreadable position
    await until(() => !t.arrowDrawn(), 'the arrow to clear', 2000);
    await tick(800);
    assert.equal(t.arrowDrawn(), false);
  } finally {
    t.stop();
  }
});

test('the analysis panel shows a table of five lines and five numbered arrows with their scores, once the engine answers', async () => {
  const t = setup({ lines: 5 });
  try {
    const panelRoot = () => t.document.querySelector('[data-analysis-panel]')?.shadowRoot;
    await until(() => panelRoot()?.querySelectorAll('tr.line').length === 5, 'five lines in the panel');
    const rows = [...panelRoot().querySelectorAll('tr.line')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    rows.forEach((cells, i) => {
      assert.equal(cells[0], String(i + 1), 'the rank');
      assert.match(cells[1], /^(O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)[+#]?$/, 'the move in SAN');
      assert.match(cells[2], /^([+-]\d\.\d\d|0\.00|-?M\d+|#)$/, 'the score');
      assert.match(cells[3], /^(\d+|mate)$/, 'the gap');
      assert.match(cells[4], /^\d+$/, 'the depth');
    });
    assert.equal(rows[0][3], '0', 'the best line has no gap');

    const arrows = [...t.arrow().querySelectorAll('g[data-rank]')];
    assert.deepEqual(arrows.map((g) => g.getAttribute('data-rank')), ['1', '2', '3', '4', '5'], 'one arrow for each line, numbered');
    arrows.forEach((g, i) => {
      const [number, label] = g.querySelectorAll('text');
      assert.equal(number.textContent, String(i + 1), 'the number at the tip');
      assert.equal(label.textContent, rows[i][2], 'the score label matches the table row');
      assert.match(g.querySelector('line').getAttribute('stroke'), /^hsl\(\d+, 70%, 42%\)$/, 'coloured by the gap');
    });

    assert.match(panelRoot().querySelector('.technical').textContent, /^depth \d+ · seldepth \d+ · nodes \d+ · nps \d+ · hashfull \d+ · time \d+ ms$/);
    assert.ok(panelRoot().querySelector('.wdl-text').textContent.includes('%'), 'win/draw/loss is shown');
    assert.match(panelRoot().querySelector('.opening').textContent, /^Opening: /);
    await until(() => panelRoot().querySelectorAll('.history-row').length >= 1, 'the finished search to reach the game history');
  } finally {
    t.stop();
  }
});

test('a new game URL empties the game history, and the next position starts it again', async () => {
  const t = setup();
  try {
    const panelRoot = () => t.document.querySelector('[data-analysis-panel]')?.shadowRoot;
    const rows = () => panelRoot()?.querySelectorAll('.history-row').length ?? -1;
    await until(() => rows() === 1, 'the start position in the history');

    // A new game on the same tab: the URL changes, and the board is still the start position.
    t.dom.window.history.pushState({}, '', '/game/live/2');
    await until(() => rows() === 0, 'the history to empty after the URL changes', 5000);
    assert.equal(panelRoot().querySelector('.history'), null, 'the history list is gone');

    // The new game's first position is recorded on its own.
    const pawn = t.document.querySelector('[data-sq="e2"]');
    pawn.className = 'piece wp ' + sq('e4');
    await until(() => rows() === 1, 'the new game to record its first position');
    assert.match(panelRoot().querySelector('.history-row .h-move').textContent, /^[A-Za-z0-9=+#-]+$/);
  } finally {
    t.stop();
  }
});

test('a new depth is used for the next search, straight away and without a reload', async () => {
  const t = setup({ depth: 12 });
  try {
    await until(t.arrowDrawn, 'the first arrow');
    assert.equal(t.bus.messages.filter((m) => m.message.type === 'ENGINE_BEST_MOVE').pop().message.depth, 12);

    t.stored.depth = 18;
    for (const listener of t.storageListeners) listener({ depth: { oldValue: 12, newValue: 18 } }, 'local');
    await until(
      () => t.bus.messages.some((m) => m.message.type === 'ENGINE_BEST_MOVE' && m.message.depth === 18),
      'a search at depth 18',
      5000,
    );
    await until(t.arrowDrawn, 'the arrow from the depth-18 search');
  } finally {
    t.stop();
  }
});

test('nothing is asked of the engine while the setting is off', async () => {
  const t = setup({ enabled: false });
  try {
    await tick(1000);
    assert.equal(t.bus.messages.filter((m) => m.message.type === 'BEST_MOVE').length, 0);
    assert.equal(t.arrowDrawn(), false);
  } finally {
    t.stop();
  }
});

test('with nothing stored, suggestions are on and the search uses the default depth of 12', async () => {
  const t = setup({ empty: true });
  try {
    await until(t.arrowDrawn, 'the arrow');
    assert.equal(t.bus.messages.find((m) => m.message.type === 'ENGINE_BEST_MOVE').message.depth, 12);
  } finally {
    t.stop();
  }
});

test('turning the switch off clears the arrow and stops engine requests; turning it on draws again', async () => {
  const t = setup();
  try {
    await until(t.arrowDrawn, 'the first arrow');
    t.stored.suggestionsEnabled = false;
    for (const listener of t.storageListeners) listener({ suggestionsEnabled: { oldValue: true, newValue: false } }, 'local');
    await until(() => !t.arrowDrawn(), 'the arrow to clear', 2000);

    const before = t.bus.messages.filter((m) => m.message.type === 'BEST_MOVE').length;
    t.document.querySelector('[data-sq="e2"]').className = 'piece wp ' + sq('e4'); // the board changes while off
    await tick(1000);
    assert.equal(t.arrowDrawn(), false);
    assert.equal(t.bus.messages.filter((m) => m.message.type === 'BEST_MOVE').length, before, 'no engine request while off');

    t.stored.suggestionsEnabled = true;
    for (const listener of t.storageListeners) listener({ suggestionsEnabled: { oldValue: false, newValue: true } }, 'local');
    await until(t.arrowDrawn, 'the arrow after turning back on');
  } finally {
    t.stop();
  }
});

test('a short game, 1.e4 c5 2.Nf3 d6, through the real chain with five lines: arrows, table, WDL, opening and history agree', async () => {
  const { Chess } = require('../vendor/chess/chess.js');
  const { squareCenter } = require('../src/overlay.js');
  const { uciToSan } = require('../src/san.js');
  const t = setup({ lines: 5, depth: 8 });
  try {
    const panelRoot = () => t.document.querySelector('[data-analysis-panel]')?.shadowRoot;
    const requests = () => t.bus.messages.filter((m) => m.from === 'content' && m.message.type === 'BEST_MOVE');
    const answerFor = (fen) => t.bus.responses.find((r) => r.message.type === 'BEST_MOVE' && r.message.fen === fen)?.value;

    // The page's state after each ply: the pieces move by changing their square class, and the move counter on the page goes up.
    const game = new Chess();
    const plies = [['e2', 'e4', 'e4'], ['c7', 'c5', 'c5'], ['g1', 'f3', 'Nf3'], ['d7', 'd6', 'd6']];
    const positions = [];

    async function settled(expectedRows) {
      await until(() => {
        const rows = panelRoot()?.querySelectorAll('tr.line').length === 5;
        const arrows = t.arrow()?.querySelectorAll('g[data-rank]').length === 5;
        const history = panelRoot()?.querySelectorAll('.history-row').length === expectedRows;
        return rows && arrows && history;
      }, 'five lines, five arrows and ' + expectedRows + ' history rows');
      const fen = requests().pop().message.fen;
      assert.ok(answerFor(fen), 'the answer for the position on the board has arrived');
      positions.push(fen);
      return fen;
    }

    await settled(1);
    for (const [i, [from, to, san]] of plies.entries()) {
      game.move(san);
      const piece = t.document.querySelector(`[data-sq="${from}"]`);
      const colour = piece.className.match(/\b[wb][pnbrqk]\b/)[0];
      piece.className = `piece ${colour} ${sq(to)}`;
      piece.setAttribute('data-sq', to);
      t.document.getElementById('moves').setAttribute('data-ply', String(i + 1));
      await tick(100);
      assert.equal(t.arrow().querySelectorAll('g[data-rank]').length, 0, 'the arrows for the old position are gone at once');
      await settled(i + 2);
      const fen = positions.at(-1);
      assert.deepEqual(fen.split(' ').slice(0, 3), game.fen().split(' ').slice(0, 3), 'the engine was asked about the position on the board');
    }
    assert.equal(positions.length, 5);
    assert.equal(new Set(positions).size, 5, 'five different positions');

    // The final position: White to move after 2...d6.
    const finalFen = positions.at(-1);
    const answer = answerFor(finalFen);
    assert.equal(answer.ok, true);
    assert.equal(answer.lines.length, 5);

    // Arrows: five, numbered, each ending on its line's target square, scored like the table, coloured best to worst.
    const rows = [...panelRoot().querySelectorAll('tr.line')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    const arrows = [...t.arrow().querySelectorAll('g[data-rank]')];
    const hues = [];
    arrows.forEach((g, i) => {
      assert.equal(g.getAttribute('data-rank'), String(i + 1));
      const tip = g.querySelector('polygon').getAttribute('points').split(' ')[1].split(',').map(Number);
      const target = squareCenter(answer.lines[i].move.slice(2, 4), false);
      assert.ok(Math.abs(tip[0] - target.x) < 1e-6 && Math.abs(tip[1] - target.y) < 1e-6, `arrow ${i + 1} ends on ${answer.lines[i].move.slice(2, 4)}`);
      assert.equal(g.querySelectorAll('text')[1].textContent, rows[i][2], 'the arrow’s score is the table’s score');
      hues.push(Number(/^hsl\((\d+),/.exec(g.querySelector('line').getAttribute('stroke'))[1]));
    });
    assert.ok(hues.every((h, i) => i === 0 || h <= hues[i - 1]), 'colours go from green towards red down the ranks');
    assert.equal(hues[0], 120, 'the best line is green');

    // Table: the moves are the same moves as the arrows, in SAN, with gaps that grow.
    assert.deepEqual(rows.map((r) => r[1]), Array.from(answer.lines, (line) => uciToSan(finalFen, [line.move])[0])); // answer comes from another realm, so copy it
    const gaps = rows.map((r) => Number(r[3]));
    assert.equal(gaps[0], 0);
    assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1]));

    // WDL: three shares of the best line that add up to 100%.
    const wdl = /W ([\d.]+)% · D ([\d.]+)% · L ([\d.]+)%/.exec(panelRoot().querySelector('.wdl-text').textContent);
    assert.ok(wdl, 'WDL is shown');
    assert.ok(Math.abs(Number(wdl[1]) + Number(wdl[2]) + Number(wdl[3]) - 100) < 0.11);

    // Opening: the Sicilian after 1.e4 c5 2.Nf3 d6.
    assert.match(panelRoot().querySelector('.opening').textContent, /^Opening: .*Sicilian/);

    // History: one row per position seen, each with the best move the engine gave for that position.
    const historyMoves = [...panelRoot().querySelectorAll('.history-row .h-move')].map((n) => n.textContent);
    assert.deepEqual(historyMoves, positions.map((fen) => uciToSan(fen, [answerFor(fen).lines[0].move])[0]));
    assert.equal(panelRoot().querySelectorAll('.history-row').length, 5);
  } finally {
    t.stop();
  }
});

test('a position seen again is shown from the cache without asking the engine again, and lines appear while the search runs', async () => {
  const t = setup();
  try {
    const panelRoot = () => t.document.querySelector('[data-analysis-panel]')?.shadowRoot;
    const requests = () => t.bus.messages.filter((m) => m.from === 'content' && m.message.type === 'BEST_MOVE');
    await until(() => (panelRoot()?.querySelectorAll('.history-row').length ?? 0) === 1, 'the first search to finish');
    assert.ok(t.bus.messages.some((m) => m.message.type === 'ANALYSIS_PARTIAL'), 'the engine sent lines before it finished');
    assert.equal(requests().length, 1);

    const pawn = t.document.querySelector('[data-sq="e2"]');
    pawn.className = 'piece wp ' + sq('e4');
    await until(() => panelRoot().querySelectorAll('.history-row').length === 2, 'the second position to finish');
    assert.equal(requests().length, 2);

    pawn.className = 'piece wp ' + sq('e2'); // take the move back: the start position again
    await until(() => t.arrowDrawn(), 'the arrow for the position seen before');
    await tick(600);
    assert.equal(requests().length, 2, 'the engine was not asked about the start position a second time');
    assert.equal(t.arrowDrawn(), true);
  } finally {
    t.stop();
  }
});
