// Runs the real popup.html controls and popup.js in jsdom with a fake chrome.storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

async function openPopup(initial = {}) {
  const dom = new JSDOM(read('popup/popup.html'), { runScripts: 'outside-only' });
  const data = { ...initial };
  const listeners = [];
  dom.window.chrome = {
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...data }),
        set: async (items) => Object.assign(data, items),
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    tabs: { query: async () => [] },
  };
  dom.window.eval(read('src/settings.js'));
  dom.window.eval(read('popup/popup.js'));
  await new Promise((r) => setTimeout(r, 20)); // let loadSettings resolve
  const $ = (id) => dom.window.document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  return { dom, data, listeners, $, fire };
}

test('with nothing stored the switch is on and depth is 12, within a 8 to 20 range', async () => {
  const p = await openPopup();
  assert.equal(p.$('enabled').checked, true);
  assert.equal(p.$('depth').value, '12');
  assert.equal(p.$('depth-value').textContent, '12');
  assert.equal(p.$('depth').min, '8');
  assert.equal(p.$('depth').max, '20');
});

test('the controls show the stored values', async () => {
  const p = await openPopup({ suggestionsEnabled: false, depth: 17 });
  assert.equal(p.$('enabled').checked, false);
  assert.equal(p.$('depth').value, '17');
  assert.equal(p.$('depth-value').textContent, '17');
});

test('bad stored values show as the defaults', async () => {
  const p = await openPopup({ suggestionsEnabled: 'maybe', depth: null });
  assert.equal(p.$('enabled').checked, true);
  assert.equal(p.$('depth').value, '12');
});

test('flipping the switch writes it to storage', async () => {
  const p = await openPopup();
  p.$('enabled').checked = false;
  p.fire(p.$('enabled'), 'change');
  assert.equal(p.data.suggestionsEnabled, false);
  p.$('enabled').checked = true;
  p.fire(p.$('enabled'), 'change');
  assert.equal(p.data.suggestionsEnabled, true);
});

test('moving the depth slider updates the label live and saves on release', async () => {
  const p = await openPopup();
  p.$('depth').value = '16';
  p.fire(p.$('depth'), 'input');
  assert.equal(p.$('depth-value').textContent, '16');
  assert.equal(p.data.depth, undefined, 'nothing saved until the change event');
  p.fire(p.$('depth'), 'change');
  assert.equal(p.data.depth, 16);
});

test('a depth outside the range is clamped to 8 or 20 before it is stored', async () => {
  const p = await openPopup();
  p.$('depth').value = '40'; // the range input itself clamps to its max in a browser; jsdom does too
  p.fire(p.$('depth'), 'change');
  assert.ok(p.data.depth <= 20 && p.data.depth >= 8);
  p.$('depth').value = '1';
  p.fire(p.$('depth'), 'change');
  assert.equal(p.data.depth, 8);
});

test('a change made elsewhere updates the controls', async () => {
  const p = await openPopup();
  for (const l of p.listeners) l({ suggestionsEnabled: { newValue: false }, depth: { newValue: 9 } }, 'local');
  assert.equal(p.$('enabled').checked, false);
  assert.equal(p.$('depth').value, '9');
  assert.equal(p.$('depth-value').textContent, '9');
  for (const l of p.listeners) l({ depth: { newValue: 15 } }, 'sync'); // other storage areas are ignored
  assert.equal(p.$('depth').value, '9');
});

test('the popup shows the analysis and practice note', async () => {
  const p = await openPopup();
  const note = p.dom.window.document.querySelector('.note').textContent;
  assert.match(note, /analysis and practice/i);
  assert.match(note, /rated/i);
});

test('the lines selector offers 1 to 5, defaults to 3, and shows a stored value', async () => {
  const p = await openPopup();
  assert.deepEqual([...p.$('lines').options].map((o) => o.value), ['1', '2', '3', '4', '5']);
  assert.equal(p.$('lines').value, '3');
  const q = await openPopup({ lines: 2 });
  assert.equal(q.$('lines').value, '2');
});

test('choosing a number of lines writes it to storage as a number', async () => {
  const p = await openPopup();
  p.$('lines').value = '1';
  p.fire(p.$('lines'), 'change');
  assert.strictEqual(p.data.lines, 1);
});

test('a change to the lines setting made elsewhere updates the selector', async () => {
  const p = await openPopup();
  for (const l of p.listeners) l({ lines: { newValue: 2 } }, 'local');
  assert.equal(p.$('lines').value, '2');
});

test('choosing five lines writes 5 to storage', async () => {
  const p = await openPopup();
  p.$('lines').value = '5';
  p.fire(p.$('lines'), 'change');
  assert.strictEqual(p.data.lines, 5);
});

test('a stored lines value above five shows as five, and a bad one as 3', async () => {
  const p = await openPopup({ lines: 9 });
  assert.equal(p.$('lines').value, '5');
  const q = await openPopup({ lines: 'many' });
  assert.equal(q.$('lines').value, '3');
});
