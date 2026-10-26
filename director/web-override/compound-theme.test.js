/*
 * node director/web-override/compound-theme.test.js
 * HARD 白胎：白天黑字 H、透明底贴合行背景、夜晚保持白描边、徽章不写内联色。
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

var dir = __dirname;
var appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
var styleSrc = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');

var badgeFn = appSrc.match(/function compoundBadge\([\s\S]*?\n  \}/);
assert(!!badgeFn, 'compoundBadge is present');
assert(badgeFn && badgeFn[0].indexOf('style.color') < 0, 'compoundBadge does not inline color');
assert(badgeFn && badgeFn[0].indexOf('style.borderColor') < 0, 'compoundBadge does not inline borderColor');
assert(appSrc.indexOf("H: '#f0f0f0'") < 0, 'JS no longer hardcodes HARD #f0f0f0');

assert(/--comp-H:\s*#f0f0f0/.test(styleSrc), 'night HARD token stays #f0f0f0');
assert(!/html\[data-theme="day"\][\s\S]*?--comp-H:\s*#64748b/.test(styleSrc),
  'day theme does not recolor HARD to slate');
assert(!/html\[data-theme="day"\][\s\S]*?--comp-M:\s*#854d0e/.test(styleSrc),
  'day theme does not recolor MEDIUM to brown');

var dayHard = styleSrc.match(/html\[data-theme="day"\] \.ttyre\.comp-H\s*\{[^}]+\}/);
assert(!!dayHard, 'day HARD rule exists');
assert(dayHard && /border-color:\s*#3b4a5c/.test(dayHard[0]), 'day HARD has a dark rim');
assert(dayHard && /background:\s*var\(--ttyre-bg\)/.test(dayHard[0]),
  'day HARD fill inherits --ttyre-bg (transparent, matches the row)');
assert(dayHard && !/background:\s*#ffffff/.test(dayHard[0]),
  'day HARD is not a solid white chip');
assert(dayHard && !/box-shadow/.test(dayHard[0]),
  'day HARD has no extra chip ring');
assert(dayHard && /color:\s*#111111/.test(dayHard[0]), 'day HARD letter is near-black');
assert(dayHard && dayHard[0].indexOf('-webkit-text-stroke') < 0, 'day HARD letter is fill, not stroke');
assert(styleSrc.indexOf('html[data-theme="night"] .ttyre.comp-H') < 0,
  'night HARD is not restyled (outline-only via --comp-H)');
assert(!/html\[data-theme="day"\] \.ttyre\.comp-S/.test(styleSrc),
  'day SOFT is not restyled');
assert(!/html\[data-theme="day"\] \.ttyre\.comp-M/.test(styleSrc),
  'day MEDIUM is not restyled');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('compound-theme ok');
