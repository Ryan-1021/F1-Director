/*
 * node director/window-title-version.test.js
 * 系统窗口标题：VERSION 短号（去 +build）写成「F1 导播台 · Director · v{short}」。
 * 不进 share/web。
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

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(__dirname, 'director.html'), 'utf8');
var publish = fs.readFileSync(path.join(__dirname, 'Publish-Web.cmd'), 'utf8');
var start = fs.readFileSync(path.join(__dirname, 'Start.cmd'), 'utf8');
var stampPs1 = fs.readFileSync(path.join(__dirname, 'Stamp-WindowTitle.ps1'), 'utf8');
var versionRaw = fs.readFileSync(path.join(root, 'VERSION'), 'utf8');
var indexHtml = fs.readFileSync(path.join(__dirname, 'web-override', 'index.html'), 'utf8');
var boardHtml = fs.readFileSync(path.join(__dirname, 'web-override', 'board.html'), 'utf8');

var fnStart = html.indexOf('function directorShortVersion(raw)');
var fnMid = html.indexOf('function directorWindowTitle(raw)');
var fnEnd = html.indexOf('function applyDirectorWindowTitle(raw)');
assert(fnStart >= 0 && fnMid > fnStart && fnEnd > fnMid, 'title helpers live in director.html');

var helperSrc = html.slice(fnStart, fnEnd);
var sandbox = { DIRECTOR_TITLE_BASE: 'F1 导播台 · Director' };
vm.createContext(sandbox);
vm.runInContext(helperSrc, sandbox);

function short(raw) { return sandbox.directorShortVersion(raw); }
function title(raw) { return sandbox.directorWindowTitle(raw); }

assert(short('0.2.13+20261107') === '0.2.13', 'strip +build metadata');
assert(short('  0.2.13+20261107\n') === '0.2.13', 'trim whitespace');
assert(short('\uFEFF0.2.13+20261107') === '0.2.13', 'strip UTF-8 BOM');
assert(short('v0.2.13+build') === '0.2.13', 'drop leading v before re-prefix');
assert(short('V1.0.0') === '1.0.0', 'drop leading V');
assert(short('0.2.13') === '0.2.13', 'plain semver');
assert(short('0.2.13-rc.1+exp.sha') === '0.2.13-rc.1', 'keep pre-release, drop build');
assert(short('') === '', 'empty');
assert(short('   ') === '', 'blank');
assert(short(null) === '', 'null');

assert(title('0.2.13+20261107') === 'F1 导播台 · Director · v0.2.13',
  'approved title A for 0.2.13+build');
assert(title('v0.2.13') === 'F1 导播台 · Director · v0.2.13',
  'no double-v');
assert(title('') === 'F1 导播台 · Director', 'empty keeps base title');

var liveShort = short(versionRaw);
assert(liveShort === '0.2.13', 'repo VERSION short is 0.2.13 (got ' + liveShort + ')');
assert(title(versionRaw) === 'F1 导播台 · Director · v0.2.13',
  'repo VERSION stamps the exact window title');

assert(/<title>F1 导播台 · Director<\/title>/.test(html),
  'source <title> is the unversioned base (publish stamps the copy)');
assert(html.indexOf('<title>F1 导播台 · Director · v') === -1,
  'source HTML does not hardcode a versioned window title');
assert(html.indexOf("fetch('VERSION', { cache: 'no-store' })") !== -1,
  'runtime hook fetches published VERSION');
assert(html.indexOf('<div class="logo"><span class="dot"></span> F1 导播台</div>') !== -1,
  'in-page topbar logo text unchanged');
assert(!/class="logo"[^>]*>[^<]*v\d/.test(html),
  'topbar logo does not include a version');

assert(/<title>F1 Director<\/title>/.test(indexHtml), 'index.html window title left alone');
assert(/<title>F1 Director · 看板<\/title>/.test(boardHtml), 'board popout title left alone');

assert(publish.indexOf('Stamp-WindowTitle.ps1') !== -1, 'Publish-Web stamps window title');
assert(publish.indexOf('VERSION') !== -1, 'Publish-Web copies VERSION');
assert(start.indexOf('Stamp-WindowTitle.ps1') !== -1, 'Start.cmd stamps window title');
assert(start.indexOf('VERSION') !== -1, 'Start.cmd copies VERSION');
assert(stampPs1.indexOf('Get-DirectorShortVersion') !== -1, 'stamp script has short-version helper');
assert(stampPs1.indexOf("IndexOf([char]43)") !== -1, 'stamp script splits on +');
assert(stampPs1.indexOf("' · v'") !== -1, 'stamp script prefixes v with a middle-dot');
assert(stampPs1.indexOf('director.html') !== -1, 'stamp script edits published director.html');
assert(stampPs1.indexOf('Copy-Item') !== -1 && stampPs1.indexOf('VERSION') !== -1,
  'stamp script copies VERSION into web dir');

function stampLikePs1(src, raw) {
  var shortVer = short(raw);
  var open = '<title>';
  var close = '</title>';
  var start = src.indexOf(open);
  var end = src.indexOf(close);
  var cur = src.slice(start + open.length, end);
  var suffix = ' · v' + shortVer;
  var keep = cur;
  var marker = ' · v';
  var idx = cur.lastIndexOf(marker);
  if (idx >= 0 && /^\d/.test(cur.slice(idx + marker.length))) keep = cur.slice(0, idx);
  return src.slice(0, start) + open + keep + suffix + src.slice(end);
}

var published = stampLikePs1(html, versionRaw);
assert(published.indexOf('<title>F1 导播台 · Director · v0.2.13</title>') !== -1,
  'published copy title is exactly F1 导播台 · Director · v0.2.13');
assert(published.indexOf('<div class="logo"><span class="dot"></span> F1 导播台</div>') !== -1,
  'stamping title does not touch the topbar logo');
assert((published.match(/<title>/g) || []).length === 1, 'still a single <title>');

var restamp = stampLikePs1(published, '0.3.0+20990101');
assert(restamp.indexOf('<title>F1 导播台 · Director · v0.3.0</title>') !== -1,
  'restamp replaces the previous short version');
assert(restamp.indexOf('v0.2.13') === -1, 'old short version is gone after restamp');

var snippetStart = html.indexOf('(function () {\n  var DIRECTOR_TITLE_BASE');
var snippetEnd = html.indexOf('})();', snippetStart) + 5;
assert(snippetStart >= 0 && snippetEnd > snippetStart, 'runtime IIFE markers');
try {
  new vm.Script(html.slice(snippetStart, snippetEnd), { filename: 'window-title.js' });
} catch (e) {
  assert(false, 'title snippet parses: ' + e.message);
}

var doc = { title: 'F1 导播台 · Director' };
var fetchCalls = [];
var runtime = {
  document: doc,
  fetch: function (url, opts) {
    fetchCalls.push({ url: url, opts: opts });
    return Promise.resolve({
      ok: true,
      text: function () { return Promise.resolve(versionRaw); }
    });
  }
};
vm.createContext(runtime);
vm.runInContext(html.slice(snippetStart, snippetEnd), runtime);

function finish() {
  assert(fetchCalls.length === 1 && fetchCalls[0].url === 'VERSION', 'runtime fetches VERSION');
  assert(fetchCalls[0].opts && fetchCalls[0].opts.cache === 'no-store', 'VERSION fetch is no-store');
  assert(doc.title === 'F1 导播台 · Director · v0.2.13',
    'runtime document.title is exactly F1 导播台 · Director · v0.2.13 (got ' + doc.title + ')');

  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('window-title-version ok');
}

Promise.resolve().then(function () {
  return Promise.resolve();
}).then(finish).catch(function (err) {
  assert(false, 'runtime hook: ' + err.message);
  finish();
});
