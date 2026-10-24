const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('every file the manifest points to exists', () => {
  const files = [manifest.background.service_worker, manifest.action.default_popup];
  for (const cs of manifest.content_scripts) files.push(...cs.js);
  for (const file of files) assert.ok(exists(file), file + ' is missing');
});

test('background creates the offscreen page that exists, and the offscreen permission is declared', () => {
  const bg = fs.readFileSync(path.join(root, manifest.background.service_worker), 'utf8');
  const url = /OFFSCREEN_URL = '([^']+)'/.exec(bg)[1];
  assert.ok(exists(url), url + ' is missing');
  assert.ok(manifest.permissions.includes('offscreen'));
});

test('offscreen page scripts and the vendored Stockfish files exist', () => {
  const html = fs.readFileSync(path.join(root, 'offscreen/offscreen.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    assert.ok(exists(path.join('offscreen', src)), src + ' is missing');
  }
  const js = fs.readFileSync(path.join(root, 'offscreen/offscreen.js'), 'utf8');
  const worker = /getURL\('([^']+)'\)/.exec(js)[1];
  assert.ok(exists(worker), worker + ' is missing');
  assert.ok(exists(worker.replace(/\.js$/, '.wasm')), 'the .wasm next to the worker script is missing');
});

test('the CSP allows WebAssembly on extension pages', () => {
  assert.match(manifest.content_security_policy.extension_pages, /'wasm-unsafe-eval'/);
});

test('all extension scripts parse', () => {
  for (const file of ['src/background.js', 'src/content.js', 'src/chess-reader.js', 'src/engine/engine.js', 'src/overlay.js', 'offscreen/offscreen.js', 'popup/popup.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, file)]);
  }
});

const walk = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

test('the extension’s own code never contacts a remote server', () => {
  const files = ['src', 'popup', 'offscreen'].flatMap(walk).filter((f) => /\.(js|html)$/.test(f));
  assert.ok(files.length >= 8);
  const network = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\s*\()/;
  const allowedUrls = new Set(['http://www.w3.org/2000/svg']); // the SVG namespace, not a request
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, network, file + ' uses a network API');
    for (const [url] of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) assert.ok(allowedUrls.has(url), file + ' mentions ' + url);
    assert.doesNotMatch(text, /<(script|link|img|iframe)[^>]+(src|href)="(https?:)?\/\//, file + ' loads a remote resource');
  }
});

test('the vendored engine only mentions URLs in its header comments', () => {
  const text = fs.readFileSync(path.join(root, 'vendor/stockfish/stockfish-19-lite-single.js'), 'utf8');
  const known = [
    'https://github.com/nmrugg/stockfish.js',
    'https://github.com/official-stockfish/Stockfish',
    'https://tests.stockfishchess.org/nns',
  ];
  const urls = [...text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)].map((m) => m[0]);
  for (const url of urls) assert.ok(known.some((k) => url.startsWith(k)), 'unexpected URL in the engine: ' + url);
  for (const line of text.split('\n')) {
    if (/https?:\/\//.test(line)) assert.match(line.trim(), /^(\/\/|\/\*|\*)/, 'a URL outside a comment');
  }
});

test('the manifest only asks for the permissions and sites it needs', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['offscreen', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.content_scripts.flatMap((c) => c.matches), ['https://www.chess.com/*']);
});

test('the README file map only lists paths that exist, and its commands are real npm scripts', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const rows = readme.split('\n').filter((l) => /^\| `/.test(l));
  assert.ok(rows.length >= 10);
  for (const row of rows) {
    const p = /^\| `([^`]+)`/.exec(row)[1];
    assert.ok(exists(p), 'README lists ' + p + ' but it does not exist');
  }
  assert.ok(readme.includes('npm install'));
  assert.ok(readme.includes('npm test'));
  assert.ok(pkg.scripts.test);
});

test('background.js imports only files that exist next to it', () => {
  const bg = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
  for (const [, file] of bg.matchAll(/importScripts\('([^']+)'\)/g)) assert.ok(exists(path.join('src', file)), file + ' is missing');
});

test('content scripts load in dependency order: chess.js before san.js, san.js and settings.js before panel.js and content.js', () => {
  const js = manifest.content_scripts.flatMap((c) => c.js);
  const at = (f) => js.indexOf(f);
  for (const f of ['vendor/chess/chess.js', 'src/san.js', 'src/panel.js', 'src/settings.js', 'src/content.js']) assert.ok(at(f) >= 0, f + ' is not loaded');
  assert.ok(at('vendor/chess/chess.js') < at('src/san.js'));
  assert.ok(at('src/san.js') < at('src/panel.js'));
  assert.ok(at('src/settings.js') < at('src/content.js'));
  assert.ok(at('src/panel.js') < at('src/content.js'));
  assert.equal(js.at(-1), 'src/content.js');
});

test('the extension only suggests: nothing in src, popup or offscreen clicks, dispatches events, types or moves pieces', () => {
  const files = ['src', 'popup', 'offscreen'].flatMap(walk).filter((f) => /\.js$/.test(f));
  const forbidden = [
    [/\.click\s*\(/, 'click()'],
    [/dispatchEvent\s*\(/, 'dispatchEvent()'],
    [/new\s+(Mouse|Pointer|Keyboard|Touch|Input|Drag|Wheel|Focus)Event\b/, 'a synthetic UI event'],
    [/new\s+(Custom)?Event\s*\(/, 'a synthetic event'],
    [/elementFromPoint|elementsFromPoint/, 'hit-testing the page'],
    [/execCommand\s*\(/, 'execCommand()'],
    [/chrome\.(debugger|scripting|tabs\.(update|create|executeScript))/, 'a chrome API that drives pages'],
    [/\.(submit|requestSubmit|dragstart|focus)\s*\(/, 'a form or focus action'],
    [/window\.open|location\.(assign|replace)|location\.href\s*=/, 'navigation'],
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [pattern, what] of forbidden) assert.doesNotMatch(text, pattern, file + ' uses ' + what);
  }
  // The content scripts write to the page only through the arrow SVG and the panel's own shadow root.
  const content = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
  assert.doesNotMatch(content, /querySelector\([^)]*\)\s*\.(style|className|setAttribute)\s*=/);
});

test('the README describes the final features and every src file in the file map', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const word of ['five', 'win / draw / loss', 'opening', 'game so far', 'Lines shown', 'beside the board', 'Search depth']) {
    assert.ok(readme.toLowerCase().includes(word.toLowerCase()), 'README does not mention "' + word + '"');
  }
  for (const file of walk('src').concat(walk('offscreen'), walk('popup'))) {
    const dirOrFile = file.startsWith('src/engine') || file.startsWith('offscreen') || file.startsWith('popup') ? file.split('/')[0] + '/' : file;
    assert.ok(readme.includes('`' + dirOrFile) || readme.includes('`' + file.split('/')[0] + '/'), 'the file map is missing ' + file);
  }
  assert.doesNotMatch(readme, /not reset when a new game starts/, 'the README still says the history is not reset on a new game');
  assert.doesNotMatch(readme, /fixed, top right/, 'the README still describes the old panel position');
});
