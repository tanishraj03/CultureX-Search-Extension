// The creator sheet lives in chrome.storage.local under "sheet".
export const EMPTY = () => ({ title: 'Creator list', rows: [], extraHeaders: [] });

export async function getSheet() {
  const { sheet } = await chrome.storage.local.get('sheet');
  return sheet && Array.isArray(sheet.rows) ? sheet : EMPTY();
}

export const saveSheet = (sheet) => chrome.storage.local.set({ sheet });

export const blankRow = (handle) => ({
  handle,
  name: '',
  followers: null,
  er: null,
  avgViews: null,
  cities: [],
  age: null,
  audience: false,
  deliverables: '',
  cost: '',
  extras: [],
  status: 'pending',
  missing: [],
  addedAt: Date.now(),
  updatedAt: null
});

// Serialise writes so the background and the Sheet page don't overwrite each other.
let chain = Promise.resolve();
export function mutate(fn) {
  chain = chain.then(async () => {
    const sheet = await getSheet();
    const out = await fn(sheet);
    await saveSheet(sheet);
    return out;
  }, () => {});
  return chain;
}

export const inSheet = async (h) => (await getSheet()).rows.some((r) => r.handle === h);

/** Adds handles that aren't in the sheet yet; returns how many were new. */
export function addHandles(handles) {
  return mutate((sheet) => {
    let n = 0;
    for (const h of handles) {
      if (sheet.rows.some((r) => r.handle === h)) continue;
      sheet.rows.push(blankRow(h));
      n++;
    }
    return n;
  });
}

/** Saves data read from Influenzer. Your Deliverables, Cost, notes (and a name you typed) are kept. */
export function upsertRecord(rec, { create = true } = {}) {
  return mutate((sheet) => {
    let row = sheet.rows.find((r) => r.handle === rec.handle);
    if (!row) {
      if (!create) return false;
      row = blankRow(rec.handle);
      sheet.rows.push(row);
    }
    if (!row.name) row.name = rec.name || '';
    for (const k of ['followers', 'er', 'avgViews']) if (rec[k] != null) row[k] = rec[k];
    if (rec.audience) {
      row.audience = true;
      if (rec.cities && rec.cities.length) row.cities = rec.cities;
      if (rec.age) row.age = rec.age;
    }
    row.missing = rec.missing || [];
    row.status = rec.status || 'filled';
    row.updatedAt = Date.now();
    return true;
  });
}

export function setStatus(handles, status, onlyIf) {
  const set = new Set(handles);
  return mutate((sheet) => {
    for (const r of sheet.rows) if (set.has(r.handle) && (!onlyIf || onlyIf(r))) r.status = status;
  });
}
