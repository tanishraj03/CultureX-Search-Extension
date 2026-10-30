export const APP = 'https://app.influenzer.io';
export const SEARCH_URL = `${APP}/global-search?tab=global-search&platform=instagram`;
export const profileUrl = (h) =>
  `${APP}/global-search/${encodeURIComponent(h)}?platform=instagram`;

export const DEFAULTS = {
  navMode: 'type', // 'type' = type into Search & Analysis and click the result (reliable), 'direct' = open the profile link
  openInBackground: false, // false = first creator tab gets focus
  groupTabs: true,
  maxTabs: 25,
  staggerMs: 350,
  confirmCredits: true,
  clipboardFallback: true,
  addUnlocksToSheet: true, // every "Search + unlock audience" also saves the creator to the sheet
  addSearchesToSheet: true, // every plain search also saves the creator to the sheet
  concurrency: 2, // creators processed at once when filling the sheet
  autoCloseTabs: true, // close each tab once its data is saved (sheet fills)
  unlockKeywords:
    'unlock audience, unlock, use credit, view audience, reveal audience, get audience, show audience, unlock report, view full report',
  confirmKeywords: 'confirm, unlock, yes, proceed, continue, use credit, ok'
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}
