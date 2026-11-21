/* First paint uses system CJK/sans stack (--font in CSS). Optional Noto loads later. */
(function () {
  'use strict';
  function enableNoto() {
    try {
      document.documentElement.classList.add('fonts-noto-loaded');
    } catch (e0) {}
  }
  function injectLocalFace(href) {
    var style = document.createElement('style');
    style.textContent =
      '@font-face{font-family:"Noto Sans SC";font-style:normal;font-weight:400 700;' +
      'font-display:optional;src:url("' + href + '") format("woff2");}';
    document.head.appendChild(style);
    enableNoto();
  }
  function injectGoogle() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=optional';
    link.media = 'print';
    link.onload = function () {
      link.media = 'all';
      enableNoto();
    };
    document.head.appendChild(link);
  }
  function run() {
    var href = '/assets/fonts/noto-sans-sc-subset.woff2';
    if (typeof fetch === 'function') {
      fetch(href, { method: 'HEAD', cache: 'force-cache' })
        .then(function (r) {
          if (r && r.ok) {
            injectLocalFace(href);
            return;
          }
          injectGoogle();
        })
        .catch(function () { injectGoogle(); });
      return;
    }
    injectGoogle();
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 400);
  }
})();