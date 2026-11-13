// Renders the Chrome Web Store images into store/assets/: four 1280×800 screenshots and the
// 440×280 small promo tile. Drives the real extension on store/demo.html (a made-up site —
// no real brand belongs in the listing). Run: npm run assets
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'assets');
const HOST = 'dailyfeed.example'; // mapped to 127.0.0.1 below, so the popup shows a normal site name
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"; // goes inside style="…"

function frame(shot, title, sub) {
  return `<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden;
    background:linear-gradient(160deg,#fbfbfc,#eceef3);font-family:${FONT};color:#16181d">
    <div style="position:absolute;left:0;right:0;top:26px;text-align:center">
      <div style="font-size:31px;font-weight:750;letter-spacing:-.3px">${title}</div>
      <div style="margin-top:6px;font-size:17px;color:#5d6470">${sub}</div>
    </div>
    <img src="${dataUrl(shot)}" style="position:absolute;left:110px;top:112px;width:1060px;height:662.5px;
      border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 18px 50px rgba(20,24,40,.18)">
  </body></html>`;
}

function popupFrame(popupShot, w, h) {
  return `<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden;
    background:linear-gradient(160deg,#fbfbfc,#eceef3);font-family:${FONT};color:#16181d">
    <div style="position:absolute;left:120px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center">
      <div style="font-size:40px;font-weight:780;letter-spacing:-.5px;line-height:1.12">Hidden on<br>this site</div>
      <ul style="margin:28px 0 0;padding:0;list-style:none;font-size:19px;line-height:1.5;color:#3c424c">
        <li style="margin-bottom:14px">Hover a row to preview the element.</li>
        <li style="margin-bottom:14px">Click ✕ to bring it back.</li>
        <li style="margin-bottom:14px">Click ↖ to show it only on hover.</li>
        <li>Hold Alt on the page to see everything hidden.</li>
      </ul>
    </div>
    <img src="${dataUrl(popupShot)}" style="position:absolute;right:150px;top:${Math.round((800 - h) / 2)}px;width:${w}px;height:${h}px;
      border-radius:14px;box-shadow:0 0 0 1px rgba(0,0,0,.1),0 24px 60px rgba(20,24,40,.25)">
  </body></html>`;
}

// README image: the same article page before (the picker outlining the sidebar it's about to
// hide) and after, side by side. Transparent around the shots and mid-gray labels, so it sits
// well on GitHub's light and dark themes. Rendered at 2× so it stays sharp on retina screens.
const README_VIEW = { width: 1240, height: 720 }; // wide enough for the picker bar to clear the logo
const PANEL_W = 800;
const PANEL_H = Math.round((PANEL_W * README_VIEW.height) / README_VIEW.width);
function beforeAfter(before, after) {
  const panel = (shot, label) => `<figure style="margin:0;width:${PANEL_W}px">
      <figcaption style="margin:0 0 10px 2px;font-size:20px;font-weight:600;color:#8b949e">${label}</figcaption>
      <img src="${dataUrl(shot)}" style="display:block;width:${PANEL_W}px;height:${PANEL_H}px;border-radius:10px;box-shadow:0 0 0 1px rgba(128,128,128,.35)">
    </figure>`;
  return `<!doctype html><html><body style="margin:0;background:transparent;font-family:${FONT}">
    <div style="display:flex;gap:40px;padding:12px 20px 20px">${panel(before, 'Before')}${panel(after, 'After')}</div>
  </body></html>`;
}

async function readmeImage(port) {
  const host = 'northline.example';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hide-it-readme-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: README_VIEW,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=MAP ${host} 127.0.0.1`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`http://${host}:${port}/demo-article.html`);
    await wait(300);
    const tabId = await sw.evaluate(async (h) => (await chrome.tabs.query({})).find((t) => (t.url || '').includes(h)).id, host);
    const KEY = `site:${host}`;
    const lastRule = () => sw.evaluate(async (k) => (((await chrome.storage.local.get(k))[k] || {}).rules || []).pop(), KEY);
    await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'startPicker' }), tabId);

    // Point at the sidebar and find how many ↑ outline all of it (pick, read the rule, undo).
    const SIDEBAR = 'aside[aria-label="Sidebar"]';
    const bb = await page.locator('.most h3').boundingBox();
    const x = bb.x + 60;
    const y = bb.y + bb.height / 2;
    const aim = async (ups) => {
      await page.mouse.move(x - 2, y);
      await page.mouse.move(x, y);
      for (let i = 0; i < ups; i++) await page.keyboard.press('ArrowUp');
      await wait(150);
    };
    let ups = -1;
    for (let k = 0; k <= 5 && ups < 0; k++) {
      await aim(k);
      await page.mouse.click(x, y);
      await wait(200);
      const r = await lastRule();
      await page.keyboard.press('Meta+z');
      await wait(200);
      if (r && r.selector === SIDEBAR) ups = k;
    }
    if (ups < 0) throw new Error('could not outline the sidebar');

    // A fresh page for the real shots: no "Shown again" toast left from the search above.
    await page.reload();
    await wait(400);
    await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'startPicker' }), tabId);
    await aim(ups);
    const before = await page.screenshot();
    await page.mouse.click(x, y);
    await wait(250);
    await page.keyboard.press('Escape');
    await page.mouse.move(5, README_VIEW.height - 5);
    await wait(400);
    const after = await page.screenshot();

    await page.setViewportSize({ width: PANEL_W * 2 + 80, height: PANEL_H + 74 });
    await page.setContent(beforeAfter(before, after));
    await page.waitForLoadState('load');
    fs.mkdirSync(path.join(EXT, 'docs'), { recursive: true });
    await page.screenshot({ path: path.join(EXT, 'docs/before-after.png'), omitBackground: true });
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

function promoTile(icon) {
  return `<!doctype html><html><body style="margin:0;width:440px;height:280px;overflow:hidden;font-family:${FONT};
    background:radial-gradient(120% 140% at 0% 0%,#ff7a6b 0%,#f2453f 45%,#c81f2c 100%);color:#fff;
    display:flex;align-items:center;gap:22px;padding:0 34px;box-sizing:border-box">
    <img src="${dataUrl(icon)}" style="width:96px;height:96px;border-radius:22px;box-shadow:0 10px 30px rgba(80,0,10,.35),0 0 0 2px rgba(255,255,255,.35)">
    <div>
      <div style="font-size:42px;font-weight:800;letter-spacing:-.5px">Hide It</div>
      <div style="margin-top:6px;font-size:18px;line-height:1.3;opacity:.95">Hide distracting parts<br>of any website.</div>
    </div>
  </body></html>`;
}

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p, (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(d);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://${HOST}:${server.address().port}`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hide-it-store-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${base}/demo.html`);
    const tabId = await sw.evaluate(async (h) => (await chrome.tabs.query({})).find((t) => (t.url || '').includes(h)).id, HOST);
    const startPicker = () => sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'startPicker' }), tabId);

    async function point(selector, downs) {
      const bb = await page.locator(selector).first().boundingBox();
      const x = bb.x + Math.min(40, bb.width / 2);
      const y = bb.y + bb.height / 2;
      await page.mouse.move(x - 2, y);
      await page.mouse.move(x, y);
      for (let i = 0; i < downs; i++) await page.keyboard.press('ArrowDown');
      await wait(150);
      return { x, y };
    }

    // 1 — picking: the "Suggested for you" card outlined.
    await startPicker();
    const s = await point('section[aria-label="Suggested for you"] h2', 0);
    const raw1 = await page.screenshot();
    await page.mouse.click(s.x, s.y);
    await wait(200);
    for (const sel of ['section[aria-label="Trending now"] h2', '.promo b']) {
      const p = await point(sel, 0);
      await page.mouse.click(p.x, p.y);
      await wait(200);
    }
    await page.keyboard.press('Escape');
    await page.mouse.move(640, 790);
    await wait(400);

    // 2 — the clean page. 3 — holding ⌥: everything hidden shows, outlined.
    const raw2 = await page.screenshot();
    await page.keyboard.down('Alt');
    await wait(500);
    const raw3 = await page.screenshot();
    await page.keyboard.up('Alt');

    // 4 — the popup, rendered at 2× (CSS zoom) so the composite stays crisp.
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 340, height: 600 });
    await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await popup.waitForSelector('#list li');
    const h = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    await popup.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await popup.setViewportSize({ width: 680, height: h * 2 });
    await popup.locator('#list li').nth(1).hover();
    await wait(150);
    const popupShot = await popup.screenshot();
    await popup.close();

    const compose = await ctx.newPage();
    await compose.setViewportSize({ width: 1280, height: 800 });
    const shots = [
      ['screenshot-1-pick.png', frame(raw1, 'Pick an element', 'Scroll to make the selection smaller or bigger, then click to hide it.')],
      ['screenshot-2-clean.png', frame(raw2, 'After hiding', 'Hidden elements stay hidden on every visit and don’t show up while the page loads.')],
      ['screenshot-3-peek.png', frame(raw3, 'Hold Alt to see what’s hidden', 'Hidden elements show up with an outline until you let go.')],
      ['screenshot-4-popup.png', popupFrame(popupShot, 340 * 1.25, h * 1.25)],
    ];
    for (const [name, html] of shots) {
      await compose.setContent(html);
      await compose.waitForLoadState('load');
      await compose.screenshot({ path: path.join(OUT, name) });
    }
    await compose.setViewportSize({ width: 440, height: 280 });
    await compose.setContent(promoTile(fs.readFileSync(path.join(EXT, 'icons/icon128.png'))));
    await compose.waitForLoadState('load');
    await compose.screenshot({ path: path.join(OUT, 'promo-small-440x280.png') });
    console.log(fs.readdirSync(OUT).map((f) => path.join(OUT, f)).join('\n'));
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  try {
    await readmeImage(server.address().port);
    console.log(path.join(EXT, 'docs/before-after.png'));
  } finally {
    server.close();
  }
})();
