/*
 * node director/pack-release.test.js
 * Static checks for Pack-Release (no share\jre required).
 */
'use strict'

var fs = require('fs')
var path = require('path')

var failed = 0
function assert(cond, msg) {
  if (!cond) {
    failed++
    console.error('FAIL ' + msg)
  }
}

var root = path.join(__dirname, '..')
var ps1 = fs.readFileSync(path.join(__dirname, 'Pack-Release.ps1'), 'utf8')
var cmd = fs.readFileSync(path.join(__dirname, 'Pack-Release.cmd'), 'utf8')
var publish = fs.readFileSync(path.join(__dirname, 'Publish-Web.cmd'), 'utf8')
var version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()

assert(version === '0.2.17+20261122', 'VERSION is 0.2.17+20261122')
assert(cmd.indexOf('Pack-Release.ps1') !== -1, 'wrapper invokes Pack-Release.ps1')
assert(ps1.indexOf('Publish-Web.cmd') !== -1, 'pack runs Publish-Web')
assert(ps1.indexOf('D:\\Develop') !== -1, 'default output under D:\\Develop')
assert(ps1.indexOf('Compress-Archive') === -1, 'does not use Compress-Archive')
assert(ps1.indexOf(' tar ') === -1 && ps1.indexOf('tar -a') === -1, 'does not use tar -a')
assert(ps1.indexOf('ZipFile') !== -1, 'uses ZipFile for UTF-8 entries')
assert(ps1.indexOf("'--output'") !== -1, 'jlink uses --output not -o')
assert(ps1.indexOf("'-o',") === -1, 'jlink does not use short -o')
assert(ps1.indexOf('Set-ZipUtf8LanguageFlags') !== -1, 'post-pass sets ZIP UTF-8 name flags')
assert(ps1.indexOf('0x0800') !== -1, 'ORs GP bit 11 (0x800) into zip entry flags')
assert(ps1.indexOf('jdk.crypto.ec') !== -1, 'minijre lists crypto modules')
assert(ps1.indexOf('jdk.httpserver') !== -1, 'minijre lists httpserver')
assert(ps1.indexOf('docs') !== -1 && ps1.indexOf('.git') !== -1, 'excludes docs and .git')
assert(ps1.indexOf('*.bak') !== -1, 'excludes bak jars')
assert(ps1.indexOf('with-jre-win64.zip') !== -1, 'with-jre zip name')
assert(ps1.indexOf('with-minijre-win64.zip') !== -1, 'with-minijre zip name')
assert(ps1.indexOf('SHA256') !== -1 || ps1.indexOf('SHA-256') !== -1, 'prints SHA-256')
assert(ps1.indexOf('WhatIf') !== -1, 'supports -WhatIf')
assert(ps1.indexOf('Stop-Process') === -1 && ps1.indexOf('taskkill') === -1, 'does not kill Java/Director')
assert(publish.indexOf('Sync-WebPublish.ps1') !== -1, 'Publish-Web still uses Sync-WebPublish')

if (failed) {
  process.exit(1)
}
console.log('OK pack-release')