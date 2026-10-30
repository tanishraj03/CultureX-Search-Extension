import { getSheet, mutate, addHandles } from './sheet-store.js';
import { COLS, rowValues, toXlsx, toCsv, toHtmlTable, toTsv, parseDelimited, importTable } from './sheet-io.js';
import { extractHandles } from './parse.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtInt = (v) => (v === '' || v == null ? '' : typeof v === 'number' ? v.toLocaleString('en-IN') : v);
const fmtPct = (v) => (v === '' || v == null ? '' : `${Number(v).toFixed(2)}%`);

const STATUS = {
  pending: ['To fill', ''],
  queued: ['Queued', 'busy'],
  running: ['Filling…', 'busy'],
  filled: ['Filled', 'ok'],
  partial: ['Partly filled', 'warn'],
  error: ['Error', 'err'],
  'not-found': ['Not found', 'err']
};

let sheet = await getSheet();
let queue = (await chrome.storage.local.get('queue')).queue;

function toast(t) {
  $('#toast').textContent = t;
  $('#toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('#toast').classList.remove('show'), 2600);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileBase = () => (sheet.title || 'Creator list').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Creator list';

// ---------- render ----------
function render() {
  if (document.activeElement && document.activeElement.classList.contains('in')) return; // don't clobber typing
  $('#title').value = sheet.title || 'Creator list';
  const n = sheet.rows.length;
  const filled = sheet.rows.filter((r) => r.status === 'filled').length;
  const partial = sheet.rows.filter((r) => r.status === 'partial').length;
  $('#stats').textContent = n ? `${n} creator${n === 1 ? '' : 's'} · ${filled} filled · ${partial} partly filled · ${n - filled - partial} to fill` : 'No creators yet';

  const extras = sheet.extraHeaders || [];
  const groups = {};
  COLS.forEach((c) => c.group && (groups[c.group] = (groups[c.group] || 0) + 1));
  const seen = new Set();
  let top = '';
  for (const c of COLS) {
    if (!c.group) top += `<th rowspan="2">${esc(c.h)}</th>`;
    else if (!seen.has(c.group)) {
      seen.add(c.group);
      top += `<th class="grp" colspan="${groups[c.group]}">${esc(c.group)}</th>`;
    }
  }
  extras.forEach((x) => (top += `<th rowspan="2">${esc(x || 'Notes')}</th>`));
  top += '<th rowspan="2">Status</th><th rowspan="2"></th>';
  const second = COLS.filter((c) => c.group).map((c) => `<th>${esc(c.h)}</th>`).join('');

  const body = sheet.rows
    .map((r, i) => {
      const v = rowValues(r, i);
      const [label, cls] = STATUS[r.status] || [r.status, ''];
      const tip = r.missing && r.missing.length ? `Missing: ${r.missing.join(', ')}` : '';
      return `<tr data-h="${esc(r.handle)}">
        <td class="num">${v.sr}</td>
        <td><input class="in" data-k="name" value="${esc(v.name)}" placeholder="@${esc(r.handle)}"></td>
        <td class="num">${fmtInt(v.followers)}</td>
        <td><a href="${esc(v.link)}" target="_blank">${esc(v.link)}</a></td>
        <td>${esc(v.category)}</td>
        <td class="num">${fmtPct(v.er)}</td>
        <td class="num">${fmtInt(v.avgViews)}</td>
        <td class="loc">${esc(v.locations)}</td>
        <td class="num">${fmtPct(v.a1317)}</td>
        <td class="num">${fmtPct(v.a1824)}</td>
        <td class="num">${fmtPct(v.a2534)}</td>
        <td class="mine"><input class="in" data-k="deliverables" value="${esc(v.deliverables)}" placeholder="—"></td>
        <td class="mine"><input class="in cost" data-k="cost" value="${esc(r.cost ?? '')}" placeholder="—"></td>
        ${extras.map((_, j) => `<td class="mine"><input class="in" data-k="extra" data-j="${j}" value="${esc((r.extras || [])[j] || '')}"></td>`).join('')}
        <td><span class="status ${cls}" title="${esc(tip)}">${esc(label)}</span></td>
        <td style="white-space:nowrap"><button class="rowbtn" data-act="refill" title="Fill this creator again (search + unlock audience)">↻</button><button class="rowbtn" data-act="del" title="Remove from sheet">×</button></td>
      </tr>`;
    })
    .join('');
  $('#table').innerHTML = `<thead><tr>${top}</tr><tr>${second}</tr></thead><tbody>${body}</tbody>`;
  $('#empty').hidden = !!n;
  $('#empty').textContent =
    'Your sheet is empty. Use “Search + unlock audience” on any creator, or click “+ Add creators” / “Import CSV” to start from a list.';

  // progress
  $('#progress').hidden = !queue;
  if (queue) {
    const running = Object.keys(queue.active || {}).length;
    $('#progText').textContent = `Filling ${queue.done} / ${queue.total}${running ? ` · ${running} open now` : ''}${queue.unlock ? ' · using credits' : ''}`;
    $('#barFill').style.width = `${(queue.done / Math.max(1, queue.total)) * 100}%`;
  }
  $('#fillCredits').disabled = $('#fillFree').disabled = !!queue || !n;
}

// ---------- editing ----------
$('#table').addEventListener('change', async (e) => {
  const input = e.target.closest('.in');
  if (!input) return;
  const h = input.closest('tr').dataset.h;
  const k = input.dataset.k;
  const val = input.value;
  await mutate((s) => {
    const r = s.rows.find((x) => x.handle === h);
    if (!r) return;
    if (k === 'extra') {
      r.extras = r.extras || [];
      r.extras[+input.dataset.j] = val;
    } else r[k] = val;
  });
  input.blur();
});
$('#table').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('in')) e.target.blur();
});
$('#table').addEventListener('click', async (e) => {
  const b = e.target.closest('.rowbtn');
  if (!b) return;
  const h = b.closest('tr').dataset.h;
  if (b.dataset.act === 'del') {
    await mutate((s) => (s.rows = s.rows.filter((r) => r.handle !== h)));
  } else if (b.dataset.act === 'refill') {
    if (queue) return toast('A fill is already running.');
    const row = sheet.rows.find((r) => r.handle === h);
    if (!row.audience && !confirm(`Unlock @${h}'s audience? This may use Influenzer credits.`)) return;
    await chrome.runtime.sendMessage({ type: 'fillSheet', handles: [h], unlock: true });
  }
});
$('#title').addEventListener('change', () => mutate((s) => (s.title = $('#title').value.trim() || 'Creator list')));

// ---------- adding / importing ----------
$('#addBtn').onclick = () => {
  $('#addPanel').hidden = !$('#addPanel').hidden;
  $('#addText').focus();
};
$('#addCancel').onclick = () => ($('#addPanel').hidden = true);
$('#addText').oninput = () => {
  const n = extractHandles($('#addText').value).length;
  $('#addCount').textContent = n ? `${n} creator${n === 1 ? '' : 's'} found` : '';
};
$('#addGo').onclick = async () => {
  const text = $('#addText').value;
  // Pasted spreadsheet cells keep your Deliverables / Cost / notes too.
  if (text.includes('\t')) {
    const r = await mergeImport(importTable(parseDelimited(text, '\t')));
    if (r) return;
  }
  const handles = extractHandles(text);
  if (!handles.length) return toast('No Instagram creators found in that text.');
  const added = await addHandles(handles);
  $('#addText').value = '';
  $('#addPanel').hidden = true;
  toast(`Added ${added} creator${added === 1 ? '' : 's'}${handles.length - added ? ` (${handles.length - added} already in the sheet)` : ''}.`);
};

async function mergeImport(imp) {
  if (!imp.rows.length) return false;
  let added = 0;
  await mutate((s) => {
    const extras = s.extraHeaders || [];
    imp.extraHeaders.forEach((h, j) => {
      if (j >= extras.length) extras.push(h);
    });
    s.extraHeaders = extras;
    for (const r of imp.rows) {
      let row = s.rows.find((x) => x.handle === r.handle);
      if (!row) {
        row = {
          handle: r.handle, name: '', followers: null, er: null, avgViews: null, cities: [], age: null,
          audience: false, deliverables: '', cost: '', extras: [], status: 'pending', missing: [], addedAt: Date.now()
        };
        s.rows.push(row);
        added++;
      }
      if (r.name && !row.name) row.name = r.name;
      if (r.deliverables) row.deliverables = r.deliverables;
      if (r.cost) row.cost = r.cost;
      if (r.extras.some(Boolean)) row.extras = r.extras;
    }
  });
  $('#addPanel').hidden = true;
  $('#addText').value = '';
  toast(`Imported ${imp.rows.length} creators (${added} new). Deliverables, Cost and notes were kept.`);
  return true;
}

$('#importBtn').onclick = () => $('#file').click();
$('#file').onchange = async () => {
  const f = $('#file').files[0];
  if (!f) return;
  const text = await f.text();
  const delim = /\.tsv$/i.test(f.name) || (text.includes('\t') && !text.includes(',')) ? '\t' : ',';
  const imp = importTable(parseDelimited(text, delim));
  if (!imp.rows.length) toast('No Instagram links found in that file.');
  else {
    if (!sheet.rows.length && (sheet.title || 'Creator list') === 'Creator list') {
      const t = f.name.replace(/\.(csv|tsv)$/i, '').replace(/[_]+/g, ' ').trim();
      await mutate((s) => (s.title = t));
    }
    await mergeImport(imp);
  }
  $('#file').value = '';
};

// ---------- filling ----------
async function fill(unlock) {
  let targets = sheet.rows.filter((r) => !['filled', 'queued', 'running'].includes(r.status));
  if (!unlock) targets = sheet.rows.filter((r) => !r.followers || !r.er || !r.avgViews || !r.name);
  if (!targets.length) {
    if (!confirm('Every creator is already filled. Refresh all of them?')) return;
    targets = sheet.rows;
  }
  const n = targets.length;
  const msg = unlock
    ? `Fill ${n} creator${n === 1 ? '' : 's'}?\n\nEach one opens in Influenzer and its Audience tab gets unlocked. Creators not unlocked yet use Influenzer credits.`
    : `Fill ${n} creator${n === 1 ? '' : 's'} without using credits?\n\nAudience columns (locations, age split) stay empty unless already unlocked.`;
  if (!confirm(msg)) return;
  const res = await chrome.runtime.sendMessage({ type: 'fillSheet', handles: targets.map((r) => r.handle), unlock });
  if (res && res.error) toast(res.error);
}
$('#fillCredits').onclick = () => fill(true);
$('#fillFree').onclick = () => fill(false);
$('#stopBtn').onclick = () => chrome.runtime.sendMessage({ type: 'stopFill' });

// ---------- export ----------
$('#xlsxBtn').onclick = () => {
  if (!sheet.rows.length) return toast('Nothing to export yet.');
  download(toXlsx(sheet), `${fileBase()}.xlsx`);
};
$('#csvBtn').onclick = () => {
  if (!sheet.rows.length) return toast('Nothing to export yet.');
  download(new Blob([toCsv(sheet)], { type: 'text/csv;charset=utf-8' }), `${fileBase()}.csv`);
};
$('#copyBtn').onclick = async () => {
  if (!sheet.rows.length) return toast('Nothing to copy yet.');
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([toHtmlTable(sheet)], { type: 'text/html' }),
        'text/plain': new Blob([toTsv(sheet)], { type: 'text/plain' })
      })
    ]);
    toast('Copied. Click cell A1 in Google Sheets and paste.');
  } catch (_) {
    await navigator.clipboard.writeText(toTsv(sheet));
    toast('Copied as plain text. Paste into Google Sheets.');
  }
};

// ---------- more ----------
$('#moreBtn').onclick = (e) => {
  e.stopPropagation();
  $('#more').classList.toggle('open');
};
document.addEventListener('click', () => $('#more').classList.remove('open'));
$('#debugBtn').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  const debug = Object.entries(all).filter(([k]) => k.startsWith('debug:')).map(([, v]) => v);
  if (!debug.length) return toast('No debug data yet. Fill a creator first.');
  download(new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, creators: debug }, null, 1)], { type: 'application/json' }), 'culturex-debug.json');
};
$('#clearBtn').onclick = async () => {
  if (!confirm('Remove every creator from this sheet? (Export first if you need it.)')) return;
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('debug:')));
  await mutate((s) => {
    s.rows = [];
    s.extraHeaders = [];
    s.title = 'Creator list';
  });
};

// ---------- live updates ----------
chrome.storage.onChanged.addListener(async (c, area) => {
  if (area !== 'local') return;
  if (c.sheet) sheet = c.sheet.newValue || (await getSheet());
  if ('queue' in c) queue = c.queue.newValue;
  if (c.credits) showCredits(c.credits.newValue);
  if (c.sheet || 'queue' in c) render();
});
document.addEventListener('focusout', () => setTimeout(render, 50));
function showCredits(cr) {
  if (cr && cr.value) {
    $('#credits').hidden = false;
    $('#credits').textContent = `My Credits: ${cr.value}`;
  }
}
showCredits((await chrome.storage.local.get('credits')).credits);
render();
