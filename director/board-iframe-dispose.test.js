/*
 * node director/board-iframe-dispose.test.js
 * 刷新看板 / 替换 iframe 前释放旧看板文档的 timer、rAF、Observer。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL ' + msg);
  }
}

function extractFunction(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'found ' + name);
  if (start < 0) return '';
  var i = src.indexOf('{', start);
  var depth = 0;
  var quote = '';
  for (; i < src.length; i++) {
    var c = src.charAt(i);
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src.charAt(i + 1) === '/') {
      var nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert(false, 'unclosed ' + name);
  return '';
}

var root = __dirname;
var boardJs = fs.readFileSync(path.join(root, 'web-override', 'app.js'), 'utf8');
var director = require('./test-director-sources').loadDirectorSources().app;

assert(boardJs.indexOf('function dispose()') !== -1, 'board has dispose()');
assert(boardJs.indexOf('dispose: dispose') !== -1, 'F1.dispose exported');
assert(/addEventListener\('pagehide'[\s\S]*dispose\(\)/.test(boardJs),
  'pagehide calls dispose');
assert(boardJs.indexOf('var tickIv = setInterval') !== -1, 'tick interval tracked');
assert(boardJs.indexOf('var poppedIv = setInterval') !== -1, 'popped interval tracked');
assert(boardJs.indexOf('themeMo.disconnect') !== -1, 'theme MutationObserver disconnected');
assert(boardJs.indexOf('docRo.disconnect') !== -1, 'doc ResizeObserver disconnected');
assert(boardJs.indexOf('disconnectBoardFitObservers') !== -1, 'per-box RO cleanup');
var disposeSrc = extractFunction(boardJs, 'dispose');
assert(disposeSrc.indexOf('clearInterval(tickIv)') !== -1, 'dispose clears tickIv');
assert(disposeSrc.indexOf('clearInterval(poppedIv)') !== -1, 'dispose clears poppedIv');
assert(disposeSrc.indexOf('stopTrackmapPoll') !== -1, 'dispose stops trackmap poll');
assert(disposeSrc.indexOf('stopTrackmapMotion') !== -1, 'dispose stops trackmap rAF');
assert(disposeSrc.indexOf('es.close') !== -1, 'dispose closes EventSource');

assert(director.indexOf('function disposeBoardFrame') !== -1, 'director disposeBoardFrame');
assert(director.indexOf('F1.dispose') !== -1, 'director calls F1.dispose');
assert(director.indexOf("frame.src = 'about:blank'") !== -1, 'director blanks old iframe');
var applySrc = extractFunction(director, 'applyBoardToPanel');
assert(applySrc.indexOf('disposeBoardFrame(oldFrame)') !== -1,
  'applyBoardToPanel disposes before replaceChild');

// Sandbox: dispose clears intervals and observers once.
var cleared = { tick: 0, popped: 0, raf: 0, es: 0, mo: 0, ro: 0, fit: 0 };
var sandbox = {
  disposed: false,
  tickIv: 1,
  poppedIv: 2,
  resizeTimer: 3,
  themeRedrawTimer: 4,
  TRACKMAP: { raf: 9, timer: 8 },
  es: { closed: false, close: function () { cleared.es++; sandbox.es = null; } },
  themeMo: { gone: false, disconnect: function () { cleared.mo++; this.gone = true; } },
  docRo: { gone: false, disconnect: function () { cleared.ro++; this.gone = true; } },
  clearInterval: function (id) {
    if (id === 1) cleared.tick++;
    if (id === 2) cleared.popped++;
  },
  clearTimeout: function (id) {
    if (id === 3) sandbox.resizeTimer = null;
    if (id === 4) sandbox.themeRedrawTimer = null;
  },
  stopTrackmapPoll: function () {
    sandbox.TRACKMAP.timer = null;
  },
  stopTrackmapMotion: function () {
    if (sandbox.TRACKMAP.raf) { cleared.raf++; sandbox.TRACKMAP.raf = 0; }
  },
  disconnectBoardFitObservers: function () { cleared.fit++; },
  document: {
    querySelectorAll: function () { return []; }
  }
};
vm.createContext(sandbox);
sandbox.disconnectBoardFitObservers = function () { cleared.fit++; };
vm.runInContext(disposeSrc + '\nfunction runTwice() { dispose(); dispose(); }\n', sandbox);
sandbox.runTwice();
assert(cleared.tick === 1 && cleared.popped === 1, 'intervals cleared once');
assert(cleared.raf === 1, 'trackmap rAF cleared');
assert(cleared.es === 1, 'EventSource closed');
assert(cleared.mo === 1 && cleared.ro === 1, 'observers disconnected');
assert(cleared.fit === 1, 'board fit observers hook');
assert(sandbox.disposed === true, 'dispose idempotent flag');

// Sandbox: disposeBoardFrame + replace invokes parent cleanup.
var disposeCalls = 0;
var blanked = false;
var oldFrame = {
  onload: function () {},
  _src: 'http://127.0.0.1/board/timing?once=1',
  contentWindow: {
    F1: {
      dispose: function () { disposeCalls++; }
    }
  }
};
Object.defineProperty(oldFrame, 'src', {
  get: function () { return oldFrame._src; },
  set: function (v) {
    oldFrame._src = v;
    blanked = (v === 'about:blank');
  }
});
var disposeFrameSrc = extractFunction(director, 'disposeBoardFrame');
var sandbox2 = { frame: oldFrame };
vm.createContext(sandbox2);
vm.runInContext(disposeFrameSrc + '\nfunction runFrame(f) { disposeBoardFrame(f); }\n', sandbox2);
sandbox2.runFrame(oldFrame);
assert(disposeCalls === 1, 'disposeBoardFrame calls F1.dispose');
assert(blanked, 'disposeBoardFrame navigates to about:blank');
assert(oldFrame.onload === null, 'onload cleared');

if (failed) {
  console.error(failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('OK board-iframe-dispose');