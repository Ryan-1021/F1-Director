/*
 * node director/web-override/messages-patch.test.js
 * 赛事通报就地改行：同一列表节点、未变化的行节点不拆掉，滚动位置不被写回顶部。
 * 中文 / 英文原文 / 时间 / 类别的显示约定不变。不进 share/web。
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

function extractFunction(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'found ' + name);
  if (start < 0) return '';
  var i = src.indexOf('{', start);
  var depth = 0;
  var quote = '';
  for (; i < src.length; i++) {
    var c = src.charAt(i);
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src.charAt(i + 1) === '/') {
      var nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert(false, 'unclosed ' + name);
  return '';
}

function hasClass(el, cls) {
  return (' ' + (el.className || '') + ' ').indexOf(' ' + cls + ' ') !== -1;
}

function createNode(tag) {
  var node = {
    nodeType: 1,
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    title: '',
    childNodes: [],
    parentNode: null,
    scrollTop: 0
  };
  node.classList = {
    contains: function (c) { return hasClass(node, c); },
    add: function (c) { if (!hasClass(node, c)) node.className = (node.className + ' ' + c).replace(/^\s+/, ''); },
    remove: function (c) {
      node.className = (node.className || '').split(/\s+/).filter(function (x) { return x && x !== c; }).join(' ');
    },
    toggle: function (c, force) {
      var on = hasClass(node, c);
      var want = (force === undefined) ? !on : !!force;
      if (want) node.classList.add(c);
      else node.classList.remove(c);
    }
  };
  Object.defineProperty(node, 'children', { get: function () { return node.childNodes; } });
  Object.defineProperty(node, 'firstChild', { get: function () { return node.childNodes[0] || null; } });
  Object.defineProperty(node, 'textContent', {
    get: function () {
      if (!node.childNodes.length) return node._text || '';
      var s = '';
      for (var i = 0; i < node.childNodes.length; i++) s += node.childNodes[i].textContent;
      return s;
    },
    set: function (v) {
      node.childNodes = [];
      node._text = v == null ? '' : String(v);
    }
  });
  node.appendChild = function (child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = node;
    node.childNodes.push(child);
    return child;
  };
  node.removeChild = function (child) {
    var idx = node.childNodes.indexOf(child);
    if (idx < 0) throw new Error('not a child');
    node.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  };
  node.replaceChild = function (next, prev) {
    var idx = node.childNodes.indexOf(prev);
    if (idx < 0) throw new Error('not a child');
    if (next.parentNode) next.parentNode.removeChild(next);
    next.parentNode = node;
    prev.parentNode = null;
    node.childNodes[idx] = next;
    return prev;
  };
  return node;
}

var app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
var renderSrc = extractFunction(app, 'renderMessages');
assert(renderSrc.indexOf('clear(box)') === -1, 'renderMessages does not clear the box');
assert(renderSrc.indexOf('scrollTop') === -1, 'renderMessages does not assign scrollTop');

var names = ['fmtClock', 'el', 'clear', 'msgLine', 'msgTime', 'childByClass', 'fillMessageMeta', 'buildMessageRow', 'patchMessageMeta', 'patchMessageRow', 'syncMessagesPopButton', 'renderMessages'];
var body = names.map(function (name) { return extractFunction(app, name); }).join('\n');

var sandbox = {
  document: { createElement: function (tag) { return createNode(tag); } },
  state: null,
  ONCE: true,
  panelTitleCalls: 0,
  panelTitle: function (box, text) {
    sandbox.panelTitleCalls++;
    var t = sandbox.document.createElement('div');
    t.className = 'ptitle';
    var label = sandbox.document.createElement('span');
    label.className = 'ptitle-text';
    label.textContent = text;
    t.appendChild(label);
    box.appendChild(t);
  }
};
vm.createContext(sandbox);
vm.runInContext('var state = null;\nvar ONCE = true;\n' + body, sandbox);

function childByClass(parent, cls) {
  var kids = parent.children;
  for (var i = 0; i < kids.length; i++) {
    if (kids[i].classList.contains(cls)) return kids[i];
  }
  return null;
}

function render(box) {
  sandbox.renderMessages(box);
}

var epoch = Date.UTC(2026, 10, 21, 8, 7, 5);
var clock = sandbox.fmtClock(epoch);

function rowText(row) {
  return childByClass(row, 'mtext').textContent;
}

var box = createNode('div');
box.scrollTop = 80;
sandbox.state = { messages: [] };
render(box);
assert(childByClass(box, 'sub').textContent === '还没有通报', 'empty copy');
assert(!childByClass(box, 'msgs'), 'empty has no list');
assert(box.scrollTop === 80, 'empty render does not touch scrollTop');

var first = {
  gloss: '安全车出动',
  text: 'SAFETY CAR DEPLOYED',
  time: epoch,
  category: 'SC',
  utc: 'utc-a'
};
var second = { text: 'GREEN FLAG', time: '12:00:01', flag: 'GREEN' };
sandbox.state = { messages: [first, second] };
render(box);
var list = childByClass(box, 'msgs');
assert(!!list && list.children.length === 2, 'two rows');
assert(!childByClass(box, 'sub'), 'empty note removed');
assert(box.scrollTop === 80, 'first fill does not touch scrollTop');
var row0 = list.children[0];
var row1 = list.children[1];
var text0 = childByClass(row0, 'mtext');
var text1 = childByClass(row1, 'mtext');
var time0 = childByClass(childByClass(row0, 'mmeta'), 'mtime');
assert(row0.classList.contains('newest') && !row1.classList.contains('newest'), 'newest is the first row only');
assert(text0.textContent === '安全车出动', 'translated Chinese is the primary line');
assert(childByClass(childByClass(row0, 'mmeta'), 'morig').textContent === 'SAFETY CAR DEPLOYED', 'English sits on the meta row');
assert(time0.textContent === clock, 'epoch time is a clock');
assert(childByClass(childByClass(row0, 'mmeta'), 'mcat').textContent === 'SC', 'category chip');
assert(row0.title === 'utc-a', 'utc title');
assert(text1.textContent === 'GREEN FLAG', 'untranslated line shows the original text');
assert(!childByClass(childByClass(row1, 'mmeta'), 'morig'), 'no English duplicate when it was not translated');
assert(childByClass(childByClass(row1, 'mmeta'), 'mtime').textContent === '12:00:01', 'string time is kept');
assert(childByClass(childByClass(row1, 'mmeta'), 'mcat').textContent === 'GREEN', 'flag is the category fallback');
assert(row1.title === '', 'no utc means empty title');

second.text = 'GREEN FLAG WAVING';
box.scrollTop = 140;
render(box);
assert(childByClass(box, 'msgs') === list, 'routine update keeps the list node');
assert(list.children[0] === row0 && list.children[1] === row1, 'unchanged row nodes stay');
assert(childByClass(row1, 'mtext') === text1, 'patched text node stays');
assert(text1.textContent === 'GREEN FLAG WAVING', 'patched row shows the new text');
assert(childByClass(childByClass(row0, 'mmeta'), 'mtime') === time0, 'unchanged time node stays');
assert(box.scrollTop === 140, 'routine update does not jump scrollTop');

var third = {
  gloss: '虚拟安全车',
  text: 'VIRTUAL SAFETY CAR',
  time: '12:00:02',
  category: 'VSC',
  utc: 'utc-c'
};
sandbox.state = { messages: [third, first, second] };
render(box);
assert(childByClass(box, 'msgs') === list, 'prepend keeps the list node');
assert(list.children[0] === row0 && list.children[1] === row1, 'prepend reuses existing row nodes');
assert(list.children.length === 3, 'prepend appends the extra row');
assert(rowText(list.children[0]) === '虚拟安全车', 'index 0 shows the new message');
assert(rowText(list.children[1]) === '安全车出动', 'shifted row shows the previous newest');
assert(rowText(list.children[2]) === 'GREEN FLAG WAVING', 'new row shows the tail');
assert(list.children[0].classList.contains('newest') && !list.children[1].classList.contains('newest'), 'newest class follows index 0');
assert(list.children[0].title === 'utc-c', 'patched utc');
assert(box.scrollTop === 140, 'prepend does not jump scrollTop');

delete third.category;
third.gloss = 'VIRTUAL SAFETY CAR';
render(box);
assert(list.children[0] === row0, 'shape change keeps the row');
assert(rowText(row0) === 'VIRTUAL SAFETY CAR', 'gloss without Chinese shows the original');
assert(!childByClass(childByClass(row0, 'mmeta'), 'mcat'), 'category removal drops the chip');
assert(!childByClass(childByClass(row0, 'mmeta'), 'morig'), 'identical English is not repeated');
assert(box.scrollTop === 140, 'shape change does not jump scrollTop');

sandbox.state = { messages: [third] };
render(box);
assert(list.children.length === 1 && list.children[0] === row0, 'shrink keeps the first row node');
assert(box.scrollTop === 140, 'shrink does not jump scrollTop');

sandbox.state = { messages: [] };
render(box);
assert(!childByClass(box, 'msgs'), 'clearing the bulletin removes the list');
assert(childByClass(box, 'sub').textContent === '还没有通报', 'empty copy returns');
assert(box.scrollTop === 140, 'empty transition does not assign scrollTop');

sandbox.ONCE = false;
sandbox.panelTitleCalls = 0;
var titled = createNode('div');
sandbox.state = { messages: [first] };
sandbox.renderMessages(titled);
sandbox.renderMessages(titled);
var titles = 0;
for (var ti = 0; ti < titled.children.length; ti++) {
  if (titled.children[ti].classList.contains('ptitle')) titles++;
}
assert(titles === 1 && sandbox.panelTitleCalls === 1, 'title is added once');
assert(childByClass(titled, 'msgs').children.length === 1, 'titled board still has its row');
assert(childByClass(childByClass(titled, 'ptitle'), 'ptitle-text').textContent === '赛事通报', 'title copy');

var popBtn = createNode('button');
popBtn.className = 'p-pop';
popBtn.textContent = '弹出';
childByClass(titled, 'ptitle').appendChild(popBtn);
sandbox.popButton = function () {
  var b = createNode('button');
  b.className = 'p-pop on';
  b.textContent = '收回';
  return b;
};
var rowBeforePop = childByClass(titled, 'msgs').children[0];
sandbox.renderMessages(titled);
var poppedBtn = childByClass(childByClass(titled, 'ptitle'), 'p-pop');
assert(poppedBtn && poppedBtn !== popBtn && poppedBtn.textContent === '收回', 'existing pop button is refreshed in place');
assert(childByClass(titled, 'msgs').children[0] === rowBeforePop, 'refreshing the pop button keeps the row');

sandbox.ONCE = true;
var onceBox = createNode('div');
sandbox.state = { messages: [first] };
sandbox.renderMessages(onceBox);
assert(!childByClass(onceBox, 'ptitle'), 'once mode does not add a title');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('ok');
