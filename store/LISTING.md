# Chrome Web Store — Hide It 1.0.0

Upload `dist/hide-it-1.0.0.zip` (build it with `scripts/package.sh`; bump `version` in manifest.json for every later upload).
Images: `store/assets/` (re-render with `node store/make-assets.js`).

## Store listing

**Name:** Hide It

**Summary** (82/132 chars):
Point at any part of a website and hide it for good — no flicker, undo any time.

**Category:** Productivity → Tools · **Language:** English

**Description:**

Hide the parts of a website you don't want to see — sidebars, suggestion boxes, promos, trending lists, sticky banners — and they stay hidden every time you come back.

HOW IT WORKS
• Click the Hide It icon (or press ⌥⇧H / Alt+Shift+H) and point at the page.
• The outline starts on the whole block under the pointer — scroll down (or ↓) to narrow it to exactly the part you want gone, up (or ↑) to widen it.
• Click. It's hidden — on this site, from now on.
• Undo with ⌘Z / Ctrl+Z, or bring anything back from the list in the popup.

NO FLICKER
Hidden elements are removed with CSS before the page paints, so they never flash in first — even on apps that build the page long after it loads.

PEEK AND HOVER
• Hold ⌥ / Alt on a page to see everything you hid, outlined, until you let go.
• ⇧-click (or the ↖ button in the list) keeps an element invisible but in place: point at its spot and it fades in.

THE LIST
The popup lists what's hidden on the current site. Point at a row to see that element again, ✕ to bring it back for good, or switch the site off for a moment.

PRIVATE BY DESIGN
Everything stays in your browser. Hide It has no servers, no accounts, no analytics, and never reads or sends the content of the pages you visit.

## Images

| Field | File |
| --- | --- |
| Store icon (128×128) | `icons/icon128.png` |
| Screenshots (1280×800) | `store/assets/screenshot-1-pick.png`, `-2-clean`, `-3-peek`, `-4-popup` |
| Small promo tile (440×280) | `store/assets/promo-small-440x280.png` |

## Privacy practices tab

**Single purpose:**
Lets the user hide chosen parts of the websites they visit and keeps them hidden on later visits to those sites.

**Permission justifications:**

- **storage** — Saves the list of elements the user chose to hide, per site, in the browser (chrome.storage.local). Nothing leaves the device.
- **scripting** — (1) When the extension is installed or updated, injects its content script into tabs that are already open, so the user's hidden elements and the element picker work without reloading those tabs. (2) Registers a tiny script that runs only on sites where the user has hidden something; it keeps the page from painting for the few milliseconds before the saved rules load, so hidden elements never flash on screen.
- **contextMenus** — Adds "Hide an element on this page…" to the right-click menu, which starts the element picker on the clicked element.
- **Host permissions (all sites)** — The user can hide elements on any website they choose, so the content script has to run on every page as it starts loading to apply that site's rules before anything is painted. The extension only adds a stylesheet that hides the user's chosen elements; it doesn't read, collect or transmit page content.

**Remote code:** No, I am not using remote code. (All code ships in the package.)

**Data usage:** tick none of the data types — Hide It collects no user data. Tick all three certifications (no selling/transfer to third parties, no unrelated use, no creditworthiness use).

**Privacy policy URL:** not required (no user data is collected). If the form insists, a one-line policy works: "Hide It does not collect, store remotely, or share any personal data. Your hidden-element lists are saved only in your browser's local extension storage."

## Distribution

- **Visibility:** *Unlisted* = only people with the link can find and install it (the link works as soon as review passes). *Public* = also shows up in search.
- **Regions:** all.
- Broad host permissions usually mean a longer, in-depth review — expect from a few days up to a couple of weeks.
