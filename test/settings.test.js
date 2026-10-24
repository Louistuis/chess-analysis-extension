const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, normalizeDepth, normalizeLines, normalizeSettings, loadSettings, saveSettings, changedSettings } = require('../src/settings.js');

// A stand-in for chrome.storage.local: get(defaults) returns stored values or the defaults, set(items) merges.
function fakeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(defaults) {
      const out = {};
      for (const key of Object.keys(defaults)) out[key] = key in data ? data[key] : defaults[key];
      return out;
    },
    async set(items) {
      Object.assign(data, items);
    },
  };
}

test('defaults are suggestions on, depth 12 and three lines', () => {
  assert.deepEqual(DEFAULTS, { suggestionsEnabled: true, depth: 12, lines: 3 });
});

test('normalizeDepth keeps the depth between 8 and 20 and rounds it', () => {
  assert.equal(normalizeDepth(3), 8);
  assert.equal(normalizeDepth(8), 8);
  assert.equal(normalizeDepth(20), 20);
  assert.equal(normalizeDepth(99), 20);
  assert.equal(normalizeDepth(13.6), 14);
  assert.equal(normalizeDepth('15'), 15);
  assert.equal(normalizeDepth('deep'), 12);
  assert.equal(normalizeDepth(undefined), 12);
  assert.equal(normalizeDepth(null), 12, 'null is not a depth');
  assert.equal(normalizeDepth(''), 12, 'an empty string is not a depth');
  assert.equal(normalizeDepth(true), 12, 'a boolean is not a depth');
  assert.equal(normalizeDepth(NaN), 12);
});

test('normalizeLines keeps the number of lines between 1 and 5', () => {
  assert.equal(normalizeLines(0), 1);
  assert.equal(normalizeLines(1), 1);
  assert.equal(normalizeLines(2), 2);
  assert.equal(normalizeLines(3), 3);
  assert.equal(normalizeLines(4), 4);
  assert.equal(normalizeLines(5), 5);
  assert.equal(normalizeLines(7), 5, 'more than five is cut to five');
  assert.equal(normalizeLines('2'), 2);
  assert.equal(normalizeLines('5'), 5);
  assert.equal(normalizeLines(2.4), 2);
  assert.equal(normalizeLines(4.6), 5);
  assert.equal(normalizeLines('many'), 3, 'bad input gets the default of 3');
  assert.equal(normalizeLines(null), 3, 'null is not a number of lines');
  assert.equal(normalizeLines(undefined), 3);
});

test('normalizeSettings falls back to defaults for missing or wrong-typed values', () => {
  assert.deepEqual(normalizeSettings({}), { suggestionsEnabled: true, depth: 12, lines: 3 });
  assert.deepEqual(normalizeSettings({ suggestionsEnabled: 'no', depth: 99, lines: 9 }), { suggestionsEnabled: true, depth: 20, lines: 5 });
  assert.deepEqual(normalizeSettings({ suggestionsEnabled: false, depth: 9, lines: 1 }), { suggestionsEnabled: false, depth: 9, lines: 1 });
});

test('loadSettings returns defaults when nothing is stored', async () => {
  assert.deepEqual(await loadSettings(fakeArea()), { suggestionsEnabled: true, depth: 12, lines: 3 });
});

test('loadSettings returns what was stored, cleaned', async () => {
  const area = fakeArea({ suggestionsEnabled: false, depth: 18, lines: 2 });
  assert.deepEqual(await loadSettings(area), { suggestionsEnabled: false, depth: 18, lines: 2 });

  const messy = fakeArea({ suggestionsEnabled: 'yes', depth: 'lots', lines: 'all' });
  assert.deepEqual(await loadSettings(messy), { suggestionsEnabled: true, depth: 12, lines: 3 });
});

test('saveSettings writes only the keys it is given, cleaned', async () => {
  const area = fakeArea({ suggestionsEnabled: true, depth: 12, lines: 3 });
  await saveSettings({ depth: '40' }, area);
  assert.deepEqual(area.data, { suggestionsEnabled: true, depth: 20, lines: 3 });

  await saveSettings({ suggestionsEnabled: 0 }, area);
  assert.deepEqual(area.data, { suggestionsEnabled: false, depth: 20, lines: 3 });

  await saveSettings({ lines: 4 }, area);
  assert.deepEqual(area.data, { suggestionsEnabled: false, depth: 20, lines: 4 });

  await saveSettings({ lines: 9 }, area);
  assert.deepEqual(area.data, { suggestionsEnabled: false, depth: 20, lines: 5 });
});

test('a saved setting is what loads back', async () => {
  const area = fakeArea();
  await saveSettings({ suggestionsEnabled: false, depth: 15, lines: 1 }, area);
  assert.deepEqual(await loadSettings(area), { suggestionsEnabled: false, depth: 15, lines: 1 });
});

test('changedSettings reports only the settings that changed, cleaned', () => {
  assert.deepEqual(changedSettings({ depth: { oldValue: 12, newValue: 25 }, unrelated: { newValue: 1 } }), { depth: 20 });
  assert.deepEqual(changedSettings({ suggestionsEnabled: { newValue: false } }), { suggestionsEnabled: false });
  assert.deepEqual(changedSettings({ lines: { oldValue: 3, newValue: 2 } }), { lines: 2 });
  assert.deepEqual(changedSettings({ unrelated: { newValue: 1 } }), {});
});

test('a removed setting falls back to its default when it changes', () => {
  assert.deepEqual(changedSettings({ depth: { oldValue: 16 } }), { depth: 12 });
  assert.deepEqual(changedSettings({ suggestionsEnabled: { oldValue: false } }), { suggestionsEnabled: true });
  assert.deepEqual(changedSettings({ lines: { oldValue: 1 } }), { lines: 3 });
});
