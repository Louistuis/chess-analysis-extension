const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { throttle, formatStrength, withPracticeStrength, buildSearching, renderPanel, AnalysisPanel } = require('../src/panel.js');

// A clock the test moves by hand: `advance` runs any timer that has come due.
function fakeClock() {
  let time = 0;
  let timers = [];
  return {
    now: () => time,
    setTimer: (fn, ms) => {
      const timer = { fn, at: time + ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timers = timers.filter((item) => item !== timer);
    },
    advance(ms) {
      time += ms;
      const due = timers.filter((timer) => timer.at <= time).sort((a, b) => a.at - b.at);
      timers = timers.filter((timer) => timer.at > time);
      for (const timer of due) timer.fn();
    },
    pending: () => timers.length,
  };
}

test('throttle: the first call runs at once, and calls within the interval keep only the latest value for when it is up', () => {
  const clock = fakeClock();
  const seen = [];
  const fn = throttle((value) => seen.push(value), 400, clock);
  fn('a');
  assert.deepEqual(seen, ['a'], 'the first call runs at once');
  fn('b');
  fn('c');
  assert.deepEqual(seen, ['a'], 'calls in the interval wait');
  clock.advance(399);
  assert.deepEqual(seen, ['a']);
  clock.advance(1);
  assert.deepEqual(seen, ['a', 'c'], 'the latest waiting value runs once the interval is up; b is skipped');
});

test('throttle: once the interval has passed, a call runs at once again', () => {
  const clock = fakeClock();
  const seen = [];
  const fn = throttle((value) => seen.push(value), 400, clock);
  fn('a');
  clock.advance(400);
  fn('d');
  assert.deepEqual(seen, ['a', 'd']);
  assert.equal(clock.pending(), 0, 'no timer is left waiting');
});

test('throttle: cancel drops a waiting value', () => {
  const clock = fakeClock();
  const seen = [];
  const fn = throttle((value) => seen.push(value), 400, clock);
  fn('a');
  fn('b');
  fn.cancel();
  clock.advance(1000);
  assert.deepEqual(seen, ['a'], 'b never runs');
  assert.equal(clock.pending(), 0);
});

test('the practice strength label says the rating, and nothing at Full strength', () => {
  assert.equal(formatStrength(1500), 'Practice strength: ~1500 Elo');
  assert.equal(formatStrength(null), null);
  assert.equal(formatStrength(undefined), null);
});

test('adding the practice strength to a model does not change the model it came from', () => {
  const model = buildSearching(null);
  const rated = withPracticeStrength(model, 1900);
  assert.equal(rated.strength, 'Practice strength: ~1900 Elo');
  assert.equal(model.strength, undefined);
  assert.equal(withPracticeStrength(model, null).strength, null);
});

test('the panel shows the practice strength under the score, and no line at Full strength', () => {
  const doc = new JSDOM('<body><div id="out"></div></body>').window.document;
  const container = doc.getElementById('out');
  renderPanel(container, withPracticeStrength(buildSearching(null), 1500));
  assert.equal(container.querySelector('.strength').textContent, 'Practice strength: ~1500 Elo');
  renderPanel(container, withPracticeStrength(buildSearching(null), null));
  assert.equal(container.querySelector('.strength'), null);
});

test('live stats in the panel change at most every 400 ms, and the latest numbers are the ones shown', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  const panel = new AnalysisPanel(doc);
  const technical = () => panel.body.querySelector('.technical').textContent;
  panel.render(buildSearching(null));
  panel.updateStats({ depth: 5, seldepth: null, nodes: 100, nps: 1000, hashfull: null, time: 10 });
  assert.match(technical(), /^depth 5 /, 'the first tick shows at once');
  panel.updateStats({ depth: 6, seldepth: null, nodes: 200, nps: 1000, hashfull: null, time: 20 });
  panel.updateStats({ depth: 7, seldepth: null, nodes: 300, nps: 1000, hashfull: null, time: 30 });
  assert.match(technical(), /^depth 5 /, 'the next ticks wait for the interval');
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.match(technical(), /^depth 7 /, 'then the latest one is shown');
});

test('stats waiting for an old search are dropped when the panel shows a new model', async () => {
  const doc = new JSDOM('<body></body>').window.document;
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  panel.updateStats({ depth: 5, seldepth: null, nodes: 100, nps: 1000, hashfull: null, time: 10 });
  panel.updateStats({ depth: 6, seldepth: null, nodes: 200, nps: 1000, hashfull: null, time: 20 });
  panel.render(buildSearching(null));
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(panel.body.querySelector('.technical').textContent, 'No search stats yet', 'the waiting depth 6 did not land on the new model');
});

test('the panel stylesheet turns off transitions and animations for reduced motion', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const panel = new AnalysisPanel(doc);
  panel.render(buildSearching(null));
  const css = panel.host.shadowRoot.querySelector('style').textContent;
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition: none !important/);
});
