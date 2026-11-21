/*
 * node director/state-buffer-window.test.js
 * 看板延迟缓冲：delay 0 只留最新一帧；delay N 只留 N 秒加 8 秒余量，不再垫 180 秒。
 * pickDelayedState 的选帧规则不变。不进 share/web。
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

var html = require('./test-director-sources').loadDirectorSources().bundle;
var trimSrc = extractFunction(html, 'trimStateBuffer');
var pickSrc = extractFunction(html, 'pickDelayedState');
assert(trimSrc.indexOf('MAX_BUFFER_MS') === -1, 'trim no longer reads MAX_BUFFER_MS');
assert(trimSrc.indexOf('180000') === -1, 'trim has no 180s floor');
assert(html.indexOf('var MAX_BUFFER_MS') === -1, '180s constant is gone');
assert(/var DELAY_BUFFER_MARGIN_MS = 8000;/.test(html), 'margin is 8s');
assert(/var MAX_BUFFER_SNAPSHOTS = 2400;/.test(html), 'count cap stays 2400');

var sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  'var DELAY_BUFFER_MARGIN_MS = 8000;\n' +
  'var MAX_BUFFER_SNAPSHOTS = 2400;\n' +
  'var streamDelaySec = 0;\n' +
  'var stateBuffer = [];\n' +
  trimSrc + '\n' + pickSrc,
  sandbox
);

var NOW = 1700000000000;

function load(delay, samples) {
  sandbox.streamDelaySec = delay;
  sandbox.stateBuffer = samples.map(function (s) {
    return { t: s.t, state: s.state };
  });
}

function ages(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(Math.round((NOW - list[i].t) / 1000));
  return out;
}

function chronological(ageSeconds) {
  var samples = [];
  for (var i = 0; i < ageSeconds.length; i++) {
    samples.push({ t: NOW - ageSeconds[i] * 1000, state: { age: ageSeconds[i] } });
  }
  samples.sort(function (a, b) { return a.t - b.t; });
  return samples;
}

// delay 0: one newest snapshot, even if the history is minutes long.
var longHistory = [];
for (var n = 0; n < 200; n++) {
  longHistory.push({ t: NOW - (199 - n) * 1000, state: { i: n } });
}
load(0, longHistory);
sandbox.trimStateBuffer(NOW);
assert(sandbox.stateBuffer.length === 1, 'delay 0 keeps one snapshot, got ' + sandbox.stateBuffer.length);
assert(sandbox.stateBuffer[0].state.i === 199, 'delay 0 keeps the newest snapshot');
var live = sandbox.pickDelayedState(NOW);
assert(live && live.ready && live.waitSec === 0 && live.state.i === 199, 'delay 0 plays the newest snapshot');

// delay N keeps N + 8s, inclusive of the exact cutoff, and drops the old 180s floor.
var span = [];
for (var age = 0; age <= 200; age++) span.push(age);
load(30, chronological(span));
sandbox.trimStateBuffer(NOW);
var kept30 = ages(sandbox.stateBuffer);
assert(kept30[0] === 38 && kept30[kept30.length - 1] === 0, 'delay 30 keeps ages 38..0, got ' + kept30[0] + '..' + kept30[kept30.length - 1]);
assert(kept30.indexOf(39) === -1, 'delay 30 drops age 39');
var play30 = sandbox.pickDelayedState(NOW);
assert(play30 && play30.ready && play30.state.age === 30, 'delay 30 plays the 30s-old sample');

load(120, chronological(span));
sandbox.trimStateBuffer(NOW);
var kept120 = ages(sandbox.stateBuffer);
assert(kept120[0] === 128 && kept120[kept120.length - 1] === 0, 'delay 120 keeps ages 128..0, got ' + kept120[0]);
assert(kept120.indexOf(129) === -1 && kept120.indexOf(170) === -1, 'delay 120 drops the old 180s-floor samples');
var play120 = sandbox.pickDelayedState(NOW);
assert(play120 && play120.ready && play120.state.age === 120, 'slider max still plays 120s back');

// Newest sample at or before the target, not an older one and not a newer one.
load(3, [
  { t: NOW - 5000, state: { age: 5 } },
  { t: NOW - 3000, state: { age: 3 } },
  { t: NOW - 1000, state: { age: 1 } }
]);
sandbox.trimStateBuffer(NOW);
var exact = sandbox.pickDelayedState(NOW);
assert(sandbox.stateBuffer.length === 3, 'samples inside delay+margin stay');
assert(exact && exact.ready && exact.state.age === 3, 'picks the newest sample at the target');

// Still warming up when every sample is newer than the target.
load(10, [
  { t: NOW - 1000, state: { age: 1 } },
  { t: NOW, state: { age: 0 } }
]);
sandbox.trimStateBuffer(NOW);
var warm = sandbox.pickDelayedState(NOW);
assert(warm && !warm.ready && warm.state === null && warm.waitSec === 9, 'warmup wait is ceil(delay - oldest age), got ' + (warm && warm.waitSec));

// Margin: a trimmed 10s delay still has 18s, so +8s applies; +9s does not.
load(10, chronological(span));
sandbox.trimStateBuffer(NOW);
sandbox.streamDelaySec = 18;
sandbox.trimStateBuffer(NOW);
var up8 = sandbox.pickDelayedState(NOW);
assert(up8 && up8.ready && up8.state.age === 18, 'raising delay by the 8s margin still hits a stored sample');
sandbox.streamDelaySec = 19;
sandbox.trimStateBuffer(NOW);
var up9 = sandbox.pickDelayedState(NOW);
assert(up9 && !up9.ready && up9.waitSec === 1, 'raising delay past the margin waits for new history');

// Always keep the last sample, even when it is older than the window.
load(30, [{ t: NOW - 100000, state: { age: 100 } }]);
sandbox.trimStateBuffer(NOW);
assert(sandbox.stateBuffer.length === 1 && sandbox.stateBuffer[0].state.age === 100, 'a lone stale sample is kept');
var stale = sandbox.pickDelayedState(NOW);
assert(stale && stale.ready && stale.state.age === 100, 'that lone sample is still eligible for delayed playback');

// Count cap still bounds a burst inside the time window. Delay 0 ignores it.
var burst = [];
for (var b = 0; b < 2500; b++) burst.push({ t: NOW - (2499 - b), state: { i: b } });
load(120, burst);
sandbox.trimStateBuffer(NOW);
assert(sandbox.stateBuffer.length === 2400, 'cap is 2400 inside the window, got ' + sandbox.stateBuffer.length);
assert(sandbox.stateBuffer[0].state.i === 100 && sandbox.stateBuffer[2399].state.i === 2499, 'cap drops the oldest burst samples');
load(0, burst);
sandbox.trimStateBuffer(NOW);
assert(sandbox.stateBuffer.length === 1 && sandbox.stateBuffer[0].state.i === 2499, 'delay 0 keeps one snapshot, not the count cap');

load(0, []);
sandbox.trimStateBuffer(NOW);
assert(sandbox.stateBuffer.length === 0, 'empty buffer stays empty');
assert(sandbox.pickDelayedState(NOW) === null, 'empty buffer picks null');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok');
