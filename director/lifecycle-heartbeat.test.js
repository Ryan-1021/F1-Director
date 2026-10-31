/*
 * node director/lifecycle-heartbeat.test.js
 * 关页停服时序：心跳 4s、告别 ~3s、失联 ~5s；切标签脉冲应取消 goodbye。
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

var root = __dirname;
var html = fs.readFileSync(path.join(root, 'director.html'), 'utf8');
var ps1 = fs.readFileSync(path.join(root, 'Run-Director.ps1'), 'utf8');
var readme = fs.readFileSync(path.join(root, '..', 'README.md'), 'utf8');

var interval = html.match(/var HB_INTERVAL_MS = (\d+);/);
var pulse = html.match(/var HB_ALIVE_PULSE_MS = (\d+);/);
assert(interval && Number(interval[1]) === 4000, 'HB_INTERVAL_MS is 4000');
assert(pulse && Number(pulse[1]) === 1200, 'HB_ALIVE_PULSE_MS is 1200');
assert(html.indexOf('setInterval(sendDirectorHeartbeat, HB_INTERVAL_MS)') !== -1, 'main setInterval uses HB_INTERVAL_MS');
assert(html.indexOf('postMessage(1); }, \' + HB_INTERVAL_MS') !== -1, 'Worker timer uses HB_INTERVAL_MS');

assert(/fetchLater\(HB_GOODBYE/.test(html), 'queues fetchLater /goodbye while alive');
assert(/visibilityState === 'hidden'/.test(html), 'goodbye on visibility hidden');
assert(/pulseIfStillAlive\(\)/.test(html), 'hidden path pulses still-alive heartbeat');
assert(/addEventListener\('pagehide'/.test(html), 'pagehide still sends goodbye');
assert(/addEventListener\('beforeunload'/.test(html) === false, 'no beforeunload listener (avoids --app cancel race)');
assert(/sendBeacon\(HB\)/.test(html) === false, 'heartbeat uses Blob payload, not empty sendBeacon');

var miss = ps1.match(/\$MissGraceSec = (\d+)/);
var bye = ps1.match(/\$GoodbyeGraceSec = (\d+)/);
assert(bye && Number(bye[1]) === 3, 'GoodbyeGraceSec is 3');
assert(miss && Number(miss[1]) === 5, 'MissGraceSec is 5');
assert(ps1.indexOf('Heartbeat every 4s') !== -1, 'console hint mentions 4s heartbeat');
assert(ps1.indexOf('~5s miss') !== -1, 'console hint mentions 5s miss backup');

assert(/心跳 \*\*4s\*\*/.test(readme), 'README lists 4s heartbeat');
assert(/告别宽限约 \*\*3s\*\*/.test(readme), 'README lists ~3s goodbye grace');
assert(/失联兜底约 \*\*5s\*\*/.test(readme), 'README lists ~5s miss grace');
assert(readme.indexOf('心跳间隔 **4 秒**') !== -1, 'README run steps mention 4s interval');
assert(readme.indexOf('约 **5 秒**无心跳') !== -1, 'README run steps mention 5s miss');

var workerSrc = [
  'var u = "http://127.0.0.1:8721/heartbeat";',
  'function beat() {',
  '  try {',
  '    fetch(u + "?t=" + Date.now(), {',
  '      method: "POST", cache: "no-store", mode: "cors", keepalive: true,',
  '      headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: "ok"',
  '    }).catch(function () {});',
  '  } catch (e) {}',
  '}',
  'beat();',
  'setInterval(function () { beat(); postMessage(1); }, 4000);'
].join('\n');
try {
  new vm.Script(workerSrc, { filename: 'hb-worker.js' });
} catch (e) {
  assert(false, 'Worker source parses: ' + e.message);
}

var lifeStart = html.lastIndexOf('var HB_INTERVAL_MS');
var lifeEnd = html.indexOf('connectFeed();', lifeStart);
assert(lifeStart >= 0 && lifeEnd > lifeStart, 'lifecycle snippet markers');
if (lifeStart >= 0 && lifeEnd > lifeStart) {
  try {
    new vm.Script(html.slice(lifeStart, lifeEnd), { filename: 'lifecycle.js' });
  } catch (e) {
    assert(false, 'lifecycle snippet parses: ' + e.message);
  }
}

function pump(state, nowMs, goodbyeGraceSec, missGraceSec) {
  if (state.pendingStopUtc != null && (nowMs - state.pendingStopUtc) / 1000 >= goodbyeGraceSec) {
    return 'goodbye';
  }
  if (state.seenBeat && state.lastBeatUtc != null && (nowMs - state.lastBeatUtc) / 1000 >= missGraceSec) {
    return 'heartbeat';
  }
  return null;
}

function beat(state, nowMs) {
  state.lastBeatUtc = nowMs;
  state.seenBeat = true;
  state.pendingStopUtc = null;
}

function goodbye(state, nowMs) {
  state.pendingStopUtc = nowMs;
}

var g = 3;
var m = 5;

var closeState = { lastBeatUtc: 0, seenBeat: true, pendingStopUtc: null };
goodbye(closeState, 1000);
assert(pump(closeState, 3999, g, m) === null, 'goodbye does not stop before 3s');
assert(pump(closeState, 4000, g, m) === 'goodbye', 'close window stops via ~3s goodbye');

var hideState = { lastBeatUtc: 0, seenBeat: true, pendingStopUtc: null };
goodbye(hideState, 1000);
beat(hideState, 1000 + 1200);
assert(pump(hideState, 1000 + 3000, g, m) === null, '1.2s still-alive pulse cancels goodbye');
assert(pump(hideState, 1000 + 1200 + 4999, g, m) === null, 'hidden but alive stays under miss grace');
assert(pump(hideState, 1000 + 1200 + 5000, g, m) === 'heartbeat', 'miss grace still fires if beats stop');

var f5State = { lastBeatUtc: 0, seenBeat: true, pendingStopUtc: null };
goodbye(f5State, 2000);
beat(f5State, 2800);
assert(pump(f5State, 5000, g, m) === null, 'F5 heartbeat within 3s cancels goodbye');

var missState = { lastBeatUtc: 0, seenBeat: true, pendingStopUtc: null };
assert(pump(missState, 4999, g, m) === null, '4s beat interval does not trip 5s miss');
assert(pump(missState, 5000, g, m) === 'heartbeat', 'miss grace is 5s backup');

var liveState = { lastBeatUtc: 0, seenBeat: true, pendingStopUtc: null };
beat(liveState, 4000);
beat(liveState, 8000);
assert(pump(liveState, 8000 + 4999, g, m) === null, 'regular 4s beats keep the server up');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('lifecycle-heartbeat ok');
