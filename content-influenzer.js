// Runs on app.influenzer.io. Reports login state + credits, and carries out
// the task (open creator → optionally unlock Audience) for tabs the
// extension opened.
(() => {
  if (window.__IFZ_QS__) return;
  window.__IFZ_QS__ = true;

  const SEARCH_URL = `${location.origin}/global-search?tab=global-search&platform=instagram`;
  const DEFAULT_KW = {
    unlockKeywords:
      'unlock audience, unlock, use credit, view audience, reveal audience, get audience, show audience, unlock report, view full report',
    confirmKeywords: 'confirm, unlock, yes, proceed, continue, use credit, ok'
  };
  // Never click anything that spends money or does something destructive.
  const NEVER = /download|add to|log ?out|sign ?out|delete|remove|cancel|unlocked|upgrade|buy|purchase|top ?up|recharge|plan|pricing|subscribe|billing/i;
  const NEVER_CONFIRM = /cancel|close|^no\b|not now|later|upgrade|buy|purchase|top ?up|recharge|plan|pricing|subscribe|billing/i;

  let cfg = { unlock: [], confirm: [] };

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const bodyText = () => (document.body ? document.body.innerText || '' : '');
  const send = (msg) =>
    new Promise((res) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError;
          res(r);
        });
      } catch (_) {
        res(null);
      }
    });

  async function waitFor(fn, timeout = 20000, every = 300) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch (_) {}
      await sleep(every);
    }
    return null;
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }
  const inSidebar = (el) => !!el.closest('nav, aside, [class*="sidebar" i]');
  const DIALOG_SEL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [class*="modal" i]';
  const inDialog = (el) => !!el.closest(DIALOG_SEL);
  const label = (el) =>
    norm(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();

  function realClick(el) {
    try {
      el.scrollIntoView({ block: 'center' });
    } catch (_) {}
    const o = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', o));
    } catch (_) {}
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try {
      el.dispatchEvent(new PointerEvent('pointerup', o));
    } catch (_) {}
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }

  function setNativeValue(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressEnter(el) {
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
    const form = el.closest('form');
    if (form && form.requestSubmit) {
      try {
        form.requestSubmit();
      } catch (_) {}
    }
  }

  // ---------- toast ----------
  let toastBox;
  function toast(msg, kind = 'info', ms = 4500) {
    if (!document.body) return;
    if (!toastBox) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .t{font:500 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;background:#111;color:#fff;
           padding:12px 14px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:340px;display:flex;gap:10px}
        .d{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:#8b5cf6}
        .ok .d{background:#22c55e}.warn .d{background:#f59e0b}.err .d{background:#ef4444}
        .k{opacity:.6;font-size:11px;letter-spacing:.02em;margin-bottom:2px}
      </style><div class="t"><span class="d"></span><div><div class="k">CultureX Quick Search</div><div class="m"></div></div></div>`;
      document.body.appendChild(host);
      toastBox = { host, root, timer: 0 };
    }
    toastBox.root.querySelector('.t').className = 't ' + kind;
    toastBox.root.querySelector('.m').textContent = msg;
    toastBox.host.style.display = 'block';
    clearTimeout(toastBox.timer);
    if (ms) toastBox.timer = setTimeout(() => (toastBox.host.style.display = 'none'), ms);
  }

  // ---------- login + credits watcher ----------
  function authState() {
    if (
      /\/(login|log-in|signin|sign-in|signup|sign-up|register|auth|forgot|reset)/i.test(location.pathname) ||
      document.querySelector('input[type="password"]')
    )
      return 'out';
    if (/Influencers Suite|Search & Analysis|My Credits|Influencer Profile Analysis/i.test(bodyText())) return 'in';
    return 'unknown';
  }

  let lastAuth = null;
  let lastCredits = null;
  function watchTick() {
    const st = authState();
    if (st !== 'unknown' && st !== lastAuth) {
      lastAuth = st;
      send({ type: 'authState', state: st });
    }
    const m = bodyText().match(/My Credits:?\s*([\d.,]+)/i);
    if (m && m[1] !== lastCredits) {
      lastCredits = m[1];
      send({ type: 'credits', value: m[1] });
    }
  }
  setTimeout(watchTick, 300);
  setInterval(watchTick, 1500);

  // ---------- page detection ----------
  const onProfilePath = (h) => {
    let p = location.pathname;
    try {
      p = decodeURIComponent(p);
    } catch (_) {}
    return p.toLowerCase().replace(/\/+$/, '') === `/global-search/${h}`;
  };
  const profileLoaded = (h) => {
    const t = bodyText();
    return onProfilePath(h) && t.toLowerCase().includes('@' + h) && /Overview/.test(t) && /Audience/.test(t);
  };
  // Profile page is showing, but it's someone else's (no @handle match).
  const wrongProfile = (h) => {
    const t = bodyText();
    return /Influencer Profile Analysis/i.test(t) && /@[a-z0-9._]{2,30}/i.test(t) && !t.toLowerCase().includes('@' + h);
  };
  const notFound = () =>
    /no (influencer|profile|data|results?) found|profile not found|user not found|does ?n[o']?t exist|invalid username/i.test(
      bodyText()
    );

  function findSearchInput() {
    return [...document.querySelectorAll('input')].find(
      (i) => visible(i) && /name or username|username|search/i.test(i.placeholder || i.getAttribute('aria-label') || '')
    );
  }

  function findResult(h) {
    const cands = [
      ...document.querySelectorAll('a[href], button, [role="button"], [role="option"], li, tr, div[tabindex]')
    ].filter((el) => visible(el) && !inSidebar(el));
    const byHref = cands.find((el) => {
      let href = el.getAttribute('href') || '';
      try {
        href = decodeURIComponent(href);
      } catch (_) {}
      return el.tagName === 'A' && href.toLowerCase().includes(`/global-search/${h}`);
    });
    if (byHref) return byHref;
    const byText = cands.filter((el) => {
      const t = norm(el.innerText).toLowerCase();
      return t && t.length < 300 && t.split(/[\s|•·,()]+/).includes('@' + h);
    });
    byText.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
    return byText[0] || null;
  }

  // ---------- audience unlock ----------
  function findAudienceTab() {
    const els = [...document.querySelectorAll('[role="tab"], button, a, li, div, span')].filter((el) => {
      const t = norm(el.textContent);
      return t.length < 25 && /^audience\b/i.test(t) && visible(el) && !inSidebar(el);
    });
    return els.find((el) => el.matches('[role="tab"], button, a')) || els[0] || null;
  }

  const audienceDataVisible = () => {
    const t = bodyText();
    return /Audience Credibility/i.test(t) && /Top Audience (Country|City)/i.test(t) && /\d+(\.\d+)?%/.test(t);
  };

  const kwMatch = (t, kws) => kws.some((k) => (k.length <= 3 ? t === k : t.includes(k)));

  function findUnlockButton() {
    let best = null;
    let bestLen = Infinity;
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      if (!visible(el) || inSidebar(el) || inDialog(el) || el.disabled) continue;
      const t = label(el);
      if (!t || t.length > 60 || NEVER.test(t)) continue;
      if (kwMatch(t, cfg.unlock) && t.length < bestLen) {
        best = el;
        bestLen = t.length;
      }
    }
    return best;
  }

  function findConfirmButton() {
    for (const d of document.querySelectorAll(DIALOG_SEL)) {
      if (!visible(d)) continue;
      for (const b of d.querySelectorAll('button, a, [role="button"]')) {
        if (!visible(b) || b.disabled) continue;
        const t = label(b);
        if (t && t.length < 40 && !NEVER_CONFIRM.test(t) && kwMatch(t, cfg.confirm)) return b;
      }
    }
    return null;
  }

  // Influenzer's profile data: result.reports.instagram (captured from the app).
  function latestReport(h) {
    for (let i = apiBodies.length - 1; i >= 0; i--) {
      const b = apiBodies[i].body;
      if (b.indexOf('"reports"') < 0 || b.toLowerCase().indexOf(h) < 0) continue;
      try {
        const j = JSON.parse(b);
        const ig = j && j.result && j.result.reports && j.result.reports.instagram;
        if (ig && ig.profile && String(ig.profile.username || '').toLowerCase() === h) return ig;
      } catch (_) {}
    }
    return null;
  }
  const reportHasAudience = (ig) => {
    const a = ig && ig.audience && (ig.audience.data || ig.audience);
    return !!(a && ((a.ages && a.ages.length) || (a.geoCities && a.geoCities.length)));
  };

  async function unlockAudience(h) {
    // Already unlocked? Influenzer's own data says so: no buttons, no credits.
    const rep0 = await waitFor(() => latestReport(h), 25000, 500);
    if (reportHasAudience(rep0)) return 'already-unlocked';

    const tab = await waitFor(findAudienceTab, 10000);
    if (tab) {
      realClick(tab);
      await sleep(1200);
    }
    await waitFor(() => audienceDataVisible() || findUnlockButton() || findConfirmButton(), 10000, 400);

    if ((audienceDataVisible() || reportHasAudience(latestReport(h))) && !findUnlockButton() && !findConfirmButton()) return 'already-unlocked';

    let confirm = findConfirmButton();
    if (!confirm) {
      const btn = findUnlockButton();
      if (!btn) return 'no-unlock-button';
      realClick(btn);
      confirm = await waitFor(findConfirmButton, 5000, 250);
    }
    if (confirm) realClick(confirm);

    const ok = await waitFor(
      () => reportHasAudience(latestReport(h)) || (audienceDataVisible() && !findUnlockButton() && !findConfirmButton()),
      40000,
      500
    );
    return ok ? 'unlocked' : 'unlock-clicked';
  }

  // ---------- task runner ----------
  // Page shows (almost) nothing: the app didn't render.
  const isBlank = () => {
    const root = document.getElementById('root');
    if (root) return root.children.length === 0 || norm(root.innerText).length < 20;
    return norm(bodyText()).length < 25;
  };

  // Clickable row/card around a search result.
  function clickableFor(el) {
    return (
      el.closest('a[href]') ||
      el.closest('button, [role="option"], [role="button"], [role="row"], li, tr, [class*="card" i], [class*="result" i]') ||
      el
    );
  }

  // Text that belongs to this element itself (not its children).
  const ownText = (el) =>
    norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
  const tokens = (t) => t.toLowerCase().split(/[\s|•·,()]+/).filter(Boolean);

  // Only an exact "@username" match counts, so "@name_official" or a
  // display name that merely contains the username is never clicked.
  function findResultExact(h) {
    const input = findSearchInput();
    const leaves = [...document.querySelectorAll('main *, [role="listbox"] *, [role="dialog"] *, body > div *')].filter((el) => {
      if (el === input || el.tagName === 'INPUT' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
      const txt = el.children.length === 0 ? norm(el.textContent) : ownText(el);
      return txt && txt.length < 80 && (tokens(txt).includes('@' + h) || txt.toLowerCase() === h) && visible(el) && !inSidebar(el);
    });
    for (const leaf of leaves) {
      const c = clickableFor(leaf);
      if (c && visible(c) && !(input && c.contains(input))) return c;
    }
    // Also accept a link straight to this creator's page.
    return (
      [...document.querySelectorAll('a[href]')].find((a) => {
        let href = a.getAttribute('href') || '';
        try {
          href = decodeURIComponent(href);
        } catch (_) {}
        return visible(a) && !inSidebar(a) && href.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '').endsWith(`/global-search/${h}`);
      }) || null
    );
  }

  async function typeSearch(h, task) {
    const tries = task.typeTries || 0;
    if (tries >= 3) return false; // never bounce between pages forever
    if (!/^\/global-search\/?$/i.test(location.pathname)) {
      await send({ type: 'updateTask', patch: { typeTries: tries + 1 } });
      task.typeTries = tries + 1;
      location.assign(SEARCH_URL);
      return 'navigating';
    }
    toast(`Searching @${h} in Influenzer…`, 'info', 0);
    const input = await waitFor(findSearchInput, 20000);
    if (!input) return false;
    input.focus();
    input.click();
    setNativeValue(input, '');
    await sleep(150);
    setNativeValue(input, h);
    // Influenzer shows a dropdown of results. Only the exact @username counts
    // (not look-alikes such as @name_official), and Enter is never pressed
    // because it would open whichever result happens to be first.
    const hit = await waitFor(() => (onProfilePath(h) ? 'nav' : findResultExact(h)), 15000, 300);
    if (!hit) return false;
    if (hit === 'nav') return true;
    // Results are links that open a NEW tab; open the profile in this tab instead.
    const link = hit.matches('a[href]') ? hit : hit.closest('a[href]') || hit.querySelector('a[href]');
    if (link && /\/global-search\//.test(link.getAttribute('href') || '')) {
      location.assign(new URL(link.getAttribute('href'), location.origin).href);
      return 'navigating';
    }
    realClick(hit);
    return !!(await waitFor(() => onProfilePath(h), 10000));
  }

  // ---------- reading profile data for the sheet ----------
  const P = window.CXParse;
  const apiBodies = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__cxq !== 'api') return;
    if (apiBodies.some((b) => b.at === e.data.at && b.url === e.data.url)) return;
    apiBodies.push({ url: e.data.url, body: e.data.body, at: e.data.at });
    if (apiBodies.length > 80) apiBodies.shift();
  });
  window.postMessage({ __cxq: 'dump' }, location.origin);

  function apiObjects(h) {
    const parsed = [];
    for (const b of apiBodies) {
      try {
        parsed.push({ hit: b.body.toLowerCase().includes(h), obj: JSON.parse(b.body) });
      } catch (_) {}
    }
    // Responses that mention the creator first, newest first.
    return parsed.reverse().sort((a, b) => b.hit - a.hit).map((x) => x.obj);
  }

  const mainText = () => {
    const m = document.querySelector('main') || document.body;
    return m ? m.innerText || '' : '';
  };

  function findTabNamed(name) {
    const re = new RegExp(`^${name}\\b`, 'i');
    const els = [...document.querySelectorAll('[role="tab"], button, a, li, div, span')].filter((el) => {
      const t = norm(el.textContent);
      return t.length < 30 && re.test(t) && visible(el) && !inSidebar(el);
    });
    return els.find((el) => el.matches('[role="tab"], button, a')) || els[0] || null;
  }

  // Finds "Label" on the page and reads the number/percentage shown next to it.
  function labeledValue(labels, kind) {
    const exact = new RegExp(`^(?:${labels.join('|')})$`, 'i');
    const loose = new RegExp(`(?:${labels.join('|')})`, 'i');
    const leaves = [...document.querySelectorAll('div,span,p,dt,dd,label,h1,h2,h3,h4,h5,h6,td,th,li,small,strong,b')].filter(
      (el) => el.children.length <= 2 && exact.test(norm(el.textContent)) && visible(el) && !inSidebar(el)
    );
    const valRe = kind === 'pct' ? /(\d+(?:\.\d+)?)\s*%/ : /(\d[\d,]*(?:\.\d+)?\s*(?:K|M|B)?)(?![a-z%])/i;
    for (const leaf of leaves) {
      let node = leaf.parentElement;
      for (let up = 0; up < 4 && node; up++, node = node.parentElement) {
        const t = node.innerText || '';
        const idx = t.search(loose);
        if (idx < 0) continue;
        const after = t.slice(idx).replace(loose, '');
        const m = after.match(valRe);
        if (m && after.indexOf(m[0]) < 40) return kind === 'pct' ? parseFloat(m[1]) : P.parseCount(m[1]);
        const before = t.slice(Math.max(0, idx - 30), idx);
        const mb = before.match(new RegExp(valRe.source + '\\s*$', 'i'));
        if (mb) return kind === 'pct' ? parseFloat(mb[1]) : P.parseCount(mb[1]);
      }
    }
    return null;
  }

  function findName(h) {
    const at = '@' + h;
    const els = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span,p,a')].filter(
      (el) => norm(el.textContent).toLowerCase() === at && visible(el) && !inSidebar(el)
    );
    for (const el of els) {
      let prev = el.previousElementSibling;
      for (let hop = 0; prev && !norm(prev.innerText) && hop < 3; hop++) prev = prev.previousElementSibling;
      const t = prev ? norm(prev.innerText) : '';
      if (t && t.length < 120 && !t.startsWith('@')) return t.split('|')[0].trim();
    }
    const lines = bodyText().split('\n').map(norm).filter(Boolean);
    const i = lines.findIndex((l) => l.toLowerCase() === at);
    return i > 0 ? lines[i - 1].split('|')[0].trim() : '';
  }

  async function scrollThrough() {
    const scrollers = [document.scrollingElement];
    for (const el of document.querySelectorAll('main, main div, body > div div')) {
      if (scrollers.length > 4) break;
      if (el.scrollHeight > el.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) scrollers.push(el);
    }
    for (const s of scrollers.filter(Boolean)) {
      for (let y = 0; y <= s.scrollHeight; y += 700) {
        s.scrollTop = y;
        await sleep(120);
      }
    }
    await sleep(400);
    scrollers.filter(Boolean).forEach((s) => (s.scrollTop = 0));
  }

  async function collectForSheet(h) {
    toast(`Reading @${h}'s data for your sheet…`, 'info', 0);
    await send({ type: 'taskStatus', status: 'collecting' });
    const rec = { handle: h, name: '', followers: null, er: null, avgViews: null, cities: null, age: null, audience: false };
    const texts = {};
    // Best source: Influenzer's own data for this creator.
    const ig = await waitFor(() => (reportHasAudience(latestReport(h)) ? latestReport(h) : null), 8000, 500) || latestReport(h) || (await waitFor(() => latestReport(h), 15000, 500));
    const fromRep = P.fromReport(ig);
    if (fromRep) {
      Object.assign(rec, { name: fromRep.name, followers: fromRep.followers, er: fromRep.er, avgViews: fromRep.avgViews });
      if (fromRep.audience) Object.assign(rec, { audience: true, cities: fromRep.cities, age: fromRep.age });
    }
    const complete = () => rec.name && rec.followers && rec.er && rec.avgViews && rec.audience && rec.cities && rec.cities.length && rec.age;
    const grab = () => {
      rec.name = rec.name || findName(h);
      rec.followers = rec.followers || labeledValue(['Followers'], 'num');
      rec.er = rec.er || labeledValue(P.ER_LABELS, 'pct');
      rec.avgViews = rec.avgViews || labeledValue(P.VIEW_LABELS, 'num');
    };
    grab();
    texts.card = mainText();
    for (const tabName of complete() ? [] : ['Overview', 'Performance']) {
      const tab = findTabNamed(tabName);
      if (!tab) continue;
      realClick(tab);
      await sleep(1800);
      await scrollThrough();
      grab();
      texts[tabName.toLowerCase()] = mainText();
    }
    const aud = complete() ? null : findTabNamed('Audience');
    if (aud) {
      realClick(aud);
      await sleep(1800);
      await scrollThrough();
      texts.audience = mainText();
      if (!rec.audience && audienceDataVisible() && !findUnlockButton()) {
        rec.audience = true;
        rec.cities = P.citiesFromText(texts.audience);
        // Age bars are a chart; only trust text values if all three are present.
        const ages = P.agesFromText(texts.audience.replace(/between the ages of[^\n]*/gi, ''));
        rec.age = ages && ages['13-17'] != null && ages['18-24'] != null && ages['25-34'] != null ? ages : null;
      }
    }

    // Fallbacks: page text, then the data the app loaded.
    const all = Object.values(texts).join('\n');
    rec.followers = rec.followers || P.textValue(all, ['Followers'], 'num');
    rec.er = rec.er || P.textValue(all, P.ER_LABELS, 'pct');
    rec.avgViews = rec.avgViews || P.textValue(all, P.VIEW_LABELS, 'num');
    const j = P.fromJson(apiObjects(h));
    rec.followers = rec.followers || j.followers;
    rec.er = rec.er || j.er;
    rec.avgViews = rec.avgViews || j.avgViews;
    if (rec.audience) {
      if (!rec.cities || !rec.cities.length) rec.cities = j.cities || [];
      if (!rec.age) rec.age = j.age;
    }
    rec.cities = (rec.cities || []).slice(0, 3);

    const missing = [];
    if (!rec.name) missing.push('Name');
    if (!rec.followers) missing.push('Followers');
    if (!rec.er) missing.push('ER');
    if (!rec.avgViews) missing.push('Average Views');
    if (!rec.audience) missing.push('Audience (locked)');
    else {
      if (!rec.cities.length) missing.push('Top 3 Locations');
      if (!rec.age) missing.push('Age split');
    }
    rec.missing = missing;
    rec.status = missing.length ? 'partial' : 'filled';

    const debug = {
      handle: h,
      url: location.href,
      at: new Date().toISOString(),
      record: rec,
      texts,
      api: apiBodies.slice(-15).map((b) => ({ url: b.url, body: b.body.slice(0, 250000) }))
    };
    await send({ type: 'record', record: rec, debug });
    return rec;
  }

  async function switchToTyping(task, h, why) {
    toast(
      why === 'wrong'
        ? `Influenzer showed a different creator. Searching @${h} instead…`
        : `That link didn't load in Influenzer. Searching @${h} instead…`,
      'warn',
      0
    );
    await send({ type: 'directBroken' });
    await send({ type: 'updateTask', patch: { mode: 'type', fellBack: true } });
    await sleep(700);
    location.assign(SEARCH_URL);
  }

  async function finish(status, msg, kind) {
    toast(msg, kind, kind === 'ok' ? 4500 : 9000);
    await send({ type: 'taskDone', status, note: msg });
  }

  async function run(task) {
    const h = String(task.handle).toLowerCase();

    // 0) Influenzer sometimes loads a blank page; reload it (up to 3 times).
    const rendered = await waitFor(() => !isBlank(), 12000, 400);
    if (!rendered) {
      const n = task.reloads || 0;
      if (n < 3) {
        toast(`Influenzer loaded a blank page. Reloading (${n + 1}/3)…`, 'warn', 0);
        await send({ type: 'updateTask', patch: { reloads: n + 1 } });
        location.reload();
        return;
      }
      return finish('error', `Influenzer kept loading a blank page for @${h}. Check you're logged in, then retry.`, 'err');
    }

    // 1) Make sure we're logged in; the task survives the login redirect.
    const st = await waitFor(() => (authState() === 'unknown' ? null : authState()), 15000);
    if (st === 'out') {
      toast(`Please log in to Influenzer. @${h} will open automatically after you sign in.`, 'warn', 0);
      await send({ type: 'taskStatus', status: 'waiting-login' });
      const ok = await waitFor(() => authState() === 'in', 15 * 60 * 1000, 1000);
      if (!ok) return;
      toast('Logged in, continuing…', 'ok');
      await sleep(800);
    }

    // 2) Get to the creator's Search & Analysis page.
    //    Default: type the username into Search & Analysis and click the result,
    //    the same way you'd do it by hand (direct links can show a blank page).
    if (!onProfilePath(h)) {
      if (task.mode === 'type') {
        const r = await typeSearch(h, task);
        if (r === 'navigating') return;
        if (!r) {
          return finish(
            'error',
            isBlank()
              ? `Influenzer didn't load. Check you're logged in at app.influenzer.io, then try @${h} again.`
              : `Couldn't find @${h} in Influenzer's search results.`,
            'err'
          );
        }
      } else {
        const tries = task.navAttempts || 0;
        if (tries >= 1) return switchToTyping(task, h, 'retry');
        await send({ type: 'updateTask', patch: { navAttempts: tries + 1 } });
        location.assign(task.url);
        return;
      }
    }

    toast(`Influenzer is analysing @${h}. This can take a moment…`, 'info', 0);
    await send({ type: 'taskStatus', status: 'loading' });
    const t0 = Date.now();
    let blankSince = null;
    const loaded = await waitFor(
      () => {
        if (profileLoaded(h)) return 'ok';
        if (isBlank()) {
          blankSince = blankSince || Date.now();
          if (Date.now() - blankSince > 10000) return 'blank';
        } else blankSince = null;
        if (Date.now() - t0 > 7000 && wrongProfile(h)) return 'wrong';
        return null;
      },
      task.mode === 'type' ? 90000 : 45000,
      400
    );
    if (loaded === 'wrong' || loaded === 'blank') {
      if (task.mode !== 'type' && !task.fellBack) return switchToTyping(task, h, loaded);
      if (loaded === 'blank' && (task.reloads || 0) < 3) {
        await send({ type: 'updateTask', patch: { reloads: (task.reloads || 0) + 1 } });
        location.reload();
        return;
      }
      return finish(
        'error',
        loaded === 'blank'
          ? `Influenzer showed a blank page for @${h}. Open it once by hand to check it loads, then retry.`
          : `Influenzer kept showing a different creator instead of @${h}.`,
        'err'
      );
    }
    if (!loaded) {
      if (notFound()) return finish('not-found', `Influenzer couldn't find @${h}.`, 'err');
      if (task.mode !== 'type' && !task.fellBack) return switchToTyping(task, h, 'timeout');
      return finish('error', `@${h} didn't load in time.`, 'err');
    }

    if (!task.unlock) {
      if (task.collect) await collectForSheet(h);
      return finish('loaded', `@${h} loaded${task.collect ? ' and saved to your sheet' : ''}.`, 'ok');
    }

    // 3) Unlock the Audience tab with credits.
    toast(`Unlocking audience for @${h}…`, 'info', 0);
    await send({ type: 'taskStatus', status: 'unlocking' });
    const res = await unlockAudience(h);
    if (task.collect) await collectForSheet(h);
    const msgs = {
      unlocked: [`Audience unlocked for @${h}.`, 'ok'],
      'already-unlocked': [`Audience was already unlocked for @${h}. No credits used.`, 'ok'],
      'unlock-clicked': [`Clicked unlock for @${h}. Check the Audience tab.`, 'warn'],
      'no-unlock-button': [
        `Couldn't find an unlock button on @${h}'s Audience tab. Adjust the button keywords in the extension settings if it's labelled differently.`,
        'warn'
      ]
    };
    const [m, k] = msgs[res] || [`Finished @${h}.`, 'info'];
    return finish(res, task.collect ? `${m} Saved to your sheet.` : m, k);
  }

  // ---------- boot ----------
  (async () => {
    const s = await chrome.storage.sync.get(DEFAULT_KW).catch(() => DEFAULT_KW);
    const split = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    cfg = { unlock: split(s.unlockKeywords), confirm: split(s.confirmKeywords) };

    let task = null;
    for (let i = 0; i < 8 && !task; i++) {
      task = await send({ type: 'getTask' });
      if (!task) await sleep(400);
    }
    if (task && task.handle) {
      try {
        await run(task);
      } catch (e) {
        finish('error', `Something went wrong: ${e && e.message}`, 'err');
      }
    }
  })();
})();
