import { DEFAULTS, getSettings } from './settings.js';
import { mountHotkeyEditor } from './hotkey-editor.js';

const $ = (s) => document.querySelector(s);
const keys = Object.keys(DEFAULTS);
let t;

function fill(s) {
  for (const k of keys) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = s[k];
  }
}

async function save() {
  const out = {};
  for (const k of keys) {
    const el = document.getElementById(k);
    if (!el) continue;
    out[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || DEFAULTS[k] : el.value;
  }
  await chrome.storage.sync.set(out);
  $('#saved').classList.add('show');
  clearTimeout(t);
  t = setTimeout(() => $('#saved').classList.remove('show'), 1200);
}

(async () => {
  fill(await getSettings());
  for (const k of keys) {
    const el = document.getElementById(k);
    if (el) el.addEventListener('change', save);
  }
  mountHotkeyEditor($('#hotkeys'));
  const { directBroken } = await chrome.storage.local.get('directBroken');
  $('#brokenNote').hidden = !directBroken;
})();

$('#retryDirect').onclick = async () => {
  await chrome.storage.local.remove('directBroken');
  $('#brokenNote').hidden = true;
};
$('#reset').onclick = async () => {
  await chrome.storage.sync.set(DEFAULTS);
  fill(DEFAULTS);
  save();
};

$('#openSheet').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('sheet.html') });
