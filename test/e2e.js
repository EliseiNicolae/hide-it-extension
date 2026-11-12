// End-to-end test of Hide It in Playwright's Chromium (own profile, headless). Run: npm test
// Branded Chrome 137+ ignores --load-extension, so this drives Playwright's Chromium (npm install first).
// Screenshots land in $TMPDIR/hide-it-test-out.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const SCR = __dirname;
const TMP = require('os').tmpdir();
const OUT = path.join(TMP, 'hide-it-test-out');
fs.mkdirSync(OUT, { recursive: true });
const KEY = 'site:127.0.0.1';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/favicon')) { res.writeHead(204); res.end(); return; }
    const p = path.join(SCR, 'site', decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p, (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(d);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const profile = fs.mkdtempSync(path.join(TMP, 'hide-it-prof-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];
    check('extension loaded', !!extId, extId);

    const page = ctx.pages()[0] || (await ctx.newPage());
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await page.goto(`${base}/x-mock.html`);
    await page.waitForSelector('nav[aria-label="Primary"]');

    const tabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => (t.url || '').startsWith('http://127.0.0.1')).id;
    });
    const getRules = () => sw.evaluate(async (k) => ((await chrome.storage.local.get(k))[k] || {}).rules || [], KEY);
    const startPicker = (extra = {}) => sw.evaluate(async ([id, ex]) => chrome.tabs.sendMessage(id, { type: 'startPicker', ...ex }), [tabId, extra]);
    const hasUI = () => page.evaluate(() => !!document.querySelector('hide-it-ui'));

    await startPicker();
    check('picker opens', await hasUI());

    // Ladder: the outline starts big; k presses of ↓ then click — which selector does each level
    // hide, and how big is it? (Each pick is undone right after.)
    async function ladderAt(x, y, maxK, tagName) {
      const steps = [];
      for (let k = 0; k <= maxK; k++) {
        await page.mouse.move(x - 1, y);
        await page.mouse.move(x, y);
        for (let i = 0; i < k; i++) await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(60);
        if (k === 0 && tagName) await page.screenshot({ path: path.join(OUT, `picker-${tagName}.png`) });
        await page.mouse.click(x, y);
        await page.waitForTimeout(120);
        const rules = await getRules();
        const rule = rules.length ? rules[rules.length - 1] : null;
        await page.keyboard.press('Meta+z');
        await page.waitForTimeout(120);
        if (rule) {
          rule.area = await page.evaluate((s) => {
            const r = document.querySelector(s).getBoundingClientRect();
            return (r.width * r.height) / (innerWidth * innerHeight);
          }, rule.selector);
        }
        steps.push(rule);
      }
      return { steps, x, y };
    }
    async function ladder(locator, maxK, tagName) {
      const bb = await page.locator(locator).first().boundingBox();
      return ladderAt(bb.x + bb.width / 2, bb.y + bb.height / 2, maxK, tagName);
    }
    const printLadder = (title, l) => {
      console.log(title);
      l.steps.forEach((r, k) => console.log(`  ↓×${k}: ${r ? r.selector : '—'}   (${r ? `${Math.round(r.area * 100)}% of the view — ${r.label}` : ''})`));
    };

    const navLadder = await ladder('nav a[aria-label="Home"] span', 7, 'nav');
    printLadder('\nLadder from "Home" label:', navLadder);
    const wtfLadder = await ladder('aside h2 span', 7, 'wtf');
    printLadder('Ladder from "You might like" heading:', wtfLadder);
    console.log('');
    check('undo leaves no rules behind', (await getRules()).length === 0);

    // A small control in the top-right corner: the label goes below it, pulled onto the screen.
    const share = await page.locator('#share').boundingBox();
    await page.mouse.move(share.x + share.width / 2 - 1, share.y + share.height / 2);
    await page.mouse.move(share.x + share.width / 2, share.y + share.height / 2);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(OUT, 'picker-label-corner.png'), clip: { x: 1000, y: 0, width: 400, height: 110 } });

    const kNav = navLadder.steps.findIndex((r) => r && r.selector === 'nav[aria-label="Primary"]');
    check('the outline starts big: the nav is a step down', kNav >= 1, `↓ ×${kNav}; starts at ${navLadder.steps[0].selector}`);
    check('…but never bigger than a quarter of the page', [navLadder, wtfLadder].every((l) => l.steps[0].area <= 0.25),
      `${Math.round(navLadder.steps[0].area * 100)}%, ${Math.round(wtfLadder.steps[0].area * 100)}%`);
    const kWtf = wtfLadder.steps.findIndex((r) => r && r.selector.includes(':has(> aside[aria-label="Who to follow"])'));
    check('↓ reaches the bordered "You might like" card', kWtf >= 1, kWtf >= 0 ? `${wtfLadder.steps[kWtf].selector} after ${kWtf} presses` : '');
    check('the card is never hidden without its border', !wtfLadder.steps.some((r) => r && r.selector === 'aside[aria-label="Who to follow"]'));
    check('↓ goes all the way down to the label', /span$|div:nth-of-type\(2\)$/.test(navLadder.steps[navLadder.steps.length - 1].selector), navLadder.steps[navLadder.steps.length - 1].selector);

    // ---- Wheel: scroll down = smaller, up = bigger, the page itself doesn't move; ⌥ + wheel scrolls.
    async function wheelPick(deltas, gap) {
      await page.mouse.move(navLadder.x - 1, navLadder.y);
      await page.mouse.move(navLadder.x, navLadder.y);
      for (const d of deltas) {
        await page.mouse.wheel(0, d);
        if (gap) await page.waitForTimeout(gap);
      }
      await page.waitForTimeout(60);
      await page.mouse.click(navLadder.x, navLadder.y);
      await page.waitForTimeout(120);
      const rules = await getRules();
      await page.keyboard.press('Meta+z');
      await page.waitForTimeout(120);
      return rules.length ? rules[rules.length - 1].selector : null;
    }
    const scrollY0 = await page.evaluate(() => scrollY);
    // Notches the way a person rolls while watching the highlight; a slow notch on macOS is ~4 px.
    const notches = (n, d) => Array(n).fill(d);
    const downN = await wheelPick(notches(kNav, 4), 300);
    check(`${kNav} slow wheel notches down reach the nav (one per ↓)`, downN === 'nav[aria-label="Primary"]', downN);
    check('the wheel does not scroll the page while picking', (await page.evaluate(() => scrollY)) === scrollY0);
    const downNbig = await wheelPick(notches(kNav, 120), 300);
    check('big (fast-roll) notches step one level each too', downNbig === 'nav[aria-label="Primary"]', downNbig);
    const downNup1 = await wheelPick([...notches(kNav, 4), -4], 300);
    check('a notch up grows back one level', downNup1 === navLadder.steps[kNav - 1].selector, downNup1);
    const swipeStart = Date.now();
    const burst = await wheelPick(Array(20).fill(12), 0);
    const swipeMs = Date.now() - swipeStart;
    const burstLevel = navLadder.steps.findIndex((r) => r && r.selector === burst);
    check('a fast trackpad swipe moves only a level or two', burstLevel >= 1 && burstLevel <= 2, `${burst} (level ${burstLevel}, ~${swipeMs} ms incl. click)`);
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Alt');
    await page.waitForTimeout(200);
    const scrolled = await page.evaluate(() => scrollY);
    check('⌥ + wheel scrolls the page', scrolled > scrollY0, `scrollY ${scrollY0} → ${scrolled}`);
    await page.evaluate((y) => scrollTo(0, y), scrollY0);
    await page.waitForTimeout(100);
    check('wheel tests leave no rules behind', (await getRules()).length === 0);

    // Hide the nav and the "You might like" box for real.
    async function hideAt(x, y, k) {
      await page.mouse.move(x - 1, y);
      await page.mouse.move(x, y);
      for (let i = 0; i < k; i++) await page.keyboard.press('ArrowDown');
      await page.mouse.click(x, y);
      await page.waitForTimeout(150);
    }
    await hideAt(navLadder.x, navLadder.y, kNav);
    await hideAt(wtfLadder.x, wtfLadder.y, kWtf);
    const banner = await page.locator('#static-banner').boundingBox();
    await hideAt(banner.x + 30, banner.y + banner.height / 2, 0);
    // Double-click: the second click, pointer unmoved, must not hide what slid in underneath.
    await page.mouse.click(banner.x + 30, banner.y + banner.height / 2);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'after-hide.png') });

    let rules = await getRules();
    check('3 rules stored', rules.length === 3, rules.map((r) => r.selector).join('  |  '));
    const shown = await page.evaluate(() => ({
      nav: document.querySelector('nav[aria-label="Primary"]').getClientRects().length > 0,
      wtf: document.querySelector('aside[aria-label="Who to follow"]').getClientRects().length > 0,
      banner: document.querySelector('#static-banner').getClientRects().length > 0,
      post: document.querySelector('[data-testid="SideNav_NewTweet_Button"]').getClientRects().length > 0,
      footer: document.querySelector('nav[aria-label="Footer"]').getClientRects().length > 0,
    }));
    check('targets hidden, neighbours untouched', !shown.nav && !shown.wtf && !shown.banner && shown.post && shown.footer, JSON.stringify(shown));

    // Clicks never reached the page while picking.
    await page.keyboard.press('Escape');
    check('Esc closes the picker', !(await hasUI()));

    // ---- Flicker: reload many times, look at every frame before paint.
    const gate = await sw.evaluate(async () => chrome.scripting.getRegisteredContentScripts());
    check('paint gate registered for this site only', gate.length === 1 && gate[0].matches.includes('*://127.0.0.1/*'), JSON.stringify(gate.map((g) => g.matches)));

    async function reloads(n, url) {
      let flicker = 0;
      let gated = 0;
      let leftovers = 0;
      let rawEarly = 0;
      const timings = [];
      for (let i = 0; i < n; i++) {
        if (url) await page.goto(url);
        else await page.reload();
        await page.waitForFunction(() => window.__probe && window.__probe.length >= 60 && window.__renderedAt, null, { timeout: 10000 });
        const data = await page.evaluate(() => ({
          probe: window.__probe,
          sheetAt: window.__sheetAt,
          gateAtHead: window.__gateAtHead,
          gateLeft: !!document.querySelector('style[data-hide-it-gate]'),
          opacity: getComputedStyle(document.documentElement).opacity,
        }));
        // A frame shows an element only if it is laid out AND the page isn't held transparent.
        const visible = (f) => f.op !== '0' && (f.banner === 'SHOWN' || f.nav === 'SHOWN' || f.wtf === 'SHOWN');
        if (data.probe.some(visible)) flicker++;
        if (data.probe.some((f) => f.banner === 'SHOWN' && f.op === '0')) rawEarly++;
        if (data.gateAtHead) gated++;
        if (data.gateLeft || data.opacity !== '1') leftovers++;
        const firstOpaque = data.probe.find((f) => f.op !== '0');
        timings.push({ gate: data.gateAtHead, sheetAt: data.sheetAt && +data.sheetAt.toFixed(1), firstOpaqueAt: firstOpaque && +firstOpaque.t.toFixed(1) });
      }
      return { flicker, gated, leftovers, rawEarly, timings };
    }

    const r1 = await reloads(25);
    console.log('reloads on a site with rules:', JSON.stringify(r1.timings.slice(0, 6)));
    check('no visible frame of a hidden element across 25 reloads', r1.flicker === 0, `${r1.flicker} flickered; gate caught ${r1.rawEarly} early frames`);
    check('the gate ran on every load', r1.gated === 25, `${r1.gated}/25`);
    check('the gate is always lifted', r1.leftovers === 0, `${r1.leftovers} left`);

    // A site without rules is never gated (localhost = another site key, same server).
    const plain = await reloads(3, `${base.replace('127.0.0.1', 'localhost')}/x-mock.html`);
    check('no gate on a site without rules', plain.gated === 0, `${plain.gated}/3`);
    await page.goto(`${base}/x-mock.html`);
    await page.waitForSelector('nav[aria-label="Primary"]', { state: 'attached' });

    // ---- Popup (opened as a page for this tab).
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 340, height: 420 });
    await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await popup.waitForSelector('#list li');
    await popup.screenshot({ path: path.join(OUT, 'popup-light.png') });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({ path: path.join(OUT, 'popup-dark.png') });
    const rows = await popup.locator('#list li').count();
    check('popup lists the 3 rules', rows === 3);
    check('popup shows the shortcut', (await popup.locator('#shortcut').textContent()).length > 0, await popup.locator('#shortcut').textContent());

    // Hover a row → that element is shown again, outlined; leave → hidden again.
    const navRow = popup.locator('#list li', { hasText: 'Primary' });
    await navRow.hover();
    await page.waitForTimeout(150);
    const preview = await page.evaluate(() => {
      const n = document.querySelector('nav[aria-label="Primary"]');
      return { shown: n.getClientRects().length > 0, outline: getComputedStyle(n).outlineStyle };
    });
    check('hovering a row previews the element', preview.shown && preview.outline === 'solid', JSON.stringify(preview));
    await popup.mouse.move(170, 20);
    await page.waitForTimeout(150);
    check('leaving the row hides it again', !(await page.evaluate(() => document.querySelector('nav[aria-label="Primary"]').getClientRects().length > 0)));

    // Pause switch shows everything; switching back hides again.
    await popup.locator('#switch').click();
    await page.waitForTimeout(150);
    check('pause shows everything', await page.evaluate(() => ['nav[aria-label="Primary"]', '#static-banner'].every((s) => document.querySelector(s).getClientRects().length > 0)));
    await popup.screenshot({ path: path.join(OUT, 'popup-paused.png') });
    await popup.locator('#switch').click();
    await page.waitForTimeout(150);
    check('resume hides again', await page.evaluate(() => ['nav[aria-label="Primary"]', '#static-banner'].every((s) => document.querySelector(s).getClientRects().length === 0)));

    // ✕ on a row brings that one element back.
    await popup.locator('#list li', { hasText: 'Static promo' }).locator('.remove').click();
    await page.waitForTimeout(150);
    rules = await getRules();
    check('✕ removes the rule and shows the element', rules.length === 2 && (await page.evaluate(() => document.querySelector('#static-banner').getClientRects().length > 0)));

    // A popup that closes mid-preview leaves nothing shown.
    await navRow.hover();
    await page.waitForTimeout(100);
    await popup.close();
    await page.waitForTimeout(200);
    check('closing the popup ends the preview', !(await page.evaluate(() => document.querySelector('nav[aria-label="Primary"]').getClientRects().length > 0)));

    // Right-click → "Hide an element…" starts the picker on the right-clicked element.
    await page.bringToFront();
    const post = await page.locator('[data-testid="SideNav_NewTweet_Button"]').boundingBox();
    await page.mouse.click(post.x + 20, post.y + 10, { button: 'right' });
    await startPicker({ atContextTarget: true });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, 'picker-context.png') });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    rules = await getRules();
    check('context-menu pick hides the right-clicked element', rules.some((r) => r.selector.includes('SideNav_NewTweet_Button')), rules[rules.length - 1].selector);
    await page.keyboard.press('Escape');

    // Re-injection (what happens when the extension updates under an open tab): no duplicate sheets.
    await sw.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }), tabId);
    await page.waitForTimeout(150);
    const sheets = await page.evaluate(() => document.querySelectorAll('style[data-hide-it]').length);
    check('re-injection keeps exactly one sheet', sheets === 1, `${sheets} sheets`);
    check('still hidden after re-injection', await page.evaluate(() => document.querySelector('nav[aria-label="Primary"]').getClientRects().length === 0));

    // ---- Leftover lines. A rule that hid only a card's inside (what earlier versions picked)
    // leaves the card's border as a ~2 px line: it must be pickable from a few px away.
    const rendered = (sel) => page.evaluate((s) => document.querySelector(s).getClientRects().length > 0, sel);
    // (The worker's CSP forbids eval, so edits are data: rules to add, selectors-containing to drop.)
    const editRules = ({ add = [], dropContaining = [] }) => sw.evaluate(async ([k, add, drop]) => {
      const d = (await chrome.storage.local.get(k))[k];
      d.rules = d.rules.filter((r) => !drop.some((s) => r.selector.includes(s))).concat(add);
      await chrome.storage.local.set({ [k]: d });
    }, [KEY, add, dropContaining]);
    await editRules({ add: [{ id: 'old1', selector: 'section[aria-labelledby="trends-heading"]', label: 'inside only', added: 1 }] });
    await page.waitForTimeout(150);
    const line = await page.evaluate(() => {
      const r = document.getElementById('trends-box').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    check('repro: an inside-only rule leaves a thin line', line.h > 0 && line.h <= 3, `${line.w}×${line.h}`);
    await startPicker();
    await page.mouse.move(line.x + line.w / 2 - 1, line.y + line.h + 5);
    await page.mouse.move(line.x + line.w / 2, line.y + line.h + 5); // 5 px below the line
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(OUT, 'picker-line.png') });
    await page.mouse.click(line.x + line.w / 2, line.y + line.h + 5);
    await page.waitForTimeout(150);
    rules = await getRules();
    check('the line is picked from 5 px away and hidden', !(await rendered('#trends-box')), rules[rules.length - 1].selector);
    await page.keyboard.press('Escape');

    // A fresh pick of the section takes the card's border with it: no line in the first place.
    await editRules({ dropContaining: ['trends'] });
    await page.waitForTimeout(150);
    check('trends card visible again', await rendered('#trends-box'));
    await startPicker();
    const trendsHead = await page.locator('#trends-heading span').boundingBox();
    const tx = trendsHead.x + trendsHead.width / 2;
    const ty = trendsHead.y + trendsHead.height / 2;
    // Going down from the big start, the section is never outlined without its card.
    const trendsLadder = await ladderAt(tx, ty, 6);
    check('↓ never stops on the section without its card', !trendsLadder.steps.some((r) => r && r.selector.startsWith('section[aria-labelledby')),
      trendsLadder.steps.map((r) => r && r.selector).join(' → '));
    const kTrends = trendsLadder.steps.findIndex((r) => r && r.selector === '#trends-box');
    await hideAt(tx, ty, kTrends);
    rules = await getRules();
    const trendsBox = await page.evaluate(() => document.getElementById('trends-box').getClientRects().length);
    check('picking the section hides the whole card, border included', kTrends >= 0 && trendsBox === 0, rules[rules.length - 1].selector);
    await page.keyboard.press('Escape');

    // ---- Peek: hold ⌥ alone → everything hidden shows, outlined; let go → hidden again.
    const NAV = 'nav[aria-label="Primary"]';
    const navState = () => page.evaluate((s) => {
      const n = document.querySelector(s);
      const cs = getComputedStyle(n);
      return { shown: n.getClientRects().length > 0, outline: cs.outlineStyle, opacity: cs.opacity };
    }, NAV);
    await page.mouse.move(700, 600);
    await page.keyboard.down('Alt');
    await page.waitForTimeout(450);
    const peek = await navState();
    check('holding ⌥ peeks: hidden elements show, outlined', peek.shown && peek.outline === 'dashed', JSON.stringify(peek));
    await page.screenshot({ path: path.join(OUT, 'peek.png') });
    await page.keyboard.up('Alt');
    await page.waitForTimeout(100);
    check('letting go of ⌥ hides them again', !(await navState()).shown);
    await page.keyboard.down('Alt');
    await page.waitForTimeout(80);
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(450);
    check('⌥ + another key never peeks', !(await navState()).shown);
    await page.keyboard.up('Alt');
    await page.keyboard.down('Alt');
    await page.waitForTimeout(120);
    await page.keyboard.up('Alt');
    await page.waitForTimeout(400);
    check('a quick ⌥ tap does not peek', !(await navState()).shown);

    // ---- Show on hover: ⇧+click in the picker.
    const FOOT = 'nav[aria-label="Footer"]';
    const footState = () => page.evaluate((s) => {
      const n = document.querySelector(s);
      return { opacity: getComputedStyle(n).opacity, rects: n.getClientRects().length };
    }, FOOT);
    await startPicker();
    const foot = await page.locator(FOOT).boundingBox();
    const fx = foot.x + 20;
    const fy = foot.y + foot.height / 2;
    const footLadder = await ladderAt(fx, fy, 6);
    const kFoot = footLadder.steps.findIndex((r) => r && r.selector === FOOT);
    await page.mouse.move(fx - 1, fy);
    await page.mouse.move(fx, fy);
    for (let i = 0; i < kFoot; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.down('Shift');
    await page.mouse.click(fx, fy);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    rules = await getRules();
    const footRule = rules.find((r) => r.selector.includes('Footer'));
    check('⇧+click stores a show-on-hover rule', !!footRule && footRule.mode === 'hover', footRule && `${footRule.selector} mode=${footRule.mode}`);
    await page.mouse.move(700, 600);
    await page.waitForTimeout(900);
    const away = await footState();
    check('show-on-hover: invisible but keeps its place', away.opacity === '0' && away.rects > 0, JSON.stringify(away));
    await page.mouse.move(fx, fy);
    await page.waitForTimeout(400);
    check('pointing at its place fades it in', (await footState()).opacity === '1', (await footState()).opacity);
    await page.mouse.move(700, 600);
    await page.waitForTimeout(900);
    check('pointing away fades it out again', (await footState()).opacity === '0');

    // ---- Show on hover from the popup's ↖ button, and back.
    const popup2 = await ctx.newPage();
    await popup2.setViewportSize({ width: 340, height: 520 });
    await popup2.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await popup2.waitForSelector('#list li');
    // (While the pointer is on a row the popup previews that element, so check after leaving it.)
    await popup2.locator('#list li', { hasText: 'Primary' }).locator('.mode').click();
    await popup2.mouse.move(170, 10);
    await page.waitForTimeout(800); // the preview ends, then the element fades out (0.3 s delay + 0.2 s)
    rules = await getRules();
    const navHover = await navState();
    check('popup ↖ switches a rule to show-on-hover', rules.find((r) => r.selector === NAV).mode === 'hover' && navHover.shown && navHover.opacity === '0', JSON.stringify(navHover));
    await popup2.screenshot({ path: path.join(OUT, 'popup-hover-mode.png') });
    await popup2.emulateMedia({ colorScheme: 'dark' });
    await popup2.screenshot({ path: path.join(OUT, 'popup-hover-mode-dark.png') });
    await popup2.locator('#list li', { hasText: 'Primary' }).locator('.mode').click();
    await popup2.mouse.move(170, 10);
    await page.waitForTimeout(250);
    check('clicking ↖ again hides it completely', !(await navState()).shown);
    await popup2.close();

    // ---- Boxless wrappers (display: contents, as chat apps use): the outline must never
    // settle on one — it has no box, so nothing would show.
    await page.goto(`${base}/chat-mock.html`);
    await page.waitForSelector('#reply');
    await startPicker();
    const reply = await page.locator('#reply').boundingBox();
    const chatLadder = await ladderAt(reply.x + 120, reply.y + reply.height / 2, 3, 'chat');
    console.log(`chat ladder: ${chatLadder.steps.map((r) => r && `${r.selector} (${Math.round(r.area * 100)}%)`).join(' → ')}`);
    check('pointing at a chat reply outlines a real box', chatLadder.steps[0] && chatLadder.steps[0].area > 0,
      chatLadder.steps[0] && `${chatLadder.steps[0].selector}, ${Math.round(chatLadder.steps[0].area * 100)}% of the view`);
    check('…and every step down is a real box too', chatLadder.steps.every((r) => r && r.area > 0));
    check('↓ reaches the reply itself', chatLadder.steps.some((r) => r && r.selector === '#reply'));
    await page.keyboard.press('Escape');

    // ---- Loose text: an SEO paragraph written straight into the column that also holds the
    // grid and the footer. Pointing at it targets just the text; hiding it leaves the rest.
    await page.goto(`${base}/loose-text.html`);
    await page.waitForSelector('.footer');
    const measure = () => page.evaluate(() => {
      const col = document.querySelector('.col-lg-10');
      const n = [...col.childNodes].find((t) => t.nodeType === 3 && t.textContent.includes('Live TV online'));
      const range = document.createRange();
      range.selectNodeContents(n);
      const q = range.getBoundingClientRect();
      const fs = (s) => getComputedStyle(document.querySelector(s)).fontSize;
      return {
        textW: Math.round(q.width), textH: Math.round(q.height), x: q.left + 40, y: q.top + Math.min(10, q.height / 2),
        colH: Math.round(col.getBoundingClientRect().height),
        card: fs('.card'), em: fs('.em-child'), footer: fs('.footer'),
      };
    });
    const lt0 = await measure();
    await startPicker();
    await page.mouse.move(lt0.x - 1, lt0.y);
    await page.mouse.move(lt0.x, lt0.y);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, 'picker-loose-text.png') });
    // ↑ from the text is its whole column; ↓ comes back to the text.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.mouse.click(lt0.x, lt0.y);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    rules = await getRules();
    const textRule = rules[rules.length - 1];
    const lt1 = await measure();
    check('pointing at loose text targets just the text', !!textRule.text && textRule.selector === 'div.col-lg-10.pt-1', `${textRule.selector} text=${textRule.text} — ${textRule.label}`);
    check('the text is gone and its space collapses', lt1.textW === 0 && lt0.colH - lt1.colH >= lt0.textH - 4, `text ${lt0.textW}×${lt0.textH} → ${lt1.textW}×${lt1.textH}, column ${lt0.colH} → ${lt1.colH}px`);
    check('the grid, the em-sized line and the footer keep their size',
      lt1.card === lt0.card && lt1.em === lt0.em && lt1.footer === lt0.footer,
      `card ${lt0.card}→${lt1.card}, em ${lt0.em}→${lt1.em}, footer ${lt0.footer}→${lt1.footer}`);
    await page.reload();
    await page.waitForSelector('.footer');
    const lt2 = await measure();
    check('the loose text stays hidden after a reload', lt2.textW === 0 && lt2.em === lt0.em, `text width ${lt2.textW}, em ${lt2.em}`);

    // ---- A long list keeps the popup within Chrome's 600 px; the list scrolls, thin and themed.
    const lhPage = await ctx.newPage();
    await lhPage.goto(`${base.replace('127.0.0.1', 'localhost')}/x-mock.html`);
    await sw.evaluate(async () => {
      const rules = Array.from({ length: 18 }, (_, i) => ({ id: `many${i}`, selector: `#nothing-${i}`, label: `Rule number ${i + 1} — some long label text here`, added: i }));
      await chrome.storage.local.set({ 'site:localhost': { rules, paused: false } });
    });
    const lhTab = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => (t.url || '').startsWith('http://localhost')).id);
    const popLong = await ctx.newPage();
    await popLong.setViewportSize({ width: 340, height: 800 });
    await popLong.emulateMedia({ colorScheme: 'dark' });
    await popLong.goto(`chrome-extension://${extId}/popup.html?tab=${lhTab}`);
    await popLong.waitForSelector('#list li');
    const sizes = await popLong.evaluate(() => {
      const ul = document.getElementById('list');
      return { body: Math.round(document.body.getBoundingClientRect().height), scrolls: ul.scrollHeight > ul.clientHeight, bar: getComputedStyle(ul).scrollbarWidth };
    });
    check('a long list keeps the popup ≤ 600 px and scrolls inside', sizes.body <= 600 && sizes.scrolls && sizes.bar === 'thin', JSON.stringify(sizes));
    await popLong.setViewportSize({ width: 340, height: sizes.body });
    await popLong.screenshot({ path: path.join(OUT, 'popup-long-dark.png') });
    await popLong.close();
    await sw.evaluate(async () => chrome.storage.local.remove('site:localhost'));
    await lhPage.close();

    // ---- Copy / Paste between two Chrome profiles (two separate user-data dirs).
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const popA = await ctx.newPage();
    await popA.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await popA.waitForSelector('#list li');
    await popA.click('#copy');
    await popA.waitForSelector('#transfer-msg:not([hidden])');
    const copiedMsg = await popA.textContent('#transfer-msg');
    const copied = await popA.evaluate(() => navigator.clipboard.readText());
    const rulesA = await getRules();
    let parsedCopy = null;
    try { parsedCopy = JSON.parse(copied); } catch {}
    check('Copy puts every rule on the clipboard', !!parsedCopy && parsedCopy.format === 'hide-it/1' && parsedCopy.sites['127.0.0.1'].length === rulesA.length, copiedMsg);
    await popA.close();

    const profileB = fs.mkdtempSync(path.join(TMP, 'hide-it-prof-B-'));
    const ctxB = await chromium.launchPersistentContext(profileB, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1400, height: 900 },
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    try {
      let [swB] = ctxB.serviceWorkers();
      if (!swB) swB = await ctxB.waitForEvent('serviceworker');
      const extIdB = swB.url().split('/')[2];
      const pageB = ctxB.pages()[0] || (await ctxB.newPage());
      await pageB.goto(`${base}/x-mock.html`);
      await pageB.waitForSelector(NAV, { state: 'attached' });
      const navShownB = () => pageB.evaluate((s) => document.querySelector(s).getClientRects().length > 0, NAV);
      check('profile B starts with nothing hidden', await navShownB());
      const tabB = await swB.evaluate(async () => (await chrome.tabs.query({})).find((t) => (t.url || '').startsWith('http://127.0.0.1')).id);
      const rulesInB = () => swB.evaluate(async (k) => ((await chrome.storage.local.get(k))[k] || {}).rules || [], KEY);
      const popB = await ctxB.newPage();
      await popB.goto(`chrome-extension://${extIdB}/popup.html?tab=${tabB}`);
      const pasteText = async (text) => {
        await popB.click('#paste');
        await popB.fill('#paste-input', text);
        await popB.waitForSelector('#transfer-msg:not([hidden])');
        await popB.waitForTimeout(150);
        return popB.textContent('#transfer-msg');
      };
      const pasteMsg = await pasteText(copied);
      const rulesB = await rulesInB();
      const same = rulesA.length === rulesB.length &&
        rulesA.every((a) => rulesB.some((b) => b.selector === a.selector && (b.mode || '') === (a.mode || '')));
      check('Paste in another profile adds the same rules (modes too)', same, pasteMsg);
      check('…and that profile’s open page hides them at once', !(await navShownB()));
      await popB.screenshot({ path: path.join(OUT, 'popup-pasted.png') });
      const againMsg = await pasteText(copied);
      check('pasting the same copy again adds nothing', (await rulesInB()).length === rulesB.length, againMsg);
      const junkMsg = await pasteText('hello');
      const junkIsError = await popB.evaluate(() => document.getElementById('transfer-msg').classList.contains('error'));
      check('text that isn’t a Hide It copy is refused', junkIsError && (await rulesInB()).length === rulesB.length, junkMsg);
      const gateB = await swB.evaluate(async () => chrome.scripting.getRegisteredContentScripts());
      check('profile B gets the no-flicker gate for pasted sites', gateB.length === 1 && gateB[0].matches.includes('*://127.0.0.1/*'));
    } finally {
      await ctxB.close();
      fs.rmSync(profileB, { recursive: true, force: true });
    }

    check('no page errors', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('test run', false, e.stack);
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
