/*
 * node director/sectors-head-tip.test.js
 * 赛段成绩空状态提示：标题栏 chrome，不再贴在表底。不进 share/web。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL ' + msg);
  }
}

var html = fs.readFileSync(path.join(__dirname, 'director.html'), 'utf8');
var app = fs.readFileSync(path.join(__dirname, 'web-override', 'app.js'), 'utf8');
var css = fs.readFileSync(path.join(__dirname, 'web-override', 'style.css'), 'utf8');

assert(html.indexOf('data-sectors-tip') >= 0, 'director .p-head hosts data-sectors-tip');
assert(html.indexOf('本场次暂无赛段数据') >= 0, 'director chrome uses the short copy');
assert(html.indexOf('class="sectors-head-tip"') >= 0, 'director tip class is sectors-head-tip');
assert(/boardDdHtml\(st\.board\)[\s\S]*sectors-head-tip[\s\S]*data-tm-head[\s\S]*timing-cols-tog/.test(html),
  'tip sits in .p-head between dropdown/spacer and win-btns chrome');
assert(html.indexOf('.p-head .sectors-head-tip') >= 0, 'director CSS targets .p-head .sectors-head-tip');
var tipCssStart = html.indexOf('.p-head .sectors-head-tip {');
var tipCssEnd = html.indexOf('.p-head .win-btns', tipCssStart);
assert(tipCssStart >= 0 && tipCssEnd > tipCssStart, 'director tip CSS block found');
var tipCss = html.slice(tipCssStart, tipCssEnd);
assert(tipCss.indexOf('text-overflow: ellipsis') >= 0, 'director tip truncates with ellipsis');
assert(tipCss.indexOf('white-space: nowrap') >= 0, 'director tip does not wrap');
assert(html.indexOf('function syncSectorsHeadTip(') >= 0, 'syncSectorsHeadTip exists');
assert(html.indexOf('function setSectorsHeadTipShow(') >= 0, 'setSectorsHeadTipShow exists');
assert(html.indexOf('function requestSectorsNote(') >= 0, 'requestSectorsNote exists');
assert(html.indexOf("d.type === 'f1-sectors-note'") >= 0, 'parent listens for f1-sectors-note');
assert(html.indexOf("type: 'f1-sectors-note-req'") >= 0, 'parent can request tip state');
assert(html.indexOf('syncSectorsHeadTip(el, boardId)') >= 0, 'board chrome syncs sectors tip');
assert(html.indexOf('F1.getSectorsNoteVisible') >= 0, 'parent reads F1.getSectorsNoteVisible');

assert(app.indexOf("SECTORS_NOTE_TEXT = '本场次暂无赛段数据'") >= 0, 'app.js short copy');
assert(app.indexOf('本场次暂无 S1') === -1, 'old long bottom sentence is gone');
assert(app.indexOf('有分段后会自动填色') === -1, 'old explanatory clause is gone');
assert(app.indexOf("el('div', 'sub sectors-note'") === -1, 'no longer appends .sectors-note under the table');
assert(app.indexOf('function placeSectorsHeadTip(') >= 0, 'standalone places tip in b-head / ptitle');
assert(app.indexOf("type: 'f1-sectors-note'") >= 0, 'iframe posts f1-sectors-note');
assert(app.indexOf("d.type === 'f1-sectors-note-req'") >= 0, 'iframe answers f1-sectors-note-req');
assert(app.indexOf('getSectorsNoteVisible:') >= 0, 'F1.getSectorsNoteVisible exported');
assert(app.indexOf('syncSectorsNote(box, true)') >= 0, 'empty car list hides the tip');
assert(app.indexOf('syncSectorsNote(box, liveBests.anySector)') >= 0, 'live path still keys off anySector');
assert(app.indexOf('syncSectorsNote(box, bests.anySector)') >= 0, 'first-paint path still keys off anySector');
assert(app.indexOf('querySelector(\'.b-head\')') >= 0 &&
  app.indexOf('function placeSectorsHeadTip') < app.lastIndexOf('querySelector(\'.b-head\')'),
  'standalone prefers .b-head');
assert(app.indexOf('title.querySelector(\'.p-pop\')') >= 0, 'main-grid ptitle keeps 弹出 on the right');

assert(css.indexOf('.sectors-head-tip') >= 0, 'style.css has title-row tip');
assert(css.indexOf('.sectors-note') >= 0 && css.indexOf('display: none !important') >= 0,
  'legacy .sectors-note is forced off so it cannot cover rows');
assert(!/^\.sectors-note\s*\{[^}]*padding:\s*4px/m.test(css),
  'old padded bottom-note rule is gone');
assert(css.indexOf('.b-head .sectors-head-tip') >= 0, 'standalone b-head tip');
assert(css.indexOf('.ptitle:has(> .sectors-head-tip.show)') >= 0, 'ptitle tip uses title-row :has like 列');
var cssTip = css.slice(css.indexOf('.sectors-head-tip {'), css.indexOf('.b-head .sectors-head-tip'));
assert(cssTip.indexOf('text-overflow: ellipsis') >= 0, 'standalone tip ellipsizes when narrow');
assert(cssTip.indexOf('white-space: nowrap') >= 0, 'standalone tip does not wrap');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok');
