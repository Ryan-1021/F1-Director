/*
 * node director/layout-preset-noop.test.js
 * Re-clicking a preset that already matches the stage must not remount boards.
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

var bundle = require('./test-director-sources').loadDirectorSources().bundle;

assert(bundle.indexOf('function layoutSnapshotMatchesCurrent(snap)') >= 0,
  'layoutSnapshotMatchesCurrent exists');
assert(bundle.indexOf('if (layoutSnapshotMatchesCurrent(snap))') >= 0,
  'applyLayoutSnapshot short-circuits when layout already matches');
assert(bundle.indexOf('mountLayoutForViewport(snap.panels, snap.vw || 0, snap.vh || 0)') >= 0,
  'diverged preset still mounts via mountLayoutForViewport');

var scaleStart = bundle.indexOf('  function ensureLiveInList(list)');
var scaleEnd = bundle.indexOf('  /** Apply a design-space layout onto live panels');
var typeStart = bundle.indexOf('  function panelTypeOf(raw)');
var typeEnd = bundle.indexOf('  function isTrackmapBoard(p)');
var matchStart = bundle.indexOf('  /** Pixel slack when comparing');
var matchEnd = bundle.indexOf('  function applyLayoutSnapshot(snap)');
assert(scaleStart >= 0 && scaleEnd > scaleStart && matchStart >= 0 && matchEnd > matchStart,
  'scale + match helpers slice');

function harness() {
  var ctx = {
    panels: {},
    defaultLayout: function () {
      return [{ id: 'live', type: 'live', x: 0, y: 0, w: 800, h: 400, z: 10, minimized: false }];
    }
  };
  vm.runInNewContext(bundle.slice(scaleStart, scaleEnd), ctx);
  vm.runInNewContext(bundle.slice(typeStart, typeEnd), ctx);
  vm.runInNewContext(bundle.slice(matchStart, matchEnd), ctx);
  return ctx;
}

var h = harness();

var snapPanels = [
  { id: 'live', type: 'live', x: 40, y: 80, w: 900, h: 500, z: 30, minimized: false },
  { id: 'p1', type: 'board', board: 'timing', x: 20, y: 270, w: 476, h: 600, z: 41, minimized: false },
  { id: 'p8', type: 'board', board: 'trackmap', x: 20, y: 16, w: 476, h: 240, z: 40, minimized: false }
];
var snap = { vw: 1920, vh: 1080, panels: snapPanels, theme: 'night' };

var scaled = h.scalePanelsList(snapPanels, 1920, 1080, 1920, 1080);
assert(h.layoutSnapshotMatchesLivePanels(snap, scaled, 1920, 1080),
  'identity scale: preset matches itself on stage');

assert(!h.layoutSnapshotMatchesLivePanels(snap, scaled.map(function (p) {
  if (p.id === 'p1') return Object.assign({}, p, { x: p.x + 5 });
  return p;
}), 1920, 1080),
  'panel moved beyond epsilon does not match');

assert(!h.layoutSnapshotMatchesLivePanels(snap, scaled.filter(function (p) { return p.id !== 'p8'; }), 1920, 1080),
  'missing board does not match');

var smallerStage = h.scalePanelsList(snapPanels, 1920, 1080, 1280, 720);
assert(h.layoutSnapshotMatchesLivePanels(snap, smallerStage, 1280, 720),
  'scaled preset matches live panels at smaller stage');

var boardSwap = smallerStage.map(function (p) {
  if (p.id === 'p1') return Object.assign({}, p, { board: 'flags' });
  return p;
});
assert(!h.layoutSnapshotMatchesLivePanels(snap, boardSwap, 1280, 720),
  'board type change does not match');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('layout-preset-noop ok');