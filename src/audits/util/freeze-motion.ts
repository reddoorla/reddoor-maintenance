/// <reference lib="dom" />
// Runs IN THE PAGE, serialized into the generated a11y spec the same way as
// revealBelowFold, so it keeps the same rules: self-contained, no import, no
// module-scope identifier, no named helper.
//
// #949. The sheet used to go in through `page.addStyleTag`, which inserts a
// <style> element. A CSP whose style-src lacks 'unsafe-inline' refuses that,
// the call threw, and the whole audit failed with no results. A constructed
// stylesheet adopted by the document is CSSOM, which CSP does not govern, so
// the sheet applies under any policy and the page's own CSP stays enforced.
// `bypassCSP` would also have worked, and would have switched the site's CSP
// off for everything else the audit measures.
export function freezeMotion(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync("*,*::before,*::after{transition:none!important;animation:none!important;}");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
