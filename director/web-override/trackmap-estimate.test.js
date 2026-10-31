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

near(E.ratchetCap(0.50, 0.425, false), 0.50, 1e-9, 'ratchet keeps previous on tighten');
near(E.ratchetCap(0.50, 0.55, false), 0.55, 1e-9, 'ratchet takes a forward cap');
near(E.ratchetCap(0.50, 0.30, false), 0.30, 1e-9, 'ratchet allows a large rewind');
near(E.ratchetCap(0.95, 0.08, false), 0.08, 1e-9, 'ratchet rolls forward through S/F');
near(E.ratchetCap(0.10, 0.99, false), 0.10, 1e-9, 'ratchet ignores a backward wrap flicker');
near(E.ratchetCap(0.50, 0.40, true), 0.40, 1e-9, 'ratchet reset allows a lower cap');
assert(E.ratchetCap(0.50, null, false) === 0.50, 'null measurement keeps previous cap');

// 外推超前后，新采样略落后或把 cap 收紧：这一拍不能沿轮廓回退。
var coast = E.stepMotion(null, 0.40, 0.50, 0, 90000, false, { exact: true });
var coastShown = E.sampleMotion(coast, 3000, 90000, false);
assert(coastShown > 0.42, 'precondition: coasted past the tighter cap ' + coastShown);
coast = E.stepMotion(coast, 0.41, 0.425, 3000, 90000, false, { exact: true });
near(coast.cap, 0.50, 0.001, 'tighter measurement does not lower the ratcheted cap');
var heldCoast = E.sampleMotion(coast, 3000, 90000, false);
assert(heldCoast + 1e-6 >= coastShown, 'tighter cap does not yank ' + heldCoast + ' from ' + coastShown);
var heldLater = E.sampleMotion(coast, 3600, 90000, false);
assert(E.wrapDelta(heldLater - heldCoast) > 0.001, 'leftover cap room still moves forward ' + heldLater + ' from ' + heldCoast);
assert(heldLater < heldCoast + 0.6 / 90 + 0.002, 'does not jump past lap pace after tighten');

// 同一采样反复进来时，车仍应停在官方 cap 附近，不能一层层 bleed 出去。
var pinned = E.stepMotion(null, 0.20, 0.22, 0, 90000, false, { exact: true });
var pinT;
for (pinT = 1000; pinT <= 8000; pinT += 1000) {
  pinned = E.stepMotion(pinned, 0.20, 0.22, pinT, 90000, false, { exact: true });
}
var pinShown = E.sampleMotion(pinned, 8000, 90000, false);
assert(pinShown < 0.22 + E.CHASE_CRUISE_LEAD + 0.03,
  'repeated samples stay bounded past the mini-sector cap ' + pinShown);
assert(pinShown > 0.215, 'still allowed a little bleed at the cap ' + pinShown);

// 迷你赛段褪了再点亮：exact 目标回到旧格子，cap 收紧，也不回退。
var fade = E.stepMotion(null, 0.50, 0.515, 0, 90000, false, { exact: true });
var fadeMid = E.sampleMotion(fade, 2000, 90000, false);
fade = E.stepMotion(fade, 0.343, 0.40, 2000, 90000, false, { exact: false });
var fadeFloor = E.sampleMotion(fade, 2000, 90000, false);
assert(fadeFloor + 1e-6 >= fadeMid, 'faded strips keep the coasted dot ' + fadeFloor);
var fadeLater = E.sampleMotion(fade, 4000, 90000, false);
fade = E.stepMotion(fade, 0.50, 0.515, 4000, 90000, false, { exact: true });
var fadeBack = E.sampleMotion(fade, 4000, 90000, false);
assert(fadeBack + 1e-6 >= fadeLater, 'restored mini-sectors do not yank ' + fadeBack + ' from ' + fadeLater);

// 正赛差距在 1s 一拍里抖动：外推点不能跟着 cap 往回夹。
function gapCar(gap) {
  return {
    number: 16, tla: 'LEC', position: 2, gap: gap, bestLap: '1:30.200',
    sectors: [{ value: '30.100', segments: [] }, { value: '', segments: [] }, { value: '', segments: [] }]
  };
}
var gapLeader = {
  number: 1, tla: 'VER', position: 1, gap: 'LEADER', bestLap: '1:30.000',
  sectors: [
    { value: '30.000', segments: [2048, 2048, 2048] },
    { value: '', segments: [2048, 2048, 2048, 2048, 0, 0, 0, 0] },
    { value: '', segments: [] }
  ]
};
var gapSt = null;
var gapPrev = null;
var gapTicks = ['+1.500', '+1.520', '+1.480', '+1.600', '+1.550', '+1.700'];
for (var gi = 0; gi < gapTicks.length; gi++) {
  var gapNow = gi * 1000;
  var gapPlan = E.planField([gapLeader, gapCar(gapTicks[gi])], 'Race', 'Green');
  var gapP = gapPlan.cars[1];
  gapSt = E.stepMotion(gapSt, gapP.frac, gapP.cap, gapNow, 90000, false, { exact: gapP.exact, lapScale: gapP.lapScale });
  var gapShown = E.sampleMotion(gapSt, gapNow, 90000, false);
  if (gapPrev != null) {
    assert(E.wrapDelta(gapShown - gapPrev) > -0.001,
      'gap tick ' + gapTicks[gi] + ' rolled back ' + gapShown + ' from ' + gapPrev);
  }
  gapPrev = gapShown;
}

// 超过约 0.12 圈的后撤仍然沿短弧收回（重置 / 大幅跳数）。
var rewind = E.stepMotion(null, 0.55, 0.62, 0, 90000, false, { exact: true });
rewind = E.stepMotion(rewind, 0.30, 0.36, 1000, 90000, false, { exact: true });
var rewindMid = E.sampleMotion(rewind, 1400, 90000, false);
assert(rewindMid < 0.52 && rewindMid > 0.30, 'large rearward sample still eases back ' + rewindMid);
var rewindEnd = E.sampleMotion(rewind, 2000, 90000, false);
near(rewindEnd, 0.30, 0.02, 'large rearward ease lands on the new sample');
near(rewind.cap, 0.36, 0.001, 'large rewind is allowed to lower the cap');

// 画面已经超过本拍测量 cap：不钉死，按衰减速度继续往前蹭。
var crawl = E.stepMotion(null, 0.40, null, 0, 90000, false, { exact: true });
var crawlShown = E.sampleMotion(crawl, 5000, 90000, false);
assert(crawlShown > 0.45, 'precondition: unbounded coast is ahead of a later cap ' + crawlShown);
crawl = E.stepMotion(crawl, 0.41, 0.43, 5000, 90000, false, { exact: true });
var crawlHeld = E.sampleMotion(crawl, 5000, 90000, false);
assert(crawlHeld + 1e-6 >= crawlShown, 'late cap behind paint does not yank ' + crawlHeld);
assert(crawl.coasting === true, 'enters coast when measurement sits slightly behind paint');
var crawlLater = E.sampleMotion(crawl, 6200, 90000, false);
assert(crawlLater > crawlHeld + 0.0004, 'coasts forward instead of freezing ' + crawlLater + ' from ' + crawlHeld);
assert(crawlLater < crawlHeld + 1200 / 90000, 'coast is slower than full lap pace ' + crawlLater);
var crawlLater2 = E.sampleMotion(crawl, 7400, 90000, false);
assert(crawlLater2 > crawlLater, 'coast keeps crawling on the next tick ' + crawlLater2);
assert(E.wrapDelta(crawlLater2 - crawlLater) <= E.wrapDelta(crawlLater - crawlHeld) + 1e-6,
  'coast speed decays ' + crawlLater2 + ' vs ' + crawlLater + ' vs ' + crawlHeld);

// 停车 / 进站仍冻住，不走 coast。
var stopped = E.stepMotion(null, 0.40, 0.55, 0, 90000, false, { exact: true });
stopped = E.stepMotion(stopped, 0.42, 0.55, 2000, 90000, false, { exact: true, hold: true });
var stoppedAt = E.sampleMotion(stopped, 2000, 90000, false);
var stoppedLater = E.sampleMotion(stopped, 8000, 90000, false);
near(stoppedLater, stoppedAt, 0.0005, 'hold still freezes');
assert(stopped.coasting === false, 'hold does not coast');

// Scheme 3：belief 前跳时画面不瞬移，沿圈加速度限制追上。
var leap = E.stepMotion(null, 0.20, 0.28, 0, 90000, false, { exact: true });
leap = E.stepMotion(leap, 0.20, 0.28, 3000, 90000, false, { exact: true });
var leapShown = E.sampleMotion(leap, 3000, 90000, false);
leap = E.stepMotion(leap, 0.38, 0.46, 3000, 90000, false, { exact: true });
var leapTick = E.sampleMotion(leap, 3000, 90000, false);
assert(Math.abs(leapTick - leapShown) < 0.004, 'sector jump does not teleport on the same tick ' + leapTick + ' from ' + leapShown);
assert(E.wrapDelta(leapTick - leapShown) >= -1e-9, 'same-tick sector jump stays monotonic');
var leapPrev = leapTick;
var leapT;
var leapPrevX = (leap.vel || 0) * 90000;
var leapMaxDropX = 0;
for (leapT = 3016; leapT <= 5000; leapT += 16) {
  var leapFrame = E.sampleMotion(leap, leapT, 90000, false);
  var leapStep = E.wrapDelta(leapFrame - leapPrev);
  assert(leapStep >= -1e-9, 'chase rolled back at ' + leapT + ' ' + leapFrame);
  assert(leapStep < 0.006, 'single 16ms frame teleported at ' + leapT + ' d=' + leapStep);
  var leapX = (leap.vel || 0) * 90000;
  if (leapPrevX - leapX > leapMaxDropX) leapMaxDropX = leapPrevX - leapX;
  if (leapT === 3400) {
    assert(leapFrame > leapTick + 0.004, 'starts catching the sector jump within 400ms ' + leapFrame);
    assert(leapFrame < leapTick + 0.10, '400ms does not cover the whole 0.18 jump ' + leapFrame);
  }
  leapPrevX = leapX;
  leapPrev = leapFrame;
}
assert(leapMaxDropX < 2.2, 'chase landing slammed from high speed dropX=' + leapMaxDropX);
var leapCaught = E.sampleMotion(leap, 6500, 90000, false);
assert(E.wrapDelta(leap.belief - leapCaught) < 0.015, 'caught belief within ~3.5s ' + leapCaught + ' vs ' + leap.belief);
assert(E.wrapDelta(leapCaught - leapTick) > 0.10, 'actually closed the sector jump ' + leapCaught);
var leapCruisePrev = leapCaught;
var leapCruiseX = 1 / 90000;
for (var leapCruiseT = 6516; leapCruiseT <= 8500; leapCruiseT += 16) {
  var leapCruisePos = E.sampleMotion(leap, leapCruiseT, 90000, false);
  var leapCruiseStep = E.wrapDelta(leapCruisePos - leapCruisePrev);
  assert(leapCruiseStep >= -1e-9, 'post-catch rolled back at ' + leapCruiseT);
  assert(leapCruiseStep < 0.006, 'post-catch frame teleported at ' + leapCruiseT + ' d=' + leapCruiseStep);
  var leapVisX = (leapCruiseStep / 16) / leapCruiseX;
  var leapVelX = (leap.vel || 0) / leapCruiseX;
  assert(leapVelX > 0.7, 'after catching a sector jump, vel collapsed at ' + leapCruiseT + ' velX=' + leapVelX);
  assert(leapVisX > 0.45, 'after catching a sector jump, visual speed near 0 at ' + leapCruiseT + ' visX=' + leapVisX);
  leapCruisePrev = leapCruisePos;
}

var miniCruise = E.stepMotion(null, 0.20, 0.22, 0, 90000, false, { exact: true });
var miniPrev = E.sampleMotion(miniCruise, 0, 90000, false);
var miniNow = 0;
var miniFracs = [0.22, 0.24, 0.26, 0.28, 0.30, 0.32];
var miniCaps = [0.24, 0.26, 0.28, 0.30, 0.32, 0.34];
for (var mi = 0; mi < miniFracs.length; mi++) {
  var mt;
  for (mt = miniNow + 16; mt < miniNow + 2000; mt += 16) {
    var miniPos = E.sampleMotion(miniCruise, mt, 90000, false);
    var miniStep = E.wrapDelta(miniPos - miniPrev);
    assert(miniStep >= -1e-9, 'mini-sector between steps rolled back at ' + mt);
    assert(miniStep < 0.006, 'mini-sector between steps teleported at ' + mt + ' d=' + miniStep);
    if (mt > miniNow + 480) {
      var miniVisX = (miniStep / 16) / leapCruiseX;
      var miniVelX = (miniCruise.vel || 0) / leapCruiseX;
      assert(miniVelX > 0.7, 'mini-sector between steps vel collapsed at ' + mt + ' velX=' + miniVelX);
      assert(miniVisX > 0.45, 'mini-sector between steps parked at ' + mt + ' visX=' + miniVisX);
    }
    miniPrev = miniPos;
  }
  miniNow += 2000;
  miniCruise = E.stepMotion(miniCruise, miniFracs[mi], miniCaps[mi], miniNow, 90000, false, { exact: true });
  var miniTick = E.sampleMotion(miniCruise, miniNow, 90000, false);
  var miniJump = E.wrapDelta(miniTick - miniPrev);
  assert(miniJump >= -1e-9, 'mini-sector tick rolled back d=' + miniJump);
  assert(Math.abs(miniJump) < 0.006, 'mini-sector tick teleported d=' + miniJump);
  miniPrev = miniTick;
}

var tiny = E.stepMotion(null, 0.30, 0.42, 0, 90000, false, { exact: true });
tiny = E.stepMotion(tiny, 0.312, 0.43, 0, 90000, false, { exact: true });
var tiny0 = E.sampleMotion(tiny, 0, 90000, false);
near(tiny0, 0.30, 0.004, 'tiny update does not jump on the tick');
var tiny400 = E.sampleMotion(tiny, 400, 90000, false);
assert(E.wrapDelta(tiny400 - tiny0) > 0.004, 'small update still moves by 400ms ' + tiny400);
assert(E.wrapDelta(tiny.belief - tiny400) < 0.004, 'small update caught by 400ms ' + tiny400 + ' vs ' + tiny.belief);

var capLeap = E.stepMotion(null, 0.20, 0.22, 0, 90000, false, { exact: true });
var capT;
for (capT = 1000; capT <= 6000; capT += 1000) {
  capLeap = E.stepMotion(capLeap, 0.20, 0.22, capT, 90000, false, { exact: true });
}
var capHeld = E.sampleMotion(capLeap, 6000, 90000, false);
capLeap = E.stepMotion(capLeap, 0.20, 0.40, 6000, 90000, false, { exact: true });
var capTick = E.sampleMotion(capLeap, 6000, 90000, false);
assert(Math.abs(capTick - capHeld) < 0.003, 'cap leap does not teleport on the same tick ' + capTick);
var capLater = E.sampleMotion(capLeap, 6360, 90000, false);
assert(E.wrapDelta(capLater - capTick) > 0.001, 'cap leap starts chasing ' + capLater);
assert(E.wrapDelta(capLater - capTick) < 0.05, 'cap leap chase is accel-limited ' + capLater);

// 重置仍允许不连续：进站冻住；过起终点数值可回绕（沿圈仍向前）。
var pitReset = E.stepMotion(null, 0.44, 0.55, 0, 90000, false, { exact: true });
var pitBefore = E.sampleMotion(pitReset, 1500, 90000, false);
pitReset = E.stepMotion(pitReset, 0.90, 0.95, 1500, 90000, false, { exact: true, pit: true });
var pitAt = E.sampleMotion(pitReset, 1500, 90000, false);
near(pitAt, pitBefore, 0.002, 'pit entry freezes instead of chasing the pit sample');
var pitLater = E.sampleMotion(pitReset, 8000, 90000, false);
near(pitLater, pitAt, 0.0005, 'pit stays frozen; chase does not keep sliding');

var sf = E.stepMotion(null, 0.97, 0.995, 0, 90000, false, { exact: true });
sf = E.stepMotion(sf, 0.02, 0.12, 500, 90000, false, { exact: true, freshLap: true });
var sfTick = E.sampleMotion(sf, 500, 90000, false);
assert(sfTick > 0.9, 'S/F tick stays near the line ' + sfTick);
var sfPrev = sfTick;
var sfN = 0;
for (var sfT = 516; sfT <= 1400; sfT += 16) {
  var sfNow = E.sampleMotion(sf, sfT, 90000, false);
  var sfStep = E.wrapDelta(sfNow - sfPrev);
  assert(sfStep >= -1e-9, 'S/F chase rolled back at ' + sfT + ' ' + sfNow);
  assert(sfStep < 0.006, 'S/F single frame teleported at ' + sfT + ' d=' + sfStep);
  sfPrev = sfNow;
  sfN++;
}
assert(sfPrev < 0.12, 'S/F chase wraps across the line ' + sfPrev);
assert(sfN > 10, 'S/F catch-up took more than one frame');

var wrapCap = E.stepMotion(null, 0.90, 0.95, 0, 90000, false, { exact: true });
wrapCap = E.stepMotion(wrapCap, 0.91, 0.08, 400, 90000, false, { exact: true });
near(wrapCap.cap, 0.08, 0.001, 'cap rolls forward through the start/finish');

var flickerCap = E.stepMotion(null, 0.05, 0.10, 0, 90000, false, { exact: true });
flickerCap = E.stepMotion(flickerCap, 0.05, 0.99, 400, 90000, false, { exact: true });
near(flickerCap.cap, 0.10, 0.001, 'cap flicker back across S/F does not rewind the bound');

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

var head = E.directionArrow({ x: 40, y: 20 }, 2, 0, 10, 6);
assert(head.pts.length === 3, 'direction arrow is a triangle');
assert(head.tip.x > 40, 'arrow tip is ahead along +x');
near(head.tip.y, 20, 0.01, 'arrow tip stays on the tangent');
var headSpan = Math.hypot(head.pts[1].x - head.pts[2].x, head.pts[1].y - head.pts[2].y);
near(headSpan, 6, 0.05, 'arrow base spans the requested width');
var headDot = (head.tip.x - 40) * 2 + (head.tip.y - 20) * 0;
assert(headDot > 0, 'arrow points along the supplied tangent');

var styleSrc = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
assert(styleSrc.indexOf('.tm-dir-arrow') >= 0, 'css paints the direction arrow');
assert(styleSrc.indexOf('html[data-theme="day"] .tm-dir-arrow') >= 0, 'day theme restyles the arrow');
assert(/\.b-trackmap \.tm-wrap\s*\{[^}]*background:\s*var\(--ring-bg\)/.test(styleSrc),
  'night trackmap floor uses --ring-bg');
assert(/html\[data-theme="day"\] \.b-trackmap \.tm-wrap\s*\{[^}]*background:\s*#d5dee9/.test(styleSrc),
  'day trackmap floor stays #d5dee9');

var squarePts = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }
];
var squareArc = E.buildArc(squarePts);
function idMap(x, y) { return { x: x, y: y }; }
var squareCue = E.directionCue(squareArc, idMap, { minDist: 8, length: 4, width: 3, maxFrac: 0.2 });
assert(squareCue && squareCue.frac > 0 && squareCue.frac <= 0.2, 'cue sits shortly after progress 0');
assert(squareCue.origin.x > squarePts[0].x + 4, 'cue walks along the first edge');
near(squareCue.origin.y, 0, 0.4, 'cue without strokeW stays on the first edge');
assert(squareCue.tip.x > squareCue.origin.x, 'square cue points toward the next corner');
assert(E.directionCue(null, idMap) == null, 'missing arc yields no cue');

near(E.directionOutset(8, 6.4), 8 * 0.5 + 2 + 6.4 * 0.48, 0.01, 'outset is half stroke + 2px + ~half arrow');
assert(E.directionOutset(3, 4) >= 6, 'outset has a floor');
assert(E.directionOutset(20, 12) <= 14, 'outset has a ceiling');
var squareOut = E.directionCue(squareArc, idMap, {
  minDist: 8, length: 4, width: 3, maxFrac: 0.2, strokeW: 8, centroid: { x: 5, y: 5 }
});
var squareOutset = E.directionOutset(8, 3);
near(squareOut.outset, squareOutset, 0.01, 'square reports the computed outset');
near(squareOut.origin.x, squareOut.onTrack.x, 0.2, 'outset is purely lateral');
assert(squareOut.origin.y < squareOut.onTrack.y - 4, 'square cue sits outside the loop');
var squareAway = (squareOut.origin.x - 5) * squareOut.outward.x + (squareOut.origin.y - 5) * squareOut.outward.y;
assert(squareAway > 0, 'outward normal points away from the centroid');

var turned = E.orientClosedOutline(squarePts, 0.25, false);
near(turned[0].x, 10, 0.05, 'quarter turn starts at the next corner x');
near(turned[0].y, 0, 0.05, 'quarter turn starts at the next corner y');
var backed = E.orientClosedOutline(squarePts, 0, true);
near(backed[0].x, 0, 0.01, 'reverse keeps the start x');
near(backed[0].y, 0, 0.01, 'reverse keeps the start y');
near(backed[1].x, 0, 0.05, 'reverse walks back along the last edge x');
near(backed[1].y, 10, 0.05, 'reverse walks back along the last edge y');

var miniCar = {
  sectors: [
    { value: '28.1', segments: [2048, 2048, 0, 0] },
    { value: '', segments: [0, 0, 0, 0] },
    { value: '', segments: [] }
  ]
};
var austinPhase = (function () {
  var src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  var block = src.split("'circuits/austin-1.svg'")[1].split('}')[0];
  var sectors = /sectors:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/.exec(block);
  return {
    offset: +/offset:\s*([0-9.]+)/.exec(block)[1],
    reverse: /reverse:\s*true/.test(block),
    sectors: [+sectors[1], +sectors[2]]
  };
})();
var evenMini = E.progressFromTiming(miniCar);
var austinMini = E.progressFromTiming(miniCar, austinPhase.sectors);
near(evenMini.frac, 0.5 / 3, 0.001, 'default S1 is still a third');
near(austinMini.frac, austinPhase.sectors[0] * 0.5, 0.001, 'Austin S1 uses the sector end');
assert(austinPhase.sectors[0] > 0.2 && austinPhase.sectors[0] < 0.45, 'Austin S1 ends before the back straight');
assert(austinPhase.sectors[1] > 0.6 && austinPhase.sectors[1] < 0.85, 'Austin S2 ends after Turn 12');

var austinSvg = fs.readFileSync(path.join(__dirname, 'circuits', 'austin-1.svg'), 'utf8');
var austinRaw = E.outlineFromSvg(austinSvg, 4);
function austinResample(pts, n) {
  var work = pts.slice();
  if (Math.hypot(work[0].x - work[work.length - 1].x, work[0].y - work[work.length - 1].y) < 1) work.pop();
  var cum = [0];
  var total = 0;
  var i;
  for (i = 1; i < work.length; i++) {
    total += Math.hypot(work[i].x - work[i - 1].x, work[i].y - work[i - 1].y);
    cum.push(total);
  }
  var close = Math.hypot(work[work.length - 1].x - work[0].x, work[work.length - 1].y - work[0].y);
  var per = total + close;
  var samples = [];
  for (var k = 0; k < n; k++) {
    var d = (k / n) * per;
    var a, b, segStart, segLen;
    if (d <= total) {
      var j = 1;
      while (j < cum.length && cum[j] < d) j++;
      if (j >= work.length) j = work.length - 1;
      a = work[j - 1];
      b = work[j];
      segStart = cum[j - 1];
      segLen = cum[j] - cum[j - 1];
    } else {
      a = work[work.length - 1];
      b = work[0];
      segStart = total;
      segLen = close;
    }
    var u = segLen > 1e-9 ? (d - segStart) / segLen : 0;
    samples.push({
      f: k / n,
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      h: Math.atan2(b.y - a.y, b.x - a.x)
    });
  }
  return samples;
}
function austinAngDiff(a, b) {
  var d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function austinStraights(samples) {
  var runs = [];
  var run = null;
  for (var k = 1; k < samples.length; k++) {
    var straight = Math.abs(austinAngDiff(samples[k - 1].h, samples[k].h)) < 0.07;
    if (straight) {
      if (!run) run = { f0: samples[k - 1].f, f1: samples[k].f };
      run.f1 = samples[k].f;
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs.filter(function (r) { return r.f1 - r.f0 > 0.08; })
    .sort(function (a, b) { return (b.f1 - b.f0) - (a.f1 - a.f0); });
}
var austinSamples = austinResample(austinRaw, 200);
var austinRuns = austinStraights(austinSamples);
assert(austinRuns.length >= 2, 'Austin has a back straight and a pit straight ' + JSON.stringify(austinRuns));
var austinBack = austinRuns[0];
var austinPit = austinRuns[1];
assert(austinBack.f0 < 0.03, 'longest straight is the T11–T12 straight off the file start ' + austinBack.f0);
assert(austinPhase.reverse === false, 'Austin racing direction matches the SVG, reverse stays false');
assert(austinPhase.offset > austinBack.f1 + 0.15, 'timing line is not on the T11 back straight ' + austinPhase.offset);
var pitSpan = austinPit.f1 - austinPit.f0;
var alongPit = (austinPhase.offset - austinPit.f0) / pitSpan;
assert(alongPit > -0.05 && alongPit < 0.4,
  'timing line is on the T20 side of the pit straight ' + alongPit + ' ' + JSON.stringify(austinPit));
var austinArc = E.buildArc(austinRaw);
var austinSf = E.pointOnArc(austinArc, austinPhase.offset);
var austinT11 = E.pointOnArc(austinArc, 0);
function hyp(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
assert(hyp(austinSf, austinT11) > 80, 'Austin timing line is not Turn 11');
var austinOriented = E.orientClosedOutline(austinRaw, austinPhase.offset, austinPhase.reverse);
var austinZero = E.pointOnArc(E.buildArc(austinOriented), 0);
near(austinZero.x, austinSf.x, 1.5, 'progress 0 sits on the Austin timing line');
near(austinZero.y, austinSf.y, 1.5, 'progress 0 y');
var austinAhead = E.pointOnArc(E.buildArc(austinOriented), 0.04);
var austinT1 = E.pointOnArc(austinArc, austinPit.f1);
assert(hyp(austinAhead, austinT1) < hyp(austinZero, austinT1), 'racing direction leaves the line toward Turn 1');
var austinCue = E.directionCue(E.buildArc(austinOriented), function (x, y) { return { x: x, y: y }; }, {
  minDist: 12, length: 8, width: 6, maxFrac: 0.05
});
assert(austinCue && austinCue.frac > 0.002 && austinCue.frac < 0.05, 'Austin cue is shortly after S/F');
assert(hyp(austinCue.origin, austinT1) < hyp(austinZero, austinT1), 'Austin arrow leaves the line toward Turn 1');
assert(hyp(austinCue.tip, austinT1) < hyp(austinCue.origin, austinT1), 'Austin arrow tip is further toward Turn 1');

var appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
assert(appSrc.indexOf('multiviewer.app') < 0, 'runtime does not call MultiViewer');
assert(appSrc.indexOf('openf1') < 0 && appSrc.indexOf('OpenF1') < 0, 'runtime does not call OpenF1');
assert(appSrc.indexOf('tm-pit-count') >= 0, 'app paints a pit count');
assert(appSrc.indexOf('data-tip') >= 0 && appSrc.indexOf('进站中的车数') >= 0, 'app wires a pit-count tooltip');
assert(appSrc.indexOf('tabindex') >= 0, 'pit badge is focusable');
assert(appSrc.indexOf('bay.slots') < 0, 'app no longer paints pit-bay car slots');
assert(appSrc.indexOf('makePitBayLayer()') >= 0, 'pit badge is a wrap overlay');
assert(appSrc.indexOf('paintTrackmapDir') >= 0, 'app paints a race-direction cue');
assert(appSrc.indexOf('tm-dir-arrow') >= 0, 'app uses the direction-arrow class');
assert(appSrc.indexOf('比赛方向') >= 0, 'direction cue has a Chinese title');
assert(appSrc.indexOf('directionOutset') >= 0 && appSrc.indexOf('screenCentroid') >= 0,
  'app offsets the cue along the outward normal');
var phaseSrc = appSrc.split('var CIRCUIT_PHASE')[1].split('function circuitPhase')[0];
var svgSrc = appSrc.split('var CIRCUIT_SVG')[1].split('};')[0];
function parsePhases(block) {
  var re = /'(circuits\/[^']+\.svg)'\s*:\s*\{([^}]+)\}/g;
  var out = {};
  var m;
  while ((m = re.exec(block))) {
    var body = m[2];
    var sectors = /sectors:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/.exec(body);
    out[m[1]] = {
      offset: +/offset:\s*([0-9.]+)/.exec(body)[1],
      reverse: /reverse:\s*true/.test(body),
      sectors: sectors ? [+sectors[1], +sectors[2]] : null
    };
  }
  return out;
}
var phases = parsePhases(phaseSrc);
var svgTargets = {};
var svgRe = /'(circuits\/[^']+\.svg)'/g;
var sm;
while ((sm = svgRe.exec(svgSrc))) svgTargets[sm[1]] = true;
var svgKeys = Object.keys(svgTargets);
assert(svgKeys.length >= 23, 'circuit svg map ' + svgKeys.length);
assert(phases['circuits/bahrain-3.svg'] == null, 'Bahrain outline is not calibrated');
assert(svgTargets['circuits/bahrain-3.svg'], 'Bahrain is still a known circuit');
svgKeys.forEach(function (rel) {
  if (rel === 'circuits/bahrain-3.svg') return;
  assert(phases[rel], 'missing phase ' + rel);
});
function nearestFrac(pts, q) {
  var best = Infinity;
  var bestF = 0;
  var cum = [0];
  var total = 0;
  var i;
  for (i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(total);
  }
  var close = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  var per = total + close;
  function consider(ax, ay, bx, by, segStart, segLen) {
    var vx = bx - ax;
    var vy = by - ay;
    var len2 = vx * vx + vy * vy;
    var u = 0;
    if (len2 > 1e-12) {
      u = ((q.x - ax) * vx + (q.y - ay) * vy) / len2;
      if (u < 0) u = 0;
      if (u > 1) u = 1;
    }
    var d = Math.hypot(q.x - (ax + vx * u), q.y - (ay + vy * u));
    if (d < best) {
      best = d;
      bestF = per > 0 ? (segStart + segLen * u) / per : 0;
    }
  }
  for (i = 1; i < pts.length; i++) {
    consider(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, cum[i - 1], cum[i] - cum[i - 1]);
  }
  consider(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y, total, close);
  return { frac: bestF, dist: best, per: per };
}
function flipY(pts) {
  var out = [];
  for (var i = 0; i < pts.length; i++) out.push({ x: pts[i].x, y: -pts[i].y });
  return out;
}
Object.keys(phases).forEach(function (rel) {
  var phase = phases[rel];
  assert(phase.offset >= 0 && phase.offset < 1, rel + ' offset ' + phase.offset);
  if (phase.sectors) {
    assert(phase.sectors[0] > 0.05 && phase.sectors[0] < phase.sectors[1] && phase.sectors[1] < 0.95,
      rel + ' sectors ' + phase.sectors);
  }
  var text = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  var raw = flipY(E.outlineFromSvg(text, 4));
  var oriented = E.orientClosedOutline(raw, phase.offset, phase.reverse);
  var zero = E.pointOnArc(E.buildArc(oriented), 0);
  var hit = nearestFrac(raw, zero);
  assert(hit.dist < 1.5, rel + ' finish leaves the polyline ' + hit.dist);
  var along = phase.reverse ? (1 - hit.frac) % 1 : hit.frac;
  var delta = along - phase.offset;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  assert(Math.abs(delta) < 0.012, rel + ' progress 0 fraction ' + along + ' vs ' + phase.offset);
});
var monzaPhase = phases['circuits/monza-7.svg'];
var monacoPhase = phases['circuits/monaco-6.svg'];
var shanghaiPhase = phases['circuits/shanghai-1.svg'];
near(monzaPhase.offset, 0.692, 0.0001, 'Monza offset');
assert(monzaPhase.reverse === false && monzaPhase.sectors[0] === 0.33 && monzaPhase.sectors[1] === 0.644, 'Monza sectors');
near(monacoPhase.offset, 0.335, 0.0001, 'Monaco offset');
near(E.progressFromTiming(miniCar, monacoPhase.sectors).frac, monacoPhase.sectors[0] * 0.5, 0.001, 'Monaco S1 uses the sector end');
near(E.progressFromTiming(miniCar, monzaPhase.sectors).frac, monzaPhase.sectors[0] * 0.5, 0.001, 'Monza S1 uses the sector end');
assert(shanghaiPhase.reverse === true, 'Shanghai file direction is opposite the race');
assert(phases['circuits/austin-1.svg'].offset === 0.522, 'Austin hand offset stays');
var shanghaiRaw = flipY(E.outlineFromSvg(fs.readFileSync(path.join(__dirname, 'circuits/shanghai-1.svg'), 'utf8'), 4));
var shanghaiOriented = E.orientClosedOutline(shanghaiRaw, shanghaiPhase.offset, shanghaiPhase.reverse);
var shanghaiZero = E.pointOnArc(E.buildArc(shanghaiOriented), 0);
var shanghaiAhead = E.pointOnArc(E.buildArc(shanghaiOriented), 0.04);
var shanghaiCue = E.directionCue(E.buildArc(shanghaiOriented), function (x, y) { return { x: x, y: y }; }, {
  minDist: 12, length: 8, width: 6, maxFrac: 0.05
});
assert(shanghaiCue && shanghaiCue.frac > 0.002 && shanghaiCue.frac < 0.05, 'Shanghai cue is shortly after S/F');
assert(hyp(shanghaiCue.origin, shanghaiAhead) < hyp(shanghaiZero, shanghaiAhead),
  'Shanghai reverse still places the arrow along race direction');
assert(hyp(shanghaiCue.tip, shanghaiAhead) < hyp(shanghaiCue.origin, shanghaiAhead),
  'Shanghai arrow tip follows the oriented tangent');

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

var squareScreen = [
  { x: 40, y: 200 }, { x: 360, y: 200 }, { x: 360, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 200 }
];
var pitBox = { x: 80, y: 80, w: 40, h: 30 };
near(E.minDistRectToPolyline(pitBox, squareScreen), 40, 0.6, 'infield rect clears the bottom edge');
var onLine = { x: 30, y: 190, w: 30, h: 20 };
assert(E.minDistRectToPolyline(onLine, squareScreen) <= 0, 'rect on the outline reports overlap');
near(E.minDistPointToPolyline(200, 200, squareScreen), 0, 0.01, 'point on polyline');
near(E.minDistPointToPolyline(200, 188, squareScreen), 12, 0.01, 'point above bottom edge');

var nrm = E.inwardNormal(1, 0, { x: 200, y: 200 }, { x: 200, y: 120 });
near(nrm.x, 0, 0.01, 'inward x is toward centroid');
assert(nrm.y < 0, 'inward y points up the page toward centroid ' + nrm.y);

var sized0 = E.pitBaySize(0, 1.05);
var sized = E.pitBaySize(5, 1.05);
var sized20 = E.pitBaySize(20, 1.05);
assert(sized0.n === 0 && sized.n === 5 && sized20.n === 20, 'count badge keeps the pit headcount');
assert(!sized.cols && !sized.rows, 'count badge has no car grid');
assert(sized.width < 70 && sized.height < 40, 'default-zoom count badge stays compact');
assert(Math.abs(sized.width - sized0.width) < 1, '0 and single-digit counts share a size');
assert(sized20.width > sized.width && sized20.width < 80, 'two-digit count is only slightly wider');
assert(sized20.height === sized.height, 'count height does not grow with N');

var emptyLane = E.pitLanePaint([
  { number: '1', tla: 'VER', pit: false },
  { number: '16', tla: 'LEC', pit: false }
]);
assert(emptyLane.pitCount === 0 && emptyLane.showBay === false, '0 pit cars hide the badge');
assert(emptyLane.onTrack.length === 2 && emptyLane.inPit.length === 0, 'racing cars stay on the outline');

var mixedLane = E.pitLanePaint([
  { number: '1', tla: 'VER', pit: false },
  { number: '44', tla: 'HAM', pit: true },
  { number: '16', tla: 'LEC', pit: true },
  { number: '55', tla: 'SAI', hide: true, pit: true },
  { number: '4', tla: 'NOR', pit: false }
]);
assert(mixedLane.pitCount === 2 && mixedLane.showBay === true, 'N pit cars feed the count badge');
assert(mixedLane.onTrack.map(function (c) { return c.number; }).join(',') === '1,4',
  'outline keeps only racing cars');
assert(mixedLane.inPit.every(function (c) { return c.pit && !c.hide; }), 'hidden pit cars do not count');

var pitPlan = E.planField([
  { number: 1, tla: 'VER', position: 1, gap: 'LEADER', sectors: [{}, {}, {}] },
  { number: 44, tla: 'HAM', position: 2, inPit: true, gap: 'IN PIT', sectors: [{}, {}, {}] },
  { number: 16, tla: 'LEC', position: 3, gap: 'PIT', sectors: [{}, {}, {}] },
  { number: 55, tla: 'SAI', position: 4, pitOut: true, gap: '+1.200',
    sectors: [{ value: '', segments: [0, 0, 0] }, { value: '', segments: [] }, { value: '', segments: [] }] }
], 'Qualifying', 'Started');
var pitPaint = E.pitLanePaint(pitPlan.cars);
assert(pitPlan.cars[1].pit && pitPlan.cars[2].pit, 'inPit / PIT gap stay in the count');
assert(pitPlan.cars[3].pit === false && pitPlan.cars[3].outlap === true, 'pitOut is not inPit');
assert(pitPaint.pitCount === 2, 'count badge is 2');
assert(pitPaint.onTrack.map(function (c) { return c.number; }).join(',') === '1,55',
  'outline is leader + pitOut only');

var leftPits = E.stepMotion(null, 0.42, 0.55, 0, 90000, false, { exact: true, pit: true });
assert(leftPits.pit === true, 'entered pits');
leftPits = E.stepMotion(leftPits, 0.05, 0.12, 2000, 90000, false, { exact: true, pit: false, outlap: true });
assert(leftPits.pit === false, 'pitOut clears the pit flag so the dot can return to the outline');

assert(E.pitBayTip && E.pitBayTip.indexOf('进站') >= 0, 'shared Chinese tooltip copy');
assert(E.pitBayInset === 8, 'default panel inset is 8px');

var bay0 = E.placePitBay({
  outline: squareScreen,
  strokeW: 8,
  viewW: 400,
  viewH: 240,
  zoom: 1.05,
  carCount: 0
});
assert(bay0.count === 0, 'placed badge reports 0');
assert(bay0.corner === 'top-left', 'zero-count layout still names the corner');
assert(!bay0.slots || bay0.slots.length === 0, 'count badge has no car slots');

var bay = E.placePitBay({
  outline: squareScreen,
  strokeW: 8,
  viewW: 400,
  viewH: 240,
  zoom: 1.05,
  carCount: 4
});
assert(bay.count === 4, 'placed badge reports N');
assert(!bay.slots || bay.slots.length === 0, 'N-count badge still has no car slots');
assert(isFinite(bay.countPos.x) && bay.countPos.x > bay.badge.x, 'count sits beside P');
assert(bay.corner === 'top-left', 'badge is pinned to the viewport corner');
assert(bay.tip === E.pitBayTip, 'layout carries the tooltip');
near(bay.x, E.pitBayInset, 0.6, 'square bay x is the panel inset');
near(bay.y, E.pitBayInset, 0.6, 'square bay y is the panel inset');
assert(bay.minClear === 4, 'minClear is half the stroke (no grey-line overlap)');
assert(bay.clearance >= bay.minClear, 'square top-left clears the stroke ' + bay.clearance);
assert(bay.x + bay.width < 80, 'top-left badge stays in the left gutter');
assert(bay.y + bay.height < 48, 'top-left badge stays in the top gutter');

var padded = E.placePitBay({
  outline: squareScreen,
  strokeW: 8,
  viewW: 400,
  viewH: 240,
  zoom: 1.05,
  carCount: 3,
  inset: 14
});
assert(padded.corner === 'top-left', 'custom inset stays top-left');
near(padded.x, 14, 0.6, 'honors a larger top-left inset x');
near(padded.y, 14, 0.6, 'honors a larger top-left inset y');

function trackStrokeW(zoom) {
  var z = Number(zoom);
  if (!(z > 0)) z = 1.05;
  return Math.max(4, Math.min(12, 5 + Math.sqrt(z) * 3));
}

function mapOutlineToView(pts, w, h, zoom) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var i;
  for (i = 0; i < pts.length; i++) {
    if (pts[i].x < minX) minX = pts[i].x;
    if (pts[i].y < minY) minY = pts[i].y;
    if (pts[i].x > maxX) maxX = pts[i].x;
    if (pts[i].y > maxY) maxY = pts[i].y;
  }
  var padX = (maxX - minX) * 0.06 || 1;
  var padY = (maxY - minY) * 0.06 || 1;
  minX -= padX; minY -= padY; maxX += padX; maxY += padY;
  var bw = maxX - minX;
  var bh = maxY - minY;
  var z = Number(zoom);
  if (!(z > 0)) z = 1.05;
  var scale = Math.min(w / bw, h / bh) * 0.92 * z;
  var ox = (w - bw * scale) / 2;
  var oy = (h - bh * scale) / 2;
  function mapPoint(x, y) {
    return { x: ox + (x - minX) * scale, y: oy + (maxY - y) * scale };
  }
  var screen = [];
  var sx = 0, sy = 0;
  for (i = 0; i < pts.length; i++) {
    screen.push(mapPoint(pts[i].x, pts[i].y));
    sx += pts[i].x;
    sy += pts[i].y;
  }
  var p0 = E.pointOnArc(E.buildArc(pts), 0);
  var sc = mapPoint(p0.x, p0.y);
  var ahead = mapPoint(p0.x + p0.tx, p0.y + p0.ty);
  return {
    outline: screen,
    origin: sc,
    tx: ahead.x - sc.x,
    ty: ahead.y - sc.y,
    centroid: mapPoint(sx / pts.length, sy / pts.length),
    strokeW: trackStrokeW(z),
    map: mapPoint
  };
}

var austinFlipped = E.orientClosedOutline(flipY(austinRaw), austinPhase.offset, austinPhase.reverse);
var austinView = mapOutlineToView(austinFlipped, 420, 280, 1.05);
var austinBay = E.placePitBay({
  outline: austinView.outline,
  strokeW: austinView.strokeW,
  viewW: 420,
  viewH: 280,
  zoom: 1.05,
  carCount: 6
});
assert(austinBay.count === 6, 'Austin badge shows six in the pits');
assert(austinBay.corner === 'top-left', 'Austin badge is top-left');
near(austinBay.x, E.pitBayInset, 0.6, 'Austin x is the panel inset');
near(austinBay.y, E.pitBayInset, 0.6, 'Austin y is the panel inset');
assert(austinBay.clearance >= austinBay.minClear,
  'Austin default view bay clears the outline by ' + austinBay.clearance.toFixed(1) +
  ' (need ' + austinBay.minClear + ')');
assert(!austinBay.slots || austinBay.slots.length === 0, 'Austin badge has no car dots');

var austinCell = Math.max(2.2, Math.min(3.4, austinView.strokeW * 0.42));
var austinLen = Math.max(6.6, Math.min(10.2, austinView.strokeW * 1.12));
var austinWidth = Math.max(5.1, Math.min(8.0, austinView.strokeW * 0.84));
var austinMin = austinCell * 2 + austinView.strokeW * 0.72 + austinLen * 0.42;
var austinScreenCue = E.directionCue(E.buildArc(austinFlipped), austinView.map, {
  minDist: austinMin, length: austinLen, width: austinWidth, maxFrac: 0.05,
  strokeW: austinView.strokeW, centroid: austinView.centroid
});
assert(austinScreenCue && austinScreenCue.pts.length === 3, 'Austin default view has a direction cue');
assert(austinScreenCue.frac > 0.002 && austinScreenCue.frac < 0.05, 'Austin screen cue stays near S/F');
var austinAlong = Math.hypot(austinScreenCue.onTrack.x - austinView.origin.x, austinScreenCue.onTrack.y - austinView.origin.y);
assert(austinAlong + 0.4 >= austinMin * 0.85, 'Austin cue clears the finish flag gap ' + austinAlong.toFixed(1));
var austinTipDir = (austinScreenCue.tip.x - austinScreenCue.origin.x) * austinView.tx +
  (austinScreenCue.tip.y - austinScreenCue.origin.y) * austinView.ty;
assert(austinTipDir > 0, 'Austin screen arrow follows the mapped race tangent');
near(austinScreenCue.outset, E.directionOutset(austinView.strokeW, austinWidth), 0.05, 'Austin uses the shared outset');
var austinOff = Math.hypot(austinScreenCue.origin.x - austinScreenCue.onTrack.x, austinScreenCue.origin.y - austinScreenCue.onTrack.y);
near(austinOff, austinScreenCue.outset, 0.2, 'Austin arrow center is the outset off the stroke');
assert(E.minDistPointToPolyline(austinScreenCue.origin.x, austinScreenCue.origin.y, austinView.outline) >
  austinView.strokeW / 2,
  'Austin arrow sits outside the grey stroke');
var austinAway = (austinScreenCue.origin.x - austinView.centroid.x) * austinScreenCue.outward.x +
  (austinScreenCue.origin.y - austinView.centroid.y) * austinScreenCue.outward.y;
assert(austinAway > 0, 'Austin outward normal points away from the infield');

var views = [
  { w: 420, h: 280, zoom: 1.05, label: 'preview' },
  { w: 438, h: 298, zoom: 1.05, label: 'default-panel' }
];
var usedRels = {};
svgKeys.forEach(function (rel) { usedRels[rel] = true; });
files.forEach(function (f) {
  var rel = 'circuits/' + f;
  if (!usedRels[rel] && f !== 'marina-bay.svg') return;
  var text = fs.readFileSync(path.join(dir, f), 'utf8');
  var phase = phases[rel] || { offset: 0, reverse: false };
  var oriented = E.orientClosedOutline(flipY(E.outlineFromSvg(text, 4)), phase.offset, phase.reverse);
  views.forEach(function (vp) {
    var view = mapOutlineToView(oriented, vp.w, vp.h, vp.zoom);
    var laid = E.placePitBay({
      outline: view.outline,
      strokeW: view.strokeW,
      viewW: vp.w,
      viewH: vp.h,
      zoom: vp.zoom,
      carCount: 8
    });
    assert(laid.corner === 'top-left', f + ' ' + vp.label + ' stays top-left');
    assert(laid.x <= E.pitBayInset + 20 && laid.y <= E.pitBayInset + 20,
      f + ' ' + vp.label + ' stays in the top-left gutter ' + laid.x + ',' + laid.y);
    assert(laid.clearance >= laid.minClear,
      f + ' ' + vp.label + ' pit badge overlaps outline (clearance ' +
      laid.clearance.toFixed(2) + ', need ' + laid.minClear.toFixed(2) + ')');
    var cueLen = Math.max(6.6, Math.min(10.2, view.strokeW * 1.12));
    var orientedArc = E.buildArc(oriented);
    var cueW = Math.max(5.1, Math.min(8.0, view.strokeW * 0.84));
    var cue = E.directionCue(orientedArc, view.map, {
      minDist: Math.max(2.2, Math.min(3.4, view.strokeW * 0.42)) * 2 + view.strokeW * 0.72 + cueLen * 0.42,
      length: cueLen,
      width: cueW,
      strokeW: view.strokeW,
      centroid: view.centroid,
      maxFrac: 0.05
    });
    assert(cue && cue.pts && cue.pts.length === 3, f + ' ' + vp.label + ' has a direction cue');
    assert(cue.frac > 0 && cue.frac <= 0.05, f + ' ' + vp.label + ' cue frac ' + cue.frac);
    var localDot = (cue.tip.x - cue.origin.x) * cue.tx + (cue.tip.y - cue.origin.y) * cue.ty;
    assert(localDot > 0, f + ' ' + vp.label + ' arrow follows its local race tangent');
    var pAhead = E.pointOnArc(orientedArc, 0.04);
    var pBack = E.pointOnArc(orientedArc, 0.96);
    var sAhead = view.map(pAhead.x, pAhead.y);
    var sBack = view.map(pBack.x, pBack.y);
    assert(Math.hypot(cue.onTrack.x - sAhead.x, cue.onTrack.y - sAhead.y) <
      Math.hypot(cue.onTrack.x - sBack.x, cue.onTrack.y - sBack.y),
      f + ' ' + vp.label + ' cue is on the race-direction side of S/F');
    var off = Math.hypot(cue.origin.x - cue.onTrack.x, cue.origin.y - cue.onTrack.y);
    near(off, cue.outset, 0.35, f + ' ' + vp.label + ' lateral offset');
    assert(E.minDistPointToPolyline(cue.origin.x, cue.origin.y, view.outline) > view.strokeW / 2 - 0.2,
      f + ' ' + vp.label + ' arrow overlaps the grey stroke');
    var away = (cue.origin.x - view.centroid.x) * cue.outward.x +
      (cue.origin.y - view.centroid.y) * cue.outward.y;
    assert(away > 0, f + ' ' + vp.label + ' points away from the infield');
  });
});

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok ' + files.length + ' circuits');
