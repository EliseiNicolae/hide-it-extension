# Chrome Web Store — Hide It 1.0.0

Upload `dist/hide-it-1.0.0.zip` (build it with `scripts/package.sh`; bump `version` in manifest.json for every later upload).
Images: `store/assets/` (re-render with `node store/make-assets.js`).

## Store listing

**Name:** Hide It

**Summary** (same as the manifest description, 89/132 chars):
Hide parts of websites. Hidden elements stay hidden and never show up while a page loads.

**Category:** Productivity → Tools · **Language:** English

**Description:**

Hide sidebars, suggestion boxes, promos or anything else on a website. They stay hidden every time you come back, and they don't show up while the page loads.

How to use it:
• Click the icon or press Alt+Shift+H, then point at the page.
• Scroll to make the selection smaller or bigger, and click to hide it.
• Shift+click keeps the element in place but invisible. It shows up again when you hover over it.
• Hold Alt to see everything you've hidden on the page.
• The popup lists what's hidden on the current site. Hover a row to preview it, or click ✕ to bring it back.
• Undo with Cmd+Z / Ctrl+Z while picking.

Rules are stored locally in Chrome. The extension doesn't make any network requests and doesn't collect any data.

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
