import { siteOf, keyOf, loadSite, saveSite, ensureContent, startPicker, exportAll, parseTransfer, importSites } from './shared.js';

const $ = (id) => document.getElementById(id);

// `?tab=<id>` lets the popup be opened as a page for a given tab (used by the test harness).
const forcedTab = Number(new URLSearchParams(location.search).get('tab'));
const tab = forcedTab
  ? await chrome.tabs.get(forcedTab)
  : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const site = tab && siteOf(tab.url || '');

const commands = await chrome.commands.getAll();
const pickCommand = commands.find((c) => c.name === 'pick');
$('shortcut').textContent = (pickCommand && pickCommand.shortcut) || '';

initTransfer();

if (!site) {
  $('main').hidden = true;
  $('switch').hidden = true;
  $('unsupported').hidden = false;
  $('site').textContent = tab && tab.url ? new URL(tab.url).protocol.replace(':', '') + ' page' : '';
} else {
  $('site').textContent = site;
  init();
}

async function init() {
  let state = await loadSite(site);
  render(state);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[keyOf(site)]) {
      const v = changes[keyOf(site)].newValue || {};
      state = { rules: Array.isArray(v.rules) ? v.rules : [], paused: !!v.paused };
      render(state);
    }
  });

  // Hovering a row shows that element again, outlined, while the pointer stays on the row.
  let port = null;
  if (await ensureContent(tab.id)) {
    try {
      port = chrome.tabs.connect(tab.id, { name: 'hide-it-preview', frameId: 0 });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        port = null;
      });
    } catch {
      port = null;
    }
  }
  const preview = (selector) => {
    try {
      port && port.postMessage({ selector });
    } catch {}
  };

  $('pick').addEventListener('click', async () => {
    if (await startPicker(tab.id)) window.close();
    else {
      $('main').hidden = true;
      $('unsupported').hidden = false;
    }
  });

  $('enabled').addEventListener('change', async (e) => {
    state = await loadSite(site);
    state.paused = !e.target.checked;
    await saveSite(site, state);
  });

  // Decided per mouseover at the document level: the list re-renders on every change, and
  // a row removed from under the pointer never gets its mouseleave — the preview would stick.
  let previewing = null;
  const setPreview = (selector) => {
    if (selector === previewing) return;
    previewing = selector;
    preview(selector);
  };
  document.addEventListener('mouseover', (e) => {
    const li = e.target.closest && e.target.closest('#list li');
    setPreview(li ? li.dataset.selector : null);
  });
  document.documentElement.addEventListener('mouseleave', () => setPreview(null));
  const list = $('list');
  list.addEventListener('click', async (e) => {
    const remove = e.target.closest('.remove');
    const mode = e.target.closest('.mode');
    if (!remove && !mode) return;
    const id = e.target.closest('li').dataset.id;
    state = await loadSite(site);
    if (remove) {
      setPreview(null);
      state.rules = state.rules.filter((r) => r.id !== id);
    } else {
      state.rules = state.rules.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r };
        if (r.mode === 'hover') delete next.mode;
        else next.mode = 'hover';
        return next;
      });
    }
    await saveSite(site, state);
  });

  let armTimer = 0;
  $('clear').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'Click again to show all';
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        btn.classList.remove('armed');
        btn.textContent = 'Show all';
      }, 3000);
      return;
    }
    clearTimeout(armTimer);
    btn.classList.remove('armed');
    btn.textContent = 'Show all';
    state = await loadSite(site);
    state.rules = [];
    await saveSite(site, state);
  });
}

// ---- Copy / Paste rules between Chrome profiles (works on any page, even chrome:// ones).
function initTransfer() {
  const msg = $('transfer-msg');
  const box = $('paste-box');
  const input = $('paste-input');
  let msgTimer = 0;
  const say = (text, error = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', error);
    msg.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => (msg.hidden = true), 6000);
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const isValid = (sel) => {
    try {
      document.createDocumentFragment().querySelector(sel);
      return !/[{}]/.test(sel.replace(/"(?:\\.|[^"\\])*"/g, ''));
    } catch {
      return false;
    }
  };
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  input.placeholder = `Press ${isMac ? '⌘V' : 'Ctrl+V'} to paste rules copied in another profile`;

  $('copy').addEventListener('click', async () => {
    const { text, count, siteCount } = await exportAll();
    if (!count) return say('Nothing hidden in this profile yet.', true);
    try {
      await navigator.clipboard.writeText(text);
      say(`Copied ${plural(count, 'rule')} from ${plural(siteCount, 'site')}. In the other profile: Hide It → Paste rules.`);
    } catch {
      say('Couldn’t reach the clipboard — try again.', true);
    }
  });

  const closeBox = () => {
    box.hidden = true;
    input.value = '';
  };
  $('paste').addEventListener('click', () => {
    box.hidden = false;
    msg.hidden = true;
    input.focus();
  });
  $('paste-cancel').addEventListener('click', closeBox);

  let busy = false;
  const tryImport = async (text) => {
    if (busy || !text.trim()) return;
    const sites = parseTransfer(text);
    if (!sites) {
      say('That isn’t a Hide It copy. Use “Copy all rules” in the other profile first.', true);
      return;
    }
    busy = true;
    try {
      const { added, already, sites: siteCount } = await importSites(sites, isValid);
      closeBox();
      if (added) say(`Added ${plural(added, 'rule')} on ${plural(siteCount, 'site')}${already ? ` (${already} already here)` : ''}.`);
      else say(already ? `All ${plural(already, 'rule')} were already here.` : 'No rules in that copy.');
    } finally {
      busy = false;
    }
  };
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    tryImport(e.clipboardData.getData('text/plain'));
  });
  input.addEventListener('input', () => tryImport(input.value)); // typed or dropped in
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBox();
    }
  });
}

function cursorIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 3l13.5 8.2-6 1.3-2.7 5.6z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function render({ rules, paused }) {
  document.body.classList.toggle('paused', paused);
  $('enabled').checked = !paused;
  $('count').textContent = rules.length
    ? `${rules.length} hidden on this site${paused ? ' — paused' : ''}`
    : 'Hidden on this site';
  $('clear').hidden = rules.length < 2;
  $('empty').hidden = rules.length > 0;

  const list = $('list');
  list.replaceChildren(
    ...rules
      .slice()
      .reverse()
      .map((r) => {
        const li = document.createElement('li');
        li.dataset.id = r.id;
        li.dataset.selector = r.selector;

        const text = document.createElement('div');
        text.className = 'text';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = r.label || r.selector;
        label.title = r.label || '';
        const selector = document.createElement('span');
        selector.className = 'selector';
        if (r.mode === 'hover' || r.text) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = r.text ? 'text' : 'on hover';
          badge.title = r.text ? 'Hides only the loose text written straight into this element' : '';
          selector.append(badge);
        }
        selector.append(r.selector);
        selector.title = r.selector;
        text.append(label, selector);

        const remove = document.createElement('button');
        remove.className = 'remove';
        remove.title = 'Show this again';
        remove.setAttribute('aria-label', `Show “${r.label || r.selector}” again`);
        remove.textContent = '✕';

        // Loose text collapses when hidden — there's no place left to point at, so no ↖.
        if (r.text) {
          li.append(text, remove);
          return li;
        }

        const hover = r.mode === 'hover';
        const mode = document.createElement('button');
        mode.className = `mode${hover ? ' on' : ''}`;
        mode.title = hover
          ? 'Shows when the pointer is over its place — click to hide it completely'
          : 'Show it only when the pointer is over its place';
        mode.setAttribute('aria-pressed', String(hover));
        mode.setAttribute('aria-label', 'Show on hover');
        mode.append(cursorIcon());

        li.append(text, mode, remove);
        return li;
      }),
  );
}
