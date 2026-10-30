import { extractHandles } from './parse.js';
import { APP, SEARCH_URL, profileUrl, getSettings } from './settings.js';
import { getSheet, inSheet, upsertRecord, setStatus, addHandles } from './sheet-store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSheets = (url) => /^https:\/\/docs\.google\.com\/spreadsheets\//.test(url || '');
const SOURCE = {
  selection: 'from your selection',
  page: 'from the Instagram page you’re on',
  sheets: 'from your selected cells',
  clipboard: 'from your clipboard (nothing was selected)',
  popup: 'from the popup',
  link: 'from the link you right-clicked'
};
const plural = (n) => `${n} creator${n === 1 ? '' : 's'}`;
const listOf = (h) => h.slice(0, 5).map((x) => '@' + x).join(', ') + (h.length > 5 ? ` +${h.length - 5} more` : '');

// ---------- setup ----------
chrome.runtime.onInstalled.addListener(async (details) => {
  // v1.3: searching by typing is now the default (direct links can load blank).
  if (details.reason === 'update' && details.previousVersion && details.previousVersion.localeCompare('1.3.0', undefined, { numeric: true }) < 0) {
    await chrome.storage.sync.set({ navMode: 'type' });
    await chrome.storage.local.remove('directBroken');
  }
  chrome.contextMenus.removeAll(() => {
    const contexts = ['link', 'selection', 'page'];
    chrome.contextMenus.create({ id: 'ifz-search', title: 'Search in Influenzer', contexts });
    chrome.contextMenus.create({
      id: 'ifz-unlock',
      title: 'Search + unlock audience in Influenzer (uses credits)',
      contexts
    });
  });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.session.remove(`task:${tabId}`);
  await queueTabFinished(tabId, 'error');
});

// ---------- entry points ----------
// 1) Chrome-level shortcuts (work everywhere, incl. address bar / new tab)
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'search-creators' && command !== 'unlock-audience') return;
  tab = tab || (await activeTab());
  const picked = await collect(tab);
  await start(picked, command === 'unlock-audience', tab);
});

// 2) Custom in-page hotkeys (content/hotkeys.js)
async function onPageHotkey(msg, tab) {
  const picked = await collect(tab, { text: msg.text, fromPage: true, copiedInPage: msg.copied });
  return start(picked, msg.action === 'unlock', tab);
}

// 3) Right-click menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let picked = { handles: [], source: 'link' };
  if (info.linkUrl) picked.handles = extractHandles(info.linkUrl, { allowBare: false });
  if (!picked.handles.length) picked = await collect(tab, { text: info.selectionText || '' });
  await start(picked, info.menuItemId === 'ifz-unlock', tab);
});

// ---------- collecting creators ----------
function grabSelection() {
  const out = [];
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    out.push(sel.toString());
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      r.cloneContents().querySelectorAll('a[href]').forEach((a) => out.push(a.href));
      const anc = r.commonAncestorContainer;
      const el = anc.nodeType === 1 ? anc : anc.parentElement;
      const a = el && el.closest && el.closest('a[href]');
      if (a) out.push(a.href);
    }
  }
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && /^(text|url|search)$/i.test(ae.type)))) {
    try {
      const s = ae.value.slice(ae.selectionStart, ae.selectionEnd);
      if (s) out.push(s);
    } catch (_) {}
  }
  return out.join('\n');
}

async function selectionFromTab(tab) {
  if (!tab || tab.id == null) return '';
  const run = (allFrames) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, func: grabSelection });
  let results = [];
  try {
    results = await run(true);
  } catch (_) {
    try {
      results = await run(false);
    } catch (_) {
      return '';
    }
  }
  return results.map((r) => (r && r.result) || '').join('\n');
}

// Ask Google Sheets to copy the selected cells so we can read them.
async function sheetsCopy(tab) {
  try {
    await Promise.race([chrome.tabs.sendMessage(tab.id, { type: 'sheetsCopy' }), sleep(700)]);
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        if (document.hasFocus()) {
          try {
            document.execCommand('copy');
          } catch (_) {}
        }
      }
    });
  } catch (_) {}
  await sleep(250);
}

/**
 * Figures out which creators you meant and where they came from.
 * Order: selection → Instagram page you're on → (Sheets cells / clipboard).
 * Clipboard picks always get a preview so stale clipboard data is never used silently.
 */
async function collect(tab, { text = '', fromPage = false, copiedInPage = false, clipboard = true } = {}) {
  const s = await getSettings();
  const url = (tab && tab.url) || '';
  const sheets = isSheets(url);

  if (!sheets) {
    const sel = fromPage ? text : [text, await selectionFromTab(tab)].join('\n');
    let handles = extractHandles(sel);
    if (handles.length) return { handles, source: 'selection' };
    handles = extractHandles(url, { allowBare: false });
    if (handles.length) return { handles, source: 'page' };
    if (!clipboard || !s.clipboardFallback) return { handles: [], source: 'none' };
  } else {
    if (!clipboard) return { handles: [], source: 'none' };
    if (!copiedInPage) await sheetsCopy(tab);
  }

  const clip = await readClipboard();
  const ctext = clip ? [clip.text, ...(clip.links || [])].join('\n') : '';
  const handles = extractHandles(ctext);
  if (!handles.length) return { handles: [], source: sheets ? 'sheets' : 'none' };
  const { lastClip } = await chrome.storage.session.get('lastClip');
  await chrome.storage.session.set({ lastClip: ctext });
  if (sheets) return { handles, source: 'sheets', preview: ctext === lastClip };
  return { handles, source: 'clipboard', preview: true };
}

async function readClipboard() {
  try {
    let has = false;
    try {
      has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
    } catch (_) {}
    if (!has) {
      try {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['CLIPBOARD'],
          justification: 'Read Instagram links you copied (e.g. from Google Sheets) when you press the hotkey.'
        });
      } catch (_) {}
    }
    return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'readClipboard' });
  } catch (_) {
    return null;
  }
}

// ---------- feedback ----------
async function tell(tab, text, kind = 'info', title = 'CultureX Quick Search') {
  if (tab && tab.id != null) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'toast', text, kind }, { frameId: 0 });
      return;
    } catch (_) {}
  }
  notify(title, text);
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon128.png'),
    title,
    message,
    priority: 0
  });
}

// ---------- running ----------
async function start(picked, unlock, tab) {
  const { handles, source } = picked;
  if (!handles.length) {
    const tip = isSheets(tab && tab.url)
      ? 'Couldn’t read the selected cells. Copy them first, then press the hotkey again.'
      : 'No Instagram creators found. Select profile links, @handles or usernames and press the hotkey again.';
    await tell(tab, tip, 'warn', 'No creators found');
    return { ok: false, handles: [], source };
  }
  const s = await getSettings();
  const needsConfirm = (unlock && s.confirmCredits) || picked.preview;
  if (needsConfirm) {
    await openConfirm(handles, unlock, source);
    if (tab) await tell(tab, `Found ${plural(handles.length)} ${SOURCE[source] || ''}: ${listOf(handles)}. Check the window that just opened.`);
    return { ok: true, confirming: true, handles, source };
  }
  if (tab) await tell(tab, `Opening ${plural(handles.length)} ${SOURCE[source] || ''}: ${listOf(handles)}`, 'ok');
  return runBatch(handles, unlock);
}

async function openConfirm(handles, unlock, source) {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`confirm:${id}`]: { handles, unlock, source, sourceText: SOURCE[source] || '' } });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`confirm.html?id=${id}`),
    type: 'popup',
    width: 440,
    height: 560,
    focused: true
  });
}

async function activeTab() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [t] = await chrome.tabs.query({ active: true, windowId: win.id });
    return t;
  } catch (_) {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t;
  }
}

async function effectiveMode(s) {
  if (s.navMode !== 'direct') return s.navMode;
  const { directBroken } = await chrome.storage.local.get('directBroken');
  return directBroken ? 'type' : 'direct';
}

async function openCreatorTab(h, { unlock, mode, collect, autoClose = false, sheetRun = false, active = false, windowId, index }) {
  const tab = await chrome.tabs.create({
    url: mode === 'type' ? SEARCH_URL : profileUrl(h),
    active,
    ...(windowId != null ? { windowId } : {}),
    ...(index != null ? { index } : {})
  });
  await chrome.storage.session.set({
    [`task:${tab.id}`]: {
      handle: h, unlock, mode, collect, autoClose, sheetRun,
      url: profileUrl(h), navAttempts: 0, createdAt: Date.now()
    }
  });
  await addHistory({ handle: h, unlock, status: 'opening', tabId: tab.id, at: Date.now() });
  return tab;
}

async function runBatch(handles, unlock) {
  const s = await getSettings();
  const mode = await effectiveMode(s);
  let list = [...new Set(handles)];
  if (list.length > s.maxTabs) {
    notify(`Opening the first ${s.maxTabs} of ${list.length}`, `Your limit is ${s.maxTabs} creators per batch (change it in Settings, or use the Sheet's Fill to process long lists).`);
    list = list.slice(0, s.maxTabs);
  }

  const cur = await activeTab();
  const tabIds = [];
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    const collect = unlock ? s.addUnlocksToSheet : s.addSearchesToSheet || (await inSheet(h));
    const tab = await openCreatorTab(h, {
      unlock, mode, collect,
      active: !s.openInBackground && i === 0,
      windowId: cur ? cur.windowId : undefined,
      index: cur ? cur.index + 1 + i : undefined
    });
    tabIds.push(tab.id);
    if (i < list.length - 1) await sleep(s.staggerMs);
  }

  if (s.groupTabs && tabIds.length > 1) {
    try {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: unlock ? `Influenzer · audience (${tabIds.length})` : `Influenzer (${tabIds.length})`,
        color: unlock ? 'orange' : 'purple'
      });
    } catch (_) {}
  }
  return { ok: true, opened: list.length, handles: list };
}

// ---------- sheet fill queue ----------
// Processes a long list a few creators at a time; each tab saves its data and closes.
let pumpChain = Promise.resolve();
const pump = () => (pumpChain = pumpChain.then(pumpOnce, pumpOnce));

async function startFill(handles, unlock) {
  const { queue } = await chrome.storage.local.get('queue');
  if (queue) return { ok: false, error: 'A fill is already running.' };
  const list = [...new Set(handles)];
  if (!list.length) return { ok: false, error: 'Nothing to fill.' };
  await setStatus(list, 'queued');
  await chrome.storage.local.set({
    queue: { pending: list, active: {}, unlock, total: list.length, done: 0, groupId: null, windowId: null, startedAt: Date.now() }
  });
  await pump();
  return { ok: true, total: list.length };
}

async function pumpOnce() {
  const { queue: q } = await chrome.storage.local.get('queue');
  if (!q) return;
  const s = await getSettings();
  const mode = await effectiveMode(s);
  if (q.windowId == null) {
    const cur = await activeTab();
    q.windowId = cur ? cur.windowId : undefined;
  }
  while (Object.keys(q.active).length < Math.max(1, s.concurrency) && q.pending.length) {
    const h = q.pending.shift();
    let tab;
    try {
      tab = await openCreatorTab(h, { unlock: q.unlock, mode, collect: true, autoClose: s.autoCloseTabs, sheetRun: true, windowId: q.windowId });
    } catch (_) {
      tab = await openCreatorTab(h, { unlock: q.unlock, mode, collect: true, autoClose: s.autoCloseTabs, sheetRun: true });
    }
    q.active[tab.id] = h;
    await setStatus([h], 'running');
    try {
      q.groupId = await chrome.tabs.group(q.groupId != null ? { tabIds: [tab.id], groupId: q.groupId } : { tabIds: [tab.id] });
      await chrome.tabGroups.update(q.groupId, { title: 'CultureX sheet fill', color: 'orange', collapsed: false });
    } catch (_) {
      q.groupId = null;
    }
  }
  if (!q.pending.length && !Object.keys(q.active).length) {
    await chrome.storage.local.remove('queue');
    const sheet = await getSheet();
    const filled = sheet.rows.filter((r) => r.status === 'filled').length;
    notify('Sheet fill finished', `${q.done} creator${q.done === 1 ? '' : 's'} processed · ${filled} fully filled. Open the Sheet to review and export.`);
    return;
  }
  await chrome.storage.local.set({ queue: q });
}

async function queueTabFinished(tabId, status) {
  const { queue: q } = await chrome.storage.local.get('queue');
  if (!q || !(tabId in q.active)) return false;
  const h = q.active[tabId];
  delete q.active[tabId];
  q.done++;
  await chrome.storage.local.set({ queue: q });
  if (status) await setStatus([h], status, (r) => r.status === 'running');
  await pump();
  return true;
}

async function stopFill() {
  const { queue: q } = await chrome.storage.local.get('queue');
  if (!q) return true;
  const left = q.pending;
  q.pending = [];
  await chrome.storage.local.set({ queue: q });
  await setStatus(left, 'pending', (r) => r.status === 'queued');
  await pump();
  return true;
}

// ---------- history / status ----------
async function addHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift(entry);
  await chrome.storage.local.set({ history: history.slice(0, 50) });
}

async function updateHistory(tabId, patch) {
  const { history = [] } = await chrome.storage.local.get('history');
  const e = history.find((x) => x.tabId === tabId);
  if (e) Object.assign(e, patch, { updatedAt: Date.now() });
  await chrome.storage.local.set({ history });
}

async function setAuth(state) {
  await chrome.storage.local.set({ auth: { state, at: Date.now() } });
  if (state === 'out') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.action.setTitle({ title: 'CultureX Quick Search: log in to Influenzer' });
  } else if (state === 'in') {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'CultureX Quick Search' });
  }
}

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  const tabId = sender.tab && sender.tab.id;
  const key = `task:${tabId}`;

  (async () => {
    switch (msg.type) {
      case 'hotkey':
        return onPageHotkey(msg, sender.tab);
      case 'getTask':
        if (tabId == null) return null;
        return (await chrome.storage.session.get(key))[key] || null;
      case 'updateTask': {
        const t = (await chrome.storage.session.get(key))[key];
        if (t) await chrome.storage.session.set({ [key]: { ...t, ...msg.patch } });
        return true;
      }
      case 'directBroken':
        await chrome.storage.local.set({ directBroken: true });
        return true;
      case 'taskStatus':
        await updateHistory(tabId, { status: msg.status, note: msg.note || '' });
        return true;
      case 'taskDone': {
        await updateHistory(tabId, { status: msg.status, note: msg.note || '' });
        const task = (await chrome.storage.session.get(key))[key];
        await chrome.storage.session.remove(key);
        const bad = ['error', 'not-found'].includes(msg.status);
        if (task && task.sheetRun) {
          if (bad) await setStatus([task.handle], msg.status === 'not-found' ? 'not-found' : 'error', (r) => r.status === 'running');
          await queueTabFinished(tabId, null);
          if (task.autoClose && !bad) setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 1200);
        }
        return true;
      }
      case 'record': {
        const task = (await chrome.storage.session.get(key))[key];
        await upsertRecord(msg.record, { create: !!(task && task.collect) });
        if (msg.debug) await chrome.storage.local.set({ [`debug:${msg.record.handle}`]: msg.debug });
        return true;
      }
      case 'addToSheet':
        return addHandles(msg.handles || []);
      case 'fillSheet':
        return startFill(msg.handles, !!msg.unlock);
      case 'stopFill':
        return stopFill();
      case 'openSheet':
        await chrome.tabs.create({ url: chrome.runtime.getURL('sheet.html') });
        return true;
      case 'authState':
        await setAuth(msg.state);
        return true;
      case 'credits':
        await chrome.storage.local.set({ credits: { value: msg.value, at: Date.now() } });
        return true;
      case 'collectActive': // popup prefill: selection or IG page only, never the clipboard
        return collect(await activeTab(), { clipboard: false });
      case 'runBatch':
        return msg.skipConfirm
          ? runBatch(msg.handles, !!msg.unlock)
          : start({ handles: msg.handles, source: 'popup' }, !!msg.unlock, null);
      default:
        return null;
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});
