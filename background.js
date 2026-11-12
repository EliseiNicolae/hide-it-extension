import { siteOf, startPicker } from './shared.js';

const MENU_ID = 'hide-it-pick';
const GATE_ID = 'hide-it-gate';

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Hide an element on this page…',
      contexts: ['page', 'link', 'image', 'selection', 'video', 'frame'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });

  syncGate();

  // Tabs that were already open don't run the content script until they reload.
  // Inject it now so saved rules apply and the picker works right away.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.discarded) continue;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(syncGate);

/**
 * gate.js runs at document_start only on sites that have active rules (see gate.js for why).
 * Its match list follows storage: every site key with rules and not paused.
 */
let gateQueue = Promise.resolve();
function syncGate() {
  gateQueue = gateQueue.then(doSyncGate, doSyncGate);
  return gateQueue;
}

async function doSyncGate() {
  const all = await chrome.storage.local.get(null);
  const patterns = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('site:') || !value || value.paused || !Array.isArray(value.rules) || !value.rules.length) continue;
    const site = key.slice(5);
    if (!/^[a-z0-9.-]+$/i.test(site)) continue; // IPv6 and other oddities: no gate, rules still apply
    patterns.push(`*://${site}/*`);
    if (!/^\d+(\.\d+){3}$/.test(site)) patterns.push(`*://www.${site}/*`); // www.<IP> is not a valid host
  }
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [GATE_ID] });
  if (!patterns.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [GATE_ID] });
    return;
  }
  const script = {
    id: GATE_ID,
    js: ['gate.js'],
    matches: patterns,
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: true,
  };
  try {
    await putGate(script, existing.length > 0);
  } catch {
    // One pattern Chrome rejects fails the whole list: keep the ones it accepts.
    script.matches = await acceptedPatterns(patterns);
    if (script.matches.length) await putGate(script, existing.length > 0).catch(() => {});
  }
}

const putGate = (script, exists) =>
  exists ? chrome.scripting.updateContentScripts([script]) : chrome.scripting.registerContentScripts([script]);

async function acceptedPatterns(patterns) {
  const ok = [];
  for (const p of patterns) {
    const probe = { id: 'hide-it-probe', js: ['gate.js'], matches: [p], persistAcrossSessions: false };
    try {
      await chrome.scripting.registerContentScripts([probe]);
      await chrome.scripting.unregisterContentScripts({ ids: [probe.id] });
      ok.push(p);
    } catch {}
  }
  return ok;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('site:'))) syncGate();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab && tab.id != null) {
    startPicker(tab.id, { atContextTarget: true });
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'pick') return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (target && target.id != null && siteOf(target.url || '')) startPicker(target.id);
});

// The content script reports how many rules apply to its page: show it on the icon.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'count' && sender.tab && sender.tab.id != null && sender.frameId === 0) {
    const tabId = sender.tab.id;
    const text = msg.paused ? 'off' : msg.count > 0 ? String(msg.count) : '';
    chrome.action.setBadgeBackgroundColor({ tabId, color: msg.paused ? '#8e8e93' : '#5a5a5f' }).catch(() => {});
    chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
    chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  }
});
