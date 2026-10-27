const fenEl = document.getElementById('fen');
const statusEl = document.getElementById('status');
const enabledEl = document.getElementById('enabled');
const depthEl = document.getElementById('depth');
const depthValueEl = document.getElementById('depth-value');
const linesEl = document.getElementById('lines');
const eloEl = document.getElementById('elo');
const eloValueEl = document.getElementById('elo-value');
const eloFullEl = document.getElementById('elo-full');
const { DEPTH_MIN, DEPTH_MAX, ELO_MIN, ELO_MAX, loadSettings, saveSettings, changedSettings } = window.ChessSettings;
const ELO_START = 1500; // where the slider sits when the strength has never been set (not a setting itself)
let sliderElo = ELO_START; // the last practice strength chosen, so unchecking Full strength returns to it

function show(fen, status) {
  fenEl.textContent = fen || '';
  statusEl.textContent = status || '';
}

async function readPosition() {
  show('', 'Reading board...');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    show('', 'No active tab.');
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'READ_FEN' });
    if (response && response.ok) {
      show(response.fen, 'Side to move: ' + (response.position.sideToMove === 'w' ? 'White' : 'Black'));
    } else {
      show('', (response && response.error) || 'Could not read the board.');
    }
  } catch (err) {
    // No content script in this tab: it isn't a chess.com game or analysis page, or the page was loaded before the extension.
    show('', 'Open a chess.com game or analysis page, then reload it.');
  }
}

// Full strength (null) disables the slider; a number is the practice rating the slider shows.
function showElo(elo) {
  const full = elo === null;
  if (!full) sliderElo = elo;
  eloFullEl.checked = full;
  eloEl.disabled = full;
  eloEl.value = String(sliderElo);
  eloValueEl.textContent = full ? 'Full strength' : '~' + sliderElo + ' Elo';
}

function showSettings(settings) {
  if (settings.suggestionsEnabled !== undefined) enabledEl.checked = settings.suggestionsEnabled;
  if (settings.depth !== undefined) {
    depthEl.value = settings.depth;
    depthValueEl.textContent = settings.depth;
  }
  if (settings.lines !== undefined) linesEl.value = String(settings.lines);
  if (settings.elo !== undefined) showElo(settings.elo);
}

depthEl.min = DEPTH_MIN;
depthEl.max = DEPTH_MAX;
eloEl.min = ELO_MIN;
eloEl.max = ELO_MAX;
eloEl.step = 10;

enabledEl.addEventListener('change', () => saveSettings({ suggestionsEnabled: enabledEl.checked }));
depthEl.addEventListener('input', () => {
  depthValueEl.textContent = depthEl.value;
});
depthEl.addEventListener('change', () => saveSettings({ depth: depthEl.value }));
linesEl.addEventListener('change', () => saveSettings({ lines: Number(linesEl.value) }));
eloEl.addEventListener('input', () => {
  eloValueEl.textContent = '~' + eloEl.value + ' Elo';
});
eloEl.addEventListener('change', () => saveSettings({ elo: Number(eloEl.value) }));
eloFullEl.addEventListener('change', () => saveSettings({ elo: eloFullEl.checked ? null : sliderElo }));

// Keep the controls in step with the stored values, including changes made elsewhere.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') showSettings(changedSettings(changes));
});

document.getElementById('read').addEventListener('click', readPosition);

document.getElementById('copy').addEventListener('click', async () => {
  if (!fenEl.textContent) return;
  try {
    await navigator.clipboard.writeText(fenEl.textContent);
    statusEl.textContent = 'Copied.';
  } catch (err) {
    statusEl.textContent = 'Could not copy the FEN.';
  }
});

loadSettings().then(showSettings);
readPosition();
