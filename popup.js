import { extractHandles } from './parse.js';
import { APP, profileUrl } from './settings.js';
import { OS } from './hotkeys.js';
import { mountHotkeyEditor } from './hotkey-editor.js';

const $ = (s) => document.querySelector(s);
const input = $('#input');

const STATUS = {
  opening: ['Opening', 'busy'],
  'waiting-login': ['Waiting for login', 'warn'],
  loading: ['Loading', 'busy'],
  unlocking: ['Unlocking', 'busy'],
  loaded: ['Loaded', 'ok'],
  unlocked: ['Audience unlocked', 'ok'],
  'already-unlocked': ['Already unlocked', 'ok'],
  'unlock-clicked': ['Check audience', 'warn'],
  'no-unlock-button': ['No unlock button', 'warn'],
  'not-found': ['Not found', 'err'],
  error: ['Error', 'err']
};

function handles() {
  return extractHandles(input.value);
}

function updateCount() {
  const h = handles();
  $('#count').textContent = h.length
    ? `${h.length} creator${h.length > 1 ? 's' : ''}: ${h.slice(0, 6).map((x) => '@' + x).join(', ')}${h.length > 6 ? '…' : ''}`
    : 'Nothing detected yet';
  $('#searchBtn').disabled = $('#unlockBtn').disabled = $('#addSheetBtn').disabled = !h.length;
  $('#searchBtn').textContent = h.length > 1 ? `Search ${h.length}` : 'Search';
}

function renderAuth(auth, credits) {
  const pill = $('#auth');
  const state = auth && auth.state;
  pill.className = 'pill' + (state === 'in' ? ' in' : state === 'out' ? ' out' : '');
  pill.lastElementChild.textContent =
    state === 'in' ? 'Logged in' : state === 'out' ? 'Logged out' : 'Not checked yet';
  $('#login').classList.toggle('show', state !== 'in');
  $('#login span').textContent =
    state === 'out' ? 'You’re logged out of Influenzer.' : 'Open Influenzer once so the extension can see your login.';
  const c = $('#credits');
  if (credits && credits.value) {
    c.hidden = false;
    c.textContent = `My Credits: ${credits.value}`;
  }
}

function renderHistory(history = []) {
  $('#recentWrap').hidden = !history.length;
  const box = $('#history');
  box.innerHTML = '';
  for (const e of history.slice(0, 10)) {
    const [label, cls] = STATUS[e.status] || [e.status, ''];
    const a = document.createElement('a');
    a.className = 'item';
    a.title = e.note || '';
    a.innerHTML = `<span></span><span class="status ${cls}"></span>`;
    a.firstChild.textContent = '@' + e.handle + (e.unlock ? '  ·  audience' : '');
    a.lastChild.textContent = label;
    a.onclick = () => chrome.tabs.create({ url: profileUrl(e.handle) });
    box.appendChild(a);
  }
}

async function run(unlock) {
  const h = handles();
  if (!h.length) return;
  await chrome.runtime.sendMessage({ type: 'runBatch', handles: h, unlock });
  window.close();
}

(async () => {
  const { auth, credits, history } = await chrome.storage.local.get(['auth', 'credits', 'history']);
  renderAuth(auth, credits);
  renderHistory(history);
  mountHotkeyEditor($('#hotkeys'));
  $('#tip').textContent = `Select links or usernames on any page and press your hotkey. In Google Sheets, just select the cells. If it ever picks the wrong ones, copy them first (${OS === 'mac' ? '⌘C' : 'Ctrl+C'}).`;
  updateCount();

  // Prefill from whatever is selected on the current page (or the IG profile you're on).
  try {
    const pre = await chrome.runtime.sendMessage({ type: 'collectActive' });
    if (pre && pre.handles && pre.handles.length && !input.value.trim()) {
      input.value = pre.handles.map((x) => '@' + x).join('\n');
      updateCount();
    }
  } catch (_) {}
})();

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const { auth, credits, history } = await chrome.storage.local.get(['auth', 'credits', 'history']);
  if (changes.auth || changes.credits) renderAuth(auth, credits);
  if (changes.history) renderHistory(history);
});

input.addEventListener('input', updateCount);
input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(e.shiftKey);
});
$('#searchBtn').onclick = () => run(false);
$('#addSheetBtn').onclick = async () => {
  const h = handles();
  if (!h.length) return;
  const n = await chrome.runtime.sendMessage({ type: 'addToSheet', handles: h });
  $('#count').textContent = `Added ${n} to the sheet${h.length - n ? ` (${h.length - n} already there)` : ''}. Open the sheet and click Fill.`;
  refreshSheetCount();
};
$('#unlockBtn').onclick = () => run(true);
$('#loginBtn').onclick = $('#openApp').onclick = () => chrome.tabs.create({ url: APP });
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#sheetBtn').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('sheet.html') });
  window.close();
};
function refreshSheetCount() {
  chrome.storage.local.get('sheet').then(({ sheet }) => {
    const n = sheet && sheet.rows ? sheet.rows.length : 0;
    $('#sheetCount').textContent = n ? `${n} creator${n === 1 ? '' : 's'}` : 'empty';
  });
}
refreshSheetCount();
