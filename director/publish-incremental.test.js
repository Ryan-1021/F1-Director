/*
 * node director/publish-incremental.test.js
 * Incremental publish: SHA256 gate + Start/Publish-Web wiring.
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

var root = path.join(__dirname);
var syncPs1 = fs.readFileSync(path.join(root, 'Sync-WebPublish.ps1'), 'utf8');
var start = fs.readFileSync(path.join(root, 'Start.cmd'), 'utf8');
var publish = fs.readFileSync(path.join(root, 'Publish-Web.cmd'), 'utf8');

assert(syncPs1.indexOf('SHA256') !== -1, 'Sync-WebPublish compares SHA256');
assert(syncPs1.indexOf('Test-SameFile') !== -1, 'Sync-WebPublish has same-file helper');
assert(syncPs1.indexOf('NEEDS_STAMP') !== -1, 'Sync-WebPublish emits NEEDS_STAMP');
assert(syncPs1.indexOf('fonts-boot.js') === -1, 'Sync does not publish fonts-boot.js');
assert(syncPs1.indexOf('director.css') !== -1, 'Sync publishes director.css');
assert(syncPs1.indexOf('director-app.js') !== -1, 'Sync publishes director-app.js');
assert(start.indexOf('Sync-WebPublish.ps1') !== -1, 'Start.cmd uses Sync-WebPublish');
assert(start.indexOf('NEEDS_STAMP') !== -1, 'Start.cmd reads NEEDS_STAMP');
assert(start.indexOf('xcopy') === -1, 'Start.cmd no longer bulk xcopy');
assert(publish.indexOf('Sync-WebPublish.ps1') !== -1, 'Publish-Web uses Sync-WebPublish');

var tmpWeb = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-web-'));
var srcA = path.join(tmpWeb, 'a.txt');
var dstA = path.join(tmpWeb, 'sub', 'a.txt');
fs.writeFileSync(srcA, 'hello');
fs.mkdirSync(path.dirname(dstA), { recursive: true });
fs.writeFileSync(dstA, 'hello');
assert(sha256File(srcA) === sha256File(dstA), 'fixture files match');

var ps = process.env.PWSH || 'pwsh';
try {
  var out = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpWeb + '"',
    { encoding: 'utf8' }
  );
  assert(/NEEDS_STAMP=0/.test(out) || /NEEDS_STAMP=1/.test(out), 'script prints NEEDS_STAMP');
  assert(/PUBLISH_CHANGED=1/.test(out), 'first sync copies into empty web dir');
  var out2 = cp.execSync(
    '"' + ps + '" -NoProfile -ExecutionPolicy Bypass -File "' +
      path.join(root, 'Sync-WebPublish.ps1') +
      '" -DirectorRoot "' + root + '" -WebDir "' + tmpWeb + '"',
    { encoding: 'utf8' }
  );
  assert(/PUBLISH_CHANGED=0/.test(out2), 'second sync reports no changes');
} catch (e) {
  if (e.message.indexOf('ENOENT') >= 0 || e.message.indexOf('not found') >= 0) {
    console.log('skip pwsh integration (pwsh missing on this VM)');
  } else {
    assert(false, 'pwsh sync run: ' + e.message);
  }
}

try { fs.rmSync(tmpWeb, { recursive: true, force: true }); } catch (eRm) {}

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('publish-incremental ok');