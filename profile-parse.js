// Pure parsing helpers for Influenzer profile data (text + API JSON).
// Loaded as a classic content script (window.CXParse) and usable from Node tests.
(function (root) {
  const MULT = { k: 1e3, m: 1e6, b: 1e9, l: 1e5, lakh: 1e5, cr: 1e7 };

  function parseCount(s) {
    if (s == null) return null;
    if (typeof s === 'number') return isFinite(s) ? Math.round(s) : null;
    const m = String(s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(lakh|cr|k|m|b|l)?(?![a-z])/i);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * (m[2] ? MULT[m[2].toLowerCase()] : 1));
  }

  function parsePct(s) {
    if (typeof s === 'number') return s;
    const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }

  const ER_LABELS = ['Engagement Rate', 'Avg\\.? Engagement Rate', 'Eng\\.? Rate', 'ER'];
  const VIEW_LABELS = [
    'Avg\\.? ?(?:Reels? )?Views', 'Average (?:Reels? )?Views', 'Avg\\.? ?(?:Reels? )?Plays', 'Average (?:Reels? )?Plays'
  ];
  const AGES = ['13-17', '18-24', '25-34'];

  // "Label ... value" anywhere in text (fallback when DOM lookup fails).
  function textValue(text, labels, kind) {
    for (const l of labels) {
      const val = kind === 'pct' ? '(\\d+(?:\\.\\d+)?)\\s*%' : '(\\d[\\d,]*(?:\\.\\d+)?\\s*(?:K|M|B)?)(?![a-z])';
      const re = new RegExp(`(?:^|\\n|\\s)${l}(?![a-z])[^\\d\\n]{0,25}\\n?[^\\d\\n]{0,25}?${val}`, 'i');
      const m = String(text || '').match(re);
      if (m) return kind === 'pct' ? parseFloat(m[1]) : parseCount(m[1]);
    }
    return null;
  }

  // "Top Audience City" list → [{name, pct}]
  function citiesFromText(text) {
    const t = String(text || '');
    const i = t.search(/Top Audience Cit(?:y|ies)/i);
    if (i < 0) return [];
    const lines = t.slice(i).split('\n').slice(1).map((s) => s.trim()).filter(Boolean);
    const out = [];
    let skipped = 0;
    for (let k = 0; k < lines.length && out.length < 10; k++) {
      const one = lines[k].match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'()\-]{1,60}?)\s+(\d+(?:\.\d+)?)\s*%$/);
      if (one) {
        out.push({ name: one[1].trim(), pct: parseFloat(one[2]) });
        continue;
      }
      const next = lines[k + 1] || '';
      if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'()\-]{1,60}$/.test(lines[k]) && /^\d+(?:\.\d+)?\s*%$/.test(next)) {
        out.push({ name: lines[k], pct: parseFloat(next) });
        k++;
        continue;
      }
      if (out.length || ++skipped > 4) break;
    }
    return out;
  }

  function agesFromText(text) {
    const out = {};
    for (const a of AGES) {
      const [x, y] = a.split('-');
      const m = String(text || '').match(new RegExp(`(?:^|[^\\d])${x}\\s*[-–]\\s*${y}(?!\\d)[^\\d%\\n]{0,20}\\n?[^\\d%\\n]{0,10}(\\d+(?:\\.\\d+)?)\\s*%`));
      if (m) out[a] = parseFloat(m[1]);
    }
    return Object.keys(out).length ? out : null;
  }

  // ---------- JSON (captured Influenzer API responses) ----------
  function walk(o, fn, depth = 0) {
    if (o == null || depth > 14 || typeof o !== 'object') return;
    if (Array.isArray(o)) o.forEach((v, i) => { fn(v, i, o); walk(v, fn, depth + 1); });
    else for (const k of Object.keys(o)) { fn(o[k], k, o); walk(o[k], fn, depth + 1); }
  }
  const asNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? parseFloat(v) : null);

  function jsonNumber(objs, keyRe) {
    for (const o of objs) {
      let found = null;
      walk(o, (v, k) => {
        if (found == null && typeof k === 'string' && keyRe.test(k)) {
          const n = asNum(v);
          if (n != null) found = n;
        }
      });
      if (found != null) return found;
    }
    return null;
  }

  const normAge = (s) => String(s).replace(/\s|yrs?|years?/gi, '').replace(/[–_]/g, '-');
  const LABEL_KEYS = ['code', 'label', 'name', 'key', 'range', 'age', 'ageRange', 'age_range', 'bucket', 'group'];
  const VALUE_KEYS = ['weight', 'value', 'percentage', 'percent', 'share', 'pct', 'ratio', 'count'];
  const pick = (o, keys) => { for (const k of keys) if (o[k] != null) return o[k]; return null; };

  function agesFromJson(objs) {
    for (const o of objs) {
      const acc = {};
      walk(o, (v, k) => {
        if (typeof k === 'string' && /^\d{2}-\d{2}$|^\d{2}\+$|^65-$/.test(normAge(k)) && asNum(v) != null) {
          acc[normAge(k)] = (acc[normAge(k)] || 0) + asNum(v);
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
          const lab = pick(v, LABEL_KEYS);
          const val = asNum(pick(v, VALUE_KEYS));
          if (lab != null && val != null && /^\d{2}-\d{2}$|^\d{2}\+$/.test(normAge(lab))) {
            acc[normAge(lab)] = (acc[normAge(lab)] || 0) + val;
          }
        }
      });
      const total = Object.values(acc).reduce((a, b) => a + b, 0);
      if (total > 0 && (acc['18-24'] != null || acc['25-34'] != null)) {
        const out = {};
        for (const a of AGES) out[a] = acc[a] != null ? +((acc[a] / total) * 100).toFixed(2) : 0;
        return out;
      }
    }
    return null;
  }

  function citiesFromJson(objs) {
    for (const o of objs) {
      let best = null;
      walk(o, (v, k) => {
        if (best || !Array.isArray(v) || typeof k !== 'string' || !/cit(y|ies)/i.test(k)) return;
        const items = v
          .map((it) => (it && typeof it === 'object' ? { name: pick(it, ['name', 'city', 'label', 'title', 'code']), val: asNum(pick(it, VALUE_KEYS)) } : null))
          .filter((x) => x && typeof x.name === 'string' && x.val != null);
        if (items.length) best = items;
      });
      if (best) {
        const max = Math.max(...best.map((x) => x.val));
        return best
          .sort((a, b) => b.val - a.val)
          .map((x) => ({ name: x.name.split(',')[0].trim(), pct: +(max <= 1 ? x.val * 100 : x.val).toFixed(2) }));
      }
    }
    return [];
  }

  const KEYS = {
    followers: /^(followers?|followers?_?count|follower_?count|followersCount|followerCount|total_?followers)$/i,
    er: /^(engagement_?rate|engagementRate|avg_?engagement_?rate|er)$/i,
    avgViews: /^(avg_?views|average_?views|avg_?reels?_?views|avgReelViews|avgReelsViews|avgViews|averageViews|avg_?plays|avg_?reels?_?plays|avgReelPlays)$/i
  };

  function fromJson(objs) {
    const er = jsonNumber(objs, KEYS.er);
    return {
      followers: jsonNumber(objs, KEYS.followers),
      er: er == null ? null : +(er < 1 ? er * 100 : er).toFixed(2),
      avgViews: jsonNumber(objs, KEYS.avgViews),
      age: agesFromJson(objs),
      cities: citiesFromJson(objs)
    };
  }

  // Influenzer's own profile data: result.reports.instagram
  function fromReport(ig) {
    if (!ig || !ig.profile) return null;
    const pr = ig.profile;
    const num = (v) => (v == null || v === '' ? null : isFinite(+v) ? +v : null);
    const er = num(pr.engagementRate);
    let views = num(ig.avgReelsPlays);
    if (!views) views = num(ig.avgViews) || num(pr.avgViews);
    const a = ig.audience ? ig.audience.data || ig.audience : null;
    const out = {
      name: pr.fullname || '',
      followers: num(pr.followers),
      er: er == null ? null : +(er <= 1 ? er * 100 : er).toFixed(2),
      avgViews: views ? Math.round(views) : null,
      audience: false,
      cities: [],
      age: null
    };
    if (a && ((a.ages && a.ages.length) || (a.geoCities && a.geoCities.length))) {
      out.audience = true;
      out.cities = (a.geoCities || [])
        .filter((c) => c && c.name && num(c.weight) != null)
        .sort((x, y) => y.weight - x.weight)
        .map((c) => ({ name: c.name, pct: +(c.weight * 100).toFixed(2) }));
      if (a.ages && a.ages.length) {
        const age = {};
        for (const k of AGES) {
          const row = a.ages.find((x) => normAge(x.code) === k);
          age[k] = row && num(row.weight) != null ? +(row.weight * 100).toFixed(2) : 0;
        }
        out.age = age;
      }
    }
    return out;
  }

  function category(followers) {
    if (!followers) return '';
    if (followers < 10000) return 'Nano';
    if (followers < 100000) return 'Micro';
    if (followers < 1000000) return 'Macro';
    return 'Mega';
  }

  const api = {
    parseCount, parsePct, textValue, fromReport, citiesFromText, agesFromText, agesFromJson, citiesFromJson,
    fromJson, category, ER_LABELS, VIEW_LABELS, AGES
  };
  root.CXParse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
