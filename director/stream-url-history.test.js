/*
 * node director/stream-url-history.test.js
 * 直播地址历史：载入记入新 key、去重、上限、单条删除；清除只停当前流。
 * 铺满裁切不再无条件藏起地址栏，「地址」不退出 live-media-fill。
 * 「地址」与铺满裁切过渡与日夜圆形切换同速（1s）：地址栏淡入下滑，普通模式收起高度；铺满退出等动画结束再摘 class。
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

var start = html.indexOf('/* stream-url-history:start */');
var end = html.indexOf('/* stream-url-history:end */');
assert(start >= 0 && end > start, 'history helper block is marked');
var ctx = {};
vm.createContext(ctx);
try {
  vm.runInContext(html.slice(start, end), ctx, { filename: 'stream-url-history.js' });
} catch (e) {
  assert(false, 'history helpers parse: ' + e.message);
}

assert(ctx.STREAM_URL_HISTORY_CAP === 20, 'cap is 20');
assert(ctx.STORAGE_URL_HISTORY === 'f1-director-stream-url-history', 'history uses its own key');
assert(ctx.STORAGE_URL_HISTORY !== 'f1-director-stream-url', 'history key is not STORAGE_URL');

assert(ctx.normalizeStreamUrl('  https://a  ') === 'https://a', 'trim');
assert(ctx.normalizeStreamUrl('   ') === '', 'whitespace is empty');
assert(ctx.normalizeStreamUrl(null) === '', 'null is empty');
assert(ctx.normalizeStreamUrl(1) === '', 'non-strings are not recorded');

var src = ['https://b', 'https://a'];
var recorded = ctx.recordStreamUrlHistory(src, ' https://a ');
assert(src.join('|') === 'https://b|https://a', 'record does not mutate the input list');
assert(recorded.join('|') === 'https://a|https://b', 'trimmed exact match moves to front');
assert(ctx.recordStreamUrlHistory(['https://A'], 'https://a').join('|') === 'https://a|https://A',
  'match is case-sensitive');
assert(ctx.recordStreamUrlHistory(['https://a'], '   ').join('|') === 'https://a',
  'blank value is not recorded');

var many = [];
for (var i = 0; i < 25; i++) many = ctx.recordStreamUrlHistory(many, 'https://ex/' + i);
assert(many.length === 20, 'record caps at 20');
assert(many[0] === 'https://ex/24', 'newest stays first');
assert(many[19] === 'https://ex/5', 'oldest beyond the cap drop');
assert(many.indexOf('https://ex/4') === -1, 'item 4 fell off the cap');
many = ctx.recordStreamUrlHistory(many, 'https://ex/5');
assert(many.length === 20 && many[0] === 'https://ex/5', 're-recording an old item bumps it without growing');

assert(ctx.deleteStreamUrlHistoryItem(['https://a', 'https://b', 'https://c'], 'https://b').join('|') === 'https://a|https://c',
  'delete removes only that record');
assert(ctx.deleteStreamUrlHistoryItem(['https://a'], 'https://missing').join('|') === 'https://a',
  'delete of a missing url keeps the rest');

assert(ctx.parseStreamUrlHistory(null).length === 0, 'parse null');
assert(ctx.parseStreamUrlHistory('').length === 0, 'parse empty');
assert(ctx.parseStreamUrlHistory('{').length === 0, 'parse invalid json');
assert(ctx.parseStreamUrlHistory('{"a":1}').length === 0, 'parse non-array');
assert(ctx.parseStreamUrlHistory('[" https://a ", "", "https://a", 1, "https://b"]').join('|') === 'https://a|https://b',
  'parse trims, drops blanks, dedupes');
var raw = [];
for (var j = 0; j < 25; j++) raw.push('https://p/' + j);
var parsed = ctx.parseStreamUrlHistory(JSON.stringify(raw));
assert(parsed.length === 20 && parsed[0] === 'https://p/0' && parsed[19] === 'https://p/19',
  'parse keeps stored order and caps');

function mockStorage(seed) {
  var data = {};
  Object.keys(seed || {}).forEach(function (k) { data[k] = seed[k]; });
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; }
  };
}

var HIST = ctx.STORAGE_URL_HISTORY;
var CUR = 'f1-director-stream-url';
var store = mockStorage({});
assert(ctx.rememberStreamUrl(store, '   ').length === 0, 'remember skips whitespace');
assert(store.getItem(HIST) == null, 'whitespace does not create the history key');
ctx.rememberStreamUrl(store, 'https://b');
ctx.rememberStreamUrl(store, ' https://a ');
ctx.rememberStreamUrl(store, 'https://b');
assert(JSON.parse(store.getItem(HIST)).join('|') === 'https://b|https://a', 'storage is MRU and deduped');
store.setItem(CUR, 'https://b');
ctx.forgetCurrentStreamUrl(store, CUR);
assert(store.getItem(CUR) == null, '清除 drops the current url key');
assert(JSON.parse(store.getItem(HIST)).join('|') === 'https://b|https://a', '清除 does not wipe history');
store.setItem(CUR, 'https://playing');
ctx.removeStreamUrlHistoryItem(store, 'https://a');
assert(JSON.parse(store.getItem(HIST)).join('|') === 'https://b', 'single delete leaves the other rows');
assert(store.getItem(CUR) === 'https://playing', 'single delete does not change current playback url');

var clearStart = html.indexOf("btnClear.addEventListener('click'");
var clearEnd = html.indexOf("streamInput.addEventListener('keydown'", clearStart);
assert(clearStart >= 0 && clearEnd > clearStart, '清除 handler found');
var clearFn = html.slice(clearStart, clearEnd);
assert(clearFn.indexOf('forgetCurrentStreamUrl(localStorage, STORAGE_URL)') !== -1, '清除 forgets STORAGE_URL');
assert(clearFn.indexOf('hideLive()') !== -1, '清除 hides the player');
assert(clearFn.indexOf("streamInput.value = ''") !== -1, '清除 empties the input');
assert(clearFn.indexOf('STORAGE_URL_HISTORY') === -1, '清除 handler does not mention the history key');
assert(clearFn.indexOf('removeStreamUrlHistoryItem') === -1, '清除 handler does not delete history');
assert(clearFn.indexOf('rememberStreamUrl') === -1, '清除 does not record');

var applyStart = html.indexOf('function applyStream(url)');
var applyEnd = html.indexOf('function getLiveFsRoot()', applyStart);
assert(applyStart >= 0 && applyEnd > applyStart, 'applyStream found');
var applyFn = html.slice(applyStart, applyEnd);
assert(applyFn.indexOf('rememberStreamUrl') === -1, 'applyStream itself does not record (startup restore stays out)');
assert(applyFn.indexOf('STORAGE_URL_HISTORY') === -1, 'applyStream does not touch history');

var commitStart = html.indexOf('function commitTypedStreamUrl()');
var commitEnd = html.indexOf('function loadStreamUrlFromHistory(', commitStart);
var commitFn = html.slice(commitStart, commitEnd);
assert(commitFn.indexOf('if (url) rememberStreamUrl(localStorage, url)') !== -1, '载入/回车 records a non-empty url');
assert(html.indexOf('commitTypedStreamUrl();') !== -1, '载入 and Enter call commitTypedStreamUrl');
assert((html.split('commitTypedStreamUrl();').length - 1) >= 2, 'both 载入 and Enter commit');

var payloadStart = html.indexOf('function buildLayoutsFilePayload()');
var payloadEnd = html.indexOf('function persistLayoutsToFile', payloadStart);
var payloadFn = html.slice(payloadStart, payloadEnd);
assert(payloadFn.indexOf('stream-url-history') === -1, 'layouts payload does not carry history');
assert(payloadFn.indexOf('streamUrl:') !== -1, 'layouts payload still has the single current streamUrl');

assert(!/\.live-media-fill \.live-toolbar\s*\{[^}]*display\s*:\s*none/.test(html),
  'fill mode does not force-hide the toolbar');
assert(/\.fpanel\.live-panel\.live-media-fill \.live-toolbar\s*\{[^}]*position\s*:\s*absolute/.test(html),
  'fill toolbar is an overlay');
assert(html.indexOf('button:not(.live-fs):not(.live-url-tog)') !== -1, '地址 stays visible in fill chrome');
assert(html.indexOf('.fpanel.live-panel.live-toolbar-hidden .live-toolbar { display: none !important; }') === -1,
  '地址 hide is not display:none');
assert(/\.fpanel\.live-panel\.live-toolbar-hidden \.live-toolbar\s*\{[^}]*opacity\s*:\s*0/.test(html),
  '地址 hide fades the bar');
assert(/\.fpanel\.live-panel\.live-toolbar-hidden \.live-toolbar\s*\{[^}]*translateY\(-6px\)/.test(html),
  '地址 hide slides the bar up');
assert(/\.fpanel\.live-panel\.live-toolbar-hidden \.live-toolbar\s*\{[^}]*pointer-events\s*:\s*none/.test(html),
  'hidden address bar does not take clicks');
assert(/\.fpanel\.live-panel\.live-toolbar-hidden \.live-toolbar\s*\{[^}]*visibility\s*:\s*hidden/.test(html),
  'hidden address bar is visibility hidden after the fade');
assert(/\.live-toolbar-hidden:not\(\.live-media-fill\) \.live-toolbar-clip\s*\{[^}]*grid-template-rows\s*:\s*0fr/.test(html),
  'normal mode collapses toolbar height');
assert(html.indexOf('.fpanel.live-panel.live-media-fill .live-toolbar-clip') !== -1,
  'fill mode keeps an overlay clip');
assert(/\.stream-url-history\s*\{[^}]*transition\s*:/.test(html) === false, 'history dropdown is not transitioned');
assert(/live-media-fill \.p-head \.win-btns button\.live-fs,\s*\n\s*\.fpanel\.live-panel\.live-media-fill \.p-head \.win-btns button\.live-url-tog \{[^}]*rgba\(0,0,0,\.55\)/.test(html),
  '地址 uses the fill-mode dark chip');

var togStart = html.indexOf('function wireLiveToolbarToggle()');
var togEnd = html.indexOf('function wireLiveControls()', togStart);
var togFn = html.slice(togStart, togEnd);
assert(togFn.indexOf('setLiveMediaFill') === -1, '地址 toggle does not exit live-media-fill');
assert(togFn.indexOf('live-media-fill') === -1, '地址 toggle does not touch the fill class');
assert(togFn.indexOf('applyLiveToolbarHidden(!isLiveToolbarHidden(), true)') !== -1,
  '地址 still toggles toolbar visibility');

var hideStart = html.indexOf('function applyLiveToolbarHidden(hidden, persist)');
var hideEnd = html.indexOf('function escapeStreamUrlText(', hideStart);
assert(hideStart >= 0 && hideEnd > hideStart, 'applyLiveToolbarHidden found');
var hideFn = html.slice(hideStart, hideEnd);
assert(hideFn.indexOf('armLiveToolbarAnim(panel)') !== -1, '地址 toggle arms the height clip');
assert(hideFn.indexOf("panel.classList.contains('live-media-fill')") === -1,
  'hide helper does not branch on fill; the clip class does');
assert(hideFn.indexOf('closeStreamUrlHistory()') !== -1, 'hiding the bar still closes history');

var fillStart = html.indexOf('function setLiveMediaFill(on)');
var fillEnd = html.indexOf('var LIVE_FS_TITLE_OFF', fillStart);
assert(fillStart >= 0 && fillEnd > fillStart, 'setLiveMediaFill found');
var fillFn = html.slice(fillStart, fillEnd);
assert(fillFn.indexOf("panel.classList.add('live-fill-leave')") !== -1, 'exit fill keeps a leave class');
assert(fillFn.indexOf('setTimeout') !== -1, 'exit fill waits before dropping the class');
assert(fillFn.indexOf("p.classList.remove('live-media-fill', 'live-fill-leave')") !== -1,
  'live-media-fill is removed only after the leave timer');
assert(fillFn.indexOf('LIVE_FILL_MS') !== -1, 'leave wait uses the fill duration');
assert(html.indexOf('var LIVE_FILL_MS = 1000;') !== -1, 'fill leave waits 1000ms, same as the theme wipe');
assert(html.indexOf('var LIVE_TOOLBAR_MS = 1000;') !== -1, 'address bar animates for 1000ms');
assert(html.indexOf('#liveIframe') !== -1 && /#liveIframe\s*\{[^}]*transition:\s*transform 1s/.test(html),
  'iframe crop transform eases over 1s');
assert(/visibility 0s linear 1s/.test(html), 'hidden address bar stays unclickable after the 1s fade');
assert(/live-fill-leave #liveIframe\s*\{[^}]*transform:\s*none/.test(html),
  'leaving fill eases the crop back');
assert(/\.live-crop-ui\s*\{[^}]*opacity:\s*0/.test(html), 'crop controls can fade');
assert(/live-media-fill:not\(\.live-fill-leave\) #liveFsRoot\.has-iframe \.live-crop-ui/.test(html),
  'crop controls show only while fill is settled');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok');
