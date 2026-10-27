// Settings stored in chrome.storage.local, shared by the popup, the background worker and the content script.
// Loaded as a classic script (sets globalThis.ChessSettings) and also as a CommonJS module so it can be tested in Node.
(function (scope) {
  // Practice strength is a UCI_Elo rating in this range: the engine's own floor is 1320 (below it, Stockfish would play
  // at 1320 anyway, so the slider starts there). null means Full strength, with no limit.
  const ELO_MIN = 1320;
  const ELO_MAX = 2800;
  const DEFAULTS = { suggestionsEnabled: true, depth: 12, lines: 3, elo: null };
  const DEPTH_MIN = 8;
  const DEPTH_MAX = 20;
  const LINES_MIN = 1;
  const LINES_MAX = 5;

  // Turns a stored value into a whole number in [min, max]; anything that isn't a number (or numeric text) gets the default.
  // Number(null) and Number('') are 0, so those are checked first.
  function clampInteger(value, min, max, fallback) {
    const isNumericText = typeof value === 'string' && value.trim() !== '';
    if (typeof value !== 'number' && !isNumericText) return fallback;
    const whole = Math.round(Number(value));
    if (!Number.isFinite(whole)) return fallback;
    return Math.min(max, Math.max(min, whole));
  }

  // Keeps the search depth in range; anything that isn't a number (or numeric text) gets the default.
  function normalizeDepth(value) {
    return clampInteger(value, DEPTH_MIN, DEPTH_MAX, DEFAULTS.depth);
  }

  // Number of lines (principal variations) to show: 1 to 5.
  function normalizeLines(value) {
    return clampInteger(value, LINES_MIN, LINES_MAX, DEFAULTS.lines);
  }

  // Practice strength: a whole Elo in ELO_MIN to ELO_MAX, or null for Full strength. Anything else (not a number, or
  // outside the range) is a bad value and falls back to Full strength.
  function normalizeElo(value) {
    const isNumber = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
    if (!isNumber) return null;
    const whole = Math.round(Number(value));
    return Number.isFinite(whole) && whole >= ELO_MIN && whole <= ELO_MAX ? whole : null;
  }

  function normalizeSettings(raw = {}) {
    return {
      suggestionsEnabled: typeof raw.suggestionsEnabled === 'boolean' ? raw.suggestionsEnabled : DEFAULTS.suggestionsEnabled,
      depth: normalizeDepth(raw.depth),
      lines: normalizeLines(raw.lines),
      elo: normalizeElo(raw.elo),
    };
  }

  // Reads all settings, with defaults for anything missing or invalid.
  async function loadSettings(area = globalThis.chrome.storage.local) {
    return normalizeSettings(await area.get(DEFAULTS));
  }

  // Writes only the keys given, and cleans them first so bad values never reach storage.
  function saveSettings(patch, area = globalThis.chrome.storage.local) {
    const clean = {};
    if ('suggestionsEnabled' in patch) clean.suggestionsEnabled = Boolean(patch.suggestionsEnabled);
    if ('depth' in patch) clean.depth = normalizeDepth(patch.depth);
    if ('lines' in patch) clean.lines = normalizeLines(patch.lines);
    if ('elo' in patch) clean.elo = normalizeElo(patch.elo);
    return area.set(clean);
  }

  // From a chrome.storage.onChanged event, returns the settings that changed, cleaned. Other keys are ignored.
  function changedSettings(changes) {
    const out = {};
    if ('suggestionsEnabled' in changes) out.suggestionsEnabled = normalizeSettings({ suggestionsEnabled: changes.suggestionsEnabled.newValue }).suggestionsEnabled;
    if ('depth' in changes) out.depth = normalizeDepth(changes.depth.newValue);
    if ('lines' in changes) out.lines = normalizeLines(changes.lines.newValue);
    if ('elo' in changes) out.elo = normalizeElo(changes.elo.newValue);
    return out;
  }

  const api = { DEFAULTS, DEPTH_MIN, DEPTH_MAX, LINES_MIN, LINES_MAX, ELO_MIN, ELO_MAX, normalizeDepth, normalizeLines, normalizeElo, normalizeSettings, loadSettings, saveSettings, changedSettings };
  scope.ChessSettings = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
