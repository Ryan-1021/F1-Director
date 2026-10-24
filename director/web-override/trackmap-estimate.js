/*
 * 赛道图车位估计（不是 GPS）。
 *
 * 练习 / 排位：用本圈 S1–S3 与迷你赛段（已点亮的 segment）得到圈进度。
 * 正赛 / 冲刺赛：领先者仍用赛段；其余车用相对领先者的时间差 ÷ 参考圈速。
 * 被套圈（"1 LAP"）不用时间差，改回各车自己的赛段。
 * 进站不沿赛道飞到某个假维修区，只在当前进度上由绘图层向内侧偏一点。
 * 轮廓起点不一定是起跑线，所以绝对相位是相对的；车与车的间距才是这版要看的东西。
 *
 * 浏览器：window.TrackmapEstimate
 * Node：module.exports，`node trackmap-estimate.js` 会自检。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TrackmapEstimate = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SEG_DONE = { 2048: 1, 2049: 1, 2051: 1 };

  function wrap01(f) {
    if (!isFinite(f)) return 0;
    f = f % 1;
    if (f < 0) f += 1;
    return f;
  }

  /** 把差值折成 (-0.5, 0.5]，正数表示 target 在 from 的前方（沿圈）。 */
  function wrapDelta(toMinusFrom) {
    var d = wrap01(toMinusFrom);
    if (d > 0.5) d -= 1;
    return d;
  }

  function timeSeconds(str) {
    if (str == null) return NaN;
    if (typeof str === 'object') str = str.Value || str.value || str.time || str.Time || '';
    var s = String(str).trim();
    if (!s || s === '—' || s === '-' || s === '–') return NaN;
    var m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return (+m[1]) * 60 + (+m[2]);
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function normalizeSegments(raw) {
    var out = [];
    if (!raw) return out;
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        var s = raw[i];
        if (s != null && typeof s === 'object') out.push(Number(s.status != null ? s.status : s.Status) || 0);
        else out.push(Number(s) || 0);
      }
      return out;
    }
    if (typeof raw === 'object') {
      var keys = Object.keys(raw).filter(function (k) { return /^\d+$/.test(k); })
        .map(Number).sort(function (a, b) { return a - b; });
      for (var j = 0; j < keys.length; j++) {
        var seg = raw[String(keys[j])];
        if (seg != null && typeof seg === 'object') out.push(Number(seg.status != null ? seg.status : seg.Status) || 0);
        else out.push(Number(seg) || 0);
      }
    }
    return out;
  }

  function readSectors(car) {
    var raw = (car && (car.sectors || car.Sectors)) || [];
    var out = [];
    for (var i = 0; i < 3; i++) {
      var v = raw[i];
      var value = '';
      var segments = [];
      if (v != null && typeof v === 'object') {
        value = String(v.Value || v.value || v.time || v.Time || '');
        segments = normalizeSegments(v.segments || v.Segments);
      } else if (v != null && v !== '') {
        value = String(v);
      }
      if (!value && car) {
        var flat = car['s' + (i + 1)] || car['sector' + (i + 1)] || car['Sector' + (i + 1)];
        if (flat != null && flat !== '') value = String(flat);
      }
      out.push({ value: value, segments: segments });
    }
    return out;
  }

  function sectorHasTime(value) {
    var t = timeSeconds(value);
    return isFinite(t) && t > 0.5;
  }

  /**
   * 本车自己的圈进度。
   * exact=false 表示只知道「至少已经到这个赛段起点」，绘图不该把车拉回去
   * （迷你赛段状态会褪成 0）。
   */
  function progressFromTiming(car) {
    var sectors = readSectors(car || {});
    var current = 0;
    for (var i = 0; i < 3; i++) {
      if (sectorHasTime(sectors[i].value)) current = i + 1;
      else break;
    }
    if (current >= 3) {
      return { frac: 0.01, cap: 0.1, sector: 0, confident: true, exact: true, doneSegs: 0, freshLap: true };
    }
    var segs = sectors[current].segments || [];
    var done = 0;
    for (var s = 0; s < segs.length; s++) {
      if (SEG_DONE[segs[s] | 0]) done++;
      else break;
    }
    var inner;
    var capInner;
    var exact = false;
    if (segs.length && done > 0) {
      inner = (done - 0.2) / segs.length;
      capInner = Math.min(0.98, (done + 0.9) / segs.length);
      exact = true;
    } else if (current > 0) {
      inner = 0.03;
      capInner = segs.length ? Math.max(0.2, 1.15 / segs.length) : 0.92;
      exact = false;
    } else {
      inner = 0.02;
      capInner = segs.length ? Math.max(0.18, 1 / segs.length) : 0.9;
      exact = false;
    }
    if (inner < 0) inner = 0;
    if (inner > 0.98) inner = 0.98;
    if (capInner < inner) capInner = Math.min(0.99, inner + 0.04);
    return {
      frac: (current + inner) / 3,
      cap: (current + Math.min(0.99, capInner)) / 3,
      sector: current,
      confident: current > 0 || done > 0,
      exact: exact,
      doneSegs: done,
      freshLap: false
    };
  }

  function parseGap(gap) {
    if (gap == null) return { kind: 'none' };
    var s = String(gap).trim();
    if (!s || s === '—' || s === '-' || s === '–') return { kind: 'none' };
    var u = s.toUpperCase().replace(/\s+/g, ' ');
    if (u === 'LEADER' || u === 'INTERVAL') return { kind: 'leader', seconds: 0 };
    if (u.indexOf('PIT') >= 0) return { kind: 'pit' };
    if (u.indexOf('LAP') >= 0 || /\bL\b/.test(u) || /^\+?\d+\s*L$/.test(u)) {
      var lm = /(\d+)/.exec(u);
      return { kind: 'laps', laps: lm ? parseInt(lm[1], 10) : 1 };
    }
    s = s.replace(/^\+/, '');
    var m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return { kind: 'time', seconds: (+m[1]) * 60 + (+m[2]) };
    var n = Number(s);
    if (isFinite(n)) return { kind: 'time', seconds: Math.max(0, n) };
    return { kind: 'none' };
  }

  function sessionUsesTimeGaps(name) {
    var s = String(name || '').toLowerCase();
    if (!s) return false;
    if (/qual|practice|shoot|testing|\bfp\d?\b/.test(s)) return false;
    if (/race|sprint/.test(s)) return true;
    return false;
  }

  function paceScale(text) {
    var s = String(text || '').toLowerCase();
    if (/red flag|红旗/.test(s)) return 0;
    if (/virtual safety|vsc|虚拟安全/.test(s)) return 0.6;
    if (/safety car|安全车/.test(s)) return 0.4;
    return 1;
  }

  function refLapSeconds(cars) {
    var best = Infinity;
    var list = cars || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var laps = [c.bestLap, c.lastLap, c.lastLapTime, c.LastLapTime];
      for (var k = 0; k < laps.length; k++) {
        var sec = timeSeconds(laps[k]);
        if (sec > 50 && sec < 220 && sec < best) best = sec;
      }
      var sectors = readSectors(c);
      var bests = c.bestSectors || c.BestSectors || [];
      var sum = 0;
      var ok = 0;
      for (var s = 0; s < 3; s++) {
        var bv = bests[s];
        if (bv != null && typeof bv === 'object') bv = bv.Value || bv.value || '';
        var t = timeSeconds(bv);
        if (!(t > 5)) t = timeSeconds(sectors[s].value);
        if (t > 5 && t < 90) { sum += t; ok++; }
      }
      if (ok === 3 && sum > 50 && sum < 220 && sum < best) best = sum;
    }
    return isFinite(best) ? best : 90;
  }

  function carNumber(c) {
    return String(c && c.number != null ? c.number : (c && c.tla) || '');
  }

  function findLeader(cars) {
    var leader = null;
    var bestPos = Infinity;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (!c || c.retired || c.knockedOut) continue;
      var g = parseGap(c.gap);
      if (g.kind === 'leader') return c;
      var pos = parseInt(c.position, 10);
      if (!isNaN(pos) && pos > 0 && pos < bestPos) {
        bestPos = pos;
        leader = c;
      }
    }
    return leader;
  }

  function planField(cars, sessionName, statusText) {
    var list = cars || [];
    var raceGaps = sessionUsesTimeGaps(sessionName);
    var lapSeconds = refLapSeconds(list);
    var pace = paceScale(statusText);
    var leader = findLeader(list);
    var leaderProg = leader ? progressFromTiming(leader) : null;
    var leaderNum = leader ? carNumber(leader) : '';
    var planned = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var num = carNumber(c);
      var prog = progressFromTiming(c);
      var gap = parseGap(c.gap);
      var hide = !!(c.retired || c.knockedOut);
      var pit = !hide && (!!c.inPit || gap.kind === 'pit');
      var hold = !hide && !pit && !!c.stopped;
      var outlap = !hide && !pit && !!c.pitOut && prog.sector === 0 && prog.doneSegs === 0 && !prog.freshLap;
      var frac = prog.frac;
      var cap = prog.cap;
      var exact = prog.exact;
      var mode = exact ? 'sector' : 'floor';
      var isLeader = !!(leader && carNumber(c) === leaderNum);
      if (pit) {
        mode = 'pit';
        exact = true;
      } else if (hold) {
        mode = 'hold';
        exact = true;
      } else if (raceGaps && !isLeader && gap.kind === 'time' && leaderProg) {
        var base = leaderProg.confident || leaderProg.exact ? leaderProg.frac : 0.5;
        var leadCap = (leaderProg.confident || leaderProg.exact) ? leaderProg.cap : null;
        if (!leaderProg.confident && !leaderProg.exact) {
          base = 0.5;
          leadCap = null;
          mode = 'gap-clock';
        } else {
          mode = 'gap';
        }
        frac = wrap01(base - gap.seconds / lapSeconds);
        cap = leadCap == null ? null : wrap01(leadCap - gap.seconds / lapSeconds);
        exact = true;
      } else if (raceGaps && isLeader && !prog.confident && !prog.exact) {
        frac = 0.5;
        cap = null;
        exact = false;
        mode = 'clock';
      } else if (!prog.confident && !prog.exact && !raceGaps) {
        var pos = parseInt(c.position, 10);
        if (isNaN(pos) || pos < 1) pos = i + 1;
        frac = wrap01((pos - 1) * 0.007);
        cap = wrap01(frac + 0.015);
        exact = false;
        mode = 'grid';
      } else if (outlap && !prog.exact) {
        // 出站：只给一个很低的下限，已经在前面的车不要被拉回轮廓起点。
        frac = 0.02;
        cap = prog.cap;
        exact = false;
        mode = 'outlap';
      }
      planned.push({
        number: num,
        tla: c.tla || num,
        teamColour: c.teamColour || c.teamColor || '',
        position: c.position,
        frac: frac,
        cap: cap,
        exact: exact,
        pit: pit,
        outlap: outlap && !pit,
        hold: hold,
        hide: hide,
        mode: mode
      });
    }
    return {
      lapSeconds: lapSeconds,
      pace: pace,
      raceGaps: raceGaps,
      leader: leaderNum,
      cars: planned
    };
  }

  function createMotion(frac, now) {
    return {
      anchor: frac,
      at: now,
      display: frac,
      cap: null,
      lastTarget: frac,
      pit: false,
      hold: false,
      hide: false,
      lapScale: 1,
      easeFrom: null,
      easeTo: null,
      easeStart: 0,
      easeMs: 0
    };
  }

  function sampleMotion(st, now, lapMs, frozen) {
    if (!st) return 0;
    if (st.easeTo != null) {
      var dur = st.easeMs > 0 ? st.easeMs : 1;
      var u = (now - st.easeStart) / dur;
      if (u < 1) {
        if (u < 0) u = 0;
        var s = u * u * (3 - 2 * u);
        var d = wrapDelta(st.easeTo - st.easeFrom);
        return wrap01(st.easeFrom + d * s);
      }
      st.display = st.easeTo;
      st.anchor = st.easeTo;
      st.at = now;
      st.easeTo = null;
      st.easeFrom = null;
    }
    if (frozen || st.hold || st.pit || st.hide) return st.anchor;
    var scale = st.lapScale > 0 ? st.lapScale : 1;
    var ms = (lapMs > 1 ? lapMs : 90000) * scale;
    var adv = Math.max(0, now - st.at) / ms;
    if (st.cap != null && isFinite(st.cap)) {
      var room = wrap01(st.cap - st.anchor);
      if (room > 0.98) room = 0;
      else if (room > 0.5) room = null;
      if (room != null && adv > room) adv = room;
    }
    return wrap01(st.anchor + adv);
  }

  function rebaseMotion(st, shown, now) {
    st.anchor = shown;
    st.display = shown;
    st.at = now;
    st.easeTo = null;
    st.easeFrom = null;
    return st;
  }

  function pointTarget(st, target, cap, now, lapMs, frozen, flags) {
    var shown = sampleMotion(st, now, lapMs, frozen);
    var modeChanged = !!st.pit !== !!flags.pit || !!st.hold !== !!flags.hold;
    var targetMoved = st.lastTarget == null || Math.abs(wrapDelta(target - st.lastTarget)) > 0.0005;
    if (modeChanged || (targetMoved && Math.abs(wrapDelta(target - shown)) > 0.08)) {
      st.easeFrom = shown;
      st.easeTo = target;
      st.easeStart = now;
      st.easeMs = flags.pit ? 420 : 640;
      st.anchor = target;
      st.at = now;
      st.display = shown;
    } else if (targetMoved) {
      var err = wrapDelta(target - shown);
      var nudged = wrap01(shown + err * 0.4);
      rebaseMotion(st, nudged, now);
    }
    st.cap = cap;
    st.lastTarget = target;
    return st;
  }

  /**
   * 把一帧计时测量揉进运动状态。目标没变时不重置时钟，车会沿圈继续走。
   * 进站：冻在当前进度（绘图再向内侧偏），不要滑到轮廓起点。
   */
  function stepMotion(st, target, cap, now, lapMs, frozen, flags) {
    flags = flags || {};
    if (!isFinite(target)) target = 0;
    if (!st) {
      st = createMotion(target, now);
      st.cap = cap;
      st.pit = !!flags.pit;
      st.hold = !!flags.hold;
      st.hide = !!flags.hide;
      st.lapScale = flags.outlap && !flags.exact ? 1.75 : 1;
      st.lastTarget = target;
      return st;
    }
    if (flags.hide) {
      st.hide = true;
      return st;
    }
    st.hide = false;

    if (flags.pit) {
      if (!st.pit) {
        var entered = sampleMotion(st, now, lapMs, frozen);
        rebaseMotion(st, entered, now);
        st.cap = entered;
        st.lastTarget = entered;
      }
      st.pit = true;
      st.hold = false;
      st.lapScale = 1;
      return st;
    }

    if (st.pit && !flags.pit) {
      rebaseMotion(st, st.anchor, now);
      st.pit = false;
    }

    if (flags.hold) {
      if (!st.hold) {
        var stoppedAt = sampleMotion(st, now, lapMs, frozen);
        rebaseMotion(st, stoppedAt, now);
      }
      st.hold = true;
      st.cap = st.anchor;
      st.lapScale = 1;
      st.lastTarget = target;
      return st;
    }
    st.hold = false;
    st.lapScale = flags.outlap && !flags.exact ? 1.75 : 1;

    if (!flags.exact) {
      var shown = sampleMotion(st, now, lapMs, frozen);
      var behind = wrapDelta(target - shown);
      if (behind > 0.02 && behind < 0.5) {
        var raised = wrap01(shown + behind * 0.55);
        rebaseMotion(st, raised, now);
      }
      st.cap = cap;
      st.lastTarget = target;
      return st;
    }

    return pointTarget(st, target, cap, now, lapMs, frozen, flags);
  }

  function buildArc(pts) {
    var cum = [0];
    var total = 0;
    var src = pts || [];
    for (var i = 1; i < src.length; i++) {
      var dx = src[i].x - src[i - 1].x;
      var dy = src[i].y - src[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
      cum.push(total);
    }
    return { pts: src, cum: cum, total: total };
  }

  /**
   * 裁判区段旗语 → 沿轮廓的涂色计划。
   * 数据是 TrackState：yellowSectors / doubleYellowSectors 是 1 起的区段号，
   * globalLevel 4/5/6 是虚拟安全车 / 安全车 / 红旗（整圈）。
   * 没有弯道实测桩，调用方按 count 把圈程等分。
   */
  function marshalFlagPlan(track, ringCount) {
    var t = track || {};
    var n = parseInt(ringCount, 10);
    if (!isFinite(n) || n < 0) n = 0;
    if (n > 64) n = 64;
    var level = Number(t.level);
    if (!isFinite(level)) level = 0;
    var global = (t.globalLevel == null || t.globalLevel === '') ? level : Number(t.globalLevel);
    if (!isFinite(global)) global = level;
    var dy = {};
    var ye = {};
    var listed = 0;
    function take(list, bag) {
      var arr = list || [];
      for (var i = 0; i < arr.length; i++) {
        var s = parseInt(arr[i], 10);
        if (s > 0) { bag[s] = 1; listed++; }
      }
    }
    take(t.doubleYellowSectors, dy);
    take(t.yellowSectors, ye);
    var full = '';
    if (global >= 6 || level >= 6) full = 'red';
    else if (global >= 5 || level >= 5) full = 'sc';
    else if (global >= 4 || level >= 4) full = 'vsc';
    else if ((global >= 2 || level >= 2) && !listed) full = 'yellow';
    var sectors = [];
    if (full !== 'red' && n > 0) {
      for (var sec = 1; sec <= n; sec++) {
        if (dy[sec]) sectors.push({ sec: sec, kind: 'doubleYellow' });
        else if (ye[sec]) sectors.push({ sec: sec, kind: 'yellow' });
      }
    }
    return { full: full, sectors: sectors, count: n };
  }

  /** 弧长区间 [frac0, frac1] 上的折线点。frac1 = 1 取路径终点，不绕回起点。 */
  function sliceArc(arc, frac0, frac1) {
    var pts = arc && arc.pts;
    var cum = arc && arc.cum;
    var total = (arc && arc.total) || 0;
    if (!pts || pts.length < 2 || total <= 0) return [];
    if (!isFinite(frac0) || frac0 < 0) frac0 = 0;
    if (!isFinite(frac1) || frac1 > 1) frac1 = 1;
    if (frac1 <= frac0) return [];
    var a = frac0 * total;
    var b = frac1 * total;
    var out = [];
    function push(p) {
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
      var last = out[out.length - 1];
      if (last && Math.abs(last.x - p.x) < 1e-4 && Math.abs(last.y - p.y) < 1e-4) return;
      out.push({ x: p.x, y: p.y });
    }
    if (frac0 <= 0) push(pts[0]);
    else push(pointOnArc(arc, frac0));
    for (var i = 1; i < pts.length - 1; i++) {
      if (cum[i] > a + 1e-4 && cum[i] < b - 1e-4) push(pts[i]);
    }
    if (frac1 >= 1) push(pts[pts.length - 1]);
    else push(pointOnArc(arc, frac1));
    return out;
  }

  function pointOnArc(arc, frac) {
    var pts = arc.pts;
    var cum = arc.cum;
    var total = arc.total || 0;
    if (!pts || pts.length < 2 || total <= 0) {
      var p0 = (pts && pts[0]) || { x: 0, y: 0 };
      return { x: p0.x, y: p0.y, tx: 1, ty: 0 };
    }
    var d = wrap01(frac) * total;
    var lo = 0;
    var hi = cum.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    var i = Math.max(1, lo);
    if (i >= pts.length) i = pts.length - 1;
    var span = cum[i] - cum[i - 1];
    var u = span > 1e-9 ? (d - cum[i - 1]) / span : 0;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    var a = pts[i - 1];
    var b = pts[i];
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      tx: b.x - a.x,
      ty: b.y - a.y
    };
  }

  function tokenizePath(d) {
    var re = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
    var out = [];
    var m;
    var s = String(d || '');
    while ((m = re.exec(s))) {
      var t = m[0];
      if (t >= 'A' && t <= 'Z' || t >= 'a' && t <= 'z') out.push(t);
      else out.push(parseFloat(t));
    }
    return out;
  }

  function addCubic(pts, x0, y0, x1, y1, x2, y2, x3, y3, steps) {
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var u = 1 - t;
      var uu = u * u;
      var tt = t * t;
      pts.push({
        x: uu * u * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + tt * t * x3,
        y: uu * u * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + tt * t * y3
      });
    }
  }

  function addArc(pts, x1, y1, rx, ry, angleDeg, large, sweep, x2, y2) {
    if (!isFinite(x2) || !isFinite(y2)) return;
    var dx0 = x2 - x1;
    var dy0 = y2 - y1;
    if (Math.abs(dx0) < 1e-6 && Math.abs(dy0) < 1e-6) return;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!(rx > 1e-6) || !(ry > 1e-6)) {
      pts.push({ x: x2, y: y2 });
      return;
    }
    var phi = (angleDeg || 0) * Math.PI / 180;
    var sinphi = Math.sin(phi);
    var cosphi = Math.cos(phi);
    var dx = dx0 / 2;
    var dy = dy0 / 2;
    var x1p = cosphi * dx + sinphi * dy;
    var y1p = -sinphi * dx + cosphi * dy;
    var rx2 = rx * rx;
    var ry2 = ry * ry;
    var x1p2 = x1p * x1p;
    var y1p2 = y1p * y1p;
    var lam = x1p2 / rx2 + y1p2 / ry2;
    if (lam > 1) {
      var sc = Math.sqrt(lam);
      rx *= sc;
      ry *= sc;
      rx2 = rx * rx;
      ry2 = ry * ry;
    }
    // SVG 实现笔记：large-arc XOR sweep 为 0 时中心偏移取负。
    var sign = (!!large === !!sweep) ? -1 : 1;
    var num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
    var den = rx2 * y1p2 + ry2 * x1p2;
    var sq = den > 0 ? num / den : 0;
    if (sq < 0) sq = 0;
    var coef = sign * Math.sqrt(sq);
    var cxp = coef * (rx * y1p / ry);
    var cyp = coef * (-ry * x1p / rx);
    var cx = cosphi * cxp - sinphi * cyp + (x1 + x2) / 2;
    var cy = sinphi * cxp + cosphi * cyp + (y1 + y2) / 2;
    function ang(ux, uy, vx, vy) {
      var dot = ux * vx + uy * vy;
      var lu = Math.sqrt(ux * ux + uy * uy);
      var lv = Math.sqrt(vx * vx + vy * vy);
      var c = (lu > 0 && lv > 0) ? dot / (lu * lv) : 1;
      if (c > 1) c = 1;
      if (c < -1) c = -1;
      var a = Math.acos(c);
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    }
    var theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dtheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
    if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
    var steps = Math.max(4, Math.ceil(Math.abs(dtheta) / (Math.PI / 10)));
    if (steps > 48) steps = 48;
    for (var i = 1; i <= steps; i++) {
      var t = theta1 + dtheta * (i / steps);
      var cosT = Math.cos(t);
      var sinT = Math.sin(t);
      pts.push({
        x: cx + cosphi * rx * cosT - sinphi * ry * sinT,
        y: cy + sinphi * rx * cosT + cosphi * ry * sinT
      });
    }
  }

  function sampleSvgPath(d, curveSteps) {
    var steps = curveSteps > 1 ? curveSteps : 5;
    var tok = tokenizePath(d);
    var pts = [];
    var i = 0;
    var x = 0;
    var y = 0;
    var sx = 0;
    var sy = 0;
    var prevCx = 0;
    var prevCy = 0;
    var prevCmd = '';
    function hasNum() { return i < tok.length && typeof tok[i] === 'number'; }
    function read() { return tok[i++]; }
    while (i < tok.length) {
      var cmd = tok[i];
      if (typeof cmd !== 'string') break;
      i++;
      var rel = cmd === cmd.toLowerCase();
      var C = cmd.toUpperCase();
      if (C === 'M') {
        if (!hasNum()) break;
        var mx = read();
        var my = read();
        if (rel) { mx += x; my += y; }
        x = mx; y = my; sx = x; sy = y;
        pts.push({ x: x, y: y });
        while (hasNum()) {
          var lx = read();
          var ly = read();
          if (rel) { lx += x; ly += y; }
          x = lx; y = ly;
          pts.push({ x: x, y: y });
        }
        prevCmd = 'L';
      } else if (C === 'L') {
        while (hasNum()) {
          var lx2 = read();
          var ly2 = read();
          if (rel) { lx2 += x; ly2 += y; }
          x = lx2; y = ly2;
          pts.push({ x: x, y: y });
        }
        prevCmd = 'L';
      } else if (C === 'H') {
        while (hasNum()) {
          var hx = read();
          if (rel) hx += x;
          x = hx;
          pts.push({ x: x, y: y });
        }
        prevCmd = 'L';
      } else if (C === 'V') {
        while (hasNum()) {
          var vy = read();
          if (rel) vy += y;
          y = vy;
          pts.push({ x: x, y: y });
        }
        prevCmd = 'L';
      } else if (C === 'C') {
        while (hasNum()) {
          var x1 = read(), y1 = read(), x2 = read(), y2 = read(), x3 = read(), y3 = read();
          if (rel) {
            x1 += x; y1 += y; x2 += x; y2 += y; x3 += x; y3 += y;
          }
          addCubic(pts, x, y, x1, y1, x2, y2, x3, y3, steps);
          prevCx = x2; prevCy = y2;
          x = x3; y = y3;
          prevCmd = 'C';
        }
      } else if (C === 'S') {
        while (hasNum()) {
          var sx2 = read(), sy2 = read(), sx3 = read(), sy3 = read();
          if (rel) { sx2 += x; sy2 += y; sx3 += x; sy3 += y; }
          var rx1 = x;
          var ry1 = y;
          if (prevCmd === 'C' || prevCmd === 'S') {
            rx1 = 2 * x - prevCx;
            ry1 = 2 * y - prevCy;
          }
          addCubic(pts, x, y, rx1, ry1, sx2, sy2, sx3, sy3, steps);
          prevCx = sx2; prevCy = sy2;
          x = sx3; y = sy3;
          prevCmd = 'S';
        }
      } else if (C === 'A') {
        while (hasNum()) {
          var arx = read(), ary = read(), aang = read(), alarge = read(), asweep = read(), ax = read(), ay = read();
          if (rel) { ax += x; ay += y; }
          addArc(pts, x, y, arx, ary, aang, !!alarge, !!asweep, ax, ay);
          x = ax; y = ay;
        }
        prevCmd = 'A';
      } else if (C === 'Z') {
        if (Math.abs(x - sx) > 1e-4 || Math.abs(y - sy) > 1e-4) pts.push({ x: sx, y: sy });
        x = sx; y = sy;
        prevCmd = 'Z';
      } else {
        break;
      }
    }
    return pts;
  }

  function longestPathD(svgText) {
    var re = /\bd="([^"]*)"/g;
    var best = '';
    var m;
    var s = String(svgText || '');
    while ((m = re.exec(s))) {
      if (m[1].length > best.length) best = m[1];
    }
    return best;
  }

  function outlineFromSvg(svgText, curveSteps) {
    return sampleSvgPath(longestPathD(svgText), curveSteps);
  }

  return {
    wrap01: wrap01,
    wrapDelta: wrapDelta,
    timeSeconds: timeSeconds,
    progressFromTiming: progressFromTiming,
    parseGap: parseGap,
    sessionUsesTimeGaps: sessionUsesTimeGaps,
    paceScale: paceScale,
    refLapSeconds: refLapSeconds,
    planField: planField,
    sampleMotion: sampleMotion,
    rebaseMotion: rebaseMotion,
    stepMotion: stepMotion,
    buildArc: buildArc,
    pointOnArc: pointOnArc,
    sliceArc: sliceArc,
    marshalFlagPlan: marshalFlagPlan,
    sampleSvgPath: sampleSvgPath,
    longestPathD: longestPathD,
    outlineFromSvg: outlineFromSvg
  };
});
