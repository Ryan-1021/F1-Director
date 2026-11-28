/*
 * node director/web-override/carno-team-color.test.js
 * 成绩榜 / 赛段 who-cell 车号队色与 WCAG 相对亮度对比度下限。
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
  return '';
}

var appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

assert(appSrc.indexOf('applyCarnoTeamColour') >= 0, 'applyCarnoTeamColour wired');
assert(/applyCarnoTeamColour\(carnoEl, c\.teamColour\)/.test(appSrc), 'timing build sets carno colour');
assert(/applyCarnoTeamColour\(carnoS, c\.teamColour\)/.test(appSrc), 'sectors build sets carno colour');
assert(appSrc.indexOf('CARNO_CONTRAST_MIN = 3.2') >= 0, 'contrast target 3.2');

var fns = [
  'teamColourCss',
  'hexToRgb',
  'rgbToHex',
  'srgbToLinear',
  'relLuminance',
  'contrastRatio',
  'parseCssRgbColor',
  'compositeOver',
  'mixRgb',
  'carnoMinRowContrast',
  'whoTeamColourHex',
  'carnoColourCss'
].map(function (name) { return extractFunction(appSrc, name); });

var sandbox = {
  document: {
    documentElement: {
      getAttribute: function () { return 'day'; }
    }
  },
  getComputedStyle: function () {
    return {
      getPropertyValue: function (prop) {
        if (prop === '--panel') return '#ffffff';
        if (prop === '--stripe-row') return 'rgba(15, 23, 42, 0.035)';
        return '';
      }
    };
  },
  Math: Math,
  parseFloat: parseFloat,
  parseInt: parseInt,
  String: String,
  carnoColourCache: {}
};

vm.createContext(sandbox);
var body = ''
  + 'var CARNO_CONTRAST_MIN = 3.2;\n'
  + 'var carnoColourCache = {};\n'
  + 'function timingBoardRowBgs() {\n'
  + '  var cs = getComputedStyle(document.documentElement);\n'
  + '  var panel = parseCssRgbColor(cs.getPropertyValue("--panel").trim());\n'
  + '  var stripe = parseCssRgbColor(cs.getPropertyValue("--stripe-row").trim());\n'
  + '  var even = stripe ? compositeOver(stripe, panel) : panel;\n'
  + '  return { odd: panel, even: even };\n'
  + '}\n'
  + fns.join('\n');
vm.runInContext(body, sandbox);

var dayBgs = sandbox.timingBoardRowBgs();
var silverHaas = sandbox.carnoColourCss('9C9FA2');
var silverRgb = sandbox.hexToRgb(silverHaas);
assert(
  sandbox.carnoMinRowContrast(silverRgb, dayBgs) >= 3.2,
  'day theme darkens Haas silver to >= 3.2 on both stripe backgrounds'
);

var mclaren = sandbox.carnoColourCss('FF8000');
var mclRgb = sandbox.hexToRgb(mclaren);
assert(
  sandbox.carnoMinRowContrast(mclRgb, dayBgs) >= 3.2,
  'day theme darkens McLaren orange when raw hex is below 3.2'
);
assert(mclaren.toLowerCase() !== '#ff8000', 'McLaren orange is mixed toward black on day');

sandbox.document.documentElement.getAttribute = function () { return 'night'; };
sandbox.carnoColourCache = {};
var verNight = sandbox.carnoColourCss('3671C6');
assert(verNight.toLowerCase() === '#3671c6', 'Red Bull blue unchanged on night');

if (failed) {
  console.error(failed + ' test(s) failed');
  process.exit(1);
}
console.log('carno-team-color.test.js: ok');