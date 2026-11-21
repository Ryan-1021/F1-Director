'use strict';

var fs = require('fs');
var path = require('path');

var dir = __dirname;

function loadDirectorSources() {
  var html = fs.readFileSync(path.join(dir, 'director.html'), 'utf8');
  var app = fs.readFileSync(path.join(dir, 'director-app.js'), 'utf8');
  var css = fs.readFileSync(path.join(dir, 'director.css'), 'utf8');
  return {
    html: html,
    app: app,
    css: css,
    bundle: html + '\n' + app + '\n' + css
  };
}

module.exports = { loadDirectorSources };