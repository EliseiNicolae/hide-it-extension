// Helpers shared by the popup and the service worker (ES module).
// content.js is a classic script and carries its own copy of siteOf/keyOf.

/** The site a rule set belongs to: the hostname without a leading "www.". */
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** One storage key per site, so a page reads only its own rules at document_start. */
export const keyOf = (site) => `site:${site}`;

export async function loadSite(site) {
  const key = keyOf(site);
  const got = await chrome.storage.local.get(key);
  const data = got[key] || {};
  return { rules: Array.isArray(data.rules) ? data.rules : [], paused: !!data.paused };
}

export async function saveSite(site, data) {
  const key = keyOf(site);
  if (!data.rules.length && !data.paused) await chrome.storage.local.remove(key);
  else await chrome.storage.local.set({ [key]: { rules: data.rules, paused: data.paused } });
}

// ---- Moving rules between Chrome profiles (each profile keeps its own chrome.storage).

export const TRANSFER_FORMAT = 'hide-it/1';

/** Every site's rules as one JSON string, for the clipboard. */
export async function exportAll() {
  const all = await chrome.storage.local.get(null);
  const sites = {};
  let count = 0;
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('site:') || !value || !Array.isArray(value.rules) || !value.rules.length) continue;
    sites[key.slice(5)] = value.rules.map(({ selector, label, mode, text, fontSize, fix }) => {
      const r = { selector, label };
      if (mode) r.mode = mode;
      if (text) Object.assign(r, { text: true, fontSize }, fix ? { fix } : {});
      return r;
    });
    count += value.rules.length;
  }
  return { text: JSON.stringify({ format: TRANSFER_FORMAT, sites }), count, siteCount: Object.keys(sites).length };
}

/** The `sites` map from pasted text, or null when it isn't a Hide It export. */
export function parseTransfer(text) {
  let data;
  try {
    data = JSON.parse(String(text).trim());
  } catch {
    return null;
  }
  if (!data || data.format !== TRANSFER_FORMAT || !data.sites || typeof data.sites !== 'object') return null;
  return data.sites;
}

/**
 * Adds pasted rules to this profile. Nothing here is replaced or removed: a selector the site
 * already has is skipped (its mode stays as this profile set it). `isValid` checks a selector.
 */
export async function importSites(sites, isValid = () => true) {
  const names = Object.keys(sites).filter((s) => typeof s === 'string' && s.length > 0 && s.length < 256);
  const current = await chrome.storage.local.get(names.map(keyOf));
  const updates = {};
  let added = 0;
  let already = 0;
  for (const site of names) {
    const incoming = Array.isArray(sites[site]) ? sites[site] : [];
    const cur = current[keyOf(site)] || {};
    const rules = Array.isArray(cur.rules) ? cur.rules.slice() : [];
    let changed = false;
    for (const r of incoming) {
      if (!r || typeof r.selector !== 'string' || !r.selector.trim() || r.selector.length > 2000 || !isValid(r.selector)) continue;
      if (rules.some((x) => x.selector === r.selector && !!x.text === !!r.text)) {
        already++;
        continue;
      }
      const rule = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        selector: r.selector,
        label: typeof r.label === 'string' && r.label ? r.label.slice(0, 200) : r.selector,
        added: Date.now(),
      };
      const px = (v) => typeof v === 'string' && /^\d+(\.\d+)?px$/.test(v);
      if (r.text) {
        rule.text = true;
        rule.fontSize = px(r.fontSize) ? r.fontSize : '16px';
        const fix = Array.isArray(r.fix) ? r.fix.filter((f) => f && typeof f.sel === 'string' && isValid(f.sel) && px(f.fontSize)) : [];
        if (fix.length) rule.fix = fix.map(({ sel, fontSize }) => ({ sel, fontSize }));
      } else if (r.mode === 'hover') {
        rule.mode = 'hover';
      }
      rules.push(rule);
      added++;
      changed = true;
    }
    if (changed) updates[keyOf(site)] = { rules, paused: !!cur.paused };
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  return { added, already, sites: Object.keys(updates).length };
}

/**
 * Make sure the tab runs our content script. Tabs opened before the extension was
 * installed (or reloaded) don't have it until they navigate, so inject it on demand.
 */
export async function ensureContent(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    if (pong && pong.ok) return true;
  } catch {
    // no listener in the tab yet
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch {
    return false; // chrome://, the Web Store, PDF viewer… pages extensions may not touch
  }
}

export async function startPicker(tabId, extra = {}) {
  if (!(await ensureContent(tabId))) return false;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'startPicker', ...extra });
    return true;
  } catch {
    return false;
  }
}
