# CultureX Quick Search (Chrome extension)

Select Instagram creators anywhere, press a hotkey, and they open in Influenzer's **Search & Analysis** page. There's an optional second hotkey that also unlocks the **Audience** tab with your credits.

## Install
1. Unzip this folder. If you installed an earlier version, **remove it first** so the new default hotkeys apply.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `culturex-quick-search` folder.
4. Pin the extension, then open https://app.influenzer.io and log in as usual. The extension uses your normal Influenzer login, and the popup will show **Logged in**.

## Use (Windows & Mac)
| Action | Default hotkey (Windows) | Default hotkey (Mac) |
|---|---|---|
| Search selected creators | `Ctrl + Shift + Y` | `⌘ + Shift + Y` |
| Search + unlock audience (uses credits, asks first) | `Ctrl + Shift + U` | `⌘ + Shift + U` |

**Set your own hotkeys:** open the extension popup (or Settings), click a hotkey and press the new combination. They're saved separately for Mac and Windows. Custom hotkeys work on any web page. Chrome's own shortcuts (shown under the hotkeys, changeable at `chrome://extensions/shortcuts`) also work in the address bar and on new-tab pages.

Each time you press the hotkey, a note in the top-right says who was picked and where they came from (your selection, the Instagram page you're on, your Sheets cells, or your clipboard).

What counts as a selection:
- **Any web page:** highlight profile links, `@handles` or usernames. Linked text works too.
- **Instagram profile:** with nothing selected, the profile you're on (address bar) is used.
- **Google Sheets:** select the cells and press the hotkey. If it ever picks the wrong cells, copy them first (`Ctrl+C` / `⌘C`).
- **Nothing selected:** it falls back to your clipboard, but always shows you the list first, so an old copied link never opens on its own.
- **Right-click** any link or selection and choose **Search in Influenzer**, or paste a list into the popup.

Creators are opened the same way you would by hand: the extension types the username into Search & Analysis and clicks the exact @username result (never look-alikes like @name_official). If a page stays blank it reloads once, and it never bounces between pages.

## Creator sheet
Open it from the popup (**📋 Open sheet**). It uses the same layout as the "Creator Collaboration – Approved List":
Sr. No. · Name · Followers · Link · Category · ER · Average Views · Top 3 Locations · 13-17 · 18-24 · 25-34 · Deliverables · Cost (plus any notes columns you import).

- **Every search** (either hotkey, the popup or right-click) saves that creator to the sheet automatically. Plain Search fills the audience columns too when that creator is already unlocked.
- **+ Add to sheet (fill later)** in the popup adds pasted creators without opening them.
- **+ Add creators:** paste links/handles, or paste cells copied from a spreadsheet.
- **Import CSV:** brings in a list. Deliverables, Cost and notes columns are kept.
- **Fill: search + unlock audience** works through every creator that isn't filled yet, a few at a time in the background, and closes each tab when done. **Fill without credits** fills everything except the audience columns.
- Deliverables, Cost and notes are yours to type. The extension never overwrites them. Name is filled only if it's empty.
- Category is set from followers: Nano < 10K, Micro < 100K, Macro < 1M, Mega 1M+.
- **Export Excel** (formatted, with merged headers, % formats and clickable links), **Export CSV**, or **Copy for Google Sheets** (then paste into cell A1).
- ↻ on a row re-fills that creator; × removes it.
- If a column comes back empty for a creator, use ⋯ → **Download debug data** and send that file over so the reader can be tuned to Influenzer's exact layout.

## Credits safety
- A confirmation window lists the creators before any credits are used. You can turn it off in Settings.
- Creators whose audience is already unlocked are skipped, so no credits are used on them.
- It never clicks buttons mentioning upgrade, buy, plan, pricing, top-up, recharge or download.

## Settings
- **Open mode:** "Direct profile link" (fast, default) or "Type into the search box". Direct mode falls back to typing automatically if a profile doesn't load.
- Max creators per batch, delay between tabs, background tabs, tab grouping, and reading the clipboard as a fallback.
- **Unlock button text / confirm button text:** if Influenzer labels the unlock button differently, add that wording here.

## Files
All files sit in one folder (no subfolders), so you can upload them to GitHub's web uploader in one go.
- `manifest.json`: extension config (name, permissions, default hotkeys)
- `background.js`: hotkeys, right-click menu, picking creators, opening tabs
- `content-hotkeys.js`: listens for your custom hotkeys on every page
- `content-influenzer.js`: runs on app.influenzer.io (login check, find profile, unlock audience)
- `parse.js`, `settings.js`, `hotkeys.js`, `hotkey-editor.js`: shared logic
- `sheet.*`, `sheet-io.js`, `sheet-store.js`, `xlsx.js`: the creator sheet, import/export and Excel writer
- `profile-parse.js`, `content-capture.js`: read the profile numbers (page text + data the app loads)
- `popup.*`, `confirm.*`, `options.*`, `ui.css`: the UI · `offscreen.*`: reads the clipboard · `icon*.png`: icons
