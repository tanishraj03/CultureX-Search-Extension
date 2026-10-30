const $ = (s) => document.querySelector(s);
const id = new URLSearchParams(location.search).get('id');
const key = `confirm:${id}`;

(async () => {
  const data = (await chrome.storage.session.get(key))[key] || { handles: [] };
  const handles = [...(data.handles || [])];
  const unlock = !!data.unlock;
  const { credits } = await chrome.storage.local.get('credits');

  const notes = [];
  if (data.sourceText) notes.push(`Picked ${data.sourceText}.`);
  if (data.source === 'clipboard') notes.push('Remove anyone you didn’t mean to search.');
  if (unlock) notes.push('Each creator whose Audience tab isn’t unlocked yet will use Influenzer credits. Already-unlocked creators are skipped.');
  $('#note').textContent = notes.join(' ');
  $('#note').classList.toggle('credit', unlock);
  $('#heading').textContent = unlock ? 'Unlock audience with credits?' : 'Open these creators?';
  $('#go').className = unlock ? 'credit' : '';
  $('#dontAskWrap').hidden = !unlock;
  if (credits && credits.value) {
    $('#credits').hidden = false;
    $('#credits').textContent = `My Credits: ${credits.value}`;
  }

  function render() {
    const n = handles.length;
    $('#title').textContent = `${n} creator${n === 1 ? '' : 's'}`;
    $('#go').textContent = `${unlock ? 'Unlock' : 'Open'} ${n}`;
    $('#go').disabled = !n;
    $('#list').innerHTML = '';
    handles.forEach((h, i) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.append('@' + h);
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = 'Remove';
      x.onclick = () => {
        handles.splice(i, 1);
        render();
      };
      c.appendChild(x);
      $('#list').appendChild(c);
    });
  }
  render();

  $('#cancel').onclick = async () => {
    await chrome.storage.session.remove(key);
    window.close();
  };
  $('#go').onclick = async () => {
    if (!handles.length) return;
    $('#go').disabled = true;
    if (unlock && $('#dontAsk').checked) await chrome.storage.sync.set({ confirmCredits: false });
    await chrome.storage.session.remove(key);
    await chrome.runtime.sendMessage({ type: 'runBatch', handles, unlock, skipConfirm: true });
    window.close();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#cancel').click();
    if (e.key === 'Enter') $('#go').click();
  });
  $('#go').focus();
})();
