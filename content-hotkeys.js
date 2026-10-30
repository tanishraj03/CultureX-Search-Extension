// Runs on every page (all frames). Listens for your custom hotkeys, grabs the
// current selection, and shows a small "who was picked" toast.
(() => {
  if (window.__IFZ_HK__) return;
  window.__IFZ_HK__ = true;

  const UA = navigator.platform || navigator.userAgent || '';
  const OS = /Mac|iPhone|iPad/i.test(UA) ? 'mac' : /Win/i.test(UA) ? 'win' : 'linux';
  const KEY = `hotkeys_${OS}`;
  const def = (code) => ({ ctrl: OS !== 'mac', meta: OS === 'mac', alt: false, shift: true, code });
  let hk = { search: def('KeyY'), unlock: def('KeyU') };

  const alive = () => {
    try {
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch (_) {
      return false;
    }
  };

  function load() {
    if (!alive()) return;
    chrome.storage.sync
      .get(KEY)
      .then((r) => {
        const v = r[KEY] || {};
        hk = { search: v.search || def('KeyY'), unlock: v.unlock || def('KeyU') };
      })
      .catch(() => {});
  }
  load();
  try {
    chrome.storage.onChanged.addListener((c, area) => area === 'sync' && c[KEY] && load());
  } catch (_) {}

  const match = (e, h) =>
    !!h && e.code === h.code && e.ctrlKey === !!h.ctrl && e.altKey === !!h.alt &&
    e.shiftKey === !!h.shift && e.metaKey === !!h.meta;

  function topUrl() {
    try {
      return window.top.location.href;
    } catch (_) {
      return location.href;
    }
  }
  const isSheets = () => /^https:\/\/docs\.google\.com\/spreadsheets\//.test(topUrl());

  function grab() {
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

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;
      const action = match(e, hk.search) ? 'search' : match(e, hk.unlock) ? 'unlock' : null;
      if (!action) return;
      if (!alive()) {
        // Extension was updated/reloaded; this tab still has the old script.
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const sheets = isSheets();
      let copied = false;
      // In Sheets, cells aren't a text selection. Copying them while we still
      // have your keypress lets us read exactly the cells you selected.
      if (sheets) {
        try {
          copied = document.execCommand('copy');
        } catch (_) {}
      }
      chrome.runtime.sendMessage({ type: 'hotkey', action, text: sheets ? '' : grab(), sheets, copied }, () => {
        void chrome.runtime.lastError;
      });
    },
    true
  );

  // ---------- messages from the background ----------
  let toastBox;
  function toast(text, kind = 'info', ms = 5000) {
    if (window !== window.top || !document.body) return;
    if (!toastBox) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .t{font:500 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;background:#111;color:#fff;
           padding:11px 14px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:360px;display:flex;gap:10px}
        .d{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:#8b5cf6}
        .ok .d{background:#22c55e}.warn .d{background:#f59e0b}.err .d{background:#ef4444}
        .k{opacity:.6;font-size:11px;margin-bottom:2px}
      </style><div class="t"><span class="d"></span><div><div class="k">CultureX Quick Search</div><div class="m"></div></div></div>`;
      document.body.appendChild(host);
      toastBox = { host, root, timer: 0 };
    }
    toastBox.root.querySelector('.t').className = 't ' + kind;
    toastBox.root.querySelector('.m').textContent = text;
    toastBox.host.style.display = 'block';
    clearTimeout(toastBox.timer);
    toastBox.timer = setTimeout(() => (toastBox.host.style.display = 'none'), ms);
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (!msg) return false;
      if (msg.type === 'toast') {
        toast(msg.text, msg.kind, msg.ms);
        return false;
      }
      if (msg.type === 'sheetsCopy' && document.hasFocus()) {
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch (_) {}
        sendResponse(ok);
      }
      return false;
    });
  } catch (_) {}
})();
