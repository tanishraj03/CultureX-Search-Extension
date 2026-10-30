// Reads the clipboard (text + any hyperlinks, e.g. from Google Sheets cells).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'readClipboard') return false;
  const box = document.getElementById('paste');
  box.innerHTML = '';
  box.focus();
  document.execCommand('paste');
  const links = [...box.querySelectorAll('a[href]')].map((a) => a.href);
  const text = box.innerText || box.textContent || '';
  box.innerHTML = '';
  sendResponse({ text, links });
  return false;
});
