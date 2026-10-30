// Runs in Influenzer's own page context and keeps a read-only copy of the
// JSON the app loads (profile stats, audience splits), so numbers that are
// only drawn as charts can be read. It never changes what the app receives:
// fetch returns the app's original promise untouched. Nothing leaves your browser.
(() => {
  if (window.__CXQ_CAP__) return;
  window.__CXQ_CAP__ = true;
  const buf = [];
  const keep = (url, text) => {
    try {
      if (!text || text.length > 4e6) return;
      const t = String(text).trim();
      if (t[0] !== '{' && t[0] !== '[') return;
      const item = { __cxq: 'api', url: String(url || ''), body: t, at: Date.now() + Math.random() };
      buf.push(item);
      if (buf.length > 80) buf.shift();
      window.postMessage(item, location.origin);
    } catch (_) {}
  };

  try {
    const of = window.fetch;
    if (typeof of === 'function') {
      const wrapped = function () {
        const p = of.apply(this, arguments);
        try {
          p.then((res) => {
            try {
              const ct = (res.headers && res.headers.get('content-type')) || '';
              if (/json/i.test(ct) && !res.bodyUsed) res.clone().text().then((t) => keep(res.url, t), () => {});
            } catch (_) {}
          }, () => {});
        } catch (_) {}
        return p; // the app's own promise, unchanged
      };
      try {
        Object.defineProperty(wrapped, 'name', { value: 'fetch' });
        wrapped.toString = () => of.toString();
      } catch (_) {}
      window.fetch = wrapped;
    }
  } catch (_) {}

  // XHR (axios etc.): only listens for finished responses.
  try {
    const oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      try {
        this.addEventListener('loadend', () => {
          try {
            if (this.readyState !== 4) return;
            if (this.responseType === '' || this.responseType === 'text') keep(this.responseURL, this.responseText);
            else if (this.responseType === 'json' && this.response) keep(this.responseURL, JSON.stringify(this.response));
          } catch (_) {}
        });
      } catch (_) {}
      return oSend.apply(this, arguments);
    };
  } catch (_) {}

  // The extension's script loads later; it asks for anything captured before it arrived.
  window.addEventListener('message', (e) => {
    try {
      if (e.source === window && e.data && e.data.__cxq === 'dump') buf.forEach((b) => window.postMessage(b, location.origin));
    } catch (_) {}
  });
})();
