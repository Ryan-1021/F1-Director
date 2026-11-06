/*
 * node director/trackmap-layout-keepalive.test.js
 * 预设 / 重置保活估计赛道图 iframe；「刷新看板」仍强制重建。
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

var html = fs.readFileSync(path.join(__dirname, 'director.html'), 'utf8');

assert(html.indexOf('function findTrackmapPanel()') >= 0, 'findTrackmapPanel exists');
assert(html.indexOf('function applyKeptPanel(') >= 0, 'applyKeptPanel exists');
assert(html.indexOf('var oldTm = findTrackmapPanel()') >= 0, 'mountLayout looks up the current trackmap');
assert(html.indexOf('p === oldLive || p === oldTm') >= 0, 'removal loop skips live and trackmap');
assert(html.indexOf('reusedTm && raw === tmRaw') >= 0, 'reused trackmap is not createBoardPanel\'d');
assert(html.indexOf('notifyPanelContentResize(oldTm.el)') >= 0, 'kept trackmap calls relayout/refit');
assert(/btnReloadAll[\s\S]*applyBoardToPanel\([^,]+,[^,]+,\s*true\)/.test(html),
  '刷新看板 still force-recreates board iframes');
assert(html.indexOf('applyBoardToPanel(el, val)') >= 0 &&
  html.indexOf('if (!force && oldFrame && oldFrame.getAttribute(\'data-board\') === boardId)') >= 0,
  'dropdown / drag path still keeps the iframe when not forced');
assert(html.indexOf('applyGeom(st.el, st, { silentContent: true })') >= 0,
  'drag/resize still move geometry without recreating the iframe');

var start = html.indexOf('function panelTypeOf(raw)');
var end = html.indexOf('function normalizeSaved(parsed)');
assert(start >= 0 && end > start, 'mountLayout snippet markers');

function fakeEl(tag) {
  return {
    tag: tag || 'el',
    dataset: {},
    isConnected: true,
    removed: false,
    geom: null,
    relayouts: 0,
    remove: function () { this.removed = true; this.isConnected = false; }
  };
}

function harness() {
  var createdBoards = [];
  var createdLives = 0;
  var applyStreamCalls = 0;
  var ctx = {
    panels: {},
    zCounter: 10,
    createdBoards: createdBoards,
    applyGeom: function (el, st, opts) {
      el.geom = { x: st.x, y: st.y, w: st.w, h: st.h, z: st.z, opts: opts || null };
    },
    notifyPanelContentResize: function (el) {
      if (el) el.relayouts = (el.relayouts || 0) + 1;
    },
    bindPanel: function (st, el, opts) {
      st.el = el;
      ctx.panels[st.id] = st;
      el.boundOpts = opts || null;
    },
    createBoardPanel: function (st) {
      createdBoards.push(st.board);
      return fakeEl('board-' + st.board);
    },
    createLivePanel: function () {
      createdLives += 1;
      return fakeEl('live');
    },
    wireLiveControls: function () {},
    livePlaybackMatches: function () { return true; },
    applyStream: function () { applyStreamCalls += 1; },
    document: { getElementById: function () { return { value: '' }; } },
    localStorage: { getItem: function () { return ''; } }
  };
  vm.runInNewContext(html.slice(start, end), ctx);
  ctx.createdLives = function () { return createdLives; };
  ctx.applyStreamCalls = function () { return applyStreamCalls; };
  return ctx;
}

var liveEl = fakeEl('live');
var tmEl = fakeEl('trackmap');
var timingEl = fakeEl('timing');
var h = harness();
h.panels.live = { id: 'live', type: 'live', x: 10, y: 10, w: 800, h: 400, z: 20, el: liveEl };
h.panels.p2 = { id: 'p2', type: 'board', board: 'trackmap', x: 6, y: 8, w: 400, h: 280, z: 12, el: tmEl };
h.panels.p1 = { id: 'p1', type: 'board', board: 'timing', x: 6, y: 300, w: 400, h: 500, z: 11, el: timingEl };

var nextLive = { id: 'live', type: 'live', x: 40, y: 80, w: 900, h: 500, z: 30, minimized: false };
var nextTm = { id: 'p8', type: 'board', board: 'trackmap', x: 20, y: 16, w: 476, h: 240, z: 40, minimized: false };
var nextTiming = { id: 'p1', type: 'board', board: 'timing', x: 20, y: 270, w: 476, h: 600, z: 41, minimized: false };
var nextFlags = { id: 'p3', type: 'board', board: 'flags', x: 500, y: 6, w: 800, h: 68, z: 15, minimized: false };
h.mountLayout([nextLive, nextTiming, nextTm, nextFlags], { skipClamp: true });

assert(liveEl.removed === false, 'live panel stays mounted');
assert(tmEl.removed === false, 'trackmap panel stays mounted');
assert(timingEl.removed === true, 'other boards still rebuild');
assert(h.createdBoards.indexOf('trackmap') === -1, 'kept trackmap is not createBoardPanel\'d');
assert(h.createdBoards.indexOf('timing') >= 0 && h.createdBoards.indexOf('flags') >= 0,
  'timing/flags still createBoardPanel');
assert(h.createdLives() === 0, 'live is not recreated when reused');
assert(h.panels.p8 && h.panels.p8.el === tmEl, 'kept trackmap rekeyed to new id');
assert(h.panels.p2 == null, 'old trackmap id is vacated');
assert(tmEl.dataset.panelId === 'p8', 'kept trackmap dataset.panelId follows the new slot');
assert(tmEl.geom && tmEl.geom.w === 476 && tmEl.geom.h === 240 && tmEl.geom.x === 20,
  'kept trackmap geometry updates');
assert(tmEl.geom.opts && tmEl.geom.opts.skipClamp === true, 'kept trackmap uses mount opts');
assert(tmEl.relayouts >= 1, 'kept trackmap gets relayout/refit');
assert(liveEl.geom && liveEl.geom.w === 900, 'live geometry still updates');
assert(h.panels.p8.board === 'trackmap' && h.panels.p8.type === 'board', 'kept panel stays trackmap');

var drop = harness();
var dropTm = fakeEl('trackmap');
var dropLive = fakeEl('live');
drop.panels.live = { id: 'live', type: 'live', x: 1, y: 1, w: 100, h: 100, z: 5, el: dropLive };
drop.panels.p2 = { id: 'p2', type: 'board', board: 'trackmap', x: 1, y: 1, w: 100, h: 100, z: 6, el: dropTm };
drop.mountLayout([
  { id: 'live', type: 'live', x: 2, y: 2, w: 200, h: 200, z: 5, minimized: false },
  { id: 'p1', type: 'board', board: 'timing', x: 3, y: 3, w: 200, h: 200, z: 6, minimized: false }
]);
assert(dropTm.removed === true, 'trackmap is removed when the new layout has no slot');
assert(dropLive.removed === false, 'live still kept when dropping trackmap');
assert(drop.createdBoards.indexOf('trackmap') === -1, 'no fresh trackmap when layout has none');
assert(drop.createdBoards.indexOf('timing') >= 0, 'remaining boards still create');

var fresh = harness();
var freshLive = fakeEl('live');
fresh.panels.live = { id: 'live', type: 'live', x: 1, y: 1, w: 100, h: 100, z: 5, el: freshLive };
fresh.mountLayout([
  { id: 'live', type: 'live', x: 2, y: 2, w: 200, h: 200, z: 5, minimized: false },
  { id: 'p2', type: 'board', board: 'trackmap', x: 8, y: 8, w: 300, h: 200, z: 9, minimized: false }
]);
assert(fresh.createdBoards.indexOf('trackmap') >= 0, 'new trackmap slot creates a panel');
assert(freshLive.removed === false, 'live keep is unchanged when adding trackmap');
assert(fresh.panels.p2 && fresh.panels.p2.board === 'trackmap', 'fresh trackmap is bound');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('trackmap-layout-keepalive ok');
