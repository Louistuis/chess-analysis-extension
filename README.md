# Chess.com Position Reader

A Chrome extension (Manifest V3) that reads the chess.com board, asks a bundled Stockfish engine for its best lines, and draws them as numbered, colour-coded arrows over the board, with an analysis panel (eval bar, a table of the top lines, live depth, nodes and nodes per second).

It is for **analysis, practice and learning**. It does not play moves or click anything. It is not meant for live rated games: using engine help in a live rated game breaks chess.com's fair play rules.

This project is not affiliated with, endorsed by or sponsored by chess.com. It is a suggestion-only analysis tool: it shows arrows, numbers and scores, and never clicks or moves pieces. It is not for use in live rated games.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (version 116 or newer).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this project folder (the one that contains `manifest.json`).
4. Pin the extension from the puzzle-piece menu if you want the popup one click away.

After editing any file in the folder, click the reload arrow on the extension's card in `chrome://extensions`.

## Using it

- Open a game or analysis page on `https://www.chess.com/` (`/game/...` or `/analysis/...`). Each of the top lines (up to five) is drawn as an arrow over the board, numbered 1 to 5 at its tip. The colour shows how far the line is behind the best one: green for the best line, through yellow, to red at 300 centipawns or more behind. Each arrow has its score next to its end square. When two lines end on the same square, their numbers and scores are spread apart. They update as the position changes.
- The **analysis panel** sits beside the board, on whichever side has more room, or below or above it. It never covers the board: if the full panel doesn't fit, it shows as a small tab in one of those gaps, and if there is no gap at all (the board fills the window) it is hidden and comes back when the window changes. Its **▾ / ▸** button collapses it to the header, and it remembers that choice:
  - an eval bar and score from White's side, and a table of the top lines: rank, move in SAN, score, gap to the best line in centipawns (or "mate"), and depth. Hover a row to see the whole line;
  - **win / draw / loss** percentages for the best line, from the engine's `UCI_ShowWDL` output;
  - the **opening** the game is in, from a small bundled table of common openings (not the full ECO list), or "not in the bundled table";
  - a scrolling **game so far** list: for each position seen on the page, the move number, the engine's best move and its score;
  - a raw **technical row** (depth, seldepth, nodes, nps, hashfull, time), updated live while the engine searches.
- **Faster suggestions.** The engine keeps its hash table between positions, a search for a position you have already left is stopped the moment the board changes, and the lines found so far are drawn while the search is still running (the panel shows a depth bar towards your chosen depth). A position you have already looked at comes back from a cache without searching again.
- **Clearer analysis.** The panel opens with the score, a plain-words verdict ("White is slightly better", "Black mates in 3") and the best move. Each line has a label under it (Best, Equally strong, Playable, Worse, Poor) and its first moves. An evaluation graph shows White's win chance through the game, and a **Game review** gives each side an accuracy score, counts of inaccuracies, mistakes and blunders, and lists the moves that cost the most, with the engine's choice. Inaccuracy, mistake and blunder mean 5, 10 and 15 percentage points of win chance lost, and the review only covers positions the extension saw one move after another.
- **Opponent check.** From the moves the extension has seen, the panel shows how often the other side's moves match the engine's first choice, their average loss per move, a rough rating estimate (from the average loss, with a plus/minus range that narrows as moves add up) and a signal: collecting, nothing unusual, unusually engine-like or very engine-like. Opening moves and already decided positions are left out, and nothing is shown until there are 12 moves to judge. It is a hint, not proof: strong players and forced positions also match the engine often, the engine here is a shallow lite build, and the rating estimate ignores how hard the positions were. Do not accuse anyone on this alone; report suspected cheating to the site.
- Click the extension icon to open the popup:
  - **Current position**: the FEN of the board, with **Read again** and **Copy FEN**.
  - **Show suggested move**: the on/off switch. Off removes the arrows and the panel, and stops new searches from starting (a search already running finishes).
  - **Search depth**: 8 to 20, default 12. Deeper is stronger but slower. A new depth applies to the next search.
  - **Lines shown**: 1 to 5 (default 3). The engine searches that many lines (MultiPV), and each one gets an arrow and a table row.
  - The note at the bottom repeats the rules above.

## Running the tests

You need Node.js (a recent version with `node --test`).

```sh
npm install
npm test
```

The tests use `node:test` and jsdom. They include tests that run the real vendored Stockfish build as a child process, so the engine tests take a few seconds.

## File map

| Path | What it does |
| --- | --- |
| `manifest.json` | Extension manifest: content script on chess.com, background worker, offscreen document, popup, permissions and CSP (`wasm-unsafe-eval` for the engine). |
| `src/chess-reader.js` | Reads the board from the DOM and builds the FEN (pieces, side to move, castling, en passant, move numbers). |
| `src/content.js` | Watches the board (debounced), asks for a suggestion when the position changes, and reacts to the on/off, depth and lines settings, keeps the game history (restarted when the URL path changes), and feeds the arrows and the panel. |
| `src/overlay.js` | Square-to-coordinate maths, arrow shapes, the colour scale by gap to the best line, the plan for numbered arrows and their score labels (where numbers and labels go when lines share a square), the stale-answer tracker, and the SVG arrows drawn over the board. |
| `src/panel.js` | The analysis panel: score, eval-bar and WDL formatting, the model built from a search, the opening and history sections, the technical row, and the panel itself in a shadow root. |
| `src/openings-data.js` | The bundled table of common openings: ECO code, name and the moves in SAN. Hand-picked, not the full ECO list. |
| `src/openings.js` | Names a position's opening by playing the table through chess.js and keying each position (placement, side, castling). |
| `src/review.js` | Works out which move was played between two positions, how much win chance it cost, and each side's accuracy and counts of inaccuracies, mistakes and blunders. |
| `src/history.js` | The positions seen on the page so far, with the engine's best move and score for each; a position seen again updates its entry. |
| `src/san.js` | Turns the engine's UCI lines into SAN (e.g. `1. e4 e5 2. Nf3`) using chess.js. |
| `src/settings.js` | Settings in `chrome.storage.local` (`suggestionsEnabled`, `depth`, `lines`): defaults, clamping and change handling. |
| `src/background.js` | Service worker: starts the offscreen document, reads the stored settings, passes searches on to the engine, and relays live progress to the tab. |
| `offscreen/` | Offscreen document that owns the Stockfish Web Worker (a Worker can't run in a service worker). |
| `src/engine/engine.js` | UCI wrapper for the engine: FEN validation (including adjacent kings), MultiPV search, the evaluations (from White's side), progress reports, timeouts, and worker failures. |
| `vendor/stockfish/` | The Stockfish 19 lite single-threaded build (JS and WASM) and its licence. |
| `vendor/chess/` | chess.js 1.4.0 (used for SAN and legality) and its licence. |
| `popup/` | The popup: FEN display, copy button, on/off switch, depth slider, lines selector and the note. |
| `test/` | Unit and end-to-end tests (`npm test`). |

## Licences

- **Project code** (everything outside `vendor/`) is licensed under the **MIT licence**. The full text is in [LICENSE](LICENSE), with copyright held by Louistuis.
- **`vendor/stockfish/`** is the Stockfish engine, licensed under **GPL-3.0**. The files are the lite, single-threaded build (`stockfish-19-lite-single.js` and `.wasm`) from [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) release **v19.0.1** (npm package `stockfish` 19.0.1; the bundled files match it byte for byte). That build is based on [Stockfish](https://github.com/official-stockfish/Stockfish) 19 (tag `sf_19`). Its licence text is in `vendor/stockfish/LICENSE-stockfish.txt`.
- **`vendor/chess/`** is chess.js 1.4.0, licensed under **BSD-2-Clause**, with its licence text in `vendor/chess/LICENSE-chess.js.txt`.
- **The release zip is not purely MIT.** It includes the Stockfish files in `vendor/stockfish/`, which stay under their GPL-3.0 terms. Anyone who redistributes the zip has to follow GPL-3.0 for those files, and MIT covers only the project's own code.

## Not yet checked in real Chrome on live chess.com

Everything below was tested in Node with jsdom and fixtures, or not at all. Please check these first, in this order:

1. **Board selectors.** The DOM reading assumes chess.com's current markup: `wc-chess-board` / `.board`, pieces as `.piece wk square-51`, last-move highlights as `.highlight`, `.clock-player-turn` with `clock-top` / `clock-bottom`, `data-ply` for the move count, and `.flipped` for a turned board. These were written from memory of the markup and have not been checked on a live page.
2. **Arrow alignment.** The SVG overlay is placed over the `.board` element and assumes it covers the 8 x 8 squares exactly. Chess.com's own CSS could clip it, cover it, or offset it, and a flipped board or a resized window may misplace it.
3. **Engine loading in the extension.** The Stockfish Worker, its WASM load from `vendor/stockfish/`, the offscreen document, and the `wasm-unsafe-eval` CSP have only been run in Node. Check the service worker console and the offscreen document's console for load errors.
4. **Search speed.** The lite engine's time per search at depths 8 to 20 in the browser is unmeasured. Depth 20 may be slow enough to matter, and a slow search leaves the previous arrow hidden until the answer arrives.
5. **Settings and progress across contexts.** The popup, background and content script reacting to a change without a reload, and the live progress path (offscreen → background → tab), have only been checked with fake Chrome APIs.
5a. **Analysis panel.** It is placed from the board's on-screen box, beside it, below or above, as a tab, or hidden. Check on a live page that this works with chess.com's own side panels, clock and move list, and that the stats update at a comfortable rate.
5b. **Multi-line search speed.** Searching 5 lines is slower than 1. The time per update at depth 8 to 20 in the browser is unmeasured.
5e. **Numbered arrows.** The numbers, colours and corner score labels are placed by the maths in `src/overlay.js` and checked in Node. Check on a live board that the numbers and labels are readable at the board's size, and that the arrows for lines that share a square stay apart.
5c. **Opening names.** The ECO codes and names in `src/openings-data.js` were written from memory of common ECO naming and need a check against a reference. The table only covers its own lines, so most games will show "not in the bundled table" after the first few moves.
5d. **Game history.** The history lives in the page and starts again when the page's URL path changes (a new game gets its own URL). Check that this holds on a real game, a rematch and the analysis board. WDL and the technical row have only been seen from the engine's output in Node, not on a live page.
6. **Observer load.** The MutationObserver watches the whole page for class changes, including clock ticks. Check that this doesn't slow the page noticeably.
7. **Match pattern.** The content script matches `https://www.chess.com/*`, which is wider than the game and analysis pages. Check that it behaves sensibly on other chess.com pages.
8. **Faster suggestions and the panel redesign.** The partial-result stream (engine to offscreen to background to tab), the depth bar, the position cache and the 150 ms debounce were tested in Node with the real engine and jsdom, not in Chrome. Check on a live page that the arrows updating several times a second don't flicker and that the 32 MB engine hash loads in the offscreen document.
9. **Game review and opponent check.** Based on win chance from a shallow search and on positions seen one move after another; the reader's FEN fields were not checked against chess.js beyond placement and side to move.
