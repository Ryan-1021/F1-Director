/*
 * node director/web-override/trackmap-estimate.test.js
 * 计时估计与 SVG 轮廓采样的自检。不进 share/web。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var E = require('./trackmap-estimate.js');

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL ' + msg);
  }
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, msg + ' got ' + a + ' expected ' + b);
}

assert(E.sessionUsesTimeGaps('Race') === true, 'race gaps');
assert(E.sessionUsesTimeGaps('Sprint') === true, 'sprint gaps');
assert(E.sessionUsesTimeGaps('Sprint Qualifying') === false, 'sprint quali not gaps');
assert(E.sessionUsesTimeGaps('Qualifying') === false, 'quali');
assert(E.sessionUsesTimeGaps('Practice 1') === false, 'fp');

assert(E.parseGap('LEADER').kind === 'leader', 'leader');
assert(E.parseGap('+1.250').kind === 'time' && E.parseGap('+1.250').seconds === 1.25, 'gap sec');
assert(E.parseGap('1:02.500').seconds === 62.5, 'gap clock');
assert(E.parseGap('+1 LAP').kind === 'laps', 'one lap');
assert(E.parseGap('2 LAPS').kind === 'laps', 'two laps');
assert(E.parseGap('IN PIT').kind === 'pit', 'pit gap');
assert(E.paceScale('Safety Car') === 0.4, 'sc');
assert(E.paceScale('Virtual Safety Car') === 0.6, 'vsc');
assert(E.paceScale('Red Flag') === 0, 'red');
assert(E.paceScale('绿灯') === 1, 'green');

var s2 = E.progressFromTiming({
  sectors: [
    { value: '28.100', segments: [2049, 2049, 2048, 2048, 2051, 2048, 2048, 2048] },
    { value: '', segments: [2048, 2049, 2051, 2048, 0, 0, 0, 0] },
    { value: '', segments: [0, 0, 0, 0] }
  ]
});
assert(s2.sector === 1 && s2.exact && s2.doneSegs === 4, 's2 segments ' + JSON.stringify(s2));
near(s2.frac, (1 + (4 - 0.2) / 8) / 3, 0.02, 's2 frac');

var aged = E.progressFromTiming({
  sectors: [
    { value: '28.100', segments: [0, 0, 0, 0] },
    { value: '', segments: [0, 0, 0, 0, 0, 0] },
    { value: '', segments: [] }
  ]
});
assert(aged.sector === 1 && aged.exact === false, 'aged segments are a floor');
near(aged.frac, 1 / 3 + 0.01, 0.03, 'aged floor');

var doneLap = E.progressFromTiming({
  sectors: [
    { value: '28.1', segments: [2048] },
    { value: '30.2', segments: [2048] },
    { value: '29.4', segments: [2048] }
  ]
});
assert(doneLap.freshLap && doneLap.exact && doneLap.frac < 0.05, 'fresh lap near line');

var quali = E.planField([
  { number: 1, tla: 'VER', position: 1, gap: '+0.200', sectors: [{ value: '', segments: [] }, {}, {}] },
  { number: 44, tla: 'HAM', position: 2, gap: '+0.800', inPit: true, sectors: [{}, {}, {}] }
], 'Qualifying', 'Started');
assert(quali.raceGaps === false, 'quali plan');
assert(quali.cars[1].pit === true && quali.cars[1].mode === 'pit', 'quali pit');
assert(quali.cars[0].mode === 'grid', 'no sector yet is grid ' + quali.cars[0].mode);

var race = E.planField([
  {
    number: 1, tla: 'VER', position: 1, gap: 'LEADER', bestLap: '1:30.000',
    sectors: [
      { value: '30.000', segments: [2048, 2048, 2048] },
      { value: '', segments: [2048, 0, 0] },
      { value: '', segments: [] }
    ]
  },
  {
    number: 16, tla: 'LEC', position: 2, gap: '+1.500', bestLap: '1:30.200',
    sectors: [
      { value: '30.100', segments: [] },
      { value: '', segments: [] },
      { value: '', segments: [] }
    ]
  },
  {
    number: 55, tla: 'SAI', position: 3, gap: '+1 LAP', bestLap: '1:31.000',
    sectors: [
      { value: '30.000', segments: [2048, 2048] },
      { value: '31.000', segments: [2048] },
      { value: '', segments: [0, 0] }
    ]
  }
], 'Race', 'Green');
assert(race.raceGaps === true, 'race gaps on');
near(race.lapSeconds, 90, 0.01, 'ref lap');
assert(race.cars[1].mode === 'gap', 'lec gap mode ' + race.cars[1].mode);
var leaderFrac = race.cars[0].frac;
near(race.cars[1].frac, E.wrap01(leaderFrac - 1.5 / 90), 0.0001, 'lec behind');
assert(race.cars[2].mode !== 'gap', 'lapped car not gap ' + race.cars[2].mode);
assert(race.cars[2].sector === undefined || race.cars[2].mode === 'sector' || race.cars[2].mode === 'floor', 'sai own sectors');

// 运动：目标不变时继续往前走，不要被每秒的重复测量拉回。
var st = E.stepMotion(null, 0.2, 0.33, 0, 90000, false, { exact: true });
st = E.stepMotion(st, 0.2, 0.33, 1000, 90000, false, { exact: true });
var moved = E.sampleMotion(st, 3000, 90000, false);
near(moved, 0.2 + 3 / 90, 0.012, 'integrates across unchanged targets');

// 迷你赛段褪色：不要把车拉回赛段起点。
st = E.stepMotion(null, 0.5, 0.6, 0, 90000, false, { exact: true });
var mid = E.sampleMotion(st, 2000, 90000, false);
st = E.stepMotion(st, 0.34, 0.66, 2000, 90000, false, { exact: false });
var kept = E.sampleMotion(st, 2000, 90000, false);
assert(kept > 0.45, 'aged segments do not rewind ' + kept + ' from ' + mid);

// 进站冻在当前进度。
st = E.stepMotion(null, 0.42, 0.55, 0, 90000, false, { exact: true });
st = E.stepMotion(st, 0.99, 0.99, 1000, 90000, false, { exact: true, pit: true });
var parked = E.sampleMotion(st, 8000, 90000, false);
near(parked, 0.42 + 1 / 90, 0.02, 'pit holds entry frac');
assert(st.pit === true, 'pit flag');

// 弧长：中点大致在线段中间。
var arc = E.buildArc([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
var midPt = E.pointOnArc(arc, 0.5);
near(midPt.x, 10, 0.2, 'arc mid x');
near(midPt.y, 0, 0.6, 'arc mid y');
var endPt = E.pointOnArc(arc, 0);
near(endPt.x, 0, 0.01, 'arc start');

var dir = path.join(__dirname, 'circuits');
var files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.svg'); });
assert(files.length >= 20, 'circuit svgs present');
files.forEach(function (f) {
  var text = fs.readFileSync(path.join(dir, f), 'utf8');
  var pts = E.outlineFromSvg(text, 4);
  assert(pts.length >= 80, f + ' points ' + pts.length);
  var a = pts[0];
  var b = pts[pts.length - 1];
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  var close = Math.sqrt(dx * dx + dy * dy);
  var built = E.buildArc(pts);
  assert(built.total > 100, f + ' length');
  assert(close < built.total * 0.08, f + ' not closed dist ' + close.toFixed(1) + ' / ' + built.total.toFixed(1));
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < pts.length; i++) {
    if (pts[i].x < minX) minX = pts[i].x;
    if (pts[i].y < minY) minY = pts[i].y;
    if (pts[i].x > maxX) maxX = pts[i].x;
    if (pts[i].y > maxY) maxY = pts[i].y;
  }
  assert(maxX - minX > 40 && maxY - minY > 40, f + ' bbox');
  assert(isFinite(minX) && isFinite(maxY), f + ' finite');
});

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok ' + files.length + ' circuits');
