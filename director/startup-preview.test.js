/*
 * node director/startup-preview.test.js
 * Early browser open, JVM startup flags, slim director shell, boot health copy.
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

var root = path.join(__dirname);
var ps1 = fs.readFileSync(path.join(root, 'Run-Director.ps1'), 'utf8');
var sync = fs.readFileSync(path.join(root, 'Sync-WebPublish.ps1'), 'utf8');
var sources = require('./test-director-sources').loadDirectorSources();

assert(ps1.indexOf('function Open-DirectorBrowser') !== -1, 'Run-Director has Open-DirectorBrowser');
assert(ps1.indexOf('function Invoke-F1DirectorStartupCleanup') !== -1, 'conditional startup cleanup');
assert(/if \(-not \(Test-DirectorPort8720Free\)\) \{[\s\S]*Invoke-F1DirectorStartupCleanup/.test(ps1),
  'skip cleanup when 8720 already free');
assert(ps1.indexOf('Test-DirectorBindLikelyFailed') !== -1, 'bind-fail detection for one-shot retry');
var loopPos = ps1.indexOf('for ($startAttempt = 0; $startAttempt -lt 2; $startAttempt++)');
var openPos = ps1.indexOf('Open-DirectorBrowser', loopPos);
var waitPos = ps1.indexOf("Write-Host 'Waiting for http://127.0.0.1:8720/api/health", loopPos);
assert(loopPos >= 0 && openPos > loopPos && waitPos > openPos,
  'inside start loop: Java start, then browser, then health wait');
assert((ps1.match(/Start-Process -FilePath \$browser/g) || []).length === 1,
  'single browser launch via Open-DirectorBrowser');

assert(ps1.indexOf('-XX:+TieredCompilation') !== -1, 'JVM TieredCompilation flag');
assert(ps1.indexOf('-XX:TieredStopAtLevel=1') !== -1, 'JVM TieredStopAtLevel=1 flag');

assert(sync.indexOf("director.css") !== -1, 'Sync publishes director.css');
assert(sync.indexOf("director-app.js") !== -1, 'Sync publishes director-app.js');

assert(sources.html.indexOf('<link rel="stylesheet" href="director.css">') !== -1, 'shell links CSS');
assert(sources.html.indexOf('<script src="director-app.js"></script>') !== -1, 'shell loads app JS');
assert(sources.css.length > 10000, 'director.css extracted');
assert(sources.app.length > 50000, 'director-app.js extracted');

assert(sources.app.indexOf('healthEverOk') !== -1, 'boot health tracks first success');
assert(sources.app.indexOf('HEALTH_BOOT_POLL_MS') !== -1, 'faster boot health polling');
assert(sources.app.indexOf('正在连接服务') !== -1, 'boot status copy in app');
assert(sources.html.indexOf('正在连接服务') !== -1, 'boot status copy in HTML');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('startup-preview ok');