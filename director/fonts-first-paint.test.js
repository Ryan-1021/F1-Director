/*
 * node director/fonts-first-paint.test.js
 * No blocking Google Fonts on first paint; async optional Noto.
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
var director = fs.readFileSync(path.join(root, 'director.html'), 'utf8');
var index = fs.readFileSync(path.join(root, 'web-override', 'index.html'), 'utf8');
var board = fs.readFileSync(path.join(root, 'web-override', 'board.html'), 'utf8');
var css = fs.readFileSync(path.join(root, 'web-override', 'style.css'), 'utf8');
var boot = fs.readFileSync(path.join(root, 'web-override', 'fonts-boot.js'), 'utf8');

function noBlockingFonts(src, label) {
  assert(src.indexOf('fonts.googleapis.com/css2') === -1, label + ' has no blocking Google stylesheet');
  assert(src.indexOf('@import url("https://fonts.googleapis.com') === -1, label + ' has no @import fonts');
}

noBlockingFonts(director, 'director.html');
noBlockingFonts(index, 'index.html');
noBlockingFonts(board, 'board.html');
noBlockingFonts(css, 'style.css');

assert(director.indexOf('fonts-boot.js') !== -1, 'director loads fonts-boot.js');
assert(index.indexOf('/fonts-boot.js') !== -1, 'index loads fonts-boot.js');
assert(board.indexOf('/fonts-boot.js') !== -1, 'board loads fonts-boot.js');
assert(css.indexOf('html.fonts-noto-loaded') !== -1, 'CSS upgrades stack when Noto loads');
assert(css.indexOf('"Segoe UI"') === 0 || css.indexOf('--font: "Segoe UI"') !== -1,
  'first-paint stack leads with system UI');
assert(boot.indexOf('requestIdleCallback') !== -1, 'optional font load is idle-deferred');
assert(boot.indexOf('display=optional') !== -1, 'Google path uses font-display optional');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('fonts-first-paint ok');