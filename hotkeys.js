// Custom hotkeys, stored per OS so a Mac and a Windows PC can each keep their own.
const UA = navigator.platform || navigator.userAgent || '';
export const OS = /Mac|iPhone|iPad/i.test(UA) ? 'mac' : /Win/i.test(UA) ? 'win' : 'linux';
export const OS_NAME = { mac: 'Mac', win: 'Windows', linux: 'Linux' }[OS];
export const STORE_KEY = `hotkeys_${OS}`;
export const PRIMARY = OS === 'mac' ? '⌘' : 'Ctrl';

export const ACTIONS = [
  { id: 'search', label: 'Search selected creators', command: 'search-creators', code: 'KeyY' },
  { id: 'unlock', label: 'Search + unlock audience', command: 'unlock-audience', code: 'KeyU' }
];

export const defaultHotkey = (code) => ({
  ctrl: OS !== 'mac',
  meta: OS === 'mac',
  alt: false,
  shift: true,
  code
});

export async function getHotkeys() {
  const saved = (await chrome.storage.sync.get(STORE_KEY))[STORE_KEY] || {};
  const out = {};
  for (const a of ACTIONS) out[a.id] = saved[a.id] || defaultHotkey(a.code);
  return out;
}

export async function setHotkey(id, hk) {
  const saved = (await chrome.storage.sync.get(STORE_KEY))[STORE_KEY] || {};
  saved[id] = hk;
  await chrome.storage.sync.set({ [STORE_KEY]: saved });
}

export const resetHotkeys = () => chrome.storage.sync.remove(STORE_KEY);

const KEY_NAMES = {
  Space: 'Space', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[',
  BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫',
  Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins'
};

export function keyLabel(code, key) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return KEY_NAMES[code] || (key && key.length === 1 ? key.toUpperCase() : code);
}

export function formatHotkey(hk) {
  if (!hk) return 'Not set';
  const k = keyLabel(hk.code, hk.key);
  if (OS === 'mac') return `${hk.ctrl ? '⌃' : ''}${hk.alt ? '⌥' : ''}${hk.shift ? '⇧' : ''}${hk.meta ? '⌘' : ''}${k}`;
  return [hk.ctrl && 'Ctrl', hk.alt && 'Alt', hk.shift && 'Shift', hk.meta && 'Win', k].filter(Boolean).join(' + ');
}

export const fromEvent = (e) => ({
  ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code, key: e.key
});

export const isModifierOnly = (e) =>
  ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS', 'Fn', 'AltGraph'].includes(e.key);

export const sameHotkey = (a, b) =>
  !!a && !!b && a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt &&
  !!a.shift === !!b.shift && !!a.meta === !!b.meta;

/** @returns {{error?: string, warning?: string}} */
export function checkHotkey(hk, other) {
  if (!hk.ctrl && !hk.alt && !hk.meta) {
    return { error: `Include ${OS === 'mac' ? '⌘, ⌥ or ⌃' : 'Ctrl or Alt'} so it doesn't fire while you type.` };
  }
  if (sameHotkey(hk, other)) return { error: 'The other action already uses that hotkey.' };
  const primary = OS === 'mac' ? hk.meta : hk.ctrl;
  const L = keyLabel(hk.code);
  if (primary && !hk.alt && !hk.shift && ['T', 'W', 'N', 'Q', 'Tab'].includes(L)) {
    return { error: 'Chrome reserves this shortcut. Pick another.' };
  }
  if (primary && hk.shift && !hk.alt && ['T', 'N', 'W', 'Q', 'I', 'J', 'C', 'B', 'O', 'A', 'M', 'D', 'R', 'V', 'Z'].includes(L)) {
    return { warning: 'Chrome or Google Sheets already uses this. It may not work everywhere.' };
  }
  if (primary && !hk.shift && !hk.alt) {
    return { warning: 'Sites often use this for copy/paste etc. Adding Shift is safer.' };
  }
  if (OS === 'win' && hk.alt && hk.shift && !hk.ctrl) {
    return { warning: 'On Windows, Alt + Shift can switch keyboard language.' };
  }
  return {};
}
