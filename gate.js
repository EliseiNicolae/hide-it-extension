// Registered by background.js only for sites that have saved rules, at document_start.
//
// content.js reads the rules from chrome.storage, which answers asynchronously (~5–15 ms).
// A fast, server-rendered page can be painted inside that window — the hidden element would
// show for one frame. So until content.js has put the rules in place, keep the page
// transparent: Chrome keeps showing the previous page meanwhile, so nothing visibly blinks.
(() => {
  if (!(document instanceof HTMLDocument) || !document.documentElement) return;
  if (document.querySelector('style[data-hide-it-gate]')) return;
  const gate = document.createElement('style');
  gate.setAttribute('data-hide-it-gate', '');
  gate.textContent = 'html{opacity:0!important}';
  document.documentElement.appendChild(gate);
  // Never leave a page invisible, whatever happens to content.js.
  setTimeout(() => gate.remove(), 800);
})();
