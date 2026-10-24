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
near(s2.frac, (1 + 4 / 8) / 3, 0.001, 's2 frac matches lit mini-sectors');
assert(s2.cap > s2.frac, 'cap still lets the dot move');
assert(s2.cap - s2.frac < (1 / 8) / 3, 'cap does not cross the next mini-sector');

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

// 上一圈的赛段时间还在，但本圈迷你赛段只点亮了一截：跟格子走，不要拉回起点。
var stale = E.progressFromTiming({
  sectors: [
    { value: '28.100', segments: [2048, 2048, 2048, 2048] },
    { value: '31.200', segments: [2048, 2064, 0, 0, 0] },
    { value: '29.400', segments: [2048, 2049, 2051] }
  ]
});
assert(stale.freshLap === false, 'stale times are not a new lap');
assert(stale.sector === 1 && stale.exact && stale.doneSegs === 2, 'follow partial strip ' + JSON.stringify(stale));
near(stale.frac, (1 + 2 / 5) / 3, 0.001, 'frac at lit S2 edge');

var newLap = E.progressFromTiming({
  sectors: [
    { value: '28.100', segments: [2048, 2049, 0, 0] },
    { value: '31.200', segments: [2048, 2048, 2048] },
    { value: '29.400', segments: [2051, 2048] }
  ]
});
assert(newLap.freshLap === false && newLap.sector === 0 && newLap.doneSegs === 2, 'new lap follows S1 strip');
near(newLap.frac, (2 / 4) / 3, 0.001, 'S1 lit edge');

var enterS3 = E.progressFromTiming({
  sectors: [
    { value: '28.1', segments: [2048, 2048] },
    { value: '30.2', segments: [2048, 2048, 2048] },
    { value: '29.4', segments: [0, 0, 0, 0] }
  ]
});
assert(enterS3.freshLap === false && enterS3.sector === 2 && enterS3.exact === false,
  'S3 reset is not the start line ' + JSON.stringify(enterS3));
near(enterS3.frac, (2 + 0.03) / 3, 0.01, 'S3 entrance floor');

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

// 迷你赛段向前跳一格时，同一时刻不要瞬移，沿弧线滑过去。
var glide = E.stepMotion(null, 0.2, 0.28, 5000, 90000, false, { exact: true });
glide = E.stepMotion(glide, 0.24, 0.32, 5000, 90000, false, { exact: true });
var atTick = E.sampleMotion(glide, 5000, 90000, false);
near(atTick, 0.2, 0.005, 'mini-sector tick does not jump');
var midGlide = E.sampleMotion(glide, 5180, 90000, false);
assert(midGlide > 0.205 && midGlide < 0.235, 'glides toward new mini-sector ' + midGlide);

var scaled = E.stepMotion(null, 0.4, 0.5, 0, 90000, false, { exact: true, lapScale: 1 });
var midScale = E.sampleMotion(scaled, 3000, 90000, false);
scaled = E.stepMotion(scaled, 0.4, 0.5, 3000, 90000, false, { exact: true, lapScale: 1.3 });
var heldScale = E.sampleMotion(scaled, 3000, 90000, false);
near(heldScale, midScale, 0.002, 'lap scale change does not jump');

var slow = E.planField([{
  number: 1, tla: 'VER', position: 1, gap: 'LEADER', lastLap: '1:40.000', bestLap: '1:30.000',
  sectors: [
    { value: '', segments: [2048, 0, 0] },
    { value: '', segments: [] },
    { value: '', segments: [] }
  ]
}], 'Practice 3', 'Started');
near(slow.cars[0].lapScale, 100 / 90, 0.02, 'coast at own last lap');
near(slow.cars[0].frac, (1 / 3) / 3, 0.001, 'practice frac follows first lit mini-sector');

var onLine = E.packOffset(0, false);
assert(onLine.n === 0 && onLine.t === 0, 'first car sits on the arc');
var pit0 = E.packOffset(0, true);
assert(pit0.n > 0 && pit0.n <= 16 && pit0.t === 0, 'pit car is a small inward offset');
var midLap = E.stepMotion(null, 0.4, 0.5, 0, 90000, false, { exact: true });
midLap = E.stepMotion(midLap, 0.01, 0.1, 2000, 90000, false, { exact: true, freshLap: true });
var stayed = E.sampleMotion(midLap, 2000, 90000, false);
assert(stayed > 0.35, 'full strips mid-lap do not snap to the line ' + stayed);

var fin = E.stepMotion(null, 0.96, 0.99, 0, 90000, false, { exact: true });
fin = E.stepMotion(fin, 0.01, 0.1, 1000, 90000, false, { exact: true, freshLap: true });
var crossing = E.sampleMotion(fin, 1000, 90000, false);
assert(crossing > 0.9, 'finish stays near the line at the tick ' + crossing);
var crossed = E.sampleMotion(fin, 1700, 90000, false);
assert(crossed < 0.08, 'finish eases across the line ' + crossed);

for (var slot = 0; slot < 16; slot++) {
  var pack = E.packOffset(slot, false);
  var pitPack = E.packOffset(slot, true);
  assert(Math.abs(pack.n) <= 14 && Math.abs(pack.t) <= 22, 'on-track pack stays beside the line ' + slot);
  assert(Math.abs(pitPack.n) <= 28 && Math.abs(pitPack.t) <= 22, 'pit pack stays beside the line ' + slot);
}

var flag = E.finishGrid({ x: 80, y: 40 }, 0, 2, 4, 6, 2);
assert(flag.length === 12, 'finish grid count');
var lightN = 0;
var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (var fi = 0; fi < flag.length; fi++) {
  if (flag[fi].light) lightN++;
  assert(flag[fi].light !== flag[(fi + 1) % flag.length].light || fi % 6 === 5, 'row alternates');
  for (var fk = 0; fk < flag[fi].pts.length; fk++) {
    var fp = flag[fi].pts[fk];
    if (fp.x < minX) minX = fp.x;
    if (fp.x > maxX) maxX = fp.x;
    if (fp.y < minY) minY = fp.y;
    if (fp.y > maxY) maxY = fp.y;
  }
}
assert(lightN === 6, 'half the finish squares are light');
near((minX + maxX) / 2, 80, 0.01, 'finish centered on x');
near((minY + maxY) / 2, 40, 0.01, 'finish centered on y');
near(maxY - minY, 8, 0.01, 'two cells along the tangent');
near(maxX - minX, 24, 0.01, 'six cells across the track');
assert(flag[0].light === true && flag[1].light === false, 'checker starts light');

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

var square = E.buildArc([
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }
]);
var q2 = E.sliceArc(square, 0.25, 0.5);
assert(q2.length >= 2, 'slice has ends');
near(q2[0].x, 100, 0.2, 'slice start x');
near(q2[0].y, 0, 0.2, 'slice start y');
near(q2[q2.length - 1].x, 100, 0.2, 'slice end x');
near(q2[q2.length - 1].y, 100, 0.2, 'slice end y');
var qlen = 0;
for (var qi = 1; qi < q2.length; qi++) {
  var qdx = q2[qi].x - q2[qi - 1].x;
  var qdy = q2[qi].y - q2[qi - 1].y;
  qlen += Math.sqrt(qdx * qdx + qdy * qdy);
}
near(qlen, 100, 1, 'slice is one side');
var whole = E.sliceArc(square, 0, 1);
near(whole[0].x, 0, 0.1, 'whole start');
near(whole[whole.length - 1].x, 0, 0.1, 'whole end x');
near(whole[whole.length - 1].y, 0, 0.1, 'whole end does not wrap early');

var localY = E.marshalFlagPlan({
  level: 2, globalLevel: 2, yellowSectors: [10, '3'], doubleYellowSectors: [3]
}, 19);
assert(localY.full === '', 'local yellow is not full course');
assert(localY.sectors.length === 2, 'two flagged sectors');
assert(localY.sectors[0].sec === 3 && localY.sectors[0].kind === 'doubleYellow', 'double yellow wins');
assert(localY.sectors[1].sec === 10 && localY.sectors[1].kind === 'yellow', 'sector 10 yellow');

var scLocal = E.marshalFlagPlan({
  level: 5, globalLevel: 5, yellowSectors: [10], doubleYellowSectors: []
}, 19);
assert(scLocal.full === 'sc' && scLocal.sectors.length === 1, 'SC plus local yellow');

var red = E.marshalFlagPlan({
  level: 6, globalLevel: 6, yellowSectors: [10], doubleYellowSectors: [2]
}, 19);
assert(red.full === 'red' && red.sectors.length === 0, 'red flag clears stretches');

var vsc = E.marshalFlagPlan({ level: 4, globalLevel: 4, yellowSectors: [] }, 19);
assert(vsc.full === 'vsc' && vsc.sectors.length === 0, 'vsc full lap');

var bareYellow = E.marshalFlagPlan({ level: 2, globalLevel: 2, yellowSectors: [] }, 19);
assert(bareYellow.full === 'yellow' && bareYellow.sectors.length === 0, 'yellow with no sector list');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok ' + files.length + ' circuits');
