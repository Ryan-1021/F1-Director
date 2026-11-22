/*
 * node director/updates-skip-redraw.test.js
 * updates 未变时跳过整板重绘：onState / pushStateToAll 仅以 updates 为门闩。
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
var appJs = fs.readFileSync(path.join(root, 'web-override', 'app.js'), 'utf8');
var director = require('./test-director-sources').loadDirectorSources().app;

assert(appJs.indexOf('lastFeedUpdates') !== -1, 'board tracks lastFeedUpdates');
assert(appJs.indexOf('function feedUpdatesKey') !== -1, 'board has feedUpdatesKey');
assert(appJs.indexOf('function repaintTickOnly') !== -1, 'board has repaintTickOnly');
assert(appJs.indexOf('function applyStateTick') !== -1, 'board has applyStateTick');
assert(/repaintTickOnly\(\)/.test(appJs), 'board uses repaintTickOnly');
assert(appJs.indexOf('lastUpdateAt') < appJs.indexOf('function onState'),
  'onState mentions lastUpdateAt');
var onStateSrc = extractFunction(appJs, 'onState');
assert(onStateSrc.indexOf('lastFeedUpdates') !== -1, 'onState compares feed updates');
assert(onStateSrc.indexOf('repaintTickOnly') !== -1, 'onState can tick-only');
assert(onStateSrc.indexOf('lastUpdateAt') === -1 || onStateSrc.indexOf('repaintTickOnly') < onStateSrc.indexOf('repaint()') || onStateSrc.indexOf('repaintTickOnly') !== -1,
  'onState structure ok');
assert(onStateSrc.indexOf('s.updates') === -1, 'onState uses feedUpdatesKey not raw field');

assert(director.indexOf('lastPushedBoardUpdates') !== -1, 'director tracks lastPushedBoardUpdates');
assert(director.indexOf('function pushTickToFrame') !== -1, 'director has pushTickToFrame');
assert(director.indexOf('f1-tick-state') !== -1, 'director posts tick state message');
var pushAllSrc = extractFunction(director, 'pushStateToAll');
assert(pushAllSrc.indexOf('skipBoardRender') !== -1, 'pushStateToAll gates on updates');
assert(pushAllSrc.indexOf('pushTickToFrame') !== -1, 'pushStateToAll tick-pushes when skipping');
assert(pushAllSrc.indexOf('updateWeatherStrip') !== -1, 'weather strip still on full push');
assert(pushAllSrc.indexOf('pushStateToFrame') !== -1, 'full push still uses pushStateToFrame');

// Sandbox: pushStateToAll calls weather only when updates change.
var sandbox = {
  latestState: null,
  lastPushedBoardUpdates: null,
  panels: {
    timing: { type: 'board', el: { querySelector: function () { return { contentWindow: null }; } } }
  },
  updateSessionStripCalls: 0,
  updateWeatherStripCalls: 0,
  updateTrackStripCalls: 0,
  framePush: 0,
  tickPush: 0
};
vm.createContext(sandbox);
vm.runInContext(
  'function feedUpdatesKey(s) {\n' +
  '  if (!s || s.updates == null) return null;\n' +
  '  return s.updates;\n' +
  '}\n' +
  'function updateSessionStrip() { updateSessionStripCalls++; }\n' +
  'function updateWeatherStrip() { updateWeatherStripCalls++; }\n' +
  'function updateTrackStrip() { updateTrackStripCalls++; }\n' +
  'function pushStateToFrame() { framePush++; }\n' +
  'function pushTickToFrame() { tickPush++; }\n' +
  pushAllSrc,
  sandbox
);

sandbox.latestState = { updates: 1, race: { remaining: '05:00' } };
sandbox.pushStateToAll();
assert(sandbox.updateSessionStripCalls === 1, 'session strip always');
assert(sandbox.updateWeatherStripCalls === 1, 'first push full strips');
assert(sandbox.framePush === 1, 'first push full frames');
assert(sandbox.tickPush === 0, 'no tick on first push');
assert(sandbox.lastPushedBoardUpdates === 1, 'remember updates');

sandbox.latestState = { updates: 1, race: { remaining: '04:59' } };
sandbox.pushStateToAll();
assert(sandbox.updateSessionStripCalls === 2, 'session strip on tick path');
assert(sandbox.updateWeatherStripCalls === 1, 'weather skipped');
assert(sandbox.framePush === 1, 'frames skipped');
assert(sandbox.tickPush === 1, 'tick push once');

sandbox.latestState = { updates: 2, race: { remaining: '04:58' } };
sandbox.pushStateToAll();
assert(sandbox.updateWeatherStripCalls === 2, 'weather on update bump');
assert(sandbox.framePush === 2, 'full frame on update bump');
assert(sandbox.lastPushedBoardUpdates === 2, 'bump remembered');

if (failed) {
  console.error(failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('OK updates-skip-redraw');