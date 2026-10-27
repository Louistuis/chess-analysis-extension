// Enforces the scope rule: the extension only suggests. It never clicks, dispatches events or moves pieces, and nothing
// delays or randomises a suggestion (no hidden randomness, no timing tweaks, no human-like imitation).
// The strength setting is allowed: it is a visible, user-chosen practice setting that uses the engine's own UCI options.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const walk = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
const files = ['src', 'popup', 'offscreen'].flatMap(walk).filter((f) => /\.(js|html)$/.test(f));

// Code without comments, so a comment that explains a rule does not trip the scan.
function code(file) {
  return fs
    .readFileSync(path.join(root, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}
const lines = (file) => code(file).split('\n').map((l) => l.trim()).filter(Boolean);

test('the scan sees the extension’s own files', () => {
  assert.ok(files.length >= 15, 'found ' + files.length + ' files');
  assert.ok(files.includes('src/content.js') && files.includes('src/engine/engine.js') && files.includes('popup/popup.js'));
});

test('nothing uses randomness: no Math.random, crypto random values, or random-looking names', () => {
  for (const file of files) {
    const text = code(file);
    assert.doesNotMatch(text, /Math\.random|getRandomValues|randomUUID|\brandom\w*\s*\(/i, file + ' uses randomness');
  }
});

test('nothing imitates a human or varies timing: no jitter, humanising, mimicry or busy-waiting', () => {
  for (const file of files) {
    const text = code(file);
    assert.doesNotMatch(text, /human-?like|humani[sz]e|\bjitter|\bmimic|imitat|think(ing)?[ _-]?time|fake[ _-]?delay|artificial/i, file + ' hints at imitation or delay');
    assert.doesNotMatch(text, /Atomics\.wait|while\s*\(\s*(Date\.now|performance\.now)/, file + ' busy-waits');
  }
});

// The only timers in the extension, each with the reason it is not a delay on a suggestion.
const ALLOWED_TIMERS = {
  'src/overlay.js': [
    'setTimeout(() => old.remove(), motion.fadeMs);', // removes a faded-out arrow from the page
    'else setTimeout(fn, 16);', // fallback for requestAnimationFrame
  ],
  'src/panel.js': [
    'function throttle(fn, intervalMs, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {', // the stats numbers only
  ],
  'src/content.js': [
    'timer = setTimeout(refresh, DEBOUNCE_MS);', // waits for the page to settle before reading the board
    'setInterval(checkGame, URL_CHECK_MS);', // notices a new game URL
  ],
  'src/engine/engine.js': [
    'const timer = setTimeout(() => {', // rejects a request the engine never answers
  ],
};

test('every timer in the extension is on the allowed list, so a new one has to be looked at', () => {
  for (const file of files) {
    const allowed = ALLOWED_TIMERS[file] || [];
    for (const line of lines(file)) {
      if (!/\b(setTimeout|setInterval|setTimer|requestAnimationFrame)\b/.test(line)) continue;
      if (/requestAnimationFrame/.test(line) && /typeof requestAnimationFrame|requestAnimationFrame\(fn\)/.test(line)) continue;
      if (/^(timer = )?setTimer\(run, wait\);?$|else timer = setTimer\(run, wait\);/.test(line)) continue; // inside throttle
      assert.ok(allowed.includes(line), `${file} has a timer that is not on the allowed list: ${line}`);
    }
  }
});

test('the debounce before reading the board is short, and the stats throttle is used only for the live numbers', () => {
  const content = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
  assert.ok(Number(/DEBOUNCE_MS = (\d+)/.exec(content)[1]) <= 300, 'the page-settle wait is short');
  const panel = code('src/panel.js');
  const uses = panel.match(/throttle\(/g) || [];
  assert.equal(uses.length, 2, 'the definition and the one use');
  assert.match(panel, /statsThrottle = throttle\(\(stats\) => this\.applyStats\(stats\), STATS_INTERVAL_MS\)/);
  assert.ok(Number(/STATS_INTERVAL_MS = (\d+)/.exec(fs.readFileSync(path.join(root, 'src/panel.js'), 'utf8'))[1]) <= 500);
});

test('the suggestion path has no timer: the tracker, the engine’s search and the background just pass the answer on', () => {
  const overlay = fs.readFileSync(path.join(root, 'src/overlay.js'), 'utf8');
  const tracker = overlay.slice(overlay.indexOf('class SuggestionTracker'), overlay.indexOf('class SuggestionOverlay'));
  assert.ok(tracker.length > 200);
  assert.doesNotMatch(tracker, /setTimeout|setInterval|Math\.random/);
  for (const file of ['src/background.js', 'offscreen/offscreen.js']) {
    assert.doesNotMatch(code(file), /setTimeout|setInterval/, file + ' delays something');
  }
  const engine = code('src/engine/engine.js');
  const search = engine.slice(engine.indexOf('async search('));
  assert.doesNotMatch(search.slice(0, search.indexOf('function validateFen') > 0 ? search.indexOf('function validateFen') : undefined), /setTimeout\(\s*resolve|sleep|delay/i);
});

test('nothing clicks, dispatches events, types, focuses or navigates (the extension only suggests)', () => {
  const forbidden = [
    [/\.click\s*\(/, 'click()'],
    [/dispatchEvent\s*\(/, 'dispatchEvent()'],
    [/new\s+(Mouse|Pointer|Keyboard|Touch|Input|Drag|Wheel|Focus|Custom)?Event\b/, 'a synthetic event'],
    [/elementFromPoint|elementsFromPoint/, 'hit-testing the page'],
    [/execCommand\s*\(/, 'execCommand()'],
    [/chrome\.(debugger|scripting|tabs\.(update|create|executeScript))/, 'a chrome API that drives pages'],
    [/\.(submit|requestSubmit|focus|blur|select)\s*\(/, 'a form or focus action'],
    [/window\.open|location\.(assign|replace)|location\.href\s*=/, 'navigation'],
    [/\.(dragstart|mousedown|mouseup|pointerdown|pointerup|touchstart)\b/, 'a pointer action'],
  ];
  for (const file of files.filter((f) => f.endsWith('.js'))) {
    const text = code(file);
    for (const [pattern, what] of forbidden) assert.doesNotMatch(text, pattern, file + ' uses ' + what);
  }
});

test('the only event listeners the extension adds are for reading: no listener is added on the chess.com board for input', () => {
  for (const file of files.filter((f) => f.startsWith('src/') && f.endsWith('.js'))) {
    for (const [, type] of code(file).matchAll(/addEventListener\(\s*'([a-z]+)'/g)) {
      assert.ok(!/^(click|mousedown|mouseup|pointerdown|pointerup|keydown|keyup|touchstart|touchend|drag\w*)$/.test(type) || file === 'src/panel.js', `${file} listens for ${type}`);
    }
  }
});

test('the strength setting only goes through the engine’s own UCI options, and is labelled in the panel', () => {
  const engine = code('src/engine/engine.js');
  const setoptions = new Set([...engine.matchAll(/setoption name ([\w ]+?) value/g)].map((m) => m[1]));
  // Analysis options (lines, WDL, memory) and the two UCI strength options. Nothing like Skill Level, Contempt or Move Overhead.
  const allowed = new Set(['MultiPV', 'UCI_ShowWDL', 'UCI_AnalyseMode', 'Hash', 'UCI_LimitStrength', 'UCI_Elo']);
  assert.deepEqual([...setoptions].filter((name) => !allowed.has(name)), [], 'an engine option outside the allowed list is set');
  assert.ok(setoptions.has('UCI_LimitStrength') && setoptions.has('UCI_Elo'));
  assert.match(code('src/panel.js'), /Practice strength: ~/);
  assert.match(fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8'), /Full strength/);
});
