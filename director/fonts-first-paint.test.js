/*
 * node director/fonts-first-paint.test.js
 * System UI font stack only — no Google Fonts / fonts-boot / Noto network path.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL ' + msg);
  }
}

var root = path.join(__dirname);
var sources = require('./test-director-sources').loadDirectorSources();
var director = sources.html + '\n' + sources.css;
var index = fs.readFileSync(path.join(root, 'web-override', 'index.html'), 'utf8');
var board = fs.readFileSync(path.join(root, 'web-override', 'board.html'), 'utf8');
var css = fs.readFileSync(path.join(root, 'web-override', 'style.css'), 'utf8');
var appJs = fs.readFileSync(path.join(root, 'web-override', 'app.js'), 'utf8');

function assertNoGoogleFonts(src, label) {
  assert(src.indexOf('fonts.googleapis.com') === -1, label + ' has no fonts.googleapis.com');
  assert(src.indexOf('fonts.gstatic.com') === -1, label + ' has no fonts.gstatic.com');
  assert(src.indexOf('@import url("https://fonts.googleapis.com') === -1, label + ' has no @import fonts');
}

assertNoGoogleFonts(director, 'director.html');
assertNoGoogleFonts(index, 'index.html');
assertNoGoogleFonts(board, 'board.html');
assertNoGoogleFonts(css, 'style.css');
assertNoGoogleFonts(appJs, 'app.js');

assert(director.indexOf('fonts-boot.js') === -1, 'director does not load fonts-boot.js');
assert(index.indexOf('fonts-boot.js') === -1, 'index does not load fonts-boot.js');
assert(board.indexOf('fonts-boot.js') === -1, 'board does not load fonts-boot.js');
assert(!fs.existsSync(path.join(root, 'web-override', 'fonts-boot.js')), 'fonts-boot.js removed');

assert(director.indexOf('fonts-noto-loaded') === -1, 'director has no Noto class hook');
assert(css.indexOf('fonts-noto-loaded') === -1, 'style.css has no Noto class hook');
assert(director.indexOf('Noto Sans SC') === -1, 'director shell/css has no Noto family name');
assert(sources.html.indexOf('director.css') !== -1, 'director.html links director.css');
assert(sources.html.indexOf('director-app.js') !== -1, 'director.html loads director-app.js');
assert(sources.html.indexOf('<style>') === -1, 'director.html has no inline style block');
assert(css.indexOf('Noto') === -1, 'style.css has no Noto references');

var stack = '--font: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
assert(css.indexOf(stack) !== -1, 'style.css first-paint stack is system UI');
assert(director.indexOf('"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif') !== -1,
  'director shell uses same system stack');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('fonts-first-paint ok');