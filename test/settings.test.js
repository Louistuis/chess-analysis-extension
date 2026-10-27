const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, normalizeDepth, normalizeLines, normalizeElo, normalizeSettings, loadSettings, saveSettings, changedSettings } = require('../src/settings.js');

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

test('defaults are suggestions on, depth 12, three lines and Full strength (no Elo limit)', () => {
  assert.deepEqual(DEFAULTS, { suggestionsEnabled: true, depth: 12, lines: 3, elo: null });
});

test('normalizeElo keeps practice strengths from 1320 to 2800 as whole numbers', () => {
  assert.equal(normalizeElo(1320), 1320);
  assert.equal(normalizeElo(2800), 2800);
  assert.equal(normalizeElo(1500), 1500);
  assert.equal(normalizeElo(1500.4), 1500);
  assert.equal(normalizeElo(1500.6), 1501);
  assert.equal(normalizeElo('2100'), 2100, 'numeric text from storage or the slider is read as a number');
});

test('normalizeElo falls back to Full strength (null) for anything that is not a rating in range', () => {
  assert.equal(normalizeElo(null), null, 'null is Full strength');
  assert.equal(normalizeElo(undefined), null, 'a missing value is Full strength');
  assert.equal(normalizeElo(''), null, 'an empty string is not a rating');
  assert.equal(normalizeElo('  '), null);
  assert.equal(normalizeElo('strong'), null);
  assert.equal(normalizeElo(NaN), null);
  assert.equal(normalizeElo(true), null, 'a boolean is not a rating');
  assert.equal(normalizeElo({ elo: 1500 }), null);
  assert.equal(normalizeElo(800), null, 'below the engine’s 1320 floor');
  assert.equal(normalizeElo(1319), null);
  assert.equal(normalizeElo(2801), null, 'above 2800');
  assert.equal(normalizeElo(Infinity), null);
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
  assert.deepEqual(normalizeSettings({}), { suggestionsEnabled: true, depth: 12, lines: 3, elo: null });
  assert.deepEqual(normalizeSettings({ suggestionsEnabled: 'no', depth: 99, lines: 9, elo: 'fast' }), { suggestionsEnabled: true, depth: 20, lines: 5, elo: null });
  assert.deepEqual(normalizeSettings({ suggestionsEnabled: false, depth: 9, lines: 1, elo: 1500 }), { suggestionsEnabled: false, depth: 9, lines: 1, elo: 1500 });
});

test('loadSettings returns defaults when nothing is stored, including Full strength', async () => {
  assert.deepEqual(await loadSettings(fakeArea()), { suggestionsEnabled: true, depth: 12, lines: 3, elo: null });
});

test('loadSettings returns what was stored, cleaned', async () => {
  const area = fakeArea({ suggestionsEnabled: false, depth: 18, lines: 2, elo: 2100 });
  assert.deepEqual(await loadSettings(area), { suggestionsEnabled: false, depth: 18, lines: 2, elo: 2100 });

  const messy = fakeArea({ suggestionsEnabled: 'yes', depth: 'lots', lines: 'all', elo: 'weak' });
  assert.deepEqual(await loadSettings(messy), { suggestionsEnabled: true, depth: 12, lines: 3, elo: null }, 'a bad Elo is Full strength');

  const outOfRange = fakeArea({ elo: 900 });
  assert.equal((await loadSettings(outOfRange)).elo, null, 'an Elo out of range is Full strength');
});

test('saveSettings stores the practice strength, and null means Full strength', async () => {
  const area = fakeArea({ suggestionsEnabled: true, depth: 12, lines: 3 });
  await saveSettings({ elo: 1800 }, area);
  assert.equal(area.data.elo, 1800);
  await saveSettings({ elo: null }, area);
  assert.strictEqual(area.data.elo, null, 'Full strength is stored as null');
  await saveSettings({ elo: 'x' }, area);
  assert.strictEqual(area.data.elo, null, 'a bad value is stored as Full strength, never as a bad number');
  await saveSettings({ elo: '2000' }, area);
  assert.strictEqual(area.data.elo, 2000);
  assert.equal(area.data.depth, 12, 'other settings are not touched');
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
  await saveSettings({ suggestionsEnabled: false, depth: 15, lines: 1, elo: 1600 }, area);
  assert.deepEqual(await loadSettings(area), { suggestionsEnabled: false, depth: 15, lines: 1, elo: 1600 });
});

test('changedSettings reports only the settings that changed, cleaned', () => {
  assert.deepEqual(changedSettings({ depth: { oldValue: 12, newValue: 25 }, unrelated: { newValue: 1 } }), { depth: 20 });
  assert.deepEqual(changedSettings({ suggestionsEnabled: { newValue: false } }), { suggestionsEnabled: false });
  assert.deepEqual(changedSettings({ lines: { oldValue: 3, newValue: 2 } }), { lines: 2 });
  assert.deepEqual(changedSettings({ unrelated: { newValue: 1 } }), {});
});

test('changedSettings reports a change of practice strength, cleaned, with null for Full strength', () => {
  assert.deepEqual(changedSettings({ elo: { oldValue: null, newValue: 1500 } }), { elo: 1500 });
  assert.deepEqual(changedSettings({ elo: { oldValue: 1500, newValue: null } }), { elo: null });
  assert.deepEqual(changedSettings({ elo: { oldValue: 1500, newValue: 'bad' } }), { elo: null });
});

test('a removed practice strength falls back to Full strength when it changes', () => {
  assert.deepEqual(changedSettings({ elo: { oldValue: 1800 } }), { elo: null });
});

test('a removed setting falls back to its default when it changes', () => {
  assert.deepEqual(changedSettings({ depth: { oldValue: 16 } }), { depth: 12 });
  assert.deepEqual(changedSettings({ suggestionsEnabled: { oldValue: false } }), { suggestionsEnabled: true });
  assert.deepEqual(changedSettings({ lines: { oldValue: 1 } }), { lines: 3 });
});
