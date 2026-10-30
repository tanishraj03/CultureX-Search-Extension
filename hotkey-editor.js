// Renders the "Hotkeys" editor used by both the popup and the settings page.
import {
  ACTIONS, OS, OS_NAME, PRIMARY, getHotkeys, setHotkey, resetHotkeys, formatHotkey,
  fromEvent, isModifierOnly, checkHotkey
} from './hotkeys.js';

export async function mountHotkeyEditor(root) {
  root.innerHTML = `
    <div class="hk-list"></div>
    <div class="hk-msg" hidden></div>
    <div class="hk-foot">
      <span class="muted">Click a hotkey to change it · ${OS_NAME}</span>
      <a class="hk-reset">Reset</a>
    </div>
    <div class="hk-chrome muted"></div>`;
  const list = root.querySelector('.hk-list');
  const msg = root.querySelector('.hk-msg');
  let recording = null;

  const say = (text, kind = '') => {
    msg.hidden = !text;
    msg.className = 'hk-msg ' + kind;
    msg.textContent = text || '';
  };

  async function render() {
    const hks = await getHotkeys();
    list.innerHTML = '';
    for (const a of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'hk-row';
      row.innerHTML = `<span></span><button class="hk-key" type="button"></button>`;
      row.firstChild.textContent = a.label;
      const btn = row.lastChild;
      btn.textContent = recording === a.id ? 'Press keys…' : formatHotkey(hks[a.id]);
      btn.classList.toggle('rec', recording === a.id);
      btn.title = 'Click, then press the new key combination (Esc to cancel)';
      btn.onclick = () => {
        recording = recording === a.id ? null : a.id;
        say(recording ? `Press the new hotkey, using ${PRIMARY}${OS === 'mac' ? ', ⌥ or ⌃' : ' or Alt'} plus a key. Esc cancels.` : '');
        render();
      };
      list.appendChild(row);
    }

    // Chrome-level shortcuts work in the address bar, new tab page, etc.
    const cmds = await chrome.commands.getAll();
    const parts = ACTIONS.map((a) => {
      const c = cmds.find((x) => x.name === a.command);
      return c && c.shortcut ? c.shortcut : null;
    });
    const chromeLine = root.querySelector('.hk-chrome');
    chromeLine.innerHTML = '';
    const lead = document.createElement('span');
    lead.textContent = parts.some(Boolean)
      ? `Address bar & new tabs: ${parts.map((p) => p || 'not set').join(' / ')} · `
      : 'For the address bar & new tabs, also set Chrome shortcuts · ';
    const link = document.createElement('a');
    link.textContent = 'Change in Chrome';
    link.onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    chromeLine.append(lead, link);
  }

  window.addEventListener(
    'keydown',
    async (e) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        recording = null;
        say('');
        return render();
      }
      if (isModifierOnly(e)) return;
      const hk = fromEvent(e);
      const hks = await getHotkeys();
      const otherId = ACTIONS.find((a) => a.id !== recording).id;
      const { error, warning } = checkHotkey(hk, hks[otherId]);
      if (error) return say(error, 'err');
      const id = recording;
      recording = null;
      await setHotkey(id, hk);
      say(warning ? `Saved ${formatHotkey(hk)}. ${warning}` : `Saved ${formatHotkey(hk)}.`, warning ? 'warn' : 'ok');
      render();
    },
    true
  );

  root.querySelector('.hk-reset').onclick = async () => {
    recording = null;
    await resetHotkeys();
    say('Hotkeys reset to the defaults.', 'ok');
    render();
  };

  await render();
}
