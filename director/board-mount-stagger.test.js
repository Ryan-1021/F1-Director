/*
 * node director/board-mount-stagger.test.js
 * Cold-start board iframe stagger: timing/flags first, layout switch immediate.
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

var html = require('./test-director-sources').loadDirectorSources().bundle;

assert(html.indexOf('BOARD_MOUNT_STAGGER_MS') !== -1, 'stagger constant defined');
assert(html.indexOf('staggerBoardMounts') !== -1, 'stagger opt wired');
assert(html.indexOf('scheduleStaggeredBoardMount') !== -1, 'deferred mount helper');
assert(html.indexOf("mountLayoutForViewport(cur.panels, cur.vw, cur.vh, { staggerBoardMounts: true })") !== -1,
  'layouts.json init staggers');
assert(html.indexOf('mountLayout(defaultLayout(), { staggerBoardMounts: true })') !== -1,
  'default layout init staggers');
assert(html.indexOf('mountLayoutForViewport(snap.panels') !== -1 &&
  html.indexOf('applyLayoutSnapshot') !== -1 &&
  html.indexOf('mountLayoutForViewport(snap.panels, snap.vw || 0, snap.vh || 0)') !== -1 &&
  html.indexOf('mountLayoutForViewport(snap.panels, snap.vw || 0, snap.vh || 0, { staggerBoardMounts: true })') === -1,
  'preset apply does not stagger');

var start = html.indexOf('function boardMountStaggerTier');
var end = html.indexOf('  var BOARD_OPTS = [');
assert(start >= 0 && end > start, 'stagger helpers before stage init');

var scheduled = [];

function harness() {
  var ctx = {
    boardMountStaggerToken: 0,
    boardMountStaggerSeq: 0,
    deferredBoardMountTimers: [],
    setTimeout: function (fn, ms) {
      scheduled.push({ ms: ms, fn: fn });
      return scheduled.length;
    },
    clearTimeout: function () {},
    applyBoardToPanel: function () {}
  };
  vm.runInNewContext(html.slice(start, end), ctx);
  return ctx;
}

var h = harness();
assert(h.boardMountStaggerTier('timing') === 0, 'timing tier 0');
assert(h.boardMountStaggerTier('flags') === 1, 'flags tier 1');
assert(h.boardMountStaggerTier('trackmap') === 2, 'trackmap tier 2');

var el = { isConnected: true };
h.scheduleStaggeredBoardMount(el, 'trackmap', 48);
assert(scheduled.length === 1 && scheduled[0].ms === 48, 'deferred delay honored');

var cStart = html.indexOf('function createBoardPanel(st, mountOpts)');
var cEnd = html.indexOf('  function bindPanel(st, el, opts)');
assert(cStart >= 0 && cEnd > cStart, 'createBoardPanel snippet');

var mountSnippet = html.slice(cStart, cEnd);
assert(mountSnippet.indexOf('if (mountOpts && mountOpts.staggerBoardMounts)') !== -1,
  'createBoardPanel branches on staggerBoardMounts');
assert(mountSnippet.indexOf('boardMountStaggerTier(boardId)') !== -1,
  'createBoardPanel uses tier helper');
assert(mountSnippet.indexOf('scheduleStaggeredBoardMount(el, boardId, 0)') !== -1,
  'flags scheduled in tier 1');
assert(mountSnippet.indexOf('boardMountStaggerSeq') !== -1,
  'later boards get increasing delay');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('board-mount-stagger ok');