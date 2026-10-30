// Pulls Instagram usernames out of any text: profile URLs, @handles,
// or (when nothing else is found) a plain list of usernames such as a
// column copied from Google Sheets.

const RESERVED = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv', 'about',
  'developer', 'developers', 'legal', 'privacy', 'terms', 'web', 'challenge', 'emails',
  'session', 'graphql', 'api', 'static', 'press', 'jobs', 'help', 'locations', 'tags',
  'ar', 'your_activity', 'oauth', 'login', 'signup', 'nametag', 'qr', 'directory',
  'topics', 'popular', 'invites', 'lite', 'threads', 'create', 'audio', 'guides', 'u'
]);

// Typical spreadsheet header cells we skip in plain-list mode.
const HEADERS = new Set([
  'username', 'usernames', 'handle', 'handles', 'instagram', 'ig', 'profile', 'profiles',
  'name', 'names', 'link', 'links', 'url', 'urls', 'creator', 'creators', 'influencer',
  'influencers', 'account', 'accounts', 'id'
]);

export function isValidUsername(u) {
  return (
    /^[a-z0-9._]{1,30}$/.test(u) &&
    !u.startsWith('.') &&
    !u.endsWith('.') &&
    !u.includes('..') &&
    !RESERVED.has(u)
  );
}

const URL_RE =
  /(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:instagram\.com|instagr\.am)\/(?:_u\/)?(?:stories\/)?([A-Za-z0-9._]{1,30})(?=[\/?#\s"'<>)\],;|]|$)/gi;
const AT_RE = /(^|[^A-Za-z0-9._@\/])@([A-Za-z0-9._]{1,30})(?![A-Za-z0-9_])/g;

/**
 * @param {string} text
 * @param {{allowBare?: boolean}} [opts]
 * @returns {string[]} unique lowercase usernames in the order found
 */
export function extractHandles(text, { allowBare = true } = {}) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const u = String(raw || '').toLowerCase().replace(/\.+$/, '');
    if (isValidUsername(u) && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };

  // Keep matches in the order they appear, whether URL or @handle.
  const hits = [];
  for (const m of text.matchAll(URL_RE)) hits.push([m.index, m[1]]);
  for (const m of text.matchAll(AT_RE)) hits.push([m.index + m[1].length, m[2]]);
  hits.sort((a, b) => a[0] - b[0]).forEach(([, u]) => add(u));
  if (out.length || !allowBare) return out;

  // Plain list mode: every cell/line must look like a single username.
  const cells = text
    .split(/[\r\n\t,;|]+/)
    .map((s) => s.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .filter(Boolean)
    .filter((s) => !HEADERS.has(s.toLowerCase()));
  if (!cells.length || cells.length > 500) return [];
  const ok = cells.every(
    (c) => /^[A-Za-z0-9._]{1,30}$/.test(c) && /[A-Za-z]/.test(c) && isValidUsername(c.toLowerCase())
  );
  if (!ok) return [];
  cells.forEach(add);
  return out;
}
