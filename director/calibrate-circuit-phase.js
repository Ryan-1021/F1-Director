#!/usr/bin/env node
/**
 * 离线校准。导播台运行时不会加载这个文件，也不会请求 MultiViewer。
 *
 * 方法和奥斯汀对照一样：把 MultiViewer 中心线按弧长重采样成 400 点，
 * 在 flipY × 反向 × 圆周移位上做 Umeyama 相似变换（平移、旋转、均匀缩放），
 * 再把 length≈0 的 marshal light 投到 director 的 outlineFromSvg 折线上，
 * 最近点的弧长比例就是原始 offset。
 *
 *   node director/calibrate-circuit-phase.js --cache /tmp/mv
 *   node director/calibrate-circuit-phase.js --cache /tmp/mv --only austin-1.svg
 *
 * 缓存是 MultiViewer `GET /api/v1/circuits/{key}/{year}` 的 JSON。
 * 加 --fetch 才会联网下载（默认年份 2024、2025、2026，再加目录里列出的年份）。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var E = require('./web-override/trackmap-estimate.js');

var CIRCUITS = [
  { svg: 'bahrain-3.svg', key: 63, name: 'Sakhir' },
  { svg: 'jeddah-1.svg', key: 149, name: 'Jeddah' },
  { svg: 'melbourne-2.svg', key: 10, name: 'Melbourne' },
  { svg: 'suzuka-2.svg', key: 46, name: 'Suzuka' },
  { svg: 'shanghai-1.svg', key: 49, name: 'Shanghai' },
  { svg: 'miami-1.svg', key: 151, name: 'Miami' },
  { svg: 'imola-3.svg', key: 6, name: 'Imola' },
  { svg: 'monaco-6.svg', key: 22, name: 'Monte Carlo' },
  { svg: 'montreal-6.svg', key: 23, name: 'Montreal' },
  { svg: 'catalunya-6.svg', key: 15, name: 'Catalunya' },
  { svg: 'spielberg-3.svg', key: 19, name: 'Spielberg' },
  { svg: 'silverstone-8.svg', key: 2, name: 'Silverstone' },
  { svg: 'hungaroring-3.svg', key: 4, name: 'Hungaroring' },
  { svg: 'spa-francorchamps-4.svg', key: 7, name: 'Spa-Francorchamps' },
  { svg: 'zandvoort-5.svg', key: 55, name: 'Zandvoort' },
  { svg: 'monza-7.svg', key: 39, name: 'Monza' },
  { svg: 'baku-1.svg', key: 144, name: 'Baku' },
  { svg: 'marina-bay-4.svg', key: 61, name: 'Singapore' },
  { svg: 'austin-1.svg', key: 9, name: 'Austin' },
  { svg: 'mexico-city-3.svg', key: 65, name: 'Mexico City' },
  { svg: 'interlagos-2.svg', key: 14, name: 'Interlagos' },
  { svg: 'las-vegas-1.svg', key: 152, name: 'Las Vegas' },
  { svg: 'lusail-1.svg', key: 150, name: 'Losail' },
  { svg: 'yas-marina-2.svg', key: 70, name: 'Yas Marina' }
];

function wrap01(f) {
  if (!isFinite(f)) return 0;
  f = f % 1;
  if (f < 0) f += 1;
  if (f >= 1) f -= 1;
  return f;
}

function wrapDelta(d) {
  d = wrap01(d);
  if (d > 0.5) d -= 1;
  return d;
}

function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

function polylineGeom(pts) {
  var work = [];
  for (var i = 0; i < pts.length; i++) work.push({ x: pts[i].x, y: pts[i].y });
  if (work.length > 2 && hypot(work[0].x - work[work.length - 1].x, work[0].y - work[work.length - 1].y) < 1e-3) {
    work.pop();
  }
  var cum = [0];
  var total = 0;
  for (var j = 1; j < work.length; j++) {
    total += hypot(work[j].x - work[j - 1].x, work[j].y - work[j - 1].y);
    cum.push(total);
  }
  var close = hypot(work[0].x - work[work.length - 1].x, work[0].y - work[work.length - 1].y);
  return { work: work, cum: cum, total: total, close: close, per: total + close };
}

function pointAt(geom, dist) {
  var per = geom.per;
  if (!(per > 0)) return { x: geom.work[0].x, y: geom.work[0].y };
  var d = dist % per;
  if (d < 0) d += per;
  var work = geom.work;
  var cum = geom.cum;
  if (d <= geom.total + 1e-9 || geom.close < 1e-12) {
    if (d > geom.total) d = geom.total;
    var lo = 1;
    var hi = cum.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    var j = lo;
    var a = work[j - 1];
    var b = work[j];
    var segStart = cum[j - 1];
    var segLen = cum[j] - cum[j - 1];
    var u = segLen > 1e-12 ? (d - segStart) / segLen : 0;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }
  var uc = (d - geom.total) / geom.close;
  var a0 = work[work.length - 1];
  var b0 = work[0];
  return { x: a0.x + (b0.x - a0.x) * uc, y: a0.y + (b0.y - a0.y) * uc };
}

function resample(geom, n) {
  var out = new Array(n);
  for (var k = 0; k < n; k++) out[k] = pointAt(geom, (k / n) * geom.per);
  return out;
}

function nearestFrac(geom, q) {
  var best = Infinity;
  var bestD = 0;
  var work = geom.work;
  function consider(ax, ay, bx, by, segStart, segLen) {
    var vx = bx - ax;
    var vy = by - ay;
    var len2 = vx * vx + vy * vy;
    var u = 0;
    if (len2 > 1e-18) {
      u = ((q.x - ax) * vx + (q.y - ay) * vy) / len2;
      if (u < 0) u = 0;
      else if (u > 1) u = 1;
    }
    var px = ax + vx * u;
    var py = ay + vy * u;
    var dist = hypot(q.x - px, q.y - py);
    if (dist < best) {
      best = dist;
      bestD = segStart + segLen * u;
    }
  }
  for (var i = 1; i < work.length; i++) {
    consider(work[i - 1].x, work[i - 1].y, work[i].x, work[i].y, geom.cum[i - 1], geom.cum[i] - geom.cum[i - 1]);
  }
  consider(work[work.length - 1].x, work[work.length - 1].y, work[0].x, work[0].y, geom.total, geom.close);
  return { frac: geom.per > 0 ? bestD / geom.per : 0, dist: best };
}

/** 2×2 SVD：A = U diag(s) V^T。列向量存在 U、V 里。 */
function svd2(a, b, c, d) {
  var ata00 = a * a + c * c;
  var ata01 = a * b + c * d;
  var ata11 = b * b + d * d;
  var tr = ata00 + ata11;
  var det = ata00 * ata11 - ata01 * ata01;
  var disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  var l1 = tr / 2 + disc;
  var l2 = tr / 2 - disc;
  function eigenvec(lambda) {
    var x = -ata01;
    var y = ata00 - lambda;
    var nrm = hypot(x, y);
    if (nrm < 1e-14) {
      x = ata11 - lambda;
      y = -ata01;
      nrm = hypot(x, y);
    }
    if (nrm < 1e-14) return [1, 0];
    return [x / nrm, y / nrm];
  }
  var v1 = eigenvec(l1);
  var v2 = [-v1[1], v1[0]];
  var s0 = Math.sqrt(Math.max(0, l1));
  var s1 = Math.sqrt(Math.max(0, l2));
  function applyA(v) {
    return [a * v[0] + b * v[1], c * v[0] + d * v[1]];
  }
  var u1 = applyA(v1);
  var u2 = applyA(v2);
  if (s0 > 1e-10) u1 = [u1[0] / s0, u1[1] / s0];
  else u1 = [1, 0];
  if (s1 > 1e-10) u2 = [u2[0] / s1, u2[1] / s1];
  else u2 = [-u1[1], u1[0]];
  var dot = u1[0] * u2[0] + u1[1] * u2[1];
  u2 = [u2[0] - dot * u1[0], u2[1] - dot * u1[1]];
  var n2 = hypot(u2[0], u2[1]);
  if (n2 < 1e-10) u2 = [-u1[1], u1[0]];
  else u2 = [u2[0] / n2, u2[1] / n2];
  return {
    u00: u1[0], u01: u2[0], u10: u1[1], u11: u2[1],
    v00: v1[0], v01: v2[0], v10: v1[1], v11: v2[1],
    s0: s0, s1: s1
  };
}

/**
 * 把 src 变到 dst：dst ≈ scale * R * src + t。
 * R 保持 det +1（纯旋转）。镜像只通过外面的 flipY 尝试。
 * shift 把 src 的下标循环挪到和 dst[i] 配对。
 */
function umeyamaShift(src, shift, dst) {
  var n = dst.length;
  var mx = 0, my = 0, dx = 0, dy = 0;
  var i;
  for (i = 0; i < n; i++) {
    var p = src[(i + shift) % n];
    mx += p.x;
    my += p.y;
    dx += dst[i].x;
    dy += dst[i].y;
  }
  mx /= n;
  my /= n;
  dx /= n;
  dy /= n;
  var a00 = 0, a01 = 0, a10 = 0, a11 = 0, varA = 0;
  for (i = 0; i < n; i++) {
    var s = src[(i + shift) % n];
    var sx = s.x - mx;
    var sy = s.y - my;
    var tx = dst[i].x - dx;
    var ty = dst[i].y - dy;
    a00 += tx * sx;
    a01 += tx * sy;
    a10 += ty * sx;
    a11 += ty * sy;
    varA += sx * sx + sy * sy;
  }
  var svd = svd2(a00, a01, a10, a11);
  var vh00 = svd.v00, vh01 = svd.v10, vh10 = svd.v01, vh11 = svd.v11;
  var r00 = svd.u00 * vh00 + svd.u01 * vh10;
  var r01 = svd.u00 * vh01 + svd.u01 * vh11;
  var r10 = svd.u10 * vh00 + svd.u11 * vh10;
  var r11 = svd.u10 * vh01 + svd.u11 * vh11;
  var sign = 1;
  if (r00 * r11 - r01 * r10 < 0) {
    sign = -1;
    r00 = svd.u00 * vh00 + (-svd.u01) * vh10;
    r01 = svd.u00 * vh01 + (-svd.u01) * vh11;
    r10 = svd.u10 * vh00 + (-svd.u11) * vh10;
    r11 = svd.u10 * vh01 + (-svd.u11) * vh11;
  }
  var scale = varA > 1e-12 ? (svd.s0 + sign * svd.s1) / varA : 1;
  return {
    r00: r00, r01: r01, r10: r10, r11: r11,
    scale: scale,
    tx: dx - scale * (r00 * mx + r01 * my),
    ty: dy - scale * (r10 * mx + r11 * my)
  };
}

function applyTr(tr, p) {
  return {
    x: tr.scale * (tr.r00 * p.x + tr.r01 * p.y) + tr.tx,
    y: tr.scale * (tr.r10 * p.x + tr.r11 * p.y) + tr.ty
  };
}

function rmsShift(tr, src, shift, dst) {
  var n = dst.length;
  var acc = 0;
  for (var i = 0; i < n; i++) {
    var p = applyTr(tr, src[(i + shift) % n]);
    var dx = p.x - dst[i].x;
    var dy = p.y - dst[i].y;
    acc += dx * dx + dy * dy;
  }
  return Math.sqrt(acc / n);
}

function assertUmeyama() {
  var src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  var dst = [{ x: 5, y: 7 }, { x: 5, y: 9 }, { x: 3, y: 9 }, { x: 3, y: 7 }];
  var tr = umeyamaShift(src, 0, dst);
  var err = rmsShift(tr, src, 0, dst);
  if (!(err < 1e-6)) throw new Error('umeyama self-check failed ' + err + ' ' + JSON.stringify(tr));
  if (!(tr.scale > 1.9 && tr.scale < 2.1)) throw new Error('umeyama scale ' + tr.scale);
}

function loadSvgOutline(file, curveSteps) {
  var text = fs.readFileSync(file, 'utf8');
  var pts = E.outlineFromSvg(text, curveSteps);
  for (var i = 0; i < pts.length; i++) pts[i] = { x: pts[i].x, y: -pts[i].y };
  return pts;
}

function mvPoints(data) {
  var xs = data.x || [];
  var ys = data.y || [];
  var pts = [];
  var n = Math.min(xs.length, ys.length);
  for (var i = 0; i < n; i++) pts.push({ x: +xs[i], y: +ys[i] });
  return pts;
}

function sfPoint(data) {
  var lights = data.marshalLights || [];
  var best = null;
  for (var i = 0; i < lights.length; i++) {
    var len = Math.abs(+lights[i].length || 0);
    if (!best || len < best.length) best = { length: len, p: lights[i].trackPosition, number: lights[i].number };
  }
  if (best && best.p) return { x: +best.p.x, y: +best.p.y, length: best.length };
  return { x: +data.x[0], y: +data.y[0], length: 0 };
}

/** 让折线从计时线起、沿比赛方向（弯道 length 递增）走。 */
function orientMvRace(pts, corners, sf) {
  var geom = polylineGeom(pts);
  var hit = nearestFrac(geom, sf);
  var rotated = [];
  var nSamp = geom.work.length;
  // 用原始顶点旋转，避免重采样把弯心抹掉。先在弧长上切开。
  var per = geom.per;
  var target = hit.frac * per;
  var work = geom.work;
  var cum = geom.cum;
  var seg = work.length - 1;
  var segStart = geom.total;
  var segLen = geom.close;
  for (var s = 1; s < cum.length; s++) {
    if (cum[s] >= target - 1e-8) {
      seg = s - 1;
      segStart = cum[s - 1];
      segLen = cum[s] - cum[s - 1];
      break;
    }
  }
  var a = seg < work.length - 1 ? work[seg] : work[work.length - 1];
  var b = seg < work.length - 1 ? work[seg + 1] : work[0];
  var u = segLen > 1e-9 ? (target - segStart) / segLen : 0;
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  var split = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  rotated.push(split);
  if (seg < work.length - 1) {
    for (var j = seg + 1; j < work.length; j++) rotated.push(work[j]);
    for (var k = 0; k <= seg; k++) rotated.push(work[k]);
  } else {
    for (var n = 0; n < work.length; n++) rotated.push(work[n]);
  }
  // 比赛方向：从计时线出发，弯号应沿折线递增。length 字段有时和这条折线的弧长对不上。
  function dirError(seq) {
    var g = polylineGeom(seq);
    var rows = [];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      if (!c || !c.trackPosition || !isFinite(+c.number)) continue;
      var nf = nearestFrac(g, { x: +c.trackPosition.x, y: +c.trackPosition.y });
      rows.push({ n: +c.number, f: nf.frac });
    }
    rows.sort(function (a, b) { return a.n - b.n; });
    if (rows.length < 3) return 0;
    var bad = 0;
    for (var k = 1; k < rows.length; k++) {
      if (wrapDelta(rows[k].f - rows[k - 1].f) < -0.005) bad++;
    }
    return bad / (rows.length - 1);
  }
  var fwd = dirError(rotated);
  var revSeq = [rotated[0]];
  for (var r = rotated.length - 1; r >= 1; r--) revSeq.push(rotated[r]);
  var rev = dirError(revSeq);
  return {
    pts: rev + 0.01 < fwd ? revSeq : rotated,
    reversedFile: rev + 0.01 < fwd,
    cornerErrFwd: fwd,
    cornerErrRev: rev
  };
}

function alignPair(svgPts, mvPts, sf, corners) {
  var N = 400;
  var oriented = orientMvRace(mvPts, corners || [], sf);
  var svgGeom = polylineGeom(svgPts);
  var mvGeom = polylineGeom(oriented.pts);
  var svgS = resample(svgGeom, N);
  var base = resample(mvGeom, N);
  var best = null;
  var bestOtherDir = null;
  for (var flipI = 0; flipI < 2; flipI++) {
    var flip = flipI === 1;
    var flipped = new Array(N);
    for (var i = 0; i < N; i++) {
      flipped[i] = flip ? { x: base[i].x, y: -base[i].y } : base[i];
    }
    for (var revI = 0; revI < 2; revI++) {
      var rev = revI === 1;
      var seq = flipped;
      if (rev) {
        seq = new Array(N);
        for (var k = 0; k < N; k++) seq[k] = flipped[(N - k) % N];
      }
      var localBest = null;
      var localSecond = null;
      for (var s = 0; s < N; s++) {
        var tr = umeyamaShift(seq, s, svgS);
        var err = rmsShift(tr, seq, s, svgS);
        var row = { err: err, shift: s, flip: flip, reverse: rev, tr: tr, seq: seq };
        if (!localBest || err < localBest.err) {
          if (localBest && Math.abs(wrapDelta((s - localBest.shift) / N)) > 0.05) localSecond = localBest;
          localBest = row;
        } else if (!localSecond || err < localSecond.err) {
          if (Math.abs(wrapDelta((s - localBest.shift) / N)) > 0.05) localSecond = row;
        }
      }
      localBest.secondErr = localSecond ? localSecond.err : null;
      localBest.secondShift = localSecond ? localSecond.shift : null;
      if (!best || localBest.err < best.err) {
        if (best && best.reverse !== localBest.reverse) bestOtherDir = best;
        best = localBest;
      } else if (best && localBest.reverse !== best.reverse) {
        if (!bestOtherDir || localBest.err < bestOtherDir.err) bestOtherDir = localBest;
      }
    }
  }
  var sfIn = best.flip ? { x: sf.x, y: -sf.y } : { x: sf.x, y: sf.y };
  var sfSvg = applyTr(best.tr, sfIn);
  var proj = nearestFrac(svgGeom, sfSvg);
  var cornerErr = 0;
  var cornerN = 0;
  var cornerRows = [];
  for (var c = 0; c < (corners || []).length; c++) {
    var corner = corners[c];
    if (!corner || !corner.trackPosition || !isFinite(+corner.length)) continue;
    var cp = { x: +corner.trackPosition.x, y: +corner.trackPosition.y };
    if (best.flip) cp.y = -cp.y;
    var mapped = applyTr(best.tr, cp);
    var nf = nearestFrac(svgGeom, mapped);
    var race = best.reverse ? wrap01(proj.frac - nf.frac) : wrap01(nf.frac - proj.frac);
    var mvF = mvGeom.per > 0 ? (+corner.length) / mvGeom.per : 0;
    var e = Math.abs(wrapDelta(race - mvF));
    cornerErr += e;
    cornerN++;
    cornerRows.push({
      number: corner.number,
      letter: corner.letter || '',
      mv: +mvF.toFixed(4),
      svg: +race.toFixed(4),
      err: +e.toFixed(4)
    });
  }
  if (cornerN) cornerErr /= cornerN;
  var cornerOnMv = 0;
  var cornerFracErr = 0;
  var cornerOnMvN = 0;
  for (var ci = 0; ci < (corners || []).length; ci++) {
    var cc = corners[ci];
    if (!cc || !cc.trackPosition || !isFinite(+cc.length)) continue;
    var hitMv = nearestFrac(mvGeom, { x: +cc.trackPosition.x, y: +cc.trackPosition.y });
    cornerOnMv += hitMv.dist;
    var mvTarget = mvGeom.per > 0 ? (+cc.length) / mvGeom.per : 0;
    cornerFracErr += Math.abs(wrapDelta(hitMv.frac - mvTarget));
    cornerOnMvN++;
  }
  if (cornerOnMvN) {
    cornerOnMv /= cornerOnMvN;
    cornerFracErr /= cornerOnMvN;
  }
  return {
    seq: best.seq,
    cornerOnMv: cornerOnMv,
    cornerFracErr: cornerFracErr,
    mvGeom: mvGeom,
    rms: best.err,
    rmsPct: svgGeom.per > 0 ? (best.err / svgGeom.per) * 100 : null,
    scale: best.tr.scale,
    flipY: best.flip,
    reverseMv: best.reverse,
    shift: best.shift,
    shiftFrac: best.shift / N,
    secondShift: best.secondShift,
    secondRms: best.secondErr,
    otherDirRms: bestOtherDir ? bestOtherDir.err : null,
    rawOffset: proj.frac,
    projDist: proj.dist,
    projDistPct: svgGeom.per > 0 ? (proj.dist / svgGeom.per) * 100 : null,
    svgPerim: svgGeom.per,
    mvPerim: mvGeom.per,
    mvReversedToRace: oriented.reversedFile,
    cornerMeanAbsErr: cornerErr,
    corners: cornerRows,
    tr: best.tr,
    svgGeom: svgGeom
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function phaseFromAlign(align) {
  var raw = align.rawOffset;
  var offset = align.reverseMv ? wrap01(1 - raw) : raw;
  return {
    offset: round3(offset),
    reverse: !!align.reverseMv,
    rawOffset: +raw.toFixed(6),
    offsetFull: +offset.toFixed(6)
  };
}

function confidenceOf(align) {
  var rms = align.rmsPct;
  var proj = align.projDistPct;
  var margin = align.otherDirRms && align.rms > 0 ? align.otherDirRms / align.rms : 1;
  if (!(rms < 4) || !(proj < 1.5) || !(margin > 1.15)) return 'poor';
  if (rms < 1.2 && proj < 0.6 && margin > 1.4) return 'high';
  if (rms < 2.6 && proj < 1.05 && margin > 1.2) return 'medium';
  return 'poor';
}

/**
 * FIA 比赛笔记里的赛段中心线长度（km）。2026 西班牙站是马德里，不能用来标 Catalunya。
 * 2026 巴林站在雪邦，不能用来标萨基尔。
 */
var SECTOR_KM = {
  'melbourne-2.svg': { s1: 1.753, s2: 1.413, total: 5.278, source: 'FIA 2026 Australian GP' },
  'suzuka-2.svg': { s1: 2.184, s2: 2.526, total: 5.807, source: 'FIA 2026 Japanese GP' },
  'shanghai-1.svg': { s1: 1.430, s2: 1.569, total: 5.451, source: 'FIA 2026 Chinese GP' },
  'miami-1.svg': { s1: 1.866, s2: 1.730, total: 5.412, source: 'FIA 2026 Miami GP' },
  'monaco-6.svg': { s1: 1.051, s2: 1.419, total: 3.337, source: 'FIA 2026 Monaco GP' },
  'montreal-6.svg': { s1: 1.092, s2: 1.396, total: 4.361, source: 'FIA 2026 Canadian GP' },
  'spielberg-3.svg': { s1: 1.215, s2: 1.697, total: 4.326, source: 'FIA 2026 Austrian GP' },
  'silverstone-8.svg': { s1: 1.823, s2: 2.464, total: 5.891, source: 'FIA 2026 British GP' },
  'hungaroring-3.svg': { s1: 1.736, s2: 1.542, total: 4.381, source: 'FIA 2026 Hungarian GP' },
  'spa-francorchamps-4.svg': { s1: 2.254, s2: 2.820, total: 7.004, source: 'FIA 2026 Belgian GP' },
  'zandvoort-5.svg': { s1: 1.483, s2: 1.452, total: 4.259, source: 'FIA 2026 Dutch GP' },
  'monza-7.svg': { s1: 1.909, s2: 1.823, total: 5.793, source: 'FIA 2026 Italian GP' },
  'baku-1.svg': { s1: 2.033, s2: 2.025, total: 6.003, source: 'FIA 2026 Azerbaijan GP' },
  'marina-bay-4.svg': { s1: 1.639, s2: 1.782, total: 4.927, source: 'FIA 2026 Singapore GP' }
};

/** 没有公里数、但图例写了相对弯心的计时环。米数沿比赛方向从弯心量。 */
var SECTOR_TURN = {
  'lusail-1.svg': {
    totalKm: 5.419,
    s1: { turn: 6, meters: 80, side: 'before' },
    s2: { turn: 12, meters: 75, side: 'before' },
    source: 'FIA 2025 Qatar GP'
  },
  'catalunya-6.svg': {
    totalKm: 4.657,
    s1: { turn: 4, meters: 50, side: 'before' },
    s2: { turn: 10, meters: 89, side: 'before' },
    source: 'FIA 2025 Spanish GP (Barcelona)'
  },
  'mexico-city-3.svg': {
    totalKm: 4.304,
    s1: { turn: 4, meters: 136, side: 'before' },
    s2: { turn: 12, meters: 242, side: 'before' },
    source: 'FIA 2025 Mexico City GP'
  },
  'las-vegas-1.svg': {
    totalKm: 6.201,
    s1: { turn: 5, meters: 90, side: 'after' },
    s2: { turn: 12, meters: 140, side: 'after' },
    source: 'FIA 2025 Las Vegas GP'
  },
  'yas-marina-2.svg': {
    totalKm: 5.281,
    s1: { turn: 5, meters: 205, side: 'before' },
    s2: { turn: 9, meters: 100, side: 'before' },
    source: 'FIA 2025 Abu Dhabi GP'
  }
};

function phaseOnProd(align, prodGeom, prodRaw, mvXY) {
  var p = { x: mvXY.x, y: mvXY.y };
  if (align.flipY) p = { x: p.x, y: -p.y };
  var mapped = applyTr(align.tr, p);
  var nf = nearestFrac(prodGeom, mapped);
  var phase = align.reverseMv ? wrap01(prodRaw - nf.frac) : wrap01(nf.frac - prodRaw);
  return {
    phase: phase,
    distPct: prodGeom.per > 0 ? (nf.dist / prodGeom.per) * 100 : 99
  };
}

function sectorFromKm(align, prodGeom, prodRaw, spec) {
  var f1 = spec.s1 / spec.total;
  var f2 = (spec.s1 + spec.s2) / spec.total;
  var p1 = phaseOnProd(align, prodGeom, prodRaw, pointAt(align.mvGeom, f1 * align.mvGeom.per));
  var p2 = phaseOnProd(align, prodGeom, prodRaw, pointAt(align.mvGeom, f2 * align.mvGeom.per));
  return {
    source: spec.source,
    distanceFrac: [+f1.toFixed(4), +f2.toFixed(4)],
    svg: [p1.phase, p2.phase],
    distPct: [+p1.distPct.toFixed(3), +p2.distPct.toFixed(3)]
  };
}

function cornerByNumber(corners, n) {
  for (var i = 0; i < corners.length; i++) {
    if (+corners[i].number === n) return corners[i];
  }
  return null;
}

function sectorFromTurn(align, prodGeom, prodRaw, corners, spec) {
  function at(one) {
    var c = cornerByNumber(corners, one.turn);
    if (!c || !c.trackPosition) return null;
    var hit = nearestFrac(align.mvGeom, { x: +c.trackPosition.x, y: +c.trackPosition.y });
    var delta = one.meters / (spec.totalKm * 1000);
    var f = one.side === 'after' ? wrap01(hit.frac + delta) : wrap01(hit.frac - delta);
    return { f: f, proj: phaseOnProd(align, prodGeom, prodRaw, pointAt(align.mvGeom, f * align.mvGeom.per)) };
  }
  var a = at(spec.s1);
  var b = at(spec.s2);
  if (!a || !b) return { source: spec.source, missingCorner: true };
  return {
    source: spec.source,
    distanceFrac: [+a.f.toFixed(4), +b.f.toFixed(4)],
    svg: [a.proj.phase, b.proj.phase],
    distPct: [+a.proj.distPct.toFixed(3), +b.proj.distPct.toFixed(3)]
  };
}

function acceptSectors(raw) {
  if (!raw || !raw.svg || raw.missingCorner) return null;
  if (raw.distPct[0] > 0.8 || raw.distPct[1] > 0.8) return null;
  var a = round3(raw.svg[0]);
  var b = round3(raw.svg[1]);
  if (!(a > 0.05 && a < b && b < 0.95 && (b - a) > 0.12)) return null;
  // 和距离比例差太远，说明示意图把某一段拉得很长，最近点可能吸到了旁边的弯。
  if (Math.abs(wrapDelta(raw.svg[0] - raw.distanceFrac[0])) > 0.03) return null;
  if (Math.abs(wrapDelta(raw.svg[1] - raw.distanceFrac[1])) > 0.03) return null;
  return { sectors: [a, b], source: raw.source, distanceFrac: raw.distanceFrac, distPct: raw.distPct };
}

function listYearFiles(cache, key) {
  var files = fs.readdirSync(cache);
  var out = [];
  var re = new RegExp('^' + key + '-(\\d+)\\.json$');
  for (var i = 0; i < files.length; i++) {
    var m = re.exec(files[i]);
    if (m) out.push({ year: +m[1], file: path.join(cache, files[i]) });
  }
  out.sort(function (a, b) { return a.year - b.year; });
  return out;
}

function parseArgs(argv) {
  var out = { cache: '/tmp/mv', only: '', fetch: false, steps: 24 };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--fetch') out.fetch = true;
    else if (a === '--cache') out.cache = argv[++i];
    else if (a === '--only') out.only = argv[++i];
    else if (a === '--steps') out.steps = +argv[++i];
    else if (a === '--help') out.help = true;
  }
  return out;
}

function fetchJson(url, dest) {
  var cp = require('child_process');
  cp.execFileSync('curl', ['-fsSL', '-A', 'Mozilla/5.0', '-m', '40', '-o', dest, url], { stdio: 'inherit' });
}

function main() {
  assertUmeyama();
  var args = parseArgs(process.argv);
  if (args.help) {
    console.log('node director/calibrate-circuit-phase.js --cache /tmp/mv [--only austin-1.svg] [--fetch]');
    return;
  }
  var svgDir = path.join(__dirname, 'web-override', 'circuits');
  var results = [];
  for (var i = 0; i < CIRCUITS.length; i++) {
    var c = CIRCUITS[i];
    if (args.only && c.svg.indexOf(args.only) < 0 && String(c.key) !== args.only) continue;
    var svgPath = path.join(svgDir, c.svg);
    if (!fs.existsSync(svgPath)) {
      results.push({ svg: c.svg, key: c.key, name: c.name, skip: 'missing svg' });
      continue;
    }
    var svgPts = loadSvgOutline(svgPath, args.steps);
    var svgPts4 = args.steps === 4 ? svgPts : loadSvgOutline(svgPath, 4);
    var years = listYearFiles(args.cache, c.key);
    if (args.fetch && !years.length) {
      [2024, 2025, 2026].forEach(function (y) {
        var dest = path.join(args.cache, c.key + '-' + y + '.json');
        fetchJson('https://api.multiviewer.app/api/v1/circuits/' + c.key + '/' + y, dest);
      });
      years = listYearFiles(args.cache, c.key);
    }
    if (!years.length) {
      results.push({ svg: c.svg, key: c.key, name: c.name, skip: 'no multiviewer cache' });
      continue;
    }
    var scored = [];
    for (var y = 0; y < years.length; y++) {
      var data;
      try { data = JSON.parse(fs.readFileSync(years[y].file, 'utf8')); }
      catch (e) { continue; }
      if (!data.x || data.x.length < 30) continue;
      var align = alignPair(svgPts, mvPoints(data), sfPoint(data), data.corners || []);
      var phase = phaseFromAlign(align);
      var prodGeom = polylineGeom(svgPts4);
      var sfMv = sfPoint(data);
      var prod = nearestFrac(prodGeom, applyTr(align.tr, align.flipY ? { x: sfMv.x, y: -sfMv.y } : sfMv));
      var prodRaw = prod.frac;
      var prodOffset = align.reverseMv ? wrap01(1 - prodRaw) : prodRaw;
      var sectorRaw = null;
      if (SECTOR_KM[c.svg]) sectorRaw = sectorFromKm(align, prodGeom, prodRaw, SECTOR_KM[c.svg]);
      else if (SECTOR_TURN[c.svg]) sectorRaw = sectorFromTurn(align, prodGeom, prodRaw, data.corners || [], SECTOR_TURN[c.svg]);
      scored.push({
        requestYear: years[y].year,
        yearField: data.year,
        corners: (data.corners || []).length,
        align: align,
        phase: phase,
        prodOffset: round3(prodOffset),
        prodOffsetFull: +prodOffset.toFixed(6),
        prodProjDist: prod.dist,
        confidence: confidenceOf(align),
        sectors: acceptSectors(sectorRaw),
        sectorRaw: sectorRaw
      });
    }
    if (!scored.length) {
      results.push({ svg: c.svg, key: c.key, name: c.name, skip: 'empty multiviewer payloads' });
      continue;
    }
    scored.sort(function (a, b) { return a.align.rms - b.align.rms; });
    var bestRms = scored[0].align.rms;
    var pool = scored.filter(function (s) { return s.align.rms <= bestRms * 1.12; });
    pool.sort(function (a, b) { return (b.yearField || 0) - (a.yearField || 0); });
    var pick = pool[0];
    results.push({
      svg: 'circuits/' + c.svg,
      file: c.svg,
      key: c.key,
      name: c.name,
      requestYear: pick.requestYear,
      yearField: pick.yearField,
      mvCorners: pick.corners,
      confidence: pick.confidence,
      offset: pick.prodOffset,
      offsetFull: pick.prodOffsetFull,
      offsetDense: pick.phase.offset,
      offsetDenseFull: pick.phase.offsetFull,
      reverse: pick.phase.reverse,
      rawOffset: pick.phase.rawOffset,
      rms: +pick.align.rms.toFixed(4),
      rmsPct: +pick.align.rmsPct.toFixed(3),
      scale: +pick.align.scale.toFixed(6),
      flipY: pick.align.flipY,
      reverseMv: pick.align.reverseMv,
      shift: pick.align.shift,
      projDist: +pick.align.projDist.toFixed(3),
      projDistPct: +pick.align.projDistPct.toFixed(3),
      prodProjDist: +pick.prodProjDist.toFixed(3),
      cornerMeanAbsErr: +pick.align.cornerMeanAbsErr.toFixed(4),
      cornerOnMv: +pick.align.cornerOnMv.toFixed(2),
      cornerFracErr: +pick.align.cornerFracErr.toFixed(4),
      otherDirRms: pick.align.otherDirRms ? +pick.align.otherDirRms.toFixed(3) : null,
      secondShift: pick.align.secondShift,
      secondRms: pick.align.secondRms ? +pick.align.secondRms.toFixed(3) : null,
      mvReversedToRace: pick.align.mvReversedToRace,
      sectors: pick.sectors ? pick.sectors.sectors : null,
      sectorSource: pick.sectors ? pick.sectors.source : (pick.sectorRaw && pick.sectorRaw.source) || null,
      sectorDistanceFrac: pick.sectors ? pick.sectors.distanceFrac : (pick.sectorRaw && pick.sectorRaw.distanceFrac) || null,
      sectorDistPct: pick.sectors ? pick.sectors.distPct : (pick.sectorRaw && pick.sectorRaw.distPct) || null,
      sectorSvgFull: pick.sectorRaw && pick.sectorRaw.svg ? pick.sectorRaw.svg.map(function (v) { return +v.toFixed(4); }) : null,
      sectorRejected: !pick.sectors && !!pick.sectorRaw,
      svgPerim: +pick.align.svgPerim.toFixed(2),
      yearsTried: scored.map(function (s) {
        return {
          requestYear: s.requestYear,
          yearField: s.yearField,
          rmsPct: +s.align.rmsPct.toFixed(3),
          offset: s.prodOffset,
          reverse: s.phase.reverse,
          confidence: s.confidence
        };
      })
    });
    var row = results[results.length - 1];
    if (process.env.OVERLAY) {
      try {
        fs.mkdirSync(process.env.OVERLAY, { recursive: true });
        var seq = pick.align.seq;
        var sh = pick.align.shift;
        var trA = pick.align.tr;
        var mvDraw = [];
        for (var di = 0; di < seq.length; di++) mvDraw.push(applyTr(trA, seq[(di + sh) % seq.length]));
        var svgDraw = pick.align.svgGeom.work;
        function pathOf(pts) {
          var d = '';
          for (var pi = 0; pi < pts.length; pi++) {
            d += (pi ? 'L' : 'M') + pts[pi].x.toFixed(2) + ' ' + (-pts[pi].y).toFixed(2) + ' ';
          }
          return d;
        }
        var all = svgDraw.concat(mvDraw);
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var bi = 0; bi < all.length; bi++) {
          var bx = all[bi].x, by = -all[bi].y;
          if (bx < minX) minX = bx;
          if (by < minY) minY = by;
          if (bx > maxX) maxX = bx;
          if (by > maxY) maxY = by;
        }
        var pad = 20;
        var svgOut = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
          (minX - pad) + ' ' + (minY - pad) + ' ' + (maxX - minX + pad * 2) + ' ' + (maxY - minY + pad * 2) + '">' +
          '<path d="' + pathOf(svgDraw) + 'Z" fill="none" stroke="#1d4ed8" stroke-width="2"/>' +
          '<path d="' + pathOf(mvDraw) + 'Z" fill="none" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="4 3"/>' +
          '</svg>';
        fs.writeFileSync(path.join(process.env.OVERLAY, c.svg.replace('.svg', '-align.svg')), svgOut);
      } catch (e) { console.error('overlay', e.message); }
    }
    console.error(
      c.svg + ' key=' + c.key + ' year=' + row.yearField +
      ' off=' + row.offset + ' rev=' + row.reverse +
      ' rms%=' + row.rmsPct + ' cerr=' + row.cornerMeanAbsErr +
      ' proj=' + row.projDist + ' ' + row.confidence +
      ' flipY=' + row.flipY + ' shift=' + row.shift +
      (row.sectors ? ' sectors=' + row.sectors.join(',') : (row.sectorRejected ? ' sectors-rejected' : ''))
    );
  }
  var slim = results.map(function (r) {
    if (r.skip) return r;
    var copy = {};
    Object.keys(r).forEach(function (k) {
      if (k !== 'align') copy[k] = r[k];
    });
    return copy;
  });
  console.log(JSON.stringify(slim, null, 2));
}

main();
