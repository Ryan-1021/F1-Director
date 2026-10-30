/*
 * Live Timing–style rank-row swap (FLIP / translateY).
 *
 * 成绩榜 / 赛段成绩共用：名次变了时，按车号（或 TLA）认同一行，
 * 用 transform 滑到新位置，而不是按行号覆盖或整表拆掉重画。
 * 这和 jar 下发的 drop5 / drop10 / flash（闪一下 + ↓N）不是同一套效果。
 *
 * 浏览器：window.F1RankSwap
 * Node：module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.F1RankSwap = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DURATION_MS = 320;
  var EASE = 'ease';
  var MIN_DY = 0.5;

  function carKey(car) {
    if (!car) return '';
    if (car.number != null && car.number !== '') return String(car.number);
    return String(car.tla || '');
  }

  function rowKey(tr) {
    return tr ? String(tr.getAttribute('data-car') || '') : '';
  }

  function keysOfCars(cars) {
    var out = [];
    if (!cars) return out;
    for (var i = 0; i < cars.length; i++) out.push(carKey(cars[i]));
    return out;
  }

  function keysOfRows(rows) {
    var out = [];
    if (!rows) return out;
    for (var i = 0; i < rows.length; i++) out.push(rowKey(rows[i]));
    return out;
  }

  function sameOrder(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function planSwap(oldKeys, newKeys) {
    var oldIndex = Object.create(null);
    var i;
    oldKeys = oldKeys || [];
    newKeys = newKeys || [];
    for (i = 0; i < oldKeys.length; i++) {
      if (oldKeys[i]) oldIndex[oldKeys[i]] = i;
    }
    var moved = [];
    for (i = 0; i < newKeys.length; i++) {
      var k = newKeys[i];
      if (!k) continue;
      if (Object.prototype.hasOwnProperty.call(oldIndex, k) && oldIndex[k] !== i) {
        moved.push(k);
      }
    }
    return {
      same: sameOrder(oldKeys, newKeys),
      moved: moved
    };
  }

  function invertDy(firstTop, lastTop) {
    return firstTop - lastTop;
  }

  function prefersReducedMotion(matchMediaFn) {
    try {
      var mm = matchMediaFn;
      if (!mm && typeof window !== 'undefined' && window.matchMedia) {
        mm = function (q) { return window.matchMedia(q); };
      }
      if (!mm) return false;
      var m = mm('(prefers-reduced-motion: reduce)');
      return !!(m && m.matches);
    } catch (e) {
      return false;
    }
  }

  function isHeaderRow(tr) {
    return !!(tr && tr.querySelector && tr.querySelector('th'));
  }

  function headerRow(table) {
    if (!table) return null;
    var rows = table.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      if (isHeaderRow(rows[i])) return rows[i];
    }
    return null;
  }

  function dataRows(table) {
    var out = [];
    if (!table) return out;
    var rows = table.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      if (isHeaderRow(rows[i])) continue;
      if (rows[i].classList && rows[i].classList.contains('board-empty')) continue;
      out.push(rows[i]);
    }
    return out;
  }

  function rowParent(table) {
    if (!table) return null;
    if (table.tBodies && table.tBodies[0]) return table.tBodies[0];
    return table;
  }

  function indexRows(rows) {
    var map = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var k = rowKey(rows[i]);
      if (k) map[k] = rows[i];
    }
    return map;
  }

  function collectFirsts(rows) {
    var map = Object.create(null);
    if (!rows) return map;
    for (var i = 0; i < rows.length; i++) {
      var k = rowKey(rows[i]);
      if (!k) continue;
      var r = rows[i].getBoundingClientRect();
      map[k] = { top: r.top, height: r.height, index: i };
    }
    return map;
  }

  function stripeClassForIndex(dataIndex) {
    // Header is nth-child(1); first data row is even → stripe (see style.css).
    return dataIndex % 2 === 0;
  }

  function freezeStripe(rows) {
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('rank-stripe', stripeClassForIndex(i));
    }
  }

  function clearStripe(rows) {
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove('rank-stripe', 'rank-swap-up', 'rank-swap-down');
    }
  }

  function clearRowMotion(tr) {
    if (!tr) return;
    tr.style.transition = 'none';
    tr.style.transform = '';
    tr.style.zIndex = '';
    tr.classList.remove('rank-swap-up', 'rank-swap-down');
  }

  function finishRowMotion(tr) {
    if (!tr) return;
    tr.style.transition = '';
    tr.style.transform = '';
    tr.style.zIndex = '';
    tr.classList.remove('rank-swap-up', 'rank-swap-down');
  }

  function playFlip(rows, firsts, opts) {
    opts = opts || {};
    var duration = opts.durationMs != null ? opts.durationMs : DURATION_MS;
    var onDone = opts.onDone || function () {};
    var i, tr, k, first, last, dy;
    var moving = [];

    for (i = 0; i < rows.length; i++) {
      clearRowMotion(rows[i]);
    }
    if (rows.length) void rows[0].offsetHeight;

    for (i = 0; i < rows.length; i++) {
      tr = rows[i];
      k = rowKey(tr);
      first = k && firsts ? firsts[k] : null;
      if (!first) continue;
      last = tr.getBoundingClientRect();
      dy = invertDy(first.top, last.top);
      if (Math.abs(dy) < MIN_DY) continue;
      tr.style.transform = 'translateY(' + dy + 'px)';
      // dy > 0: layout is above the visual first → will slide up (overtake).
      if (dy > 0) {
        tr.classList.add('rank-swap-up');
        tr.style.zIndex = '3';
      } else {
        tr.classList.add('rank-swap-down');
        tr.style.zIndex = '2';
      }
      moving.push(tr);
    }

    if (!moving.length) {
      onDone();
      return { animated: false };
    }

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      for (var j = 0; j < moving.length; j++) {
        moving[j].removeEventListener('transitionend', onEnd);
        finishRowMotion(moving[j]);
      }
      onDone();
    }

    function onEnd(ev) {
      if (ev && ev.target !== ev.currentTarget) return;
      if (ev && ev.propertyName && ev.propertyName !== 'transform') return;
      finish();
    }

    var play = function () {
      for (var j = 0; j < moving.length; j++) {
        moving[j].style.transition = 'transform ' + duration + 'ms ' + EASE;
        moving[j].style.transform = 'translateY(0)';
        moving[j].addEventListener('transitionend', onEnd);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        requestAnimationFrame(play);
      });
    } else {
      play();
    }

    setTimeout(finish, duration + 80);
    return { animated: true, count: moving.length };
  }

  /**
   * Match rows to cars by data-car, optionally FLIP-animate order changes.
   *
   * opts.buildRow(car) -> tr
   * opts.patchRow(tr, car, { deferPlace: bool })
   * opts.applyPlace(tr, car)  // POS + place-dependent cells
   * opts.reducedMotion {bool}
   * opts.durationMs
   */
  function reconcile(table, cars, opts) {
    opts = opts || {};
    cars = cars || [];
    if (!table) return { animated: false, moved: [] };

    var buildRow = opts.buildRow;
    var patchRow = opts.patchRow;
    var applyPlace = opts.applyPlace || function () {};
    var reduce = opts.reducedMotion != null ? !!opts.reducedMotion : prefersReducedMotion();
    var duration = opts.durationMs != null ? opts.durationMs : DURATION_MS;

    var oldRows = dataRows(table);
    var oldKeys = keysOfRows(oldRows);
    var newKeys = keysOfCars(cars);
    var plan = planSwap(oldKeys, newKeys);
    var byKey = indexRows(oldRows);
    var canFlip = !reduce && oldRows.length > 0 && plan.moved.length > 0;
    var firsts = null;

    table.__rankSwapGen = (table.__rankSwapGen || 0) + 1;
    var gen = table.__rankSwapGen;

    if (canFlip) {
      firsts = collectFirsts(oldRows);
      freezeStripe(oldRows);
      table.classList.add('rank-swapping');
      for (var c = 0; c < oldRows.length; c++) {
        oldRows[c].style.transition = 'none';
      }
    } else {
      table.classList.remove('rank-swapping');
      clearStripe(oldRows);
    }

    var nextRows = [];
    var pending = [];
    var used = Object.create(null);
    var i, car, k, tr;

    for (i = 0; i < cars.length; i++) {
      car = cars[i];
      k = carKey(car);
      tr = k ? byKey[k] : null;
      if (!tr) {
        tr = buildRow(car);
      } else {
        patchRow(tr, car, { deferPlace: canFlip });
        if (canFlip) pending.push({ tr: tr, car: car });
      }
      if (k) used[k] = true;
      nextRows.push(tr);
    }

    for (k in byKey) {
      if (Object.prototype.hasOwnProperty.call(used, k)) continue;
      tr = byKey[k];
      if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
    }

    if (!plan.same) {
      var parent = rowParent(table);
      var header = headerRow(table);
      if (header) parent.appendChild(header);
      for (i = 0; i < nextRows.length; i++) parent.appendChild(nextRows[i]);
    }

    function applyAllPlace() {
      if (table.__rankSwapGen !== gen) return;
      for (var p = 0; p < pending.length; p++) applyPlace(pending[p].tr, pending[p].car);
      table.classList.remove('rank-swapping');
      clearStripe(nextRows);
    }

    if (!canFlip) {
      for (i = 0; i < nextRows.length; i++) applyPlace(nextRows[i], cars[i]);
      return { animated: false, moved: plan.moved, same: plan.same };
    }

    playFlip(nextRows, firsts, {
      durationMs: duration,
      onDone: applyAllPlace
    });
    return { animated: true, moved: plan.moved, same: false };
  }

  return {
    DURATION_MS: DURATION_MS,
    EASE: EASE,
    carKey: carKey,
    rowKey: rowKey,
    keysOfCars: keysOfCars,
    keysOfRows: keysOfRows,
    sameOrder: sameOrder,
    planSwap: planSwap,
    invertDy: invertDy,
    prefersReducedMotion: prefersReducedMotion,
    headerRow: headerRow,
    dataRows: dataRows,
    collectFirsts: collectFirsts,
    stripeClassForIndex: stripeClassForIndex,
    reconcile: reconcile,
    playFlip: playFlip
  };
});
