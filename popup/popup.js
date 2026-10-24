const fenEl = document.getElementById('fen');
const statusEl = document.getElementById('status');
const enabledEl = document.getElementById('enabled');
const depthEl = document.getElementById('depth');
const depthValueEl = document.getElementById('depth-value');
const linesEl = document.getElementById('lines');
const { DEPTH_MIN, DEPTH_MAX, loadSettings, saveSettings, changedSettings } = window.ChessSettings;

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

function showSettings(settings) {
  if (settings.suggestionsEnabled !== undefined) enabledEl.checked = settings.suggestionsEnabled;
  if (settings.depth !== undefined) {
    depthEl.value = settings.depth;
    depthValueEl.textContent = settings.depth;
  }
  if (settings.lines !== undefined) linesEl.value = String(settings.lines);
}

depthEl.min = DEPTH_MIN;
depthEl.max = DEPTH_MAX;

enabledEl.addEventListener('change', () => saveSettings({ suggestionsEnabled: enabledEl.checked }));
depthEl.addEventListener('input', () => {
  depthValueEl.textContent = depthEl.value;
});
depthEl.addEventListener('change', () => saveSettings({ depth: depthEl.value }));
linesEl.addEventListener('change', () => saveSettings({ lines: Number(linesEl.value) }));

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
