// Hide It — content script.
//
// Two jobs:
//  1. At document_start, put one <style> into the page that sets `display: none !important`
//     on every saved selector for this site. CSS applies to an element the moment it exists,
//     so nothing is ever painted and then removed — that is what keeps it flicker-free, also
//     for single-page apps (x.com) that render their DOM long after load. For the few ms
//     before storage answers, gate.js holds the page transparent (sites with rules only).
//  2. The element picker: hover highlights, scroll or ↑/↓ grow/shrink, click hides
//     (⇧-click: invisible until the pointer is over its place), Esc leaves.
//  3. Peek: hold ⌥ alone and everything hidden shows, outlined, until it's released.
(() => {
  'use strict';

  if (!(document instanceof HTMLDocument) || !document.documentElement) return;

  // A copy injected earlier (extension reloaded, or injected into an open tab) steps down.
  document.dispatchEvent(new CustomEvent('hide-it:teardown'));

  const SITE = location.hostname.replace(/^www\./, '');
  const KEY = `site:${SITE}`;
  const ACCENT = '#ff453a';

  const cleanups = [];
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  // ---------------------------------------------------------------- hiding stylesheet

  const sheet = document.createElement('style');
  sheet.setAttribute('data-hide-it', '');
  const mount = () => {
    const root = document.documentElement;
    if (root && sheet.parentNode !== root) root.appendChild(sheet);
  };
  mount(); // empty for now; filled the moment storage answers (a few ms, before first paint)

  // Some pages rebuild <html>'s children; put the sheet back if it goes missing.
  const guard = new MutationObserver(() => {
    if (!sheet.isConnected) mount();
  });
  guard.observe(document.documentElement, { childList: true });
  cleanups.push(() => guard.disconnect());

  let rules = [];
  let paused = false;
  let previewSelector = null;

  const validCache = new Map();
  function validSelector(sel) {
    if (typeof sel !== 'string' || !sel.trim() || /[{}]/.test(sel.replace(/"(?:\\.|[^"\\])*"/g, ''))) return false;
    if (!validCache.has(sel)) {
      let ok = true;
      try {
        document.createDocumentFragment().querySelector(sel);
      } catch {
        ok = false;
      }
      validCache.set(sel, ok);
    }
    return validCache.get(sel);
  }

  // Rule modes: "hide" (default, display:none — gone, its space too) and "hover" (invisible but
  // keeps its place; pointing at that place fades it in, leaving fades it out a moment later).
  let peeking = false; // ⌥ held: everything hidden shows, outlined
  function render() {
    let css = '';
    if (peeking && !paused) {
      for (const r of rules) css += `${r.selector}{outline:2px dashed ${ACCENT}!important;outline-offset:-2px!important}\n`;
    } else if (!paused) {
      // One rule per selector: a selector the browser can't parse drops only itself.
      for (const r of rules) {
        if (r.selector === previewSelector) continue;
        if (r.text) {
          css += textRuleCss(r);
        } else if (r.mode === 'hover') {
          css += `${r.selector}:not(:hover){opacity:0!important;transition:opacity .2s ease .3s!important}\n`;
          css += `${r.selector}:hover{opacity:1!important;transition:opacity .12s ease!important}\n`;
        } else {
          css += `${r.selector}{display:none!important}\n`;
        }
      }
    }
    if (previewSelector) {
      css += `${previewSelector}{outline:3px solid ${ACCENT}!important;outline-offset:-3px!important}\n`;
    }
    if (sheet.textContent !== css) sheet.textContent = css;
  }

  /**
   * A "text" rule hides the loose text written straight into an element (no tag of its own —
   * CSS can't select a text node) while leaving that element's child elements alone:
   * font-size 0 on the element collapses its own text, and a zero-specificity rule hands the
   * children back the size they'd have inherited (any size the site sets on a child still wins).
   * Children whose size the site gives in em / % (relative to the now-0 parent) are pinned to
   * their measured size when the rule is made (`fix`).
   */
  const PX = /^\d+(\.\d+)?px$/;
  function textRuleCss(r) {
    const fs = PX.test(r.fontSize) ? r.fontSize : '16px';
    let css = `${r.selector}{font-size:0!important}\n:where(${r.selector})>:where(*){font-size:${fs}}\n`;
    for (const f of Array.isArray(r.fix) ? r.fix : []) {
      if (f && validSelector(f.sel) && PX.test(f.fontSize)) css += `:where(${r.selector})>${f.sel}{font-size:${f.fontSize}!important}\n`;
    }
    return css;
  }

  // ---------------------------------------------------------------- picker keys

  // While picking, keys (Esc, ↑ ↓, Enter, ⌘Z) are the picker's. Listened for here, at
  // document_start, before any page script: this runs first, so a page's own Esc handler
  // (a gallery, a video player) can't swallow the key before the picker sees it.
  listen(window, 'keydown', (e) => {
    if (picker) picker.key(e);
  }, true);

  // ---------------------------------------------------------------- peek: hold ⌥

  // Holding ⌥ on its own for a moment shows everything hidden; letting go hides it again.
  // ⌥ + any other key (a shortcut, a special character) never peeks.
  const PEEK_DELAY = 300;
  let peekTimer = 0;
  function setPeek(on) {
    clearTimeout(peekTimer);
    if (peeking === on) return;
    peeking = on;
    render();
  }
  listen(window, 'keydown', (e) => {
    if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (!e.repeat && !picker && !paused && rules.length && !peeking) {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => setPeek(true), PEEK_DELAY);
      }
      return;
    }
    setPeek(false);
  }, true);
  listen(window, 'keyup', (e) => {
    if (e.key === 'Alt') setPeek(false);
  }, true);
  listen(window, 'blur', () => setPeek(false)); // ⌥ released in another app never reaches us
  listen(document, 'visibilitychange', () => setPeek(false));

  function apply(data) {
    data = data || {};
    rules = Array.isArray(data.rules) ? data.rules.filter((r) => r && validSelector(r.selector)) : [];
    paused = !!data.paused;
    render();
    liftGate();
    report();
    if (picker) picker.refreshCount();
  }

  // gate.js (sites with rules only) keeps the page transparent until the rules are in.
  function liftGate() {
    for (const g of document.querySelectorAll('style[data-hide-it-gate]')) g.remove();
  }

  function report() {
    try {
      chrome.runtime.sendMessage({ type: 'count', count: rules.length, paused }).catch(() => {});
    } catch {
      // extension context gone (reloaded) — nothing to report to
    }
  }

  chrome.storage.local.get(KEY).then((got) => apply(got[KEY]), liftGate);

  const onStorage = (changes, area) => {
    if (area === 'local' && changes[KEY]) apply(changes[KEY].newValue);
  };
  chrome.storage.onChanged.addListener(onStorage);
  cleanups.push(() => {
    try {
      chrome.storage.onChanged.removeListener(onStorage);
    } catch {}
  });

  async function mutate(fn) {
    const got = await chrome.storage.local.get(KEY);
    const data = got[KEY] || {};
    const next = { rules: Array.isArray(data.rules) ? data.rules.slice() : [], paused: !!data.paused };
    fn(next);
    if (!next.rules.length && !next.paused) await chrome.storage.local.remove(KEY);
    else await chrome.storage.local.set({ [KEY]: next });
  }

  // ---------------------------------------------------------------- messages

  let lastContextTarget = null;
  listen(document, 'contextmenu', (e) => {
    if (!picker && e.target instanceof Element) lastContextTarget = e.target;
  }, true);

  const onMessage = (msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'ping') {
      sendResponse({ ok: true });
    } else if (msg.type === 'startPicker') {
      startPicker(msg.atContextTarget ? lastContextTarget : null);
      sendResponse({ ok: true });
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // The popup holds a port open while it shows; hovering a row there previews that rule.
  const onConnect = (port) => {
    if (port.name !== 'hide-it-preview') return;
    port.onMessage.addListener((m) => {
      previewSelector = m && validSelector(m.selector) ? m.selector : null;
      render();
    });
    port.onDisconnect.addListener(() => {
      previewSelector = null;
      render();
    });
  };
  chrome.runtime.onConnect.addListener(onConnect);
  cleanups.push(() => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.runtime.onConnect.removeListener(onConnect);
    } catch {}
  });

  // ---------------------------------------------------------------- selectors

  const PRIORITY_ATTRS = [
    'data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-component',
    'aria-label', 'role', 'name', 'title', 'alt', 'itemprop',
  ];
  const TEXT_ATTRS = new Set(['aria-label', 'title', 'alt']);
  const STATE_CLASS = /^(is-|has-)|^(active|hover|hovered|focus|focused|selected|open|opened|visible|hidden|show|shown|current|expanded|collapsed|disabled|loading|loaded|animating|sticky|in|fade|dark|light)$/i;

  /** Class names / ids that a build tool generated (r-1adg3ll, css-175oi2r, Button_root__a1B2c…). */
  function looksGenerated(s) {
    if (!s || s.length > 48) return true;
    if (/^(css|r|sc|jsx|emotion|svelte|astro)-/.test(s)) return true;
    if (/\d{3,}/.test(s)) return true;
    return s.split(/[-_]+/).some((p) => p.length >= 5 && /\d/.test(p) && /[a-z]/i.test(p));
  }

  function stableAttr(name, v) {
    if (!v || v.length > 80 || /[\n\r]/.test(v)) return false;
    if (TEXT_ATTRS.has(name)) return !/\d/.test(v); // "3 unread" changes; "Primary" doesn't
    return !looksGenerated(v.replace(/\s+/g, '-')) || !/\d/.test(v);
  }

  const quote = (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  /** Ways to name `el` alone, most meaningful first; the bare tag last. */
  function segments(el) {
    const tag = CSS.escape(el.localName);
    const out = [];
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !looksGenerated(el.id)) out.push(`#${CSS.escape(el.id)}`);
    const attrs = [];
    for (const a of PRIORITY_ATTRS) {
      const v = el.getAttribute(a);
      if (v != null && stableAttr(a, v)) attrs.push(`[${a}=${quote(v)}]`);
    }
    for (const a of attrs) out.push(tag + a);
    if (attrs.length > 1) out.push(tag + attrs[0] + attrs[1]);
    const classes = Array.from(el.classList).filter((c) => !looksGenerated(c) && !STATE_CLASS.test(c)).slice(0, 3);
    if (classes.length) out.push(tag + classes.map((c) => `.${CSS.escape(c)}`).join(''));
    out.push(tag);
    return out;
  }

  const anchorSegments = (el) => segments(el).slice(0, -1);

  function isUnique(sel, el) {
    try {
      const all = document.querySelectorAll(sel);
      return all.length === 1 && all[0] === el;
    } catch {
      return false;
    }
  }

  function nthSegment(el) {
    const tag = CSS.escape(el.localName);
    const parent = el.parentElement;
    if (!parent) return tag;
    let index = 0;
    let count = 0;
    for (let s = parent.firstElementChild; s; s = s.nextElementSibling) {
      if (s.localName === el.localName) {
        count++;
        if (s === el) index = count;
      }
    }
    return count > 1 ? `${tag}:nth-of-type(${index})` : tag;
  }

  /** Last resort: a child path from the nearest distinctive ancestor (or <body>). */
  function positionalPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur !== el) {
        const anchor = anchorSegments(cur).find((s) => isUnique(s, cur));
        if (anchor) {
          parts.unshift(anchor);
          return parts.join(' > ');
        }
      }
      const parent = cur.parentElement;
      const own = anchorSegments(cur).find((s) => {
        try {
          return parent && Array.from(parent.children).filter((c) => c.matches(s)).length === 1;
        } catch {
          return false;
        }
      });
      parts.unshift(own || nthSegment(cur));
      cur = parent;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  function selectorFor(el) {
    const own = segments(el);
    for (const s of own) if (isUnique(s, el)) return s;

    // A distinctive direct child names its wrapper: div:has(> aside[aria-label="Who to follow"])
    for (const child of Array.from(el.children).slice(0, 8)) {
      for (const cs of anchorSegments(child)) {
        const s = `${CSS.escape(el.localName)}:has(> ${cs})`;
        if (isUnique(s, el)) return s;
      }
    }

    // A distinctive ancestor + the element: [data-testid="sidebarColumn"] aside
    let depth = 0;
    for (let a = el.parentElement; a && a !== document.documentElement && depth < 14; a = a.parentElement, depth++) {
      for (const as of anchorSegments(a)) {
        for (const s of own) {
          const sel = `${as} ${s}`;
          if (isUnique(sel, el)) return sel;
        }
      }
    }
    return positionalPath(el);
  }

  function fragility(sel) {
    return (
      (sel.match(/:nth-of-type/g) || []).length * 10 +
      (sel.startsWith('body') ? 6 : 0) +
      (sel.match(/ > /g) || []).length * 1.5 +
      (sel.includes(':has(') ? 1 : 0) +
      sel.length / 80
    );
  }

  // ---------------------------------------------------------------- geometry & labels

  const rectOf = (el) => el.getBoundingClientRect();
  const sameRect = (a, b) =>
    Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
  const isPage = (el) => el === document.body || el === document.documentElement;

  /** True when nothing in `parent` but `child` puts anything on screen. */
  function soleContent(parent, child) {
    if (parent.childElementCount > 30) return false;
    for (const n of parent.childNodes) {
      if (n === child) continue;
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.textContent.trim()) return false;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const r = n.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return false;
      }
    }
    return true;
  }

  /**
   * What hiding `el` should really hide: `el` plus the wrappers around it that hold nothing
   * else and add only a little chrome (a border, padding, a background). Hiding just the
   * inside of a bordered card leaves its empty border behind as a 2 px line; this takes the
   * card with it.
   */
  const WRAPPER_CHROME = 24; // px a wrapper may extend past its content on any side
  function wrapperOf(el) {
    let cur = el;
    for (let i = 0; i < 6; i++) {
      const p = cur.parentElement;
      if (!p || isPage(p) || !soleContent(p, cur)) break;
      const pr = rectOf(p);
      const cr = rectOf(cur);
      const extra = Math.max(cr.left - pr.left, cr.top - pr.top, pr.right - cr.right, pr.bottom - cr.bottom);
      if (extra > WRAPPER_CHROME) break;
      cur = p;
    }
    return cur;
  }

  /**
   * The element to hide and its selector. Wrappers that cover exactly the same box hide
   * exactly the same thing, so among `el` and its same-size ancestors keep the one with
   * the sturdiest selector (an aria-label beats a :nth-of-type path).
   */
  function bestTarget(el) {
    const r = rectOf(el);
    const candidates = [el];
    for (let p = el.parentElement; p && !isPage(p) && candidates.length < 8; p = p.parentElement) {
      if (!sameRect(rectOf(p), r)) break;
      candidates.push(p);
    }
    let best = null;
    for (const c of candidates) {
      const selector = selectorFor(c);
      const score = fragility(selector);
      if (!best || score < best.score) best = { el: c, selector, score };
    }
    return best;
  }

  const squash = (s, n) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };

  function labelFor(el) {
    const heading = el.querySelector('h1,h2,h3,h4,[role="heading"]');
    const name = squash(
      el.getAttribute('aria-label') || (heading && heading.textContent) || el.getAttribute('title') || el.getAttribute('alt') || '',
      40,
    );
    const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter((s) => s && s !== name);
    const snippet = squash(lines.slice(0, 4).join(' · '), 60);
    if (name && snippet) return squash(`${name} — ${snippet}`, 90);
    if (name || snippet) return name || snippet;
    return el.querySelector('img,svg,video,canvas,picture') ? `${el.localName} (media)` : el.localName;
  }

  // ---- Loose text: words written straight into an element that also holds other blocks
  // (<div>  <div class="grid">…</div>  Some SEO paragraph…  <footer>…</footer>  </div>).
  // The pointer can only land on that element, so the picker targets "its own text" instead.

  /** True when `el` holds blocks of its own besides text (a paragraph with links doesn't). */
  function hasBlockChildren(el) {
    let n = 0;
    for (const c of el.children) {
      if (++n > 50) break;
      if (c.localName === 'br') continue;
      const d = getComputedStyle(c).display;
      if (d !== 'none' && d !== 'contents' && !d.startsWith('inline')) return true;
    }
    return false;
  }

  /** True when (x, y) lies on text written straight into `el` (not inside a child element). */
  function looseTextAt(x, y, el) {
    if (!el || !el.firstElementChild || !hasBlockChildren(el)) return false;
    let node = null;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      node = p && p.offsetNode;
    } else if (document.caretRangeFromPoint) {
      const p = document.caretRangeFromPoint(x, y);
      node = p && p.startContainer;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || node.parentNode !== el || !node.textContent.trim()) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const q of range.getClientRects()) {
      if (x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 1 && y <= q.bottom + 1) return true;
    }
    return false;
  }

  /** The box around all of `el`'s own loose text, or null. */
  function looseTextRect(el) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const range = document.createRange();
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) {
        if (!q.width && !q.height) continue;
        left = Math.min(left, q.left);
        top = Math.min(top, q.top);
        right = Math.max(right, q.right);
        bottom = Math.max(bottom, q.bottom);
      }
    }
    return left === Infinity ? null : { left, top, width: right - left, height: bottom - top };
  }

  const looseText = (el) =>
    Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ');

  /** A selector for `child` among its siblings: a distinctive segment, else its position. */
  function childSegment(child) {
    const parent = child.parentElement;
    const own = anchorSegments(child).find((s) => {
      try {
        return Array.from(parent.children).filter((c) => c.matches(s)).length === 1;
      } catch {
        return false;
      }
    });
    return own || nthSegment(child);
  }

  function describe(el, r = rectOf(el)) {
    const aria = el.getAttribute('aria-label');
    const testid = el.getAttribute('data-testid');
    let name = el.localName;
    if (aria) name += ` “${squash(aria, 28)}”`;
    else if (testid) name += ` [${squash(testid, 28)}]`;
    else if (el.id && !looksGenerated(el.id)) name += `#${squash(el.id, 28)}`;
    return `${name}   ${Math.round(r.width)} × ${Math.round(r.height)}`;
  }

  // ---------------------------------------------------------------- picker

  let picker = null;

  function startPicker(initial) {
    if (!picker) picker = createPicker();
    if (initial && initial.isConnected && !isPage(initial)) picker.focus(initial);
  }

  function createPicker() {
    const host = document.createElement('hide-it-ui');
    host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;';
    const root = host.attachShadow({ mode: 'closed' });
    // Built with createElement, not innerHTML: pages enforcing Trusted Types reject innerHTML.
    const make = (tagName, className, ...children) => {
      const n = document.createElement(tagName);
      if (className) n.className = className;
      for (const c of children) n.append(c);
      return n;
    };
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; }
        * { box-sizing: border-box; font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; letter-spacing: 0; }
        .box { position: fixed; left: 0; top: 0; display: none; pointer-events: none;
               border: 2px solid ${ACCENT}; border-radius: 4px; background: rgba(255, 69, 58, .13);
               box-shadow: 0 0 0 1px rgba(0, 0, 0, .35), inset 0 0 0 1px rgba(255, 255, 255, .25); }
        .tag { position: absolute; left: -2px; bottom: calc(100% + 4px); padding: 3px 8px; border-radius: 6px;
               background: ${ACCENT}; color: #fff; font-size: 11px; font-weight: 600; white-space: pre;
               max-width: 70vw; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
        .tag.below { bottom: auto; top: calc(100% + 4px); }
        .tag.inside { bottom: auto; top: 4px; }
        .bar { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); pointer-events: auto; cursor: default;
               display: flex; align-items: center; gap: 12px; padding: 6px 6px 6px 14px; border-radius: 12px;
               background: rgba(28, 28, 30, .94); color: #f2f2f7; border: 1px solid rgba(255, 255, 255, .14);
               box-shadow: 0 10px 34px rgba(0, 0, 0, .4); white-space: nowrap; user-select: none; }
        .bar.bottom { top: auto; bottom: 14px; }
        .hint { color: rgba(242, 242, 247, .78); }
        .hint b { color: #fff; font-weight: 600; }
        kbd { display: inline-block; min-width: 18px; padding: 1px 5px; margin: 0 1px; border-radius: 5px; text-align: center;
              background: rgba(255, 255, 255, .12); border: 1px solid rgba(255, 255, 255, .16); color: #fff; font-size: 11px; }
        .count { color: rgba(242, 242, 247, .55); font-size: 11px; }
        .count:empty { display: none; }
        button { all: unset; cursor: pointer; padding: 5px 11px; border-radius: 8px; font-weight: 600;
                 background: rgba(255, 255, 255, .1); color: #fff; }
        button:hover { background: rgba(255, 255, 255, .18); }
        button:disabled { opacity: .35; cursor: default; background: rgba(255, 255, 255, .1); }
        button.done { background: #0a84ff; }
        button.done:hover { background: #2a95ff; }
        .toast { position: fixed; left: 50%; bottom: 18px; transform: translate(-50%, 8px); opacity: 0; pointer-events: none;
                 max-width: min(560px, 90vw); padding: 8px 14px; border-radius: 10px; overflow: hidden; text-overflow: ellipsis;
                 white-space: nowrap; background: rgba(28, 28, 30, .94); color: #f2f2f7; border: 1px solid rgba(255,255,255,.14);
                 box-shadow: 0 10px 34px rgba(0, 0, 0, .4); transition: opacity .16s ease, transform .16s ease; }
        .toast.show { opacity: 1; transform: translate(-50%, 0); }
        .toast.raised { bottom: 66px; }`;
    const tag = make('div', 'tag');
    const box = make('div', 'box', tag);
    const dot = '  ·  ';
    const hint = make('span', 'hint',
      make('b', '', 'Click'), ' hide', dot,
      make('kbd', '', '⇧'), ' + ', make('b', '', 'click'), ' show only on hover', dot,
      make('b', '', 'Scroll'), ' / ', make('kbd', '', '↑'), make('kbd', '', '↓'), ' size', dot,
      make('kbd', '', '⌥'), ' + scroll page', dot,
      make('kbd', '', 'Esc'), ' done');
    const countEl = make('span', 'count');
    const undoBtn = make('button', 'undo', 'Undo');
    undoBtn.disabled = true;
    const doneBtn = make('button', 'done', 'Done');
    const bar = make('div', 'bar', hint, countEl, undoBtn, doneBtn);
    const toastEl = make('div', 'toast');
    root.append(style, box, bar, toastEl);

    // Frames (ads, players, embeds) let the pointer through while picking. Otherwise the page
    // inside one takes the hover and the click — an ad opens instead of being hidden — and,
    // once clicked, the keyboard too: Esc would go to the frame and the picker would stay.
    const cursor = document.createElement('style');
    cursor.textContent =
      'html, html * { cursor: crosshair !important; }\n' +
      'iframe, frame, embed, object { pointer-events: none !important; }';
    document.documentElement.append(cursor, host);

    let hoverEl = null; // deepest element under the pointer
    let current = null; // what a click hides: hoverEl or one of its ancestors
    let adjusted = false; // the user moved current up or down (↑ ↓ / scroll): keep that level
    let hoverText = null; // hoverEl, when the pointer is on its own loose text
    let textMode = false; // the target is current's loose text, not current itself
    let lastX = -1;
    let lastY = -1;
    // After a hide, nothing is targeted until the pointer moves: a double-click must not
    // also hide whatever slid in under the cursor.
    let armed = true;
    let disarmX = 0;
    let disarmY = 0;
    const undoStack = [];
    let toastTimer = 0;
    let frame = 0;
    const off = [];
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      off.push(() => target.removeEventListener(type, fn, opts));
    };

    const fromUI = (e) => e.composedPath().includes(host);

    // With frames letting the pointer through, elementFromPoint lands on what's behind one:
    // step back into the frame that covers the point.
    const frames = document.getElementsByTagName('iframe');
    function frameAt(el, x, y) {
      let found = null;
      for (const f of frames) {
        if (!el.contains(f)) continue;
        const r = rectOf(f);
        if (r.width && r.height && x >= r.left && x < r.right && y >= r.top && y < r.bottom) found = f;
      }
      return found;
    }

    function hit(x, y) {
      if (x < 0 || y < 0) return null;
      let el = document.elementFromPoint(x, y);
      if (!el || el === host) return null;
      el = frameAt(el, x, y) || el;
      return isPage(el) ? null : el;
    }

    // Keys reach only the window that has the focus. If a frame holds it (a player clicked
    // before picking, a script focusing an ad), Esc would never get here: take it back.
    function releaseFrameFocus() {
      const a = document.activeElement;
      if (a && /^(IFRAME|FRAME|EMBED|OBJECT)$/.test(a.tagName)) a.blur();
    }
    releaseFrameFocus();
    // Focus moving into a frame blurs this window: the frame has it by the next task.
    on(window, 'blur', () => setTimeout(() => picker && releaseFrameFocus()));

    // Lines — separators, a card emptied down to its border — are too thin to land on:
    // one within THIN_REACH px of the pointer wins over what's under it.
    const THIN = 3;
    const THIN_REACH = 6;
    const isThin = (el) => {
      const r = rectOf(el);
      return (r.height > 0 && r.height <= THIN && r.width >= 10) || (r.width > 0 && r.width <= THIN && r.height >= 10);
    };
    function elementAt(x, y) {
      const base = hit(x, y);
      if (base && isThin(base)) return base;
      for (let d = 1; d <= THIN_REACH; d++) {
        for (const [dx, dy] of [[0, -d], [0, d], [-d, 0], [d, 0]]) {
          const c = hit(x + dx, y + dy);
          if (c && c !== base && isThin(c)) return c;
        }
      }
      return base;
    }

    // Start big: the outline opens on the largest block under the pointer that is still a
    // part of the page (≤ START_MAX_AREA of the viewport — a column, a card, a section, never
    // the whole page); scroll down / ↓ narrows it. A thin line is taken as is.
    const START_MAX_AREA = 0.25;
    // Only a real box around the pointer can be outlined: wrappers with no box of their own
    // (display: contents — Tailwind's `contents`, all over React apps) or one that doesn't
    // cover the pointer are stepped over, never settled on.
    const holds = (r, x, y) => r.width > 0 && r.height > 0 && x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;
    function startFor(el, x, y) {
      if (isThin(el)) return el;
      const cap = innerWidth * innerHeight * START_MAX_AREA;
      let best = el;
      for (let p = el.parentElement; p && !isPage(p); p = p.parentElement) {
        const r = rectOf(p);
        if (r.width * r.height > cap) break;
        if (holds(r, x, y)) best = p;
      }
      return best;
    }

    /** The first element from `top` down to `bottom` that has a box (bottom always does). */
    function firstBoxed(top, bottom) {
      const path = [];
      for (let n = bottom; n && n !== top; n = n.parentElement) path.push(n);
      for (let i = path.length - 1; i >= 0; i--) {
        const r = rectOf(path[i]);
        if (r.width > 0 && r.height > 0) return path[i];
      }
      return bottom;
    }

    function track(x, y) {
      const el = elementAt(x, y);
      if (!el) return;
      hoverEl = el;
      hoverText = looseTextAt(x, y, el) ? el : null;
      // A level the user picked holds while the pointer stays inside it.
      if (adjusted && current && current.isConnected && current.contains(el)) return;
      current = startFor(el, x, y);
      adjusted = false;
      textMode = !!hoverText && current === el;
    }

    // `current` is what the pointer chose; what's outlined and hidden is wrapperOf(current)
    // — or, in textMode, just current's own loose text.
    function bigger() {
      if (!current) return;
      adjusted = true;
      if (textMode) {
        textMode = false; // its text → the whole element
        return;
      }
      const base = wrapperOf(current);
      const r = rectOf(base);
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      for (let p = base.parentElement; p && !isPage(p); p = p.parentElement) {
        const pr = rectOf(p);
        if (holds(pr, cx, cy) && !sameRect(pr, r)) {
          current = p;
          return;
        }
      }
    }

    function smaller() {
      if (!current || !hoverEl) return;
      adjusted = true;
      if (current === hoverEl) {
        if (hoverText === current && !textMode) textMode = true; // the element → its own text
        return;
      }
      if (!current.contains(hoverEl)) return;
      textMode = false;
      const shown = wrapperOf(current);
      const r = rectOf(shown);
      const path = [];
      for (let n = hoverEl; n && n !== current; n = n.parentElement) path.push(n);
      for (let i = path.length - 1; i >= 0; i--) {
        if (wrapperOf(path[i]) === shown) continue; // would outline the same thing
        const pr = rectOf(path[i]);
        if (holds(pr, lastX, lastY) && !sameRect(pr, r)) {
          current = path[i];
          return;
        }
      }
      current = hoverEl;
    }

    function disarm() {
      armed = false;
      disarmX = lastX;
      disarmY = lastY;
      hoverEl = current = hoverText = null;
      adjusted = textMode = false;
    }

    function arm() {
      if (armed) return;
      armed = true;
      track(lastX, lastY);
    }

    function draw() {
      if (!current || !current.isConnected) {
        current = null;
        if (hoverEl && !hoverEl.isConnected) hoverEl = null;
      }
      // Never outline nothing: if the target lost its box (re-render, a boxless wrapper),
      // step down toward the pointer to the first element that has one.
      if (current && !textMode && hoverEl && current !== hoverEl && current.contains(hoverEl)) {
        const cr = rectOf(current);
        if (!cr.width || !cr.height) current = firstBoxed(current, hoverEl);
      }
      const shown = armed && current && (textMode ? current : wrapperOf(current));
      const r = shown && (textMode ? looseTextRect(shown) : rectOf(shown));
      if (!r || (!r.width && !r.height)) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      box.style.transform = `translate(${r.left}px, ${r.top}px)`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      const text = textMode ? `text in ${describe(shown, r)}` : describe(shown);
      if (tag.textContent !== text) tag.textContent = text;
      // The label never sits on what it names: above the outline, else below it, and only
      // inside when neither fits; sideways it stays on screen.
      const tw = tag.offsetWidth;
      const th = tag.offsetHeight || 22;
      const place = r.top >= th + 6 ? 'above' : r.top + r.height + th + 6 <= innerHeight ? 'below' : 'inside';
      tag.classList.toggle('below', place === 'below');
      tag.classList.toggle('inside', place === 'inside');
      const want = place === 'inside' ? r.left + 4 : r.left - 2;
      const x = Math.max(6, Math.min(want, innerWidth - tw - 6));
      tag.style.left = `${Math.round(x - r.left)}px`;
    }

    // Follow scrolling, re-layout and SPA updates while picking.
    const loop = () => {
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    function placeBar() {
      // Get out of the way of what's being pointed at.
      if (lastY >= 0 && lastY < 90) bar.classList.add('bottom');
      else if (lastY > innerHeight - 90) bar.classList.remove('bottom');
      toastEl.classList.toggle('raised', bar.classList.contains('bottom'));
    }

    function refreshCount() {
      countEl.textContent = rules.length ? `${rules.length} hidden on ${SITE}` : '';
      undoBtn.disabled = !undoStack.length;
    }

    function toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
    }

    /** mode: 'hide' (gone) or 'hover' (invisible until the pointer is over its place). */
    async function hideCurrent(mode = 'hide') {
      if (!armed || !current || !current.isConnected) return;
      const isText = textMode;
      // Loose text belongs to exactly this element: no wrapper, no same-size ancestor.
      const { el, selector } = isText ? { el: current, selector: selectorFor(current) } : bestTarget(wrapperOf(current));
      const label = isText ? `Text: ${squash(looseText(el), 70)}` : labelFor(el);
      const stored = mode === 'hover' && !isText ? 'hover' : undefined;
      if (isText) mode = 'hide'; // text collapses; it can't wait under the pointer
      const existing = rules.find((r) => r.selector === selector && !!r.text === isText);
      let step = null;
      if (!existing) {
        const rule = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, selector, label, added: Date.now() };
        if (stored) rule.mode = stored;
        if (isText) {
          // What the children inherit today, and which children the site sizes in em / %
          // (they'd shrink with the parent's font-size 0): measured, then pinned.
          const before = Array.from(el.children).map((c) => [c, getComputedStyle(c).fontSize]);
          rule.text = true;
          rule.fontSize = getComputedStyle(el).fontSize;
          rules = rules.concat(rule);
          paused = false;
          render();
          const fix = [];
          for (const [c, fs] of before) {
            if (fs !== '0px' && getComputedStyle(c).fontSize === '0px') fix.push({ sel: childSegment(c), fontSize: fs });
          }
          if (fix.length) rule.fix = fix;
        } else {
          rules = rules.concat(rule);
        }
        step = { id: rule.id, kind: 'add' };
      } else if (existing.mode !== stored) {
        // Same element picked again the other way (⇧ or not): switch its mode.
        step = { id: existing.id, kind: 'mode', prev: existing.mode };
        rules = rules.map((r) => (r === existing ? { ...r, mode: stored } : r));
      }
      if (step) {
        paused = false;
        render(); // apply now; storage confirms a moment later
        undoStack.push(step);
        const next = rules.find((r) => r.id === step.id);
        try {
          await mutate((d) => {
            d.paused = false;
            d.rules = d.rules.filter((r) => r.id !== next.id && !(r.selector === next.selector && !!r.text === !!next.text)).concat(next);
          });
        } catch {
          toast('Hide It was updated — reload the page to keep hiding things here.');
          return;
        }
      }
      toast(mode === 'hover' ? `Shows only on hover: ${label}` : `Hidden: ${label}`);
      disarm();
      refreshCount();
    }

    async function undo() {
      const step = undoStack.pop();
      refreshCount();
      if (!step) return;
      const rule = rules.find((r) => r.id === step.id);
      if (step.kind === 'mode') {
        rules = rules.map((r) => (r.id === step.id ? { ...r, mode: step.prev } : r));
      } else {
        rules = rules.filter((r) => r.id !== step.id);
      }
      render();
      try {
        await mutate((d) => {
          if (step.kind === 'mode') d.rules = d.rules.map((r) => (r.id === step.id ? { ...r, mode: step.prev } : r));
          else d.rules = d.rules.filter((r) => r.id !== step.id);
        });
      } catch {}
      if (rule) toast(step.kind === 'mode' ? `Back to before: ${rule.label}` : `Shown again: ${rule.label}`);
      // Point at what just came back.
      requestAnimationFrame(() => {
        armed = true;
        track(lastX, lastY);
      });
    }

    // While picking, the page gets no clicks, presses or hover events — only we do.
    const block = (e) => {
      if (fromUI(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click' && e.button === 0 && armed) {
        track(e.clientX, e.clientY);
        hideCurrent(e.shiftKey ? 'hover' : 'hide');
      }
    };
    for (const type of [
      'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
      'touchstart', 'touchend', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
      'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    ]) {
      on(window, type, block, { capture: true, passive: false });
    }

    on(window, 'mousemove', (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      placeBar();
      if (!armed && Math.hypot(lastX - disarmX, lastY - disarmY) > 3) armed = true;
      if (armed && !fromUI(e)) track(lastX, lastY);
    }, { capture: true, passive: true });

    on(window, 'scroll', () => {
      if (armed) track(lastX, lastY);
    }, { capture: true, passive: true });

    // The wheel grows / shrinks the target (scroll up = bigger). ⌥ + wheel scrolls the page.
    // Steps go by time, not by delta: Chrome on macOS reports one mouse notch as anything from
    // ~4 px (slow) to 100+ px (fast), and a trackpad as a stream of small deltas plus momentum.
    // So: the first event of a gesture is one level; a continuous stream (a fast roll, a swipe,
    // its momentum) adds at most one level per REPEAT_GAP — slow enough to never overshoot.
    const GESTURE_GAP = 180; // ms of quiet that ends a wheel gesture
    const REPEAT_GAP = 250; // ms between two levels inside one gesture
    let wheelLastEvent = 0;
    let wheelLastStep = 0;
    let wheelDir = 0;
    on(window, 'wheel', (e) => {
      if (e.altKey || fromUI(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (Math.abs(e.deltaY) < 0.5) return; // sideways swipes, end-of-gesture zeros
      const now = performance.now();
      const dir = Math.sign(e.deltaY);
      const fresh = now - wheelLastEvent > GESTURE_GAP || dir !== wheelDir;
      wheelLastEvent = now;
      wheelDir = dir;
      if (!fresh && now - wheelLastStep < REPEAT_GAP) return;
      wheelLastStep = now;
      arm();
      if (dir < 0) bigger();
      else smaller();
    }, { capture: true, passive: false });

    // Called by the window keydown listener set up at document_start (see "picker keys").
    function key(e) {
      const k = e.key;
      let handled = true;
      if (k === 'Escape') stop();
      else if (k === 'ArrowUp') {
        arm();
        bigger();
      } else if (k === 'ArrowDown') {
        arm();
        smaller();
      } else if (k === 'Enter') hideCurrent(e.shiftKey ? 'hover' : 'hide');
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k.toLowerCase() === 'z') undo();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    undoBtn.addEventListener('click', () => undo());
    doneBtn.addEventListener('click', () => stop());
    // Presses on the toolbar are ours: the page never hears about them.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      bar.addEventListener(type, (e) => e.stopPropagation());
    }

    function stop() {
      cancelAnimationFrame(frame);
      clearTimeout(toastTimer);
      off.forEach((f) => f());
      host.remove();
      cursor.remove();
      picker = null;
    }

    function focus(el) {
      armed = true;
      hoverEl = current = el;
      hoverText = null;
      adjusted = textMode = false;
      const r = rectOf(el);
      lastX = r.left + r.width / 2;
      lastY = r.top + r.height / 2;
      placeBar();
    }

    refreshCount();
    return { stop, focus, refreshCount, key };
  }

  // ---------------------------------------------------------------- teardown

  const teardown = () => {
    if (picker) picker.stop();
    previewSelector = null;
    sheet.remove();
    cleanups.forEach((f) => f());
    document.removeEventListener('hide-it:teardown', teardown);
  };
  document.addEventListener('hide-it:teardown', teardown);
})();
