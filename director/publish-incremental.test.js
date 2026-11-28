/*
 * node director/publish-incremental.test.js
 * Incremental publish: SHA256 gate, source sidecar for stamped director.html, prune, wiring.
 */
'use strict';

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL ' + msg);
  }
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

var root = path.join(__dirname);
var syncPs1 = fs.readFileSync(path.join(root, 'Sync-WebPublish.ps1'), 'utf8');
var stampPs1 = fs.readFileSync(path.join(root, 'Stamp-WindowTitle.ps1'), 'utf8');
var start = fs.readFileSync(path.join(root, 'Start.cmd'), 'utf8');
var startPs1 = fs.readFileSync(path.join(root, 'Start-Director.ps1'), 'utf8');
var publish = fs.readFileSync(path.join(root, 'Publish-Web.cmd'), 'utf8');
var versionRaw = fs.readFileSync(path.join(root, '..', 'VERSION'), 'utf8');

assert(syncPs1.indexOf('SHA256') !== -1, 'Sync-WebPublish compares SHA256');
assert(syncPs1.indexOf('Test-SameFile') !== -1, 'Sync-WebPublish has same-file helper');
assert(syncPs1.indexOf('UseSourceSidecar') !== -1, 'director.html uses source sidecar hash gate');
assert(syncPs1.indexOf('Test-DirectorTitleNeedsStamp') === -1, 'Sync has no dead needs-stamp helper');
assert(syncPs1.indexOf('TrackDirectorHtml') === -1, 'Sync no TrackDirectorHtml tracking');
assert(syncPs1.indexOf('TrackVersion') === -1, 'Sync no TrackVersion tracking');
assert(stampPs1.indexOf('[char]0x00B7') !== -1, 'stamp script uses U+00B7 via numeric code');
assert(/^\s+return\s*$/m.test(stampPs1), 'stamp script uses return not exit on skip');
assert(stampPs1.indexOf('exit 0') === -1, 'stamp script does not exit parent on skip');
assert(!/[\u00b7\u2022]/.test(stampPs1.replace(/0x00B7/g, '')),
  'stamp ps1 has no literal middle-dot/bullet in source');
assert(syncPs1.indexOf('GetFullPath($WebDir)') !== -1, 'Sync-WebPublish normalizes WebDir');
assert(syncPs1.indexOf('GetFullPath($DirectorRoot)') !== -1,
  'Sync-WebPublish normalizes DirectorRoot');
assert(syncPs1.indexOf('Prune-MappedDest') !== -1, 'Sync-WebPublish prunes mapped dest without source');
assert(syncPs1.indexOf('pruneRootFiles') !== -1, 'prune list includes retired root publishes');
var rootFilesBlock = syncPs1.slice(
  syncPs1.indexOf('$rootFiles = @'),
  syncPs1.indexOf('$pruneRootFiles')
);
assert(rootFilesBlock.indexOf('fonts-boot') === -1, 'rootFiles sync list has no fonts-boot');
assert(syncPs1.indexOf("fonts-boot.js") !== -1, 'prune maps stale fonts-boot.js');
assert(syncPs1.indexOf('Stamp-WindowTitle.ps1') !== -1, 'Sync-WebPublish invokes stamp script');
assert(syncPs1.indexOf('NEEDS_STAMP') === -1, 'Sync-WebPublish no longer emits NEEDS_STAMP');
assert(syncPs1.indexOf('director.css') !== -1, 'Sync publishes director.css');
assert(syncPs1.indexOf('director-app.js') !== -1, 'Sync publishes director-app.js');
assert(start.indexOf('Start-Director.ps1') !== -1, 'Start.cmd uses single-host Start-Director.ps1');
assert(startPs1.indexOf('Sync-WebPublish.ps1') !== -1, 'Start-Director invokes Sync-WebPublish');
assert(startPs1.indexOf('Run-Director.ps1') !== -1, 'Start-Director invokes Run-Director in same host');
assert(syncPs1.indexOf('.publish-stamp') !== -1, 'Sync maintains .publish-stamp manifest');
assert(syncPs1.indexOf('ForcePublish') !== -1, 'Sync has ForcePublish switch');
assert(syncPs1.indexOf('PUBLISH_SKIPPED=1') !== -1, 'Sync skips hash walk on stamp hit');
assert(start.indexOf('NEEDS_STAMP') === -1, 'Start.cmd does not read NEEDS_STAMP');
assert(publish.indexOf('NEEDS_STAMP') === -1, 'Publish-Web.cmd does not read NEEDS_STAMP');
assert(start.indexOf('xcopy') === -1, 'Start.cmd no longer bulk xcopy');
assert(publish.indexOf('Sync-WebPublish.ps1') !== -1, 'Publish-Web uses Sync-WebPublish');
assert(/if errorlevel 1/i.test(publish), 'Publish-Web checks sync errorlevel');
assert(/if errorlevel 1/i.test(start), 'Start.cmd checks sync errorlevel');

function shortVersion(raw) {
  var s = String(raw || '').replace(/^\uFEFF/, '').trim();
  var plus = s.indexOf('+');
  if (plus >= 0) s = s.slice(0, plus).trim();
  if (!s) return '';
  if (s[0] === 'v' || s[0] === 'V') s = s.slice(1);
  return s;
}

function stampTitleInHtml(src, raw) {
  var shortVer = shortVersion(raw);
  var open = '<title>';
  var close = '</title>';
  var startIdx = src.indexOf(open);
  var endIdx = src.indexOf(close);
  var cur = src.slice(startIdx + open.length, endIdx);
  var suffix = ' \u00b7 v' + shortVer;
  var keep = cur;
  var marker = ' \u00b7 v';
  var idx = cur.lastIndexOf(marker);
  if (idx >= 0 && /^\d/.test(cur.slice(idx + marker.length))) keep = cur.slice(0, idx);
  return src.slice(0, startIdx) + open + keep + suffix + src.slice(endIdx);
}

function sidecarPath(webDir, dstRel) {
  var safe = dstRel.replace(/[\\/]/g, '_');
  return path.join(webDir, '.publish-hash', safe + '.sha256');
}

function samePublishedSource(srcPath, webDir, dstRel) {
  var hSrc = sha256File(srcPath);
  var side = sidecarPath(webDir, dstRel);
  if (fs.existsSync(side) && fs.readFileSync(side, 'utf8').trim() === hSrc) return true;
  var dst = path.join(webDir, dstRel);
  if (fs.existsSync(dst) && sha256File(dst) === hSrc) {
    fs.mkdirSync(path.dirname(side), { recursive: true });
    fs.writeFileSync(side, hSrc);
    return true;
  }
  return false;
}

var srcHtml = path.join(root, 'director.html');
var tmpWeb = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-web-'));
var dstHtml = path.join(tmpWeb, 'director.html');
fs.copyFileSync(srcHtml, dstHtml);
var stamped = stampTitleInHtml(fs.readFileSync(srcHtml, 'utf8'), versionRaw);
fs.writeFileSync(dstHtml, stamped);
var hashDir = path.dirname(sidecarPath(tmpWeb, 'director.html'));
fs.mkdirSync(hashDir, { recursive: true });
fs.writeFileSync(sidecarPath(tmpWeb, 'director.html'), sha256File(srcHtml));

assert(samePublishedSource(srcHtml, tmpWeb, 'director.html'),
  'stamped dest still matches source via sidecar (skip recopy)');
assert(sha256File(srcHtml) !== sha256File(dstHtml),
  'raw dest hash differs from source after stamp');
assert(stamped.indexOf('<title>F1 \u5bfc\u64ad\u53f0 \u00b7 Director \u00b7 v' + shortVersion(versionRaw)) !== -1,
  'stamped dest title keeps short version');

var staleBoot = path.join(tmpWeb, 'fonts-boot.js');
fs.writeFileSync(staleBoot, '/* stale */');
assert(fs.existsSync(staleBoot), 'fixture stale fonts-boot.js');

var srcA = path.join(tmpWeb, 'a.txt');
var dstA = path.join(tmpWeb, 'sub', 'a.txt');
fs.writeFileSync(srcA, 'hello');
fs.mkdirSync(path.dirname(dstA), { recursive: true });
fs.writeFileSync(dstA, 'hello');
assert(sha256File(srcA) === sha256File(dstA), 'fixture files match');

var ps = process.env.PWSH || 'pwsh';
var pwshOk = false;
try {
  var out = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpWeb + '"',
    { encoding: 'utf8' }
  );
  assert(/PUBLISH_CHANGED=1/.test(out), 'first sync copies into empty web dir');
  var firstHtml = fs.readFileSync(path.join(tmpWeb, 'director.html'), 'utf8');
  assert(firstHtml.indexOf('\u00b7 v' + shortVersion(versionRaw)) !== -1,
    'first sync stamps title with U+00B7 (not U+8DEF)');
  assert(firstHtml.indexOf('\u8def v') === -1, 'stamped title must not use U+8DEF (GBK misread)');
  var out2 = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpWeb + '"',
    { encoding: 'utf8' }
  );
  assert(/PUBLISH_CHANGED=0/.test(out2), 'second sync reports no changes');
  assert(/PUBLISH_SKIPPED=1/.test(out2), 'second sync skips hash walk via stamp');

  var stampPath = path.join(tmpWeb, '.publish-stamp');
  assert(fs.existsSync(stampPath), 'full publish writes .publish-stamp');

  var outForce = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpWeb + '" -ForcePublish',
    { encoding: 'utf8' }
  );
  assert(/PUBLISH_SKIPPED=1/.test(outForce) === false,
    'ForcePublish runs full sync (no PUBLISH_SKIPPED)');

  var layoutsDst = path.join(tmpWeb, 'layouts.json');
  var customLayouts = '{"user":"custom"}';
  fs.writeFileSync(layoutsDst, customLayouts);
  var outLayouts = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpWeb + '" -SeedLayouts',
    { encoding: 'utf8' }
  );
  assert(/PUBLISH_SKIPPED=1/.test(outLayouts), 'stamp hit still skips after layouts exist');
  assert(fs.readFileSync(layoutsDst, 'utf8') === customLayouts,
    'SeedLayouts does not overwrite existing layouts.json');

  var tmpStamp = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stamp-'));
  var stampDst = path.join(tmpStamp, 'director.html');
  fs.copyFileSync(srcHtml, stampDst);
  var sideForStamp = sidecarPath(tmpStamp, 'director.html');
  fs.mkdirSync(path.dirname(sideForStamp), { recursive: true });
  fs.writeFileSync(sideForStamp, sha256File(srcHtml));
  var unstampedTitle = stampTitleInHtml(fs.readFileSync(srcHtml, 'utf8'), '0.1.0+old');
  fs.writeFileSync(stampDst, unstampedTitle.replace(
    '<title>F1 \u5bfc\u64ad\u53f0 \u00b7 Director \u00b7 v0.1.0</title>',
    '<title>F1 \u5bfc\u64ad\u53f0 \u00b7 Director</title>'));
  fs.writeFileSync(path.join(tmpStamp, 'VERSION'), '0.1.0+old');
  var beforeHash = sha256File(stampDst);
  var outStampOnly = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpStamp + '"',
    { encoding: 'utf8' }
  );
  assert(/PUBLISH_CHANGED=1/.test(outStampOnly),
    'VERSION-only gap: repo VERSION still copies into web dir');
  var stampedHtml = fs.readFileSync(stampDst, 'utf8');
  assert(stampedHtml.indexOf('\u00b7 v' + shortVersion(versionRaw)) !== -1,
    'sync alone stamps dest title when VERSION differs (no cmd NEEDS_STAMP)');
  assert(stampedHtml.indexOf('\u8def') === -1, 'stamped separator is U+00B7 not U+8DEF');
  assert(sha256File(stampDst) !== beforeHash, 'stamp updated dest title in place');
  assert(sha256File(stampDst) !== sha256File(srcHtml),
    'dest director.html was not replaced with raw source copy');
  assert(fs.readFileSync(sideForStamp, 'utf8').trim() === sha256File(srcHtml),
    'source sidecar hash unchanged after VERSION-only stamp');
  var out3 = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpStamp + '"',
    { encoding: 'utf8' }
  );
  assert(/PUBLISH_CHANGED=0/.test(out3),
    'after stamp, unchanged source does not recopy director.html');

  fs.writeFileSync(path.join(tmpStamp, 'fonts-boot.js'), 'stale');
  var out4 = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpStamp + '"',
    { encoding: 'utf8' }
  );
  assert(!fs.existsSync(path.join(tmpStamp, 'fonts-boot.js')),
    'pwsh prune removes stale fonts-boot.js');
  assert(/PUBLISH_CHANGED=1/.test(out4), 'prune counts as publish change');

  var dotDir = path.join(root, 'dotdot-fixture');
  fs.mkdirSync(dotDir, { recursive: true });
  var dotShare = path.join(root, '..', 'publish-dotdot-share');
  var dotWeb = path.join(dotShare, 'web');
  fs.mkdirSync(dotWeb, { recursive: true });
  var dotWebArg = dotDir + path.sep + '..' + path.sep + '..' + path.sep +
    'publish-dotdot-share' + path.sep + 'web';
  var circuitsDir = path.join(dotWeb, 'circuits');
  fs.mkdirSync(circuitsDir, { recursive: true });
  var woCircuits = path.join(root, 'web-override', 'circuits');
  var realBaku = path.join(woCircuits, 'baku-1.svg');
  if (fs.existsSync(realBaku)) {
    fs.copyFileSync(realBaku, path.join(circuitsDir, 'baku-1.svg'));
    fs.writeFileSync(path.join(circuitsDir, 'aku-1.svg'), '<!-- truncated leftover -->');
    assert(dotWebArg.indexOf('..') !== -1, 'fixture WebDir arg still has .. segments');
    var outDot = cp.execSync(
      '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
        path.join(root, 'Sync-WebPublish.ps1') +
        '" -DirectorRoot "' + root + '" -WebDir "' + dotWebArg + '"',
      { encoding: 'utf8' }
    );
    assert(!fs.existsSync(path.join(circuitsDir, 'aku-1.svg')),
      'unresolved WebDir: prune removes dest-only truncated circuits leftover');
    assert(fs.existsSync(path.join(circuitsDir, 'baku-1.svg')),
      'unresolved WebDir: real circuit file remains');
    assert(/PUBLISH_CHANGED=1/.test(outDot), 'unresolved WebDir: prune counts as change');
    var dotHtml = fs.readFileSync(path.join(dotWeb, 'director.html'), 'utf8');
    assert(dotHtml.indexOf('\u00b7 v' + shortVersion(versionRaw)) !== -1,
      'unresolved WebDir: stamp still applies U+00B7 version in title');
  } else {
    console.log('skip dotdot prune (baku-1.svg source missing)');
  }
  try { fs.rmSync(dotShare, { recursive: true, force: true }); } catch (eDot) {}
  try { fs.rmSync(dotDir, { recursive: true, force: true }); } catch (eDotDir) {}

  try { fs.rmSync(tmpStamp, { recursive: true, force: true }); } catch (eTmp) {}
  pwshOk = true;
} catch (e) {
  if (e.message.indexOf('ENOENT') >= 0 || e.message.indexOf('not found') >= 0) {
    console.log('skip pwsh integration (pwsh missing on this VM)');
  } else if (!pwshOk) {
    assert(false, 'pwsh sync run: ' + e.message);
  }
}

if (!pwshOk) {
  assert(!fs.existsSync(path.join(root, 'web-override', 'fonts-boot.js')),
    'fonts-boot source absent (prune target only)');
  assert(stampPs1.indexOf('director.html') !== -1, 'stamp script still edits director.html');
  assert(stampPs1.indexOf('[char]0x00B7') !== -1, 'stamp script uses U+00B7 (node static check)');
}

try { fs.rmSync(tmpWeb, { recursive: true, force: true }); } catch (eRm) {}

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('publish-incremental ok');