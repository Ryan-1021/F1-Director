/*
 * 赛道图车位估计（不是 GPS）。
 *
 * 练习 / 排位：用本圈 S1–S3 与迷你赛段得到圈进度。进度对齐赛段成绩条上
 * 已经点亮的格子（非 0 都算到达），不拿上一圈残留的赛段时间把车拉回起点。
 * 正赛 / 冲刺赛：领先者仍用赛段；其余车用相对领先者的时间差 ÷ 参考圈速。
 * 被套圈（"1 LAP"）不用时间差，改回各车自己的赛段。
 * 两次计时之间按参考圈速外推。测量 cap 沿圈只向前收（棘轮），迷你赛段
 * 闪烁不会把上限拉到已画位置后面。新采样只比画面略靠后时（差距抖动、
 * cap 仍落后于画面）按最近沿圈速度衰减滑行，不钉死、不回退。画面进度
 * （display）沿圈严格单调，用加速度限制去追测量信念（belief / PLL）：
 * 赛段或计时突然前跳时平滑加速追上，接近目标提前减速，不瞬移；
 * 小更新仍然跟得上。进站 / 停车 /
 * 换圈过线 / 大约 0.12 圈以上的后撤仍允许不连续。
 * 进站冻在进站那一刻的估计进度；绘图层不把进站车画在轮廓上，
 * 只在赛道图视口左上角放一块「P + 人数」徽章。出站后车点回到赛道上。
 * 轮廓文件的起点不一定是起跑线。已知赛道用 orientClosedOutline 把进度 0 转到计时线，
 * 其它赛道仍相对 SVG 起点。车与车的间距不受这条相位影响。
 * 比赛方向箭头（directionCue）沿同一条定向弧、在进度 0 稍后画一枚小箭头，
 * 沿外法向偏到灰线外侧，不压在描边中心。
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

  // 约 0.12 圈（90s 圈速大约 11s）以内的回退，当成外推超前或采样抖动，不往回拽。
  var HOLD_BACK = 0.12;
  // 测量略落后时：用最近沿圈速度的一部分往前滑，再衰减到最低爬行。
  var COAST_START = 0.38;
  var COAST_TAU_MS = 900;
  var COAST_MIN = 0.12;
  var COAST_STEP_MAX = 0.0035;
  // Scheme 3：画面追 belief。墨西哥那种 0.08–0.12 圈前跳用 13× 圈速大约
  // 1.0–1.4s 追上。KP 放软，误差降到 ~0.03 圈就开始从 vmax 减速，避免
  // 旧的 8× 巡航后单帧掉回 1×（看起来「一顿一顿」）。加速上限加高，
  // 起速不要挖那么久。单帧（16ms）在 13× 下约 0.002 圈，仍远低于瞬移。
  // 小更新（0.01 圈）大约 0.4s 内跟上。
  // 额外速度（圈/秒）= CHASE_KP × 误差（圈），再被 VMAX 卡住。
  var CHASE_KP = 5;
  // 追赶最高速度：圈速的倍数。13× ≈ 90s 圈里 7s 跑完一圈的距离。
  var CHASE_VMAX_X = 13;
  // 加速度：每秒最多加上这么多倍圈速。45 → 从 1× 到 13× 大约 0.27s，
  // 也够从 13× 在 KP 放软后的剩余误差里减速落地。
  var CHASE_ACCEL_X = 45;
  // 小于这点误差直接咬住 belief，避免最后一截来回蹭。
  var CHASE_SNAP = 0.0008;
  // 积分步长。单次 sample 可能跨整秒（测试 / 切后台），必须拆开，
  // 否则 13× × 3s 会一次跳 ~0.43 圈。
  var CHASE_DT_MS = 12;

  /**
   * 沿圈取更靠前的 cap。newCap 略落后时保住 previous；
   * 越过 HOLD_BACK 的后撤、冲线换圈、进站等 reset 时才允许降低。
   */
  function ratchetCap(previous, next, reset) {
    if (next == null || !isFinite(next)) return previous;
    next = wrap01(next);
    if (reset || previous == null || !isFinite(previous)) return next;
    var d = wrapDelta(next - previous);
    if (d >= -1e-9 || d <= -HOLD_BACK) return next;
    return wrap01(previous);
  }

  function applyMeasuredCap(st, cap, allowLower) {
    if (allowLower) {
      st.cap = (cap == null || !isFinite(cap)) ? cap : wrap01(cap);
      return;
    }
    if (cap == null || !isFinite(cap)) return;
    st.cap = ratchetCap(st.cap, cap, false);
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

  /** 和赛段成绩条同一套：非 0 都画出来（2048 黄 / 2049 绿 / 2051 紫，其余暗色）。 */
  function segmentReached(status) {
    return ((status | 0) !== 0);
  }

  function sectorMini(segments) {
    var segs = segments || [];
    var done = 0;
    for (var i = 0; i < segs.length; i++) {
      if (!segmentReached(segs[i])) break;
      done++;
    }
    var allLit = segs.length > 0 && done === segs.length;
    return {
      len: segs.length,
      done: done,
      allLit: allLit,
      partial: done > 0 && !allLit
    };
  }

  /**
   * 本车自己的圈进度，和迷你赛段条上「从左点亮到哪一格」对齐。
   * 正在点亮的那一段优先：上一圈留下的赛段时间不能把车判成已冲线。
   * exact=false 表示只知道「至少已经到这个赛段起点」，绘图不该把车拉回去
   * （迷你赛段状态会褪成 0）。
   */
  /**
   * 赛段在一圈上的弧长比例。不传 ends 时三等分。
   * ends 是 [S1 终点, S2 终点]，相对计时线，0–1。
   */
  function sectorEndsOf(ends) {
    if (!ends || ends.length < 2) return null;
    var a = Number(ends[0]);
    var b = Number(ends[1]);
    if (!(a > 0.02 && a < b && b < 0.98)) return null;
    return [a, b];
  }

  function sectorFrac(index, inner, ends) {
    var e = sectorEndsOf(ends);
    var marks = e ? [0, e[0], e[1], 1] : [0, 1 / 3, 2 / 3, 1];
    var i = index | 0;
    if (i < 0) i = 0;
    if (i > 2) i = 2;
    var t = Number(inner);
    if (!isFinite(t) || t < 0) t = 0;
    if (t > 1) t = 1;
    return marks[i] + (marks[i + 1] - marks[i]) * t;
  }

  function progressFromTiming(car, sectorEnds) {
    var sectors = readSectors(car || {});
    var info = [];
    var i;
    for (i = 0; i < 3; i++) info.push(sectorMini(sectors[i].segments));

    var current = -1;
    for (i = 0; i < 3; i++) {
      if (info[i].partial) { current = i; break; }
    }

    if (current < 0) {
      current = 0;
      for (i = 0; i < 3; i++) {
        if (info[i].allLit) {
          current = i + 1;
          continue;
        }
        if (!sectorHasTime(sectors[i].value)) break;
        // 有时间但灯是灭的。前一段若还全亮，说明这段刚被清掉，旧时间不能当成已走完。
        if (i > 0 && info[i - 1].allLit) break;
        current = i + 1;
      }
    }

    if (current >= 3) {
      var allFull = info[0].allLit && info[1].allLit && info[2].allLit;
      var noStrips = (info[0].len + info[1].len + info[2].len) === 0;
      if (allFull || noStrips) {
        return { frac: 0.01, cap: 0.1, sector: 0, confident: true, exact: true, doneSegs: 0, freshLap: true };
      }
      return {
        frac: 0.02, cap: 0.12, sector: 0,
        confident: true, exact: false, doneSegs: 0, freshLap: false
      };
    }

    var mini = info[current];
    var done = mini.done;
    var inner;
    var capInner;
    var exact = false;
    if (mini.len && done > 0) {
      // 点亮前缀的右边界：条上亮了几格，车就在这一段的同样比例处。
      inner = done / mini.len;
      capInner = Math.min(0.99, inner + (1 / mini.len) * 0.35);
      exact = true;
    } else if (current > 0) {
      inner = 0.03;
      capInner = mini.len ? Math.max(0.2, 1.15 / mini.len) : 0.92;
      exact = false;
    } else {
      inner = 0.02;
      capInner = mini.len ? Math.max(0.18, 1 / mini.len) : 0.9;
      exact = false;
    }
    if (inner < 0) inner = 0;
    if (inner > 0.98) inner = 0.98;
    if (capInner < inner) capInner = Math.min(0.99, inner + 0.04);
    var anyTime = false;
    for (i = 0; i < 3; i++) {
      if (sectorHasTime(sectors[i].value)) anyTime = true;
    }
    return {
      frac: sectorFrac(current, inner, sectorEnds),
      cap: sectorFrac(current, Math.min(0.99, capInner), sectorEnds),
      sector: current,
      confident: current > 0 || done > 0 || anyTime,
      exact: exact,
      doneSegs: done,
      freshLap: false
    };
  }

  /** 用本车上一圈（否则最快圈）相对参考圈速的比例，避免按全场最快圈把点跑到迷你赛段前面。 */
  function ownLapScale(car, refSeconds) {
    var c = car || {};
    var laps = [c.lastLap, c.lastLapTime, c.LastLapTime, c.bestLap];
    var sec = NaN;
    for (var i = 0; i < laps.length; i++) {
      var t = timeSeconds(laps[i]);
      if (t > 50 && t < 220) { sec = t; break; }
    }
    if (!(sec > 50) || !(refSeconds > 40)) return 1;
    var scale = sec / refSeconds;
    if (scale < 0.85) scale = 0.85;
    if (scale > 1.5) scale = 1.5;
    return scale;
  }

  /**
   * 箭头中心相对赛道中线的外法向像素。半条描边到灰线外沿，再留 2px 空隙，
   * 再让约半个箭头宽落在线外，整枚三角贴在轮廓旁边而不是压在线上。
   */
  function directionOutset(strokeW, width) {
    var lw = Number(strokeW);
    if (!(lw > 0)) lw = 8;
    var w = Number(width);
    if (!(w > 0)) w = 6.4;
    var out = lw * 0.5 + 2 + w * 0.48;
    if (out < 6) out = 6;
    if (out > 14) out = 14;
    return out;
  }

  /**
   * 比赛方向箭头。origin / tx / ty 与 finishGrid 一样，用 mapper 之后的屏幕坐标。
   * 等腰三角沿切线指向比赛方向，中心压在 origin 上。
   */
  function directionArrow(origin, tx, ty, length, width) {
    var ox = origin && isFinite(origin.x) ? origin.x : 0;
    var oy = origin && isFinite(origin.y) ? origin.y : 0;
    var t = unit2(Number(tx) || 0, Number(ty) || 0);
    var nx = -t.y;
    var ny = t.x;
    length = Number(length);
    if (!(length > 0)) length = 8;
    width = Number(width);
    if (!(width > 0)) width = 6.2;
    var tip = {
      x: ox + t.x * length * 0.58,
      y: oy + t.y * length * 0.58
    };
    var bx = ox - t.x * length * 0.42;
    var by = oy - t.y * length * 0.42;
    var hw = width / 2;
    return {
      tip: tip,
      pts: [
        tip,
        { x: bx + nx * hw, y: by + ny * hw },
        { x: bx - nx * hw, y: by - ny * hw }
      ]
    };
  }

  /**
   * 沿定向弧从进度 0 往前走，找到与起终点拉开 minDist 屏幕像素的落点，
   * 再沿外法向（背向质心）偏出灰线。箭头跟着 CIRCUIT_PHASE 的 offset/reverse，
   * 不另做一套方向。
   */
  function directionCue(arc, mapPoint, opts) {
    opts = opts || {};
    var minDist = Number(opts.minDist);
    if (!(minDist > 0)) minDist = 16;
    var maxFrac = Number(opts.maxFrac);
    if (!(maxFrac > 0)) maxFrac = 0.055;
    if (maxFrac > 0.2) maxFrac = 0.2;
    var length = Number(opts.length);
    if (!(length > 0)) length = 8.4;
    var width = Number(opts.width);
    if (!(width > 0)) width = 6.4;
    var strokeW = Number(opts.strokeW);
    var outset = Number(opts.outset);
    if (!(outset >= 0)) {
      outset = strokeW > 0 ? directionOutset(strokeW, width) : 0;
    }
    if (!arc || typeof mapPoint !== 'function' || !(arc.total > 0)) return null;
    var p0 = pointOnArc(arc, 0);
    var s0 = mapPoint(p0.x, p0.y);
    if (!s0 || !isFinite(s0.x) || !isFinite(s0.y)) return null;

    function screenAt(frac) {
      var p = pointOnArc(arc, frac);
      var s = mapPoint(p.x, p.y);
      if (!s || !isFinite(s.x) || !isFinite(s.y)) return null;
      var ahead = mapPoint(p.x + p.tx, p.y + p.ty);
      return {
        frac: frac,
        origin: s,
        tx: ahead && isFinite(ahead.x) ? ahead.x - s.x : p.tx,
        ty: ahead && isFinite(ahead.y) ? ahead.y - s.y : p.ty
      };
    }

    function along(frac) {
      var n = 10;
      var acc = 0;
      var prev = s0;
      for (var i = 1; i <= n; i++) {
        var hit = screenAt(frac * i / n);
        if (!hit) continue;
        acc += Math.hypot(hit.origin.x - prev.x, hit.origin.y - prev.y);
        prev = hit.origin;
      }
      return acc;
    }

    var lo = 0.003;
    var hi = maxFrac;
    var frac = hi;
    var far = along(hi);
    if (far < minDist * 0.55) {
      frac = hi;
    } else {
      for (var i = 0; i < 16; i++) {
        var mid = (lo + hi) / 2;
        if (along(mid) < minDist) lo = mid;
        else {
          frac = mid;
          hi = mid;
        }
      }
    }
    if (frac < 0.004) frac = 0.004;
    if (frac > maxFrac) frac = maxFrac;
    var placed = screenAt(frac);
    if (!placed) return null;
    var centroid = opts.centroid;
    if (!centroid || !isFinite(centroid.x) || !isFinite(centroid.y)) {
      var pts = arc.pts || [];
      var sx = 0;
      var sy = 0;
      var n = 0;
      var i;
      for (i = 0; i < pts.length; i++) {
        var mapped = mapPoint(pts[i].x, pts[i].y);
        if (!mapped || !isFinite(mapped.x) || !isFinite(mapped.y)) continue;
        sx += mapped.x;
        sy += mapped.y;
        n++;
      }
      if (n >= 3) centroid = { x: sx / n, y: sy / n };
    }
    var onTrack = placed.origin;
    var origin = onTrack;
    var outward = { x: 0, y: 0 };
    if (outset > 0) {
      var inn = inwardNormal(placed.tx, placed.ty, onTrack, centroid);
      outward = { x: -inn.x, y: -inn.y };
      origin = {
        x: onTrack.x + outward.x * outset,
        y: onTrack.y + outward.y * outset
      };
    }
    var arrow = directionArrow(origin, placed.tx, placed.ty, length, width);
    return {
      frac: frac,
      origin: origin,
      onTrack: onTrack,
      outward: outward,
      outset: outset,
      tx: placed.tx,
      ty: placed.ty,
      tip: arrow.tip,
      pts: arrow.pts,
      length: length,
      width: width,
      minDist: minDist
    };
  }

  /**
   * 起终点方格。origin 与切向 tx/ty 用和轮廓相同的屏幕坐标（mapper 之后）。
   * 格子沿法线横跨赛道、沿切线两排，中心压在进度 0 上。
   */
  function finishGrid(origin, tx, ty, cell, cols, rows) {
    var ox = origin && isFinite(origin.x) ? origin.x : 0;
    var oy = origin && isFinite(origin.y) ? origin.y : 0;
    var vx = Number(tx) || 0;
    var vy = Number(ty) || 0;
    var vlen = Math.sqrt(vx * vx + vy * vy);
    if (!(vlen > 1e-6)) { vx = 1; vy = 0; vlen = 1; }
    vx /= vlen;
    vy /= vlen;
    var nx = -vy;
    var ny = vx;
    cols = cols | 0;
    rows = rows | 0;
    if (cols < 2) cols = 2;
    if (cols > 8) cols = 8;
    if (rows < 1) rows = 1;
    if (rows > 3) rows = 3;
    cell = Number(cell);
    if (!(cell > 0)) cell = 3;
    var squares = [];
    var u0 = -cols * cell / 2;
    var v0 = -rows * cell / 2;
    function at(u, v) {
      return {
        x: ox + nx * u + vx * v,
        y: oy + ny * u + vy * v
      };
    }
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var uA = u0 + c * cell;
        var uB = uA + cell;
        var vA = v0 + r * cell;
        var vB = vA + cell;
        squares.push({
          light: (r + c) % 2 === 0,
          pts: [at(uA, vA), at(uB, vA), at(uB, vB), at(uA, vB)]
        });
      }
    }
    return squares;
  }

  function packOffset(slot, pit) {
    var n = pit ? 14 : 0;
    var t = 0;
    var s = slot | 0;
    if (s < 0) s = 0;
    if (s > 12) s = 12;
    if (s > 0) {
      var col = s > 2 ? 2 : s;
      var row = s > 2 ? 1 : 0;
      t = col * 11;
      n += row * 11;
    }
    if (!pit && n > 14) n = 14;
    if (pit && n > 28) n = 28;
    if (t > 22) t = 22;
    return { n: n, t: t };
  }

  function unit2(x, y) {
    var len = Math.sqrt(x * x + y * y);
    if (!(len > 1e-9)) return { x: 1, y: 0 };
    return { x: x / len, y: y / len };
  }

  /** 指向质心的单位法向（赛道内侧）。tx/ty 是切向。 */
  function inwardNormal(tx, ty, origin, centroid) {
    var t = unit2(Number(tx) || 0, Number(ty) || 0);
    var nx = -t.y;
    var ny = t.x;
    var ox = origin && isFinite(origin.x) ? origin.x : 0;
    var oy = origin && isFinite(origin.y) ? origin.y : 0;
    if (centroid && isFinite(centroid.x) && isFinite(centroid.y)) {
      if ((centroid.x - ox) * nx + (centroid.y - oy) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
    }
    return { x: nx, y: ny, tx: t.x, ty: t.y };
  }

  function distPointToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) {
      dx = px - ax;
      dy = py - ay;
      return Math.sqrt(dx * dx + dy * dy);
    }
    var u = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    dx = px - (ax + dx * u);
    dy = py - (ay + dy * u);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function minDistPointToPolyline(px, py, pts) {
    if (!pts || !pts.length) return Infinity;
    if (pts.length === 1) {
      var dx0 = px - pts[0].x;
      var dy0 = py - pts[0].y;
      return Math.sqrt(dx0 * dx0 + dy0 * dy0);
    }
    var min = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var d = distPointToSeg(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      if (d < min) min = d;
    }
    return min;
  }

  function pointInRect(px, py, r) {
    return px >= r.x && py >= r.y && px <= r.x + r.w && py <= r.y + r.h;
  }

  function distPointToRect(px, py, r) {
    if (pointInRect(px, py, r)) {
      var dx = Math.min(px - r.x, r.x + r.w - px);
      var dy = Math.min(py - r.y, r.y + r.h - py);
      return -Math.min(dx, dy);
    }
    var cx = Math.max(r.x, Math.min(px, r.x + r.w));
    var cy = Math.max(r.y, Math.min(py, r.y + r.h));
    return Math.hypot(px - cx, py - cy);
  }

  function segHitsSeg(ax, ay, bx, by, cx, cy, dx, dy) {
    var d1x = bx - ax;
    var d1y = by - ay;
    var d2x = dx - cx;
    var d2y = dy - cy;
    var cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-12) return false;
    var t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
    var u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  function segHitsRect(ax, ay, bx, by, r) {
    if (pointInRect(ax, ay, r) || pointInRect(bx, by, r)) return true;
    return segHitsSeg(ax, ay, bx, by, r.x, r.y, r.x + r.w, r.y) ||
      segHitsSeg(ax, ay, bx, by, r.x + r.w, r.y, r.x + r.w, r.y + r.h) ||
      segHitsSeg(ax, ay, bx, by, r.x + r.w, r.y + r.h, r.x, r.y + r.h) ||
      segHitsSeg(ax, ay, bx, by, r.x, r.y + r.h, r.x, r.y);
  }

  /**
   * 轴对齐矩形到折线的最短距离。相交为 0，矩形盖住折线时为负。
   * 用四角、边中点、折线顶点，以及线段是否穿矩形来估。
   */
  function minDistRectToPolyline(rect, pts) {
    if (!rect || !pts || !pts.length) return Infinity;
    var min = Infinity;
    var probes = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
      { x: rect.x + rect.w / 2, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
      { x: rect.x + rect.w / 2, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h / 2 }
    ];
    var i;
    for (i = 0; i < probes.length; i++) {
      var d = minDistPointToPolyline(probes[i].x, probes[i].y, pts);
      if (d < min) min = d;
    }
    for (i = 0; i < pts.length; i++) {
      var pr = distPointToRect(pts[i].x, pts[i].y, rect);
      if (pr < min) min = pr;
    }
    for (i = 1; i < pts.length; i++) {
      if (segHitsRect(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, rect)) {
        return Math.min(min, 0);
      }
    }
    return min;
  }

  /**
   * 紧凑「P + 人数」徽章尺寸。人数只影响数字位数，不再为每辆车开格子。
   * 随 zoom 略放大，默认 1.05 仍能读。
   */
  function pitBaySize(carCount, zoom, compact) {
    var n = carCount | 0;
    if (n < 0) n = 0;
    if (n > 99) n = 99;
    var z = Number(zoom);
    if (!(z > 0)) z = 1;
    var badge = Math.max(12, Math.min(18, 12 + z * 3.2));
    var pad = Math.max(3, Math.min(6, 3 + z * 0.8));
    var gap = Math.max(3, Math.min(5, 3 + z * 0.6));
    var digits = n >= 10 ? 2 : 1;
    var countW = Math.max(10, Math.min(16, 10 + z * 3)) * (digits === 2 ? 1.55 : 1);
    if (compact > 1) {
      badge = Math.max(10, badge * 0.78);
      pad = 2;
      gap = 2;
      countW = Math.max(8, countW * 0.82);
    } else if (compact) {
      badge = Math.max(11, badge * 0.88);
      pad = Math.max(2, pad - 1);
      gap = Math.max(2, gap - 1);
      countW = Math.max(9, countW * 0.9);
    }
    var width = pad + badge + gap + countW + pad;
    var height = pad + badge + pad;
    return {
      n: n, digits: digits,
      badge: badge, pad: pad, gap: gap, countW: countW,
      width: width, height: height
    };
  }

  var PIT_BAY_INSET = 8;
  var PIT_BAY_TIP = '进站中的车数（退赛/淘汰不计）';

  function clampBayOrigin(x, y, w, h, viewW, viewH, margin) {
    var m = margin > 0 ? margin : 8;
    var vw = viewW > w + m * 2 ? viewW : (w + m * 2);
    var vh = viewH > h + m * 2 ? viewH : (h + m * 2);
    if (x < m) x = m;
    if (y < m) y = m;
    if (x + w > vw - m) x = vw - m - w;
    if (y + h > vh - m) y = vh - m - h;
    return { x: x, y: y };
  }

  /**
   * 屏幕坐标：P 徽章钉在赛道图视口左上角（面板 UI 角，不是按赛道搜空位）。
   * 默认离开边缘 PIT_BAY_INSET；若 AABB 仍压到灰线描边（间隙 < 半线宽），
   * 只把同一角的边距略加大，不回到内侧/网格搜索。
   */
  function placePitBay(opts) {
    opts = opts || {};
    var strokeW = Number(opts.strokeW);
    if (!(strokeW > 0)) strokeW = 8;
    var minClear = strokeW / 2;
    var outline = opts.outline || [];
    var viewW = Number(opts.viewW);
    var viewH = Number(opts.viewH);
    if (!(viewW > 0)) viewW = 320;
    if (!(viewH > 0)) viewH = 240;
    var size = pitBaySize(opts.carCount, opts.zoom, 0);
    var baseInset = Number(opts.inset);
    if (!(baseInset >= 0)) baseInset = PIT_BAY_INSET;

    function atInset(m) {
      var origin = clampBayOrigin(m, m, size.width, size.height, viewW, viewH, Math.min(m, 4));
      var rect = { x: origin.x, y: origin.y, w: size.width, h: size.height };
      var clearance = outline.length ? minDistRectToPolyline(rect, outline) : Infinity;
      return { x: origin.x, y: origin.y, rect: rect, clearance: clearance, inset: m };
    }

    var placed = atInset(baseInset);
    if (outline.length && placed.clearance < minClear) {
      var extra;
      for (extra = 2; extra <= 20; extra += 2) {
        var cand = atInset(baseInset + extra);
        if (cand.clearance > placed.clearance) placed = cand;
        if (placed.clearance >= minClear) break;
      }
    }

    var badgeX = placed.x + size.pad + size.badge / 2;
    var midY = placed.y + size.height / 2;
    return {
      x: placed.x,
      y: placed.y,
      width: size.width,
      height: size.height,
      count: size.n,
      badge: {
        x: badgeX,
        y: midY,
        r: size.badge / 2
      },
      countPos: {
        x: placed.x + size.pad + size.badge + size.gap + size.countW / 2,
        y: midY
      },
      clearance: placed.clearance,
      minClear: minClear,
      inset: placed.inset,
      corner: 'top-left',
      tip: PIT_BAY_TIP
    };
  }

  /**
   * 画面分组：进站车只计入人数，不进轮廓。出站 / 在跑的车回轮廓。
   */
  function pitLanePaint(cars) {
    var list = cars || [];
    var onTrack = [];
    var inPit = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.hide) continue;
      if (c.pit) inPit.push(c);
      else onTrack.push(c);
    }
    return {
      pitCount: inPit.length,
      onTrack: onTrack,
      inPit: inPit,
      showBay: inPit.length > 0
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

  function planField(cars, sessionName, statusText, sectorEnds) {
    var list = cars || [];
    var raceGaps = sessionUsesTimeGaps(sessionName);
    var lapSeconds = refLapSeconds(list);
    var pace = paceScale(statusText);
    var leader = findLeader(list);
    var leaderProg = leader ? progressFromTiming(leader, sectorEnds) : null;
    var leaderNum = leader ? carNumber(leader) : '';
    var planned = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var num = carNumber(c);
      var prog = progressFromTiming(c, sectorEnds);
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
        mode: mode,
        lapScale: ownLapScale(c, lapSeconds),
        freshLap: !!prog.freshLap
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
      seen: now,
      display: frac,
      belief: frac,
      cap: null,
      lastTarget: frac,
      pit: false,
      hold: false,
      hide: false,
      lapScale: 1,
      easeFrom: null,
      easeTo: null,
      easeStart: 0,
      easeMs: 0,
      vel: 0,
      trackSpeed: 0,
      coastSpeed: 0,
      coasting: false
    };
  }

  /** 这一拍的测量信念：锚点按圈速外推，再夹到棘轮 cap（含少量 bleed）。 */
  function beliefOf(st, now, lapMs) {
    var scale = st.lapScale > 0 ? st.lapScale : 1;
    var ms = (lapMs > 1 ? lapMs : 90000) * scale;
    var adv = Math.max(0, now - st.at) / ms;
    if (st.cap != null && isFinite(st.cap)) {
      var room = wrap01(st.cap - st.anchor);
      if (room > 0.98) room = 0;
      else if (room > 0.5) room = null;
      if (room != null && adv > room) {
        if (room === 0) adv = 0;
        else {
          // 靠近上限时减速，不要在迷你赛段之间突然钉死。
          var bleed = (adv - room) * 0.22;
          if (bleed > 0.006) bleed = 0.006;
          adv = room + bleed;
        }
      }
    }
    return wrap01(st.anchor + adv);
  }

  /**
   * 画面沿圈追 belief：只向前（过起终点按短弧绕），加速度和最高速度封顶。
   * dt 可能是整秒（测试一次采样 / 页签回前台），按 CHASE_DT_MS 拆开积。
   */
  function chaseToward(st, belief, dt, fullSpeed) {
    var shown = (st.display != null && isFinite(st.display)) ? st.display : belief;
    if (!(st.vel > 0) && !st.coasting) st.vel = fullSpeed;
    var err0 = wrapDelta(belief - shown);
    if (err0 < -0.0005 && err0 > -HOLD_BACK) {
      if (!st.coasting) {
        var recent = st.trackSpeed > 0 ? st.trackSpeed : (st.vel > 0 ? st.vel : fullSpeed);
        if (recent > fullSpeed) recent = fullSpeed;
        st.coastSpeed = recent * COAST_START;
        st.coasting = true;
      }
    } else if (err0 >= -0.0005) {
      st.coasting = false;
    }
    st.belief = belief;
    if (!(dt > 0)) return shown;

    var vmax = fullSpeed * CHASE_VMAX_X;
    var aMax = fullSpeed * (CHASE_ACCEL_X / 1000);
    var kp = CHASE_KP / 1000;
    var t = 0;
    while (t < dt) {
      var h = dt - t;
      if (h > CHASE_DT_MS) h = CHASE_DT_MS;
      t += h;
      var err = wrapDelta(belief - shown);
      if (err <= -HOLD_BACK) {
        // 大后撤不走 chase（换圈误判 / 重置）：允许一次不连续，交给 ease 或直接落到 belief。
        shown = belief;
        st.vel = 0;
        st.coasting = false;
        st.coastSpeed = 0;
        break;
      }
      if (err >= 0 && err <= CHASE_SNAP) {
        shown = belief;
        st.vel = fullSpeed;
        st.coasting = false;
        st.coastSpeed = 0;
        break;
      }
      var desired;
      if (err < -0.0005 && err > -HOLD_BACK) {
        if (!st.coasting) {
          var seed = st.trackSpeed > 0 ? st.trackSpeed : (st.vel > 0 ? st.vel : fullSpeed);
          if (seed > fullSpeed) seed = fullSpeed;
          st.coastSpeed = seed * COAST_START;
          st.coasting = true;
        }
        desired = st.coastSpeed;
        st.coastSpeed = Math.max(st.coastSpeed * Math.exp(-h / COAST_TAU_MS), fullSpeed * COAST_MIN);
      } else {
        st.coasting = false;
        desired = fullSpeed + kp * Math.max(0, err);
        if (desired > vmax) desired = vmax;
        if (desired < 0) desired = 0;
      }
      var vel = st.vel;
      if (!(vel > 0) && !st.coasting) vel = fullSpeed;
      var dv = desired - vel;
      var maxDv = aMax * h;
      if (dv > maxDv) dv = maxDv;
      if (dv < -maxDv) dv = -maxDv;
      vel += dv;
      if (vel < 0) vel = 0;
      if (err >= 0 && vel > vmax) vel = vmax;
      var step = vel * h;
      if (st.coasting && step > COAST_STEP_MAX) step = COAST_STEP_MAX;
      if (err >= 0) {
        if (step > err) {
          step = err;
          vel = fullSpeed;
        }
      } else {
        var maxLead = HOLD_BACK - 0.002;
        var proposed = wrap01(shown + Math.max(0, step));
        if (wrapDelta(proposed - belief) > maxLead) {
          step = wrapDelta(wrap01(belief + maxLead) - shown);
          if (step < 0) step = 0;
        }
      }
      if (step < 0) step = 0;
      shown = wrap01(shown + step);
      st.vel = vel;
    }
    if (st.vel > fullSpeed) st.trackSpeed = fullSpeed;
    else if (st.vel > 0) st.trackSpeed = st.vel;
    else if (!(st.trackSpeed > 0)) st.trackSpeed = fullSpeed;
    st.belief = belief;
    return shown;
  }

  function sampleMotion(st, now, lapMs, frozen) {
    if (!st) return 0;
    var lastSeen = st.seen != null && isFinite(st.seen) ? st.seen : st.at;
    var frameDt = Math.max(0, now - lastSeen);
    st.seen = now;
    if (st.easeTo != null) {
      var dur = st.easeMs > 0 ? st.easeMs : 1;
      var u = (now - st.easeStart) / dur;
      if (u < 1) {
        if (u < 0) u = 0;
        var s = u * u * (3 - 2 * u);
        var d = wrapDelta(st.easeTo - st.easeFrom);
        var eased = wrap01(st.easeFrom + d * s);
        st.display = eased;
        st.belief = st.easeTo;
        st.coasting = false;
        st.vel = 0;
        return eased;
      }
      st.display = st.easeTo;
      st.anchor = st.easeTo;
      st.belief = st.easeTo;
      st.at = now;
      st.easeTo = null;
      st.easeFrom = null;
      st.coasting = false;
      st.vel = 0;
    }
    if (frozen || st.hold || st.pit || st.hide) {
      st.display = st.anchor;
      st.belief = st.anchor;
      st.coasting = false;
      st.coastSpeed = 0;
      st.vel = 0;
      return st.anchor;
    }
    var scale = st.lapScale > 0 ? st.lapScale : 1;
    var ms = (lapMs > 1 ? lapMs : 90000) * scale;
    var fullSpeed = 1 / ms;
    var belief = beliefOf(st, now, lapMs);
    var next = chaseToward(st, belief, frameDt, fullSpeed);
    st.display = next;
    return next;
  }

  function rebaseMotion(st, shown, now) {
    st.anchor = shown;
    st.display = shown;
    st.belief = shown;
    st.at = now;
    st.seen = now;
    st.easeTo = null;
    st.easeFrom = null;
    st.coasting = false;
    st.coastSpeed = 0;
    st.vel = 0;
    return st;
  }

  function pointTarget(st, target, cap, now, lapMs, frozen, flags) {
    var shown = sampleMotion(st, now, lapMs, frozen);
    var modeChanged = !!st.pit !== !!flags.pit || !!st.hold !== !!flags.hold;
    var targetMoved = st.lastTarget == null || Math.abs(wrapDelta(target - st.lastTarget)) > 0.0005;
    var err = wrapDelta(target - shown);
    // 已经滑过点亮边界的不要为了对齐往回拽。
    // 差了一大截（换圈、数据跳变）仍然沿短弧收回。前跳交给 chase，不 ease。
    var bigRewind = err < -HOLD_BACK;
    if (modeChanged || (targetMoved && bigRewind)) {
      st.easeFrom = shown;
      st.easeTo = target;
      st.easeStart = now;
      var gap = Math.abs(err);
      st.easeMs = flags.pit ? 420 : (gap > HOLD_BACK ? 700 : (gap > 0.05 ? 520 : 360));
      st.anchor = target;
      st.at = now;
      st.display = shown;
      st.belief = target;
      st.coasting = false;
      st.vel = 0;
    } else if (targetMoved && err > 0.0008) {
      st.anchor = target;
      st.at = now;
      st.display = shown;
      st.belief = target;
      st.coasting = false;
    }
    applyMeasuredCap(st, cap, bigRewind || modeChanged);
    st.lastTarget = target;
    return st;
  }

  /**
   * 把一帧计时测量揉进运动状态。目标没变时不重置时钟，车会沿圈继续走。
   * 进站：冻在当前进度（绘图层只计入 P 区人数，不画点），不要滑到轮廓起点。
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
      st.lapScale = flags.outlap && !flags.exact ? 1.75 : (flags.lapScale > 0.5 ? flags.lapScale : 1);
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
    var nextScale = flags.outlap && !flags.exact ? 1.75 : (flags.lapScale > 0.5 ? flags.lapScale : 1);
    if (st.lapScale > 0 && Math.abs(nextScale - st.lapScale) / st.lapScale > 0.05) {
      var shownScale = sampleMotion(st, now, lapMs, frozen);
      rebaseMotion(st, shownScale, now);
    }
    st.lapScale = nextScale;

    // 三赛段全亮时进度会落到起点。车若还在半圈上，多半是后两段留着上一圈的颜色，不要拉回去。
    if (flags.freshLap) {
      var shownLap = sampleMotion(st, now, lapMs, frozen);
      if (shownLap > 0.15 && shownLap < 0.88) {
        st.cap = wrap01(shownLap + 0.03);
        return st;
      }
    }

    if (!flags.exact) {
      var shown = sampleMotion(st, now, lapMs, frozen);
      var behind = wrapDelta(target - shown);
      if (behind > 0.02 && behind < 0.5 && st.easeTo == null) {
        // 下限抬高：belief 前移，画面仍走加速度限制，不 420ms ease 瞬移。
        var raised = wrap01(shown + behind * 0.85);
        st.anchor = raised;
        st.at = now;
        st.display = shown;
        st.belief = raised;
        st.coasting = false;
      }
      applyMeasuredCap(st, cap, false);
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

  function ptDist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function loopClosed(pts) {
    return !!(pts && pts.length > 2 && ptDist(pts[0], pts[pts.length - 1]) < 1e-3);
  }

  /** 闭合折线掉头，起点不变。offset 在掉头之后再量。 */
  function reverseClosed(pts) {
    var closed = loopClosed(pts);
    var work = (closed ? pts.slice(0, -1) : pts.slice());
    if (work.length < 2) return pts.slice();
    var start = { x: work[0].x, y: work[0].y };
    var out = [start];
    for (var i = work.length - 1; i >= 1; i--) out.push({ x: work[i].x, y: work[i].y });
    if (closed) out.push({ x: start.x, y: start.y });
    return out;
  }

  /** 把弧长比例 offset 处变成新的进度 0。闭合环会补上回到新起点的最后一点。 */
  function rotateClosed(pts, offset) {
    var closed = loopClosed(pts);
    var work = closed ? pts.slice(0, -1) : pts.slice();
    if (work.length < 3) return pts.slice();
    var cum = [0];
    var total = 0;
    for (var i = 1; i < work.length; i++) {
      total += ptDist(work[i], work[i - 1]);
      cum.push(total);
    }
    var closeLen = closed ? ptDist(work[work.length - 1], work[0]) : 0;
    var perim = total + closeLen;
    if (!(perim > 0)) return pts.slice();
    var target = offset * perim;
    if (target < 1e-6) return pts.slice();
    var seg = work.length - 1;
    var segStart = total;
    var segLen = closeLen;
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
    var out = [split];
    function push(p) {
      var last = out[out.length - 1];
      if (last && ptDist(last, p) < 1e-4) return;
      out.push({ x: p.x, y: p.y });
    }
    if (seg < work.length - 1) {
      for (var j = seg + 1; j < work.length; j++) push(work[j]);
      for (var k = 0; k <= seg; k++) push(work[k]);
    } else {
      for (var n = 0; n < work.length; n++) push(work[n]);
    }
    push(split);
    return out;
  }

  function orientClosedOutline(pts, offset, reverse) {
    if (!pts || pts.length < 4) return pts ? pts.slice() : [];
    var out = reverse ? reverseClosed(pts) : pts.slice();
    var off = Number(offset);
    if (!isFinite(off)) off = 0;
    off = off % 1;
    if (off < 0) off += 1;
    if (off < 1e-6) return out;
    return rotateClosed(out, off);
  }

  return {
    wrap01: wrap01,
    wrapDelta: wrapDelta,
    HOLD_BACK: HOLD_BACK,
    CHASE_KP: CHASE_KP,
    CHASE_VMAX_X: CHASE_VMAX_X,
    CHASE_ACCEL_X: CHASE_ACCEL_X,
    CHASE_SNAP: CHASE_SNAP,
    ratchetCap: ratchetCap,
    beliefOf: beliefOf,
    chaseToward: chaseToward,
    timeSeconds: timeSeconds,
    progressFromTiming: progressFromTiming,
    parseGap: parseGap,
    sessionUsesTimeGaps: sessionUsesTimeGaps,
    paceScale: paceScale,
    refLapSeconds: refLapSeconds,
    planField: planField,
    ownLapScale: ownLapScale,
    packOffset: packOffset,
    inwardNormal: inwardNormal,
    minDistPointToPolyline: minDistPointToPolyline,
    minDistRectToPolyline: minDistRectToPolyline,
    pitBaySize: pitBaySize,
    placePitBay: placePitBay,
    pitBayInset: PIT_BAY_INSET,
    pitBayTip: PIT_BAY_TIP,
    pitLanePaint: pitLanePaint,
    finishGrid: finishGrid,
    directionOutset: directionOutset,
    directionArrow: directionArrow,
    directionCue: directionCue,
    sampleMotion: sampleMotion,
    rebaseMotion: rebaseMotion,
    stepMotion: stepMotion,
    buildArc: buildArc,
    pointOnArc: pointOnArc,
    sliceArc: sliceArc,
    marshalFlagPlan: marshalFlagPlan,
    sampleSvgPath: sampleSvgPath,
    longestPathD: longestPathD,
    outlineFromSvg: outlineFromSvg,
    orientClosedOutline: orientClosedOutline,
    sectorFrac: sectorFrac
  };
});
