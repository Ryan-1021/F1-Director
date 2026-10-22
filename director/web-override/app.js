/*
 * F1 Director —— 界面逻辑（主界面和独立看板共用这一份）。
 *
 * ## 为什么只有这一份
 * 需求是"网页版显示安卓同款 UI"，而且 Windows 客户端就是把看板拉成独立窗口。
 * 如果 Windows 侧另写一套渲染，就有两份真相，迟早不一致。
 * 所以：数据来自 Java 侧的 F1Feed（安卓同一份源码），几何来自 F1Layout
 * （也是安卓同一份算术），颜色直接下发 TrackState 算好的 ARGB —— 这一层
 * 只负责画。
 */
(function () {

  var STORAGE_THEME = 'f1-director-theme';

  var themeRedrawTimer = null;

  function scheduleThemeCanvasRedraw() {
    if (themeRedrawTimer) clearTimeout(themeRedrawTimer);
    themeRedrawTimer = setTimeout(function () {
      themeRedrawTimer = null;
      // Canvas boards bake day/night colors into pixels; CSS vars alone are not enough.
      try {
        if (typeof repaint === 'function') { repaint(); return; }
      } catch (e) {}
      try {
        var boxes = document.querySelectorAll('.b-trackmap');
        for (var i = 0; i < boxes.length; i++) drawTrackmap(boxes[i]);
      } catch (e2) {}
    }, 0);
  }

  function applyTheme(theme) {
    theme = (theme === 'day') ? 'day' : 'night';
    document.documentElement.setAttribute('data-theme', theme);
    try {
      var metas = document.getElementsByName('color-scheme');
      if (metas && metas[0]) {
        metas[0].setAttribute('content', theme === 'day' ? 'light' : 'dark');
      }
    } catch (e) {}
    scheduleThemeCanvasRedraw();
  }

  function loadThemeFromStorage() {
    var saved = 'night';
    try {
      var v = localStorage.getItem(STORAGE_THEME);
      if (v === 'day' || v === 'night') saved = v;
    } catch (e) {}
    applyTheme(saved);
  }

  // Apply as early as possible to avoid night flash when day is saved.
  loadThemeFromStorage();

  'use strict';

  // ★ 脚本出错必须**看得见**。
  //   这里踩过一次真实的坑：接口全 200、页面顶部也画出来了，但主体一片空白，
  //   而 HTTP 状态码和服务器日志里没有任何异常 —— 因为错在前端。
  //   静默失败是最难查的一类，所以把错误直接糊到页面上、并写进标题。
  window.addEventListener('error', function (ev) {
    var msg = (ev && ev.message) || '未知错误';
    // Chrome/Edge benign: ResizeObserver callback caused layout in the same frame.
    if (/ResizeObserver loop/i.test(msg)) return;
    try {
      document.title = 'JS错误: ' + msg;
      if (document.getElementById('jserr')) { return; }
      var box = document.createElement('div');
      box.id = 'jserr';
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#7f1d1d;'
        + 'color:#fff;padding:6px 10px;font-size:12px;z-index:99;font-family:monospace';
      box.textContent = '界面脚本出错：' + msg;
      (document.body || document.documentElement).appendChild(box);
    } catch (e) { /* 连报错都失败了，只能算了 */ }
  });

  var state = null;
  var es = null;
  var connected = false;
  var lastPush = 0;
  var errNote = '';

  // 哪些看板已经拉成了独立小窗。★ 以服务器为准，前端不自己记账：
  // 用户可能直接用窗口的 X 关掉，前端根本收不到那个事件。
  var popped = {};

  // 这个页面所在的设备能不能让服务器开/关窗口（服务器按来源是不是回环判断）。
  // 手机上为 false —— 那时显示"收回全部"是在骗人：那些窗口不在这台设备上。
  var canNative = false;

  // 圆环量不到尺寸时允许补几次重绘（见 renderRing）。
  var refitLeft = 3;

  // 手机横屏时右栏显示哪一屏（安卓默认是"赛段状态"，也就是圆环）。
  var mobilePanel = 'ring';
  // 手机状态行上的一句临时提示（比如"全屏没成功"）—— 手机版没有头部，
  // 消息只能挂在这一行上。几秒后自己消失。
  var phoneNotice = '';

  // 手机右栏那条窄框图标 —— 和安卓 RightPanelView 的 MODE_ICONS/MODE_NAMES 一一对应：
  //   0 ◎ 赛段状态(圆环)  1 ◍ 轮胎  2 ≡ 成绩  3 ☂ 天气  4 ⏱ 最快圈  5 ⓘ 环节
  // 用单字符是为了不依赖任何字体资源（安卓那边也是这个理由）。
  var PHONE_MODES = [
    ['ring', '◎', '赛段状态（圆环）'],
    ['tyres', '◍', '轮胎 / 进站'],
    ['timing', '≡', '成绩榜'],
    ['weather', '☂', '天气'],
    ['fastest', '⏱', '最快圈'],
    ['session', 'ⓘ', '环节']
  ];

  // `?once=1` —— 静态快照模式：只拉一次 /api/state 画出来，然后**不挂 SSE**。
  // 两个用处：① 无头浏览器截图/DOM 校验时不会因为挂着长连接而卡住
  //         ② 只想看一眼当前状态、不想维持推流（比如手机省电）也可以用
  var ONCE = /(^|[?&])once=1(&|$)/.test(location.search);

  // ---------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------

  /** Android 的 ARGB int -> CSS 颜色。 */
  function argb(v) {
    if (v === null || v === undefined) { return '#777'; }
    var n = v >>> 0;
    var a = ((n >>> 24) & 255) / 255;
    var r = (n >>> 16) & 255, g = (n >>> 8) & 255, b = n & 255;
    if (a === 0) { a = 1; }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined && text !== null) { e.textContent = String(text); }
    return e;
  }

  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }


  /**
   * Tyre compound → single colored letter (S/M/H/I/W).
   * Prefer English API field (SOFT/MEDIUM/…) over Chinese labels.
   */
  var COMPOUND_LETTER = {
    SOFT: 'S', S: 'S',
    MEDIUM: 'M', M: 'M',
    HARD: 'H', H: 'H',
    INTERMEDIATE: 'I', INTER: 'I', I: 'I',
    WET: 'W', FULLWET: 'W', W: 'W'
  };
  var COMPOUND_COLOR = {
    S: '#e10600',
    M: '#ffd12e',
    H: '#f0f0f0',
    I: '#43b02a',
    W: '#0090ff'
  };

  function parseCompoundToken(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s || s === '—' || s === '-') return null;
    var u = s.toUpperCase().replace(/\s+/g, '');
    if (COMPOUND_LETTER[u]) return COMPOUND_LETTER[u];
    // English substrings
    if (/SOFT/.test(u)) return 'S';
    if (/MEDIUM/.test(u)) return 'M';
    if (/HARD/.test(u)) return 'H';
    if (/INTER/.test(u)) return 'I';
    if (/WET/.test(u)) return 'W';
    // Chinese (order: specific before bare 中)
    if (/半雨/.test(s)) return 'I';
    if (/全雨/.test(s)) return 'W';
    if (/软/.test(s)) return 'S';
    if (/硬/.test(s)) return 'H';
    // 中性胎 / 中胎 = Medium (broadcast); bare 中性 from old feed = Intermediate
    if (/中性胎|中胎/.test(s)) return 'M';
    if (s === '中性') return 'I';
    if (s === '中' || /^中$/.test(s)) return 'M';
    if (/雨/.test(s)) return 'W';
    return null;
  }

  function compoundInfo(en, cn) {
    var letter = parseCompoundToken(en) || parseCompoundToken(cn);
    if (!letter) {
      return { letter: '—', key: 'unk', color: '' };
    }
    return { letter: letter, key: letter, color: COMPOUND_COLOR[letter] || '' };
  }

  /** Build a <span class="ttyre comp-S">S</span> badge. */
  function compoundBadge(en, cn) {
    var info = compoundInfo(en, cn);
    var span = el('span', 'ttyre' + (info.key ? (' comp-' + info.key) : ' comp-unk'), info.letter);
    if (info.color) {
      span.style.color = info.color;
      span.style.borderColor = info.color;
    }
    span.title = String(en || cn || '').trim() || info.letter;
    return span;
  }


  /** 旗语颜色。★ 这**不是**从安卓下发的（只有聚合色下发），属于待对齐项。 */
  var KIND_COLOR = {
    'RED': '#d32f2f', 'RED_FLAG': '#d32f2f',
    'SC': '#ffb300', 'SAFETY_CAR': '#ffb300',
    'VSC': '#ffd54f', 'VIRTUAL_SC': '#ffd54f', 'VIRTUAL_SAFETY_CAR': '#ffd54f',
    'DOUBLE_YELLOW': '#f9a825', 'DYK': '#f9a825',
    'YELLOW': '#fdd835',
    'GREEN': '#43a047', 'CLEAR': '#43a047',
    'CHEQUERED': '#eeeeee', 'CHEQUERED_FLAG': '#eeeeee',
    'BLUE': '#1e88e5', 'BLACK': '#212121',
    'WHITE': '#fafafa', 'BLACK_WHITE': '#9e9e9e'
  };

  function kindColor(k) {
    if (!k) { return '#546e7a'; }
    if (KIND_COLOR[k]) { return KIND_COLOR[k]; }
    var up = String(k).toUpperCase().replace(/\s+/g, '_');
    if (KIND_COLOR[up]) { return KIND_COLOR[up]; }
    return '#546e7a';
  }

  function fmtClock(ms) {
    if (!ms) { return '—'; }
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /** 相对"多久以前"，比绝对时间有用（数据是 10Hz 推的）。 */
  function ago(ms) {
    if (!ms) { return '—'; }
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 2) { return '刚刚'; }
    if (s < 60) { return s + ' 秒前'; }
    return Math.round(s / 60) + ' 分钟前';
  }

  // ---------------------------------------------------------------
  // 弹出 / 收回独立小窗
  // ---------------------------------------------------------------

  /** 现在渲染的是主界面（而不是某个独立看板页）。 */
  function inMain() { return !!document.getElementById('main'); }

  /**
   * 问服务器：每块看板现在弹出来了没有。
   *
   * 为什么要问：用户可以直接用窗口的 X 关掉小窗，前端收不到通知。
   * 所以按钮上的"已弹出"不能靠前端自己记，只能问出来。
   */
  function refreshPopped() {
    fetch('/api/boards', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var next = {};
        (d.boards || []).forEach(function (b) { if (b.popped) { next[b.id] = true; } });
        var cn = !!d.canNative;
        if (JSON.stringify(next) !== JSON.stringify(popped) || cn !== canNative) {
          popped = next;
          canNative = cn;
          repaint();
        }
      })
      .then(null, function () { /* 问不到就维持现状，别因此报错 */ });
  }

  /**
   * 点一下 → 弹出 / 收回。
   *
   * 是"开原生窗口"还是"开新标签页"由**服务器**决定，前端不猜：
   *   - 本机：服务器能开窗口，就开原生小窗
   *   - 手机 / 局域网设备：服务器没法在手机上开窗口，返回 mode=tab，
   *     这里再 window.open 一个新标签页
   * 猜错的后果是"点了没反应"，那比多一次往返难受得多。
   */
  function popout(id) {
    fetch('/api/popout/' + id, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.mode === 'tab' && d.url) {
          var w = window.open(d.url, '_blank');
          if (!w) {
            errNote = '浏览器拦住了弹出窗口，请允许后重试';
            repaint();
          }
          return;
        }
        if (d && d.reason) { errNote = d.reason; }
        popped[id] = !!(d && d.popped);
        repaint();
      })
      .then(null, function (e) {
        errNote = '弹出失败：' + ((e && e.message) || e);
        repaint();
      });
  }

  /** 标题栏右侧的"弹出 / 收回"按钮。 */
  function popButton(id) {
    var on = !!popped[id];
    var b = el('button', 'p-pop' + (on ? ' on' : ''));
    b.type = 'button';
    b.textContent = on ? '收回' : '弹出';
    b.title = on
      ? '收回：关掉这块看板的独立窗口'
      : '把这块看板拉成独立小窗（手机上是新标签页）';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();   // 免得标题栏再触发一次
      popout(id);
    });
    return b;
  }

  /**
   * 一键收回所有弹出去的小窗。
   *
   * 只在本机显示这个按钮（canNative），因为那些窗口在**服务器这台电脑**上：
   * 手机上是关不掉的，摆个按钮只会让人以为点了没用。
   */
  function closeAllPoppedAction() {
    fetch('/api/popout/all', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) { errNote = d.error; }
        popped = {};
        repaint();
      })
      .then(null, function (e) {
        errNote = '收回失败：' + ((e && e.message) || e);
        repaint();
      });
  }

  /** 「收回全部 (N)」按钮；没有小窗或不在本机时返回 null。 */
  function popAllButton() {
    var n = 0;
    for (var k in popped) { if (popped[k]) { n++; } }
    if (!n || !canNative) { return null; }
    var b = el('button', 'p-pop p-pop-all');
    b.type = 'button';
    b.textContent = '收回全部 (' + n + ')';
    b.title = '一次关掉所有弹出去的小窗（主界面会留着）';
    b.addEventListener('click', closeAllPoppedAction);
    return b;
  }

  /** 一条面板标题栏。带 data-board 且在主界面时，右侧就有弹出按钮。 */
  function titleRow(text, id) {
    var t = el('div', 'ptitle');
    t.appendChild(el('span', 'ptitle-text', text));
    if (id && inMain()) {
      t.appendChild(popButton(id));
      t.classList.add('p-click');
      t.title = '点标题栏也能把这块看板拉成独立小窗';
      t.addEventListener('click', function (ev) {
        if (ev.target && ev.target.classList
            && ev.target.classList.contains('p-pop')) {
          return;   // 按钮自己处理
        }
        popout(id);
      });
    }
    return t;
  }

  // ---------------------------------------------------------------
  // 各看板渲染
  // ---------------------------------------------------------------

  function renderFlags(box) {
    clear(box);
    var st = state;
    var bar = (st && st.bar) || [];
    var track = (st && st.track) || {};
    var wrap = el('div', 'flags');
    wrap.style.background = argb(track.color);

    if (!bar.length) {
      // ★ 无旗语也要"有东西"：显示一整条绿，写明全畅通和区段范围。
      //   之前这里是"赛道正常（Inactive）"一行字，看板上 2/3 是空白，
      //   看起来像坏了 —— 而且"全部区段都正常"本身就是有用的信息。
      var n = (state && state.ring && state.ring.count) || 0;
      var green = el('div', 'flag-seg');
      green.style.flexGrow = '1';
      green.style.background = kindColor('GREEN');
      green.appendChild(el('div', 'flag-kind',
        n ? ('GREEN  区段 1-' + n) : 'GREEN  全赛道畅通'));
      wrap.appendChild(green);
    } else {
      for (var i = 0; i < bar.length; i++) {
        var seg = bar[i];
        var d = el('div', 'flag-seg');
        // 几何来自 F1Layout（千分比），这里只按容器宽度缩放
        d.style.flexGrow = String(seg.width || 1);
        d.style.background = kindColor(seg.kind);
        var line = seg.kind + (seg.sectors ? ('  区段 ' + seg.sectors) : '');
        d.appendChild(el('div', 'flag-kind', line));
        wrap.appendChild(d);
      }
    }
    box.appendChild(wrap);
  }

  function renderRing(box) {
    clear(box);
    var st = state;
    var ring = (st && st.ring) || { count: 0, starts: [], sweep: 0 };
    var track = (st && st.track) || {};

    // ★ 画布必须是正方形，而且尺寸要用 px 写死。
    //
    //   踩过的坑：原来是 cv.style.width/height = 100%，像素尺寸却取自
    //   box.clientWidth/clientHeight。两者只要不等（盒子有 padding、或者首次
    //   渲染时还没布局、clientWidth 取到 0 走了 320 的回退、又或者用户把窗口
    //   拉大后没有重新测量），CSS 就会把画布**拉伸** —— 圆变成椭圆，
    //   而且拉伸一定糊。
    //   现在：短边 = 边长，画布 px 尺寸 == 像素尺寸/dpr，任何时候都不会被拉伸。
    var avail = Math.min(box.clientWidth || 0, box.clientHeight || 0);
    if (!avail) {
      avail = 320;   // 还没布局就先按 320 画，下一次重绘会纠正过来
      // 但如果这是 ?once=1 快照模式、或者容器还是隐藏的，就没有"下一次"了，
      // 所以主动补一次重绘（有次数上限，避免量不到时无限刷帧）。
      if (refitLeft > 0) {
        refitLeft--;
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(function () { repaint(); });
        } else {
          setTimeout(function () { repaint(); }, 16);
        }
      }
    } else {
      refitLeft = 3;
    }
    var side = Math.max(80, Math.round(avail));
    var dpr = window.devicePixelRatio || 1;

    var cv = el('canvas', 'ring');
    cv.setAttribute('data-fit', box.clientWidth + 'x' + box.clientHeight);
    cv.style.width = side + 'px';
    cv.style.height = side + 'px';
    cv.width = Math.max(1, Math.round(side * dpr));
    cv.height = Math.max(1, Math.round(side * dpr));
    box.appendChild(cv);

    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    var cx = side / 2, cy = side / 2;
    var rOut = side * 0.42;
    var rIn = rOut * 0.62;

    var n = ring.count || 0;
    var day = document.documentElement.getAttribute('data-theme') === 'day';
    if (!n) {
      g.fillStyle = day ? '#5b6b7c' : '#546e7a';
      g.font = '600 13px "Noto Sans SC", Segoe UI, Microsoft YaHei, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('还没有区段数据', cx, cy);
      return;
    }

    var dy = {}; (track.doubleYellowSectors || []).forEach(function (x) { dy[x] = 1; });
    var ye = {}; (track.yellowSectors || []).forEach(function (x) { ye[x] = 1; });

    for (var i = 0; i < n; i++) {
      // ★ F1Layout 约定：0 度 = 12 点、顺时针。Canvas 的 0 度 = 3 点，
      //   所以这里减 90 —— F1Layout 的注释专门警告过这个 off-by-90。
      var startDeg = (ring.starts[i] !== undefined ? ring.starts[i] : i * (360 / n)) - 90;
      var endDeg = startDeg + (ring.sweep || 360 / n);
      var a0 = startDeg * Math.PI / 180, a1 = endDeg * Math.PI / 180;

      var sec = i + 1;
      var col = '#37474f';
      if (dy[sec]) { col = '#f9a825'; } else if (ye[sec]) { col = '#fdd835'; }
      if (track.level >= 6) { col = '#d32f2f'; }

      g.beginPath();
      g.arc(cx, cy, rOut, a0, a1);
      g.arc(cx, cy, rIn, a1, a0, true);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      g.strokeStyle = day ? '#c5ced9' : '#0d1117';
      g.lineWidth = 1.5;
      g.stroke();

      // 区段号（宽了才画，和 F1Layout.labelFits 一个意思）
      var mid = (a0 + a1) / 2;
      var rl = (rOut + rIn) / 2;
      var lx = cx + Math.cos(mid) * rl, ly = cy + Math.sin(mid) * rl;
      if ((2 * Math.PI * rIn) / n >= 16) {
        // Labels sit on colored sectors (dark/yellow/red); keep light ink.
        g.fillStyle = '#eceff1';
        g.font = '600 11px "Noto Sans SC", Segoe UI, system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(sec), lx, ly);
      }
    }

    g.fillStyle = argb(track.color);
    g.beginPath();
    g.arc(cx, cy, rIn * 0.92, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = argb(track.textColor);
    g.font = '700 15px Segoe UI, Microsoft YaHei, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(track.label || '', cx, cy - 8);
    g.font = '11px Segoe UI, Microsoft YaHei, system-ui, sans-serif';
    g.fillText(ago(track.updatedAt), cx, cy + 12);
  }

  /** 面板标题。看板页里没有 data-board，自然就不会出现弹出按钮。 */
  function panelTitle(box, text) {
    box.appendChild(titleRow(text, box.getAttribute('data-board')));
  }

  function renderTrack(box) {
    clear(box);
    if (!ONCE) panelTitle(box, '赛道状态');
    var st = state, track = (st && st.track) || {};
    var wrap = el('div', 'track');
    var hero = el('div', 'track-hero');
    hero.appendChild(el('div', 'big', track.label || '—'));
    if (track.detail) { hero.appendChild(el('div', 'sub', track.detail)); }
    wrap.appendChild(hero);
    var kinds = track.kinds || [];
    if (kinds.length) {
      var list = el('div', 'kinds');
      for (var i = 0; i < kinds.length; i++) {
        var chip = el('span', 'chip', kinds[i]);
        chip.style.background = kindColor(kinds[i]);
        list.appendChild(chip);
      }
      wrap.appendChild(list);
    } else {
      wrap.appendChild(el('div', 'sub', '暂无额外旗语状态'));
    }
    box.appendChild(wrap);
  }

  function renderTyres(box) {
    clear(box);
    if (!ONCE) panelTitle(box, '轮胎进站');
    var cars = ((state && state.cars) || []).slice();
    cars.sort(function (a, b) {
      var pa = parseInt(a.position, 10), pb = parseInt(b.position, 10);
      if (!isNaN(pa) && !isNaN(pb) && pa !== pb) return pa - pb;
      if (!isNaN(pa) && isNaN(pb)) return -1;
      if (isNaN(pa) && !isNaN(pb)) return 1;
      return String(a.tla || '').localeCompare(String(b.tla || ''));
    });
    var wrap = el('div', 'tyres');
    for (var i = 0; i < cars.length; i++) {
      var car = cars[i];
      var d = el('div', 'tcell' + (car.inPit ? ' inpits' : '') + (car.retired ? ' retired' : ''));
      d.appendChild(el('span', 'tpos', car.position || '—'));
      d.appendChild(el('span', 'ttla', car.tla || ''));
      d.appendChild(compoundBadge(car.compound, car.compoundCn));
      d.appendChild(el('span', 'tlaps', car.tyreLaps ? (car.tyreLaps + '圈') : '—'));
      if (car.pitStops) { d.appendChild(el('span', 'tpit', 'P' + car.pitStops)); }
      wrap.appendChild(d);
    }
    if (!cars.length) {
      wrap.appendChild(el('div', 'sub', '还没有轮胎 / 进站数据'));
    }
    box.appendChild(wrap);
  }

  // Timing board column picker (persist which columns stay visible).
  var TIMING_COLS_STORAGE = 'f1-timing-columns';
  var TIMING_COLS = [
    { id: 'pos',  cls: 'num',      label: '#', always: true },
    { id: 'who',  cls: 'who',      label: '车手', always: true },
    { id: 'gap',  cls: 'col-gap',  label: '榜首差距', always: false },
    { id: 'int',  cls: 'col-int',  label: '前车差距', always: false },
    { id: 'tyre', cls: 'col-tyre', label: '胎',   always: false },
    { id: 'laps', cls: 'col-laps', label: '圈',   always: false },
    { id: 'pit',  cls: 'col-pit',  label: '站',   always: false }
  ];
  var TIMING_COLS_DEFAULT = TIMING_COLS.map(function (c) { return c.id; });
  // Content-ish weights; visible columns are re-normalized to 100% panel width.
  var TIMING_COL_WEIGHTS = {
    pos: 8, who: 22, gap: 17, int: 17, tyre: 12, laps: 12, pit: 12
  };
  // Survives full table rebuilds on each SSE push so the menu can stay open.
  var timingColsMenuOpen = false;

  function loadTimingColumns() {
    var vis = {};
    var i;
    for (i = 0; i < TIMING_COLS.length; i++) vis[TIMING_COLS[i].id] = true;
    try {
      var raw = localStorage.getItem(TIMING_COLS_STORAGE);
      if (!raw) return vis;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return vis;
      var chosen = {};
      for (i = 0; i < arr.length; i++) chosen[arr[i]] = true;
      for (i = 0; i < TIMING_COLS.length; i++) {
        var c = TIMING_COLS[i];
        vis[c.id] = c.always ? true : !!chosen[c.id];
      }
      // Sensible minimum: never hide both 名次 and 车手.
      if (!vis.pos && !vis.who) { vis.pos = true; vis.who = true; }
      return vis;
    } catch (e) {
      return vis;
    }
  }

  function saveTimingColumns(vis) {
    var out = [];
    for (var i = 0; i < TIMING_COLS.length; i++) {
      var c = TIMING_COLS[i];
      if (c.always || vis[c.id]) out.push(c.id);
    }
    try { localStorage.setItem(TIMING_COLS_STORAGE, JSON.stringify(out)); } catch (e) {}
  }

  function applyTimingColumnWidths(wrap, vis) {
    if (!wrap) return;
    vis = vis || loadTimingColumns();
    var total = 0;
    var i, c;
    for (i = 0; i < TIMING_COLS.length; i++) {
      c = TIMING_COLS[i];
      if (vis[c.id]) total += TIMING_COL_WEIGHTS[c.id] || 0;
    }
    if (total <= 0) total = 1;
    for (i = 0; i < TIMING_COLS.length; i++) {
      c = TIMING_COLS[i];
      if (vis[c.id]) {
        var pct = (TIMING_COL_WEIGHTS[c.id] || 0) / total * 100;
        wrap.style.setProperty('--w-' + c.id, pct.toFixed(2) + '%');
      } else {
        wrap.style.setProperty('--w-' + c.id, '0%');
      }
    }
  }

  function applyTimingColumnVisibility(wrap) {
    if (!wrap) return;
    var vis = loadTimingColumns();
    for (var i = 0; i < TIMING_COLS.length; i++) {
      var c = TIMING_COLS[i];
      wrap.classList.toggle('hide-' + c.id, !vis[c.id]);
    }
    applyTimingColumnWidths(wrap, vis);
  }

  // Vertical density: scale font / padding / sector bands so rows fill panel height.
  // t=0 minimum readable, t=1 roomy ceiling; then stretch table to absorb leftover.
  // Compact only changes horizontal pad (CSS) — never lowers these vertical ceilings,
  // otherwise shrinking the window width leaves a dead grey gap under the last row.
  function applyBoardDensityScale(wrap, t, isSectors) {
    if (!wrap) return;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var minFs = 9;
    var maxFs = isSectors ? 15.5 : 17;
    var minPad = 1;
    var maxPad = isSectors ? 12 : 16;
    var minThPad = 2;
    var maxThPad = 8;
    var minThFs = 8;
    var maxThFs = 12;
    var minMini = 3;
    var maxMini = 10;
    var fs = minFs + (maxFs - minFs) * t;
    var tdPad = minPad + (maxPad - minPad) * t;
    var thPad = minThPad + (maxThPad - minThPad) * t;
    var thFs = minThFs + (maxThFs - minThFs) * t;
    var mini = minMini + (maxMini - minMini) * t;
    // Skip style writes when nothing changed (avoids layout thrash during resize).
    var key = (isSectors ? 's' : 't') + ':' + t.toFixed(3);
    if (wrap.__boardDensityKey === key) return;
    wrap.__boardDensityKey = key;
    wrap.style.setProperty('--board-fs', fs.toFixed(2) + 'px');
    wrap.style.setProperty('--board-th-fs', thFs.toFixed(2) + 'px');
    wrap.style.setProperty('--board-td-pad-y', tdPad.toFixed(2) + 'px');
    wrap.style.setProperty('--board-th-pad-y', thPad.toFixed(2) + 'px');
    wrap.style.setProperty('--board-th-pad-b', (thPad + 2).toFixed(2) + 'px');
    if (isSectors) {
      wrap.style.setProperty('--sec-mini-h', mini.toFixed(2) + 'px');
      wrap.style.setProperty('--sec-mini-gap', (0.5 + 0.5 * t).toFixed(2) + 'px');
      wrap.style.setProperty('--sec-band-gap', (0.5 + 0.5 * t).toFixed(2) + 'px');
    }
  }

  function setTableHeightPx(table, px) {
    if (!table) return;
    var next = (px == null || px === '') ? '' : (px + 'px');
    if (table.style.height === next) return;
    table.style.height = next;
  }

  /**
   * Fit board rows to wrap height.
   * mode 'cheap': keep last density, only stretch/clear height (for live drag).
   * mode 'exact' (default): binary-search density, then stretch if spare room.
   */
  function fitBoardVertical(wrap, isSectors, mode) {
    if (!wrap) return;
    var table = wrap.querySelector('table');
    if (!table) return;
    mode = mode || 'exact';
    var avail = wrap.clientHeight || 0;
    if (avail <= 0 && wrap.parentElement) avail = wrap.parentElement.clientHeight || 0;
    if (avail <= 0) return;

    var prev = wrap.__boardFit || {};
    if (Math.abs((prev.avail || 0) - avail) < 2 &&
        !!prev.isSectors === !!isSectors &&
        prev.exact && mode === 'exact') {
      // Size stable since last exact fit — only keep stretch in sync.
      if (prev.stretched) setTableHeightPx(table, avail);
      return;
    }

    if (mode === 'cheap') {
      // During drag: no scrollHeight reads. Keep density; only adjust stretch.
      if (prev.t == null) {
        // First paint mid-drag: one light exact later via settle; for now fill.
        setTableHeightPx(table, avail);
        wrap.__boardFit = { avail: avail, t: prev.t, isSectors: !!isSectors, exact: false, stretched: true };
        return;
      }
      if (prev.stretched) setTableHeightPx(table, avail);
      else setTableHeightPx(table, '');
      wrap.__boardFit = {
        avail: avail,
        t: prev.t,
        isSectors: !!isSectors,
        exact: false,
        stretched: !!prev.stretched
      };
      return;
    }

    // Exact: measure natural height under density scale.
    setTableHeightPx(table, '');
    var lo = 0;
    var hi = 1;
    var i;
    var t = 1;
    applyBoardDensityScale(wrap, 1, isSectors);
    var needed = table.scrollHeight;
    if (needed > avail + 2) {
      // Binary-search largest t that fits; 7 iters ≈ 0.8% — enough for px fonts.
      for (i = 0; i < 7; i++) {
        var mid = (lo + hi) / 2;
        applyBoardDensityScale(wrap, mid, isSectors);
        needed = table.scrollHeight;
        if (needed <= avail + 2) lo = mid;
        else hi = mid;
      }
      t = lo;
      applyBoardDensityScale(wrap, t, isSectors);
      setTableHeightPx(table, '');
      wrap.__boardFit = { avail: avail, t: t, isSectors: !!isSectors, exact: true, stretched: false };
      return;
    }
    // Spare vertical space: stretch table so leftover distributes across rows.
    setTableHeightPx(table, avail);
    wrap.__boardFit = { avail: avail, t: 1, isSectors: !!isSectors, exact: true, stretched: true };
  }

  function fitTimingTable(wrap, mode) {
    if (!wrap) return;
    var w = wrap.clientWidth || 0;
    var h = wrap.clientHeight || 0;
    var prev = wrap.__boardFitSize || {};
    if (mode === 'cheap' &&
        Math.abs((prev.w || 0) - w) < 2 &&
        Math.abs((prev.h || 0) - h) < 2) {
      return;
    }
    wrap.__boardFitSize = { w: w, h: h };
    var wantCompact = w > 0 && w < 520;
    if (wrap.classList.contains('compact') !== wantCompact) {
      wrap.classList.toggle('compact', wantCompact);
    }
    // Column visibility is independent of size; skip on cheap drag frames.
    if (mode !== 'cheap' || !wrap.__timingColsReady) {
      applyTimingColumnVisibility(wrap);
      wrap.__timingColsReady = true;
    }
    fitBoardVertical(wrap, false, mode);
  }

  // Sector board: same dense fill as timing (no column picker; all cols visible).
  var SECTOR_COL_WEIGHTS = {
    pos: 7, who: 16, best: 14, last: 14, s1: 16, s2: 16, s3: 17
  };

  function applySectorColumnWidths(wrap) {
    if (!wrap) return;
    // Percent widths are constant — apply once per wrap lifetime.
    if (wrap.__sectorColsApplied) return;
    var ids = ['pos', 'who', 'best', 'last', 's1', 's2', 's3'];
    var total = 0;
    var i;
    for (i = 0; i < ids.length; i++) total += SECTOR_COL_WEIGHTS[ids[i]] || 0;
    if (total <= 0) total = 1;
    for (i = 0; i < ids.length; i++) {
      var id = ids[i];
      var pct = (SECTOR_COL_WEIGHTS[id] || 0) / total * 100;
      wrap.style.setProperty('--w-' + id, pct.toFixed(2) + '%');
    }
    wrap.__sectorColsApplied = true;
  }

  function fitSectorsTable(wrap, mode) {
    if (!wrap) return;
    var w = wrap.clientWidth || 0;
    var h = wrap.clientHeight || 0;
    var prev = wrap.__boardFitSize || {};
    if (mode === 'cheap' &&
        Math.abs((prev.w || 0) - w) < 2 &&
        Math.abs((prev.h || 0) - h) < 2) {
      return;
    }
    wrap.__boardFitSize = { w: w, h: h };
    var wantCompact = w > 0 && w < 560;
    if (wrap.classList.contains('compact') !== wantCompact) {
      wrap.classList.toggle('compact', wantCompact);
    }
    applySectorColumnWidths(wrap);
    fitBoardVertical(wrap, true, mode);
  }

  /**
   * One ResizeObserver per board box lifetime (survives clear()+rebuild).
   * Live drag: rAF + cheap fit (no binary search). Settle ~80ms: one exact fit.
   */
  function ensureBoardFitObserver(box, kind) {
    if (!box || box.__boardFitRo) return;
    var rafId = null;
    var settleId = null;
    var lastW = -1;
    var lastH = -1;
    function wrapOf() {
      return box.querySelector(kind === 'sectors' ? '.sectors-wrap' : '.timing-wrap');
    }
    function runFit(mode) {
      var wrap = wrapOf();
      if (!wrap) return;
      if (kind === 'sectors') fitSectorsTable(wrap, mode);
      else fitTimingTable(wrap, mode);
    }
    try {
      var ro = new ResizeObserver(function () {
        var wrap = wrapOf();
        if (!wrap) return;
        var w = wrap.clientWidth || 0;
        var h = wrap.clientHeight || 0;
        // Also accept box size when wrap has not stretched yet.
        if (h <= 0) h = box.clientHeight || 0;
        if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
        lastW = w;
        lastH = h;
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(function () {
          rafId = null;
          runFit('cheap');
          if (settleId != null) clearTimeout(settleId);
          settleId = setTimeout(function () {
            settleId = null;
            runFit('exact');
          }, 80);
        });
      });
      ro.observe(box);
      box.__boardFitRo = ro;
    } catch (e) { /* ignore */ }
  }
  function buildTimingColsMenu(wrap) {
    var bar = el('div', 'timing-cols-bar');
    var btn = el('button', 'timing-cols-btn', '列');
    btn.type = 'button';
    btn.title = '选择成绩榜显示的列';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', timingColsMenuOpen ? 'true' : 'false');

    var menu = el('div', 'timing-cols-menu');
    if (!timingColsMenuOpen) menu.hidden = true;
    menu.setAttribute('role', 'menu');

    var vis = loadTimingColumns();
    for (var i = 0; i < TIMING_COLS.length; i++) {
      (function (col) {
        var lab = el('label', 'timing-cols-item');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!vis[col.id];
        if (col.always) {
          cb.disabled = true;
          lab.title = '名次与车手始终显示';
        }
        cb.addEventListener('change', function () {
          var next = loadTimingColumns();
          next[col.id] = !!cb.checked;
          if (!next.pos && !next.who) {
            next.pos = true;
            next.who = true;
            cb.checked = true;
          }
          saveTimingColumns(next);
          applyTimingColumnVisibility(wrap);
        });
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(' ' + col.label));
        menu.appendChild(lab);
      })(TIMING_COLS[i]);
    }

    function setOpen(open) {
      timingColsMenuOpen = !!open;
      menu.hidden = !timingColsMenuOpen;
      btn.setAttribute('aria-expanded', timingColsMenuOpen ? 'true' : 'false');
    }

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      setOpen(!timingColsMenuOpen);
    });
    menu.addEventListener('click', function (ev) { ev.stopPropagation(); });

    if (!buildTimingColsMenu._docBound) {
      buildTimingColsMenu._docBound = true;
      document.addEventListener('click', function () {
        if (!timingColsMenuOpen) return;
        timingColsMenuOpen = false;
        var openMenus = document.querySelectorAll('.timing-cols-menu');
        for (var j = 0; j < openMenus.length; j++) openMenus[j].hidden = true;
        var openBtns = document.querySelectorAll('.timing-cols-btn');
        for (var k = 0; k < openBtns.length; k++) {
          openBtns[k].setAttribute('aria-expanded', 'false');
        }
      });
    }

    bar.appendChild(btn);
    bar.appendChild(menu);
    return bar;
  }

  /** Put 「列」 in the board title row (b-head / ptitle).
   *  Director iframe (?once=1): parent .p-head owns the control — no tools strip row. */
  function placeTimingColsControl(box, wrap) {
    var root = box.parentElement;
    if (root) {
      var stale = root.querySelectorAll('.b-head > .timing-cols-bar, .timing-tools, .b-box > .timing-cols-bar');
      for (var i = 0; i < stale.length; i++) stale[i].remove();
    }
    // Drop any leftover tools strip from older builds inside this box.
    var oldTools = box.querySelectorAll('.timing-tools');
    for (var t = 0; t < oldTools.length; t++) oldTools[t].remove();

    if (ONCE) {
      // Embedded in director: column picker lives in the outer panel header.
      // Keep a zero-height float only when we are top-level (no parent chrome).
      if (window.parent && window.parent !== window) return;
      var barFloat = buildTimingColsMenu(wrap);
      barFloat.classList.add('timing-cols-float');
      box.appendChild(barFloat);
      return;
    }

    var bar = buildTimingColsMenu(wrap);
    var head = root && root.querySelector('.b-head');
    if (head) {
      // Standalone /board page: same row as title + 收回全部
      head.appendChild(bar);
      return;
    }
    // Main window panel: same row as 成绩榜 + 弹出
    var title = titleRow('成绩榜', box.getAttribute('data-board'));
    title.appendChild(bar);
    box.appendChild(title);
  }

  function refreshTimingColumnsFromStorage() {
    var wraps = document.querySelectorAll('.timing-wrap');
    for (var i = 0; i < wraps.length; i++) applyTimingColumnVisibility(wraps[i]);
  }

  function renderTiming(box) {
    clear(box);
    var cars = (state && state.cars) || [];
    var wrap = el('div', 'timing-wrap');
    placeTimingColsControl(box, wrap);
    var t = el('table', 'timing');
    var head = el('tr');
    ['#', '车手', '榜首差距', '前车差距', '胎', '圈', '站'].forEach(function (h, i) {
      var cls = '';
      if (i === 0) cls = 'num';
      else if (i === 1) cls = 'who';
      else if (i === 2) cls = 'col-gap';
      else if (i === 3) cls = 'col-int';
      else if (i === 4) cls = 'col-tyre';
      else if (i === 5) cls = 'col-laps';
      else if (i === 6) cls = 'col-pit';
      if (i === 0) {
        var th = el('th', cls);
        th.appendChild(el('span', 'num-mark', ''));
        th.appendChild(el('span', 'num-pos', h));
        head.appendChild(th);
      } else {
        head.appendChild(el('th', cls || null, h));
      }
    });
    t.appendChild(head);
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      var tr = el('tr');
      if (c.retired) { tr.className = 'retired'; }
      var numTd = el('td', 'num');
      numTd.appendChild(el('span', 'num-mark' + (c.inPit ? ' pit-mark' : ''), c.inPit ? 'P' : ''));
      numTd.appendChild(el('span', 'num-pos', c.position || ''));
      tr.appendChild(numTd);
      var who = el('td', 'who');
      var bar = el('span', 'teambar');
      bar.style.background = c.teamColour ? ('#' + c.teamColour.replace('#', '')) : '#555';
      who.appendChild(bar);
      who.appendChild(el('span', 'tla', c.tla || ''));
      who.appendChild(el('span', 'carno', c.number != null && c.number !== '' ? String(c.number) : ''));
      tr.appendChild(who);
      tr.appendChild(el('td', 'mono col-gap', c.gap || ''));
      tr.appendChild(el('td', 'mono col-int', c.interval || ''));
      var tyreTd = el('td', 'col-tyre');
      tyreTd.appendChild(compoundBadge(c.compound, c.compoundCn));
      tr.appendChild(tyreTd);
      tr.appendChild(el('td', 'mono col-laps', c.tyreLaps || ''));
      tr.appendChild(el('td', 'mono col-pit', c.pitStops || ''));
      t.appendChild(tr);
    }
    wrap.appendChild(t);
    box.appendChild(wrap);
    fitTimingTable(wrap, 'exact');
    ensureBoardFitObserver(box, 'timing');
  }

  function parseWeatherExtras(text) {
    var s = String(text || '');
    var out = { humidity: '', wind: '', rain: '', raining: false };
    var m;
    m = /湿度\s*([0-9]+(?:\.[0-9]+)?)\s*%/.exec(s);
    if (m) out.humidity = m[1] + '%';
    m = /风(?:速)?\s*([0-9]+(?:\.[0-9]+)?)\s*(m\/s|km\/h)?/i.exec(s);
    if (m) out.wind = m[1] + (m[2] ? (' ' + m[2]) : ' m/s');
    // Only treat as raining on explicit positive signals (not the label alone).
    if (/(?:有雨|正在下雨|下雨中)/.test(s) || /Rainfall\s*[:=]?\s*1\b/i.test(s)) {
      out.raining = true;
      out.rain = '有雨';
    } else if (/(?:无雨|未降雨)/.test(s) || /Rainfall\s*[:=]?\s*0\b/i.test(s)) {
      out.raining = false;
    }
    return out;
  }

  function formatTemp(v) {
    if (v == null || v === '') return '';
    var s = String(v).trim();
    if (!s || s === '—') return '';
    if (/°\s*C|℃/i.test(s)) return s.replace(/℃/g, '°C');
    if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(s)) return s + '°C';
    return s;
  }

  var WEATHER_STORAGE = 'f1-weather-module-order';
  var WEATHER_DEFAULT_ORDER = ['air', 'track', 'humidity', 'wind', 'rain'];
  var WEATHER_LABELS = {
    air: '气温',
    track: '赛道温度',
    humidity: '湿度',
    wind: '风速',
    rain: '降雨'
  };

  function loadWeatherOrder() {
    try {
      var raw = localStorage.getItem(WEATHER_STORAGE);
      if (!raw) return WEATHER_DEFAULT_ORDER.slice();
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return WEATHER_DEFAULT_ORDER.slice();
      var seen = {};
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var id = arr[i];
        if (WEATHER_LABELS[id] && !seen[id]) {
          seen[id] = true;
          out.push(id);
        }
      }
      for (var j = 0; j < WEATHER_DEFAULT_ORDER.length; j++) {
        var d = WEATHER_DEFAULT_ORDER[j];
        if (!seen[d]) out.push(d);
      }
      return out;
    } catch (e) {
      return WEATHER_DEFAULT_ORDER.slice();
    }
  }

  function saveWeatherOrder(order) {
    try { localStorage.setItem(WEATHER_STORAGE, JSON.stringify(order)); } catch (e) {}
  }

  function weatherValuesFromState() {
    var w = (state && state.weather) || {};
    var extras = parseWeatherExtras(w.text);
    var air = formatTemp(w.air);
    var track = formatTemp(w.track);
    if (!air) {
      var ma = /气温\s*([0-9]+(?:\.[0-9]+)?)\s*°?\s*C?/i.exec(String(w.text || ''));
      if (ma) air = ma[1] + '°C';
    }
    if (!track) {
      var mt = /赛道(?:温(?:度)?)?\s*([0-9]+(?:\.[0-9]+)?)\s*°?\s*C?/i.exec(String(w.text || ''));
      if (mt) track = mt[1] + '°C';
    }
    var humidity = '';
    if (w.humidity != null && w.humidity !== '') {
      var h = String(w.humidity).trim();
      humidity = /%$/.test(h) ? h : (h + '%');
    } else {
      humidity = extras.humidity || '';
    }
    var wind = '';
    if (w.wind != null && w.wind !== '') {
      var wv = String(w.wind).trim();
      wind = /m\/s|km\/h/i.test(wv) ? wv : (wv + ' m/s');
      if (w.windDirection != null && w.windDirection !== '') {
        wind += ' · ' + String(w.windDirection).trim() + '°';
      }
    } else {
      wind = extras.wind || '';
    }
    var raining = (typeof w.rain === 'boolean')
      ? w.rain
      : (parseFloat(w.rainfall) > 0 ? true : !!extras.raining);
    return {
      air: air || '—',
      track: track || '—',
      humidity: humidity || '—',
      wind: wind || '—',
      rain: raining ? '有雨' : '无雨',
      raining: !!raining
    };
  }

  function weatherMetric(id, value, raining) {
    var d = el('div', 'wcell' + ((id === 'air' || id === 'track') ? ' wcell-hero' : '') +
      ((id === 'rain' && raining) ? ' warn' : ''));
    d.setAttribute('data-weather-id', id);
    d.setAttribute('draggable', 'true');
    d.title = '拖动可调整顺序';
    d.appendChild(el('div', 'wlabel', WEATHER_LABELS[id] || id));
    var row = el('div', 'wvalue-row');
    row.appendChild(el('div', 'wvalue', value || '—'));
    d.appendChild(row);
    d.appendChild(el('div', 'wdrag', '⋮⋮'));
    return d;
  }

  function bindWeatherDrag(wrap) {
    var dragId = null;
    wrap.addEventListener('dragstart', function (e) {
      var cell = e.target.closest && e.target.closest('.wcell');
      if (!cell || !wrap.contains(cell)) return;
      dragId = cell.getAttribute('data-weather-id');
      cell.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId || '');
      } catch (err) {}
    });
    wrap.addEventListener('dragend', function (e) {
      var cell = e.target.closest && e.target.closest('.wcell');
      if (cell) cell.classList.remove('dragging');
      wrap.querySelectorAll('.wcell.drag-over').forEach(function (n) {
        n.classList.remove('drag-over');
      });
      dragId = null;
    });
    wrap.addEventListener('dragover', function (e) {
      var cell = e.target.closest && e.target.closest('.wcell');
      if (!cell || !wrap.contains(cell)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
      wrap.querySelectorAll('.wcell.drag-over').forEach(function (n) {
        if (n !== cell) n.classList.remove('drag-over');
      });
      cell.classList.add('drag-over');
    });
    wrap.addEventListener('dragleave', function (e) {
      var cell = e.target.closest && e.target.closest('.wcell');
      if (cell) cell.classList.remove('drag-over');
    });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      var target = e.target.closest && e.target.closest('.wcell');
      if (!target || !wrap.contains(target)) return;
      var from = dragId || (function () {
        try { return e.dataTransfer.getData('text/plain'); } catch (err) { return ''; }
      })();
      var to = target.getAttribute('data-weather-id');
      target.classList.remove('drag-over');
      if (!from || !to || from === to) return;
      var order = [];
      wrap.querySelectorAll('.wcell').forEach(function (n) {
        order.push(n.getAttribute('data-weather-id'));
      });
      var fi = order.indexOf(from);
      var ti = order.indexOf(to);
      if (fi < 0 || ti < 0) return;
      order.splice(fi, 1);
      order.splice(ti, 0, from);
      saveWeatherOrder(order);
      // Reorder DOM to match without full repaint flicker of values
      order.forEach(function (id) {
        var node = wrap.querySelector('.wcell[data-weather-id="' + id + '"]');
        if (node) wrap.appendChild(node);
      });
    });
  }


  /**
   * Read S1/S2/S3 from a car. Prefers cars[].sectors[{value,personalBest,overallBest,status,segments}]
   * from the patched Race Control jar; falls back to flat s1/s2/s3 keys.
   * Returns { value, personalBest, overallBest, status, segments, bestValue }.
   * bestValue is TimingStats personal-best sector (stable green when live status ages to 0).
   */
  function carBestSectorValue(c, idx) {
    if (!c) return '';
    var bs = c.bestSectors || c.BestSectors;
    if (Array.isArray(bs) && bs[idx] != null && bs[idx] !== '') {
      var b = bs[idx];
      if (b != null && typeof b === 'object') return String(b.Value || b.value || '');
      return String(b);
    }
    return '';
  }

  function normalizeSegments(raw) {
    var out = [];
    if (!raw) return out;
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        var s = raw[i];
        if (s != null && typeof s === 'object') out.push(Number(s.status || s.Status || 0) || 0);
        else out.push(Number(s) || 0);
      }
      return out;
    }
    if (typeof raw === 'object') {
      var keys = Object.keys(raw).filter(function (k) { return /^\d+$/.test(k); })
        .map(Number).sort(function (a, b) { return a - b; });
      for (var j = 0; j < keys.length; j++) {
        var seg = raw[String(keys[j])];
        if (seg != null && typeof seg === 'object') out.push(Number(seg.status || seg.Status || 0) || 0);
        else out.push(Number(seg) || 0);
      }
    }
    return out;
  }

  function carSectorInfo(c, idx) {
    var empty = { value: '', personalBest: false, overallBest: false, status: 0, segments: [], bestValue: '' };
    if (!c) return empty;
    var bestValue = carBestSectorValue(c, idx);
    var sectors = c.sectors || c.Sectors;
    if (Array.isArray(sectors) && sectors[idx] != null) {
      var v = sectors[idx];
      if (v != null && typeof v === 'object') {
        var val = String(v.Value || v.value || v.time || v.Time || '');
        var overall = !!(v.overallBest || v.OverallFastest || v.OverallBest);
        var personal = !!(v.personalBest || v.PersonalFastest || v.PersonalBest);
        var status = Number(v.status || v.Status || 0) || 0;
        if (!overall && !personal && status) {
          overall = status === 2051;
          personal = status === 2051 || status === 2049;
        }
        // When live Status ages to 0, match value against TimingStats bestSectors for green.
        if (!overall && !personal && val && bestValue) {
          var a = parseSectorSeconds(val);
          var b = parseSectorSeconds(bestValue);
          if (isFinite(a) && isFinite(b) && Math.abs(a - b) < 0.0005) personal = true;
        }
        return {
          value: val,
          personalBest: personal,
          overallBest: overall,
          status: status,
          segments: normalizeSegments(v.segments || v.Segments),
          bestValue: bestValue
        };
      }
      return { value: String(v), personalBest: false, overallBest: false, status: 0, segments: [], bestValue: bestValue };
    }
    var keys = [
      ['s1', 's2', 's3'],
      ['sector1', 'sector2', 'sector3'],
      ['Sector1', 'Sector2', 'Sector3'],
      ['sector1Time', 'sector2Time', 'sector3Time']
    ];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k][idx];
      if (c[key] != null && c[key] !== '') {
        return { value: String(c[key]), personalBest: false, overallBest: false, status: 0, segments: [], bestValue: bestValue };
      }
    }
    empty.bestValue = bestValue;
    return empty;
  }

  function carSectorTime(c, idx) {
    return carSectorInfo(c, idx).value;
  }

  /** Parse "1:23.456" / "28.123" into seconds; NaN if unusable. */
  function parseSectorSeconds(str) {
    if (!str) return NaN;
    var s = String(str).trim();
    if (!s || s === '—' || s === '-') return NaN;
    var m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
    if (m) return (+m[1]) * 60 + (+m[2]);
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function formatSectorDelta(sec) {
    if (!isFinite(sec) || sec <= 0.0005) return '';
    var t = sec.toFixed(3);
    if (t.charAt(0) !== '+') t = '+' + t;
    return t;
  }
  function carLastLapTime(c) {
    if (!c) return '';
    var v = c.lastLap || c.lastLapTime || c.lapTime || c.currentLapTime || c.LastLapTime;
    if (v != null && typeof v === 'object') {
      return String(v.Value || v.value || v.time || '');
    }
    return v != null && v !== '' ? String(v) : '';
  }

  /**
   * Sector / current-lap detail board.
   * Upstream F1Feed currently ships bestLap/gap/… on cars, but not per-driver
   * S1-S3 from patched F1Feed (lastLap + sectors[] with PB/overall flags).
   * until then cells show "—".
   */
  function renderSectors(box) {
    clear(box);
    if (!ONCE) panelTitle(box, '赛段成绩');
    var cars = (state && state.cars) || [];
    if (!cars.length) {
      box.appendChild(el('div', 'sub', '还没有车手数据'));
      return;
    }

    var wrap = el('div', 'sectors-wrap');
    var t = el('table', 'timing sectors');
    var head = el('tr');
    ['#', '车手', '最快圈', '本圈', 'S1', 'S2', 'S3'].forEach(function (h, i) {
      var cls = 'num';
      if (i === 1) cls = 'who';
      else if (i === 2) cls = 'col-best';
      else if (i === 3) cls = 'col-last';
      else if (i === 4) cls = 'col-s1';
      else if (i === 5) cls = 'col-s2';
      else if (i === 6) cls = 'col-s3';
      if (i === 0) {
        var th = el('th', cls);
        th.appendChild(el('span', 'num-mark', ''));
        th.appendChild(el('span', 'num-pos', h));
        head.appendChild(th);
      } else {
        head.appendChild(el('th', cls, h));
      }
    });
    t.appendChild(head);

    var anySector = false;
    // Field-wide min of personal bestSectors[i] — purple on the bottom "最快赛段" row.
    var fieldBestSec = [NaN, NaN, NaN];
    for (var bi = 0; bi < cars.length; bi++) {
      for (var bs = 0; bs < 3; bs++) {
        var bv = carBestSectorValue(cars[bi], bs);
        if (!bv) continue;
        var bsecs = parseSectorSeconds(bv);
        if (!isFinite(bsecs)) continue;
        if (!isFinite(fieldBestSec[bs]) || bsecs < fieldBestSec[bs]) fieldBestSec[bs] = bsecs;
      }
    }
    // Field-wide min bestLap / lastLap for purple on col-best / col-last.
    var fieldBestLapMs = Infinity;
    var fieldLastLapMs = Infinity;
    for (var fi = 0; fi < cars.length; fi++) {
      var fBest = cars[fi].bestLap;
      if (fBest) {
        var fbm = lapMs(fBest);
        if (isFinite(fbm) && fbm < fieldBestLapMs) fieldBestLapMs = fbm;
      }
      var fLast = carLastLapTime(cars[fi]);
      if (fLast) {
        var flm = lapMs(fLast);
        if (isFinite(flm) && flm < fieldLastLapMs) fieldLastLapMs = flm;
      }
    }
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      var tr = el('tr');
      if (c.retired) tr.className = 'retired';
      var numTd = el('td', 'num');
      numTd.appendChild(el('span', 'num-mark' + (c.inPit ? ' pit-mark' : ''), c.inPit ? 'P' : ''));
      numTd.appendChild(el('span', 'num-pos', c.position || ''));
      tr.appendChild(numTd);
      var who = el('td', 'who');
      var bar = el('span', 'teambar');
      bar.style.background = c.teamColour ? ('#' + c.teamColour.replace('#', '')) : '#555';
      who.appendChild(bar);
      who.appendChild(el('span', 'tla', c.tla || ''));
      who.appendChild(el('span', 'carno', c.number != null && c.number !== '' ? String(c.number) : ''));
      tr.appendChild(who);
      var bestLap = c.bestLap || '';
      var bestCls = 'mono col-best';
      if (bestLap) {
        var bestMs = lapMs(bestLap);
        if (isFinite(bestMs) && isFinite(fieldBestLapMs) && Math.abs(bestMs - fieldBestLapMs) < 0.5) {
          bestCls += ' sec-purple';
        } else {
          bestCls += ' sec-green';
        }
      }
      tr.appendChild(el('td', bestCls, bestLap || '—'));
      var last = carLastLapTime(c);
      var lastCls = 'mono col-last';
      if (last) {
        var lastMs = lapMs(last);
        var lastOverall = false;
        var lastPersonal = false;
        var rawLast = c.lastLap || c.lastLapTime || c.LastLapTime;
        if (rawLast != null && typeof rawLast === 'object') {
          lastOverall = !!(rawLast.overallBest || rawLast.OverallBest ||
            rawLast.lastLapOverallBest || rawLast.LastLapOverallBest);
          lastPersonal = !!(rawLast.personalBest || rawLast.PersonalBest);
        }
        if (!lastOverall && isFinite(lastMs) && isFinite(fieldLastLapMs) &&
            Math.abs(lastMs - fieldLastLapMs) < 0.5) lastOverall = true;
        if (!lastPersonal && bestLap && isFinite(lastMs)) {
          var pbMs = lapMs(bestLap);
          if (isFinite(pbMs) && Math.abs(lastMs - pbMs) < 0.5) lastPersonal = true;
        }
        if (lastOverall) lastCls += ' sec-purple';
        else if (lastPersonal) lastCls += ' sec-green';
        else lastCls += ' sec-yellow';
      }
      tr.appendChild(el('td', lastCls, last || '—'));
      for (var s = 0; s < 3; s++) {
        var info = carSectorInfo(c, s);
        var st = info.value;
        var bestSt = info.bestValue || '';
        if (st || bestSt) anySector = true;
        var td = el('td', 'mono col-s' + (s + 1) + ' sec-cell');

        // Top: mini-sector strip (fixed band; empty if no segments)
        var strip = el('div', 'sec-mini');
        if (info.segments && info.segments.length) {
          for (var mi = 0; mi < info.segments.length; mi++) {
            var mst = info.segments[mi] | 0;
            var mcls = 'sec-mini-bit';
            if (mst === 2051) mcls += ' sec-mini-purple';
            else if (mst === 2049) mcls += ' sec-mini-green';
            else if (mst === 2048) mcls += ' sec-mini-yellow';
            else if (mst) mcls += ' sec-mini-dim';
            strip.appendChild(el('span', mcls, ''));
          }
        }
        td.appendChild(strip);

        // Middle: current sector time (plain mono)
        td.appendChild(el('div', 'sec-cur', st || '—'));

        // Bottom: personal best sector — purple = field overall, green = PB, else yellow
        var bestCls = 'sec-best';
        if (bestSt) {
          var bestSecs = parseSectorSeconds(bestSt);
          var isFieldBest = isFinite(bestSecs) && isFinite(fieldBestSec[s]) &&
            Math.abs(bestSecs - fieldBestSec[s]) < 0.0005;
          if (isFieldBest) bestCls += ' sec-purple';
          else bestCls += ' sec-green';
        }
        td.appendChild(el('div', bestCls, bestSt || '—'));

        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    wrap.appendChild(t);
    box.appendChild(wrap);
    if (!anySector) {
      box.appendChild(el('div', 'sub sectors-note',
        '本场次暂无 S1–S3 / 本圈时间（字段已接通，有分段后会自动填色）'));
    }
    fitSectorsTable(wrap, 'exact');
    ensureBoardFitObserver(box, 'sectors');
  }

  function renderWeather(box) {
    clear(box);
    // Title only in standalone board windows; director chrome already names the panel.
    if (!ONCE) panelTitle(box, '天气');
    var vals = weatherValuesFromState();
    var wrap = el('div', 'weather');
    var order = loadWeatherOrder();
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      wrap.appendChild(weatherMetric(id, vals[id], vals.raining));
    }
    box.appendChild(wrap);
    bindWeatherDrag(wrap);
  }

  function renderFastest(box) {
    clear(box);
    if (!ONCE) panelTitle(box, '最快圈');
    var cars = ((state && state.cars) || []).slice();
    var withBest = cars.filter(function (c) { return c.bestLap; });
    if (!withBest.length) {
      box.appendChild(el('div', 'sub', '还没有最快圈数据'));
      return;
    }
    withBest.sort(function (a, b) { return lapMs(a.bestLap) - lapMs(b.bestLap); });
    var wrap = el('div', 'fastest');
    for (var i = 0; i < withBest.length && i < 22; i++) {
      var c = withBest[i];
      var d = el('div', 'fcell' + (i === 0 ? ' best' : ''));
      d.appendChild(el('span', 'fpos', String(i + 1)));
      var who = el('span', 'fwho');
      var bar = el('span', 'teambar');
      bar.style.background = c.teamColour
        ? ('#' + c.teamColour.replace('#', '')) : '#555';
      who.appendChild(bar);
      who.appendChild(el('span', 'ftla', c.tla || ''));
      d.appendChild(who);
      d.appendChild(el('span', 'ftime', c.bestLap || '—'));
      wrap.appendChild(d);
    }
    box.appendChild(wrap);
  }

  /** "1:23.456" -> 毫秒。用来排序。 */
  function lapMs(s) {
    if (!s) { return Infinity; }
    var m = /^(\d+):(\d+\.\d+)$/.exec(String(s).trim());
    if (m) { return parseInt(m[1], 10) * 60000 + parseFloat(m[2]) * 1000; }
    var f = parseFloat(s);
    return isNaN(f) ? Infinity : f * 1000;
  }

  function renderSession(box) {
    clear(box);
    if (!ONCE) panelTitle(box, '环节');
    var r = (state && state.race) || {};
    // ★ 别把大奖赛叫"会议" —— meeting 是 F1 的说法（分站/大奖赛）。
    var wrap = el('div', 'session');
    function scell(label, value, hero, wide) {
      var d = el('div', 'scell' + (hero ? ' hero' : '') + (wide ? ' wide' : ''));
      d.appendChild(el('div', 'slabel', label));
      d.appendChild(el('div', 'svalue' + (hero ? ' hero' : ''), value || '—'));
      wrap.appendChild(d);
    }
    scell('大奖赛', r.meeting, false, true);
    scell('赛道', r.circuit, false, true);
    scell('环节', r.session, true, false);
    scell('状态', r.status, false, false);
    scell('剩余', r.remaining, false, false);
    scell('圈数', (r.lap || 0) + ' / ' + (r.totalLaps || 0), false, false);
    box.appendChild(wrap);

    var top = (r.topThree || []);
    if (top.length) {
      var topWrap = el('div', 'session-top');
      topWrap.appendChild(el('div', 'session-top-label', '前三名'));
      var l = el('div', 'top3');
      for (var k = 0; k < top.length; k++) {
        l.appendChild(el('div', 'top3row', (k + 1) + '. ' + top[k]));
      }
      topWrap.appendChild(l);
      box.appendChild(topWrap);
    }
  }

  /**
   * 一条消息该显示成什么。
   * ★ 和安卓同一个约定：Translator 翻出来了用中文，翻不出来就显示英文原文
   *   （Translator.gloss 的契约是"翻不出来返回 null"）。
   *   这里**不能**在中文化失败时显示空白 —— 那就把信息吞了。
   */
  function msgLine(m) {
    var g = m.gloss;
    if (g && /[\u4e00-\u9fff]/.test(g)) {
      return { zh: g, en: m.text, translated: true };
    }
    return { zh: m.text, en: m.text, translated: false };
  }

  /** 消息时间。RaceMessage.time 是 epoch 毫秒，直接显示就是一串 13 位数。 */
  function msgTime(m) {
    if (typeof m.time === 'number' && m.time > 1e11) { return fmtClock(m.time); }
    return m.time || '';
  }

  function renderMessages(box) {
    clear(box);
    if (!ONCE) panelTitle(box, '赛事通报');
    var msgs = (state && state.messages) || [];
    if (!msgs.length) {
      box.appendChild(el('div', 'sub', '还没有通报'));
      return;
    }
    var list = el('div', 'msgs');
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var line = msgLine(m);
      var d = el('div', 'msg' + (i === 0 ? ' newest' : ''));
      // Chinese primary line; English sits on the time/meta row to save height.
      d.appendChild(el('span', 'mtext', line.zh));
      var meta = el('div', 'mmeta');
      meta.appendChild(el('span', 'mtime', msgTime(m)));
      if (m.category || m.flag) {
        meta.appendChild(el('span', 'mcat', m.category || m.flag || ''));
      }
      if (line.translated && line.en && line.en !== line.zh) {
        meta.appendChild(el('span', 'morig', line.en));
      }
      d.appendChild(meta);
      if (m.utc) { d.title = m.utc; }
      list.appendChild(d);
    }
    box.appendChild(list);
  }


  // ---------------------------------------------------------------
  // 赛道图（真实赛道轮廓 + 车位点）
  // ---------------------------------------------------------------
  // 数据优先 state.carPositions（Java 解析的官方 Position.z）；
  // 没有则用 OpenF1 /v1/location（与 Position.z 同坐标系）。
  // 圆环板 ring 不动。

  var TRACKMAP = {
    sessionKey: null,
    sessionMeta: null,
    positions: [],       // [{number,x,y,z,status,tla,teamColour}]
    outline: [],         // [{x,y}] 赛道轮廓采样
    source: '',          // official | openf1 | ''
    status: '等待位置数据',
    timer: null,
    resolving: false,
    lastRaceKey: '',
    svgPath: '',
    svgOk: false,
    pollBusy: false,
    outlineBusy: false,
    viewZoom: 1,
    viewPanX: 0,
    viewPanY: 0,
    viewRotDeg: 0
  };

  var TM_CACHE_KEY = 'f1-trackmap-cache-v1';

  function saveTrackmapCache() {
    try {
      if (!TRACKMAP.lastRaceKey || !TRACKMAP.sessionKey) return;
      if (!TRACKMAP.outline || TRACKMAP.outline.length < 30) return;
      sessionStorage.setItem(TM_CACHE_KEY, JSON.stringify({
        raceKey: TRACKMAP.lastRaceKey,
        sessionKey: TRACKMAP.sessionKey,
        sessionMeta: TRACKMAP.sessionMeta,
        outline: TRACKMAP.outline,
        status: TRACKMAP.status,
        savedAt: Date.now()
      }));
    } catch (e) { /* ignore quota / private mode */ }
  }

  function restoreTrackmapCache(rk) {
    try {
      var raw = sessionStorage.getItem(TM_CACHE_KEY);
      if (!raw) return false;
      var c = JSON.parse(raw);
      if (!c || c.raceKey !== rk) return false;
      if (!c.outline || c.outline.length < 30) return false;
      if (c.savedAt && (Date.now() - c.savedAt) > 6 * 3600 * 1000) return false;
      TRACKMAP.sessionKey = c.sessionKey || null;
      TRACKMAP.sessionMeta = c.sessionMeta || null;
      TRACKMAP.outline = c.outline;
      if (c.status) TRACKMAP.status = c.status;
      return true;
    } catch (e) { return false; }
  }
  var TM_ZOOM_MIN = 0.5;
  var TM_ZOOM_MAX = 4;

  function clampTrackmapZoom(z) {
    z = Number(z) || 1;
    if (z < TM_ZOOM_MIN) return TM_ZOOM_MIN;
    if (z > TM_ZOOM_MAX) return TM_ZOOM_MAX;
    return z;
  }

  function wrapTrackmapRot(deg) {
    deg = Number(deg) || 0;
    deg = deg % 360;
    if (deg < 0) deg += 360;
    return deg;
  }

  function resetTrackmapView() {
    TRACKMAP.viewZoom = 1;
    TRACKMAP.viewPanX = 0;
    TRACKMAP.viewPanY = 0;
    TRACKMAP.viewRotDeg = 0;
  }

  var TM_VIEW_HINT = '滚轮缩放\nShift+滚轮或右键拖：旋转\n双击或 Ctrl+0：复位';

  function trackmapStatusText() {
    return TRACKMAP.status || '等待位置数据';
  }

  function trackmapInDirectorParent() {
    return !!(ONCE && window.parent && window.parent !== window);
  }

  function notifyTrackmapParentUi() {
    if (!trackmapInDirectorParent()) return;
    try {
      window.parent.postMessage({
        type: 'f1-trackmap-ui',
        status: trackmapStatusText(),
        rot: Math.round(wrapTrackmapRot(TRACKMAP.viewRotDeg)),
        hint: TM_VIEW_HINT
      }, '*');
    } catch (e) { /* ignore */ }
  }

  function trackmapRotMarkup() {
    return '<button type="button" class="tm-tool" data-tm-rot="-90" title="逆时针 90°">↺</button>' +
      '<button type="button" class="tm-tool" data-tm-rot="90" title="顺时针 90°">↻</button>' +
      '<span class="tm-rot-label" title="当前旋转角">0°</span>';
  }

  function applyTrackmapStatusBadge(badge) {
    var status = trackmapStatusText();
    if (badge) {
      var textEl = badge.querySelector('.tm-status-text');
      var hintEl = badge.querySelector('.tm-hint');
      if (!textEl || !hintEl) {
        badge.textContent = '';
        textEl = el('span', 'tm-status-text');
        hintEl = el('span', 'tm-hint');
        hintEl.setAttribute('role', 'img');
        hintEl.setAttribute('aria-label', '赛道图操作说明');
        hintEl.textContent = 'ℹ';
        badge.appendChild(textEl);
        badge.appendChild(hintEl);
      }
      textEl.textContent = status;
      textEl.title = status;
      hintEl.title = TM_VIEW_HINT;
    }
    var heads = document.querySelectorAll('.tm-head-status');
    for (var i = 0; i < heads.length; i++) {
      heads[i].textContent = status;
      heads[i].title = status;
    }
    var hints = document.querySelectorAll('.tm-hint');
    for (var h = 0; h < hints.length; h++) hints[h].title = TM_VIEW_HINT;
    notifyTrackmapParentUi();
  }

  function syncTrackmapRotUi(root) {
    var deg = Math.round(wrapTrackmapRot(TRACKMAP.viewRotDeg)) + '°';
    var labels = document.querySelectorAll('.tm-rot-label');
    for (var i = 0; i < labels.length; i++) labels[i].textContent = deg;
    if (root && root.querySelectorAll) {
      var local = root.querySelectorAll('.tm-rot-label');
      for (var j = 0; j < local.length; j++) local[j].textContent = deg;
    }
    notifyTrackmapParentUi();
  }

  function wireTrackmapHeadTools(tools, box) {
    if (!tools || tools.dataset.rotWired === '1') return;
    tools.dataset.rotWired = '1';
    tools.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-tm-rot]') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var delta = Number(btn.getAttribute('data-tm-rot')) || 0;
      TRACKMAP.viewRotDeg = wrapTrackmapRot(TRACKMAP.viewRotDeg + delta);
      syncTrackmapRotUi(box);
      if (box) drawTrackmap(box);
    });
    tools.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    tools.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    tools.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: false });
  }

  function buildTrackmapHeadChrome(box) {
    var bar = el('div', 'tm-head-bar');
    var st = el('span', 'tm-head-status');
    st.textContent = trackmapStatusText();
    st.title = trackmapStatusText();
    var hint = el('span', 'tm-hint');
    hint.setAttribute('role', 'img');
    hint.setAttribute('aria-label', '赛道图操作说明');
    hint.textContent = 'ℹ';
    hint.title = TM_VIEW_HINT;
    var tools = el('span', 'tm-head-tools');
    tools.innerHTML = trackmapRotMarkup();
    bar.appendChild(st);
    bar.appendChild(hint);
    bar.appendChild(tools);
    wireTrackmapHeadTools(tools, box);
    syncTrackmapRotUi(bar);
    return bar;
  }

  /** Put status / hint / rotation in the title row (b-head / ptitle / parent .p-head).
   *  Director iframe (?once=1): parent .p-head owns the chrome — no map overlay strip. */
  function placeTrackmapChrome(box) {
    if (!box) return null;
    var wrap = box.querySelector('.tm-wrap');

    // Drop legacy full-width bar and any map-corner overlays.
    var legacy = box.querySelector('.tm-bar');
    if (legacy) legacy.remove();
    if (wrap) {
      var overlays = wrap.querySelectorAll('.tm-status, .tm-tools');
      for (var o = 0; o < overlays.length; o++) overlays[o].remove();
    }
    var stale = box.querySelectorAll('.tm-head-bar');
    for (var s = 0; s < stale.length; s++) stale[s].remove();
    var root = box.parentElement;
    if (root) {
      var headStale = root.querySelectorAll('.b-head > .tm-head-bar');
      for (var hs = 0; hs < headStale.length; hs++) headStale[hs].remove();
    }

    if (trackmapInDirectorParent()) {
      applyTrackmapStatusBadge(null);
      syncTrackmapRotUi(box);
      return wrap;
    }

    if (ONCE) {
      // once=1 top-level (no parent chrome): float in corner, no layout row.
      var floatBar = buildTrackmapHeadChrome(box);
      floatBar.classList.add('tm-head-float');
      box.appendChild(floatBar);
      return wrap;
    }

    var bar = buildTrackmapHeadChrome(box);
    var head = root && root.querySelector('.b-head');
    if (head) {
      head.appendChild(bar);
      return wrap;
    }
    var title = box.querySelector('.ptitle');
    if (!title) {
      title = titleRow('赛道图', box.getAttribute('data-board'));
      box.insertBefore(title, box.firstChild);
    }
    title.appendChild(bar);
    return wrap;
  }

  function ensureTrackmapChrome(box) {
    return placeTrackmapChrome(box);
  }

  function rotateTrackmapBy(delta) {
    TRACKMAP.viewRotDeg = wrapTrackmapRot(TRACKMAP.viewRotDeg + (Number(delta) || 0));
    var box = document.querySelector('.b-trackmap');
    syncTrackmapRotUi(box || document);
    if (box) drawTrackmap(box);
  }

  function setTrackmapRotDeg(deg) {
    TRACKMAP.viewRotDeg = wrapTrackmapRot(deg);
    var box = document.querySelector('.b-trackmap');
    syncTrackmapRotUi(box || document);
    if (box) drawTrackmap(box);
  }

  function trackmapViewSize(box, wrap) {
    return {
      w: wrap.clientWidth || box.clientWidth || 320,
      h: wrap.clientHeight || Math.max(180, (box.clientHeight || 240) - 28)
    };
  }

  /** Unrotate screen point around view center → pre-rotation screen coords. */
  function unrotateTrackmapScreen(mx, my, w, h) {
    var ang = -wrapTrackmapRot(TRACKMAP.viewRotDeg) * Math.PI / 180;
    if (!ang) return { x: mx, y: my };
    var cx = w / 2, cy = h / 2;
    var dx = mx - cx, dy = my - cy;
    var c = Math.cos(ang), s = Math.sin(ang);
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }

  function wireTrackmapZoom(wrap, box) {
    if (!wrap || wrap.dataset.zoomWired === '1') return;
    wrap.dataset.zoomWired = '1';

    ensureTrackmapChrome(box);
    // Rotation buttons live in title chrome (.tm-head-tools); wire any still in-doc.
    var toolSets = document.querySelectorAll('.tm-head-tools, .tm-tools');
    for (var ti = 0; ti < toolSets.length; ti++) wireTrackmapHeadTools(toolSets[ti], box);

    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var size = trackmapViewSize(box, wrap);
      var rect = wrap.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      if (e.shiftKey) {
        var step = e.deltaY < 0 ? 8 : -8;
        if (e.deltaMode === 1) step = e.deltaY < 0 ? 12 : -12;
        TRACKMAP.viewRotDeg = wrapTrackmapRot(TRACKMAP.viewRotDeg + step);
        syncTrackmapRotUi(box);
        drawTrackmap(box);
        return;
      }
      var factor = e.deltaY < 0 ? 1.12 : (1 / 1.12);
      if (e.deltaMode === 1) factor = e.deltaY < 0 ? 1.18 : (1 / 1.18);
      var pre = unrotateTrackmapScreen(mx, my, size.w, size.h);
      zoomTrackmapAt(box, wrap, pre.x, pre.y, factor);
    }, { passive: false });

    wrap.addEventListener('dblclick', function (e) {
      if (e.target && e.target.closest && e.target.closest('.tm-tools, .tm-head-tools, .tm-head-bar')) return;
      e.preventDefault();
      resetTrackmapView();
      syncTrackmapRotUi(box);
      drawTrackmap(box);
    });

    // Right-drag free rotate around view center
    var rotDrag = null;
    wrap.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
    wrap.addEventListener('pointerdown', function (e) {
      if (e.button !== 2) return;
      if (e.target && e.target.closest && e.target.closest('.tm-tools, .tm-head-tools, .tm-head-bar')) return;
      var size = trackmapViewSize(box, wrap);
      var rect = wrap.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var ang0 = Math.atan2(my - size.h / 2, mx - size.w / 2) * 180 / Math.PI;
      rotDrag = {
        pointerId: e.pointerId,
        startAng: ang0,
        startRot: wrapTrackmapRot(TRACKMAP.viewRotDeg)
      };
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      wrap.classList.add('tm-rotating');
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!rotDrag || e.pointerId !== rotDrag.pointerId) return;
      var size = trackmapViewSize(box, wrap);
      var rect = wrap.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var ang = Math.atan2(my - size.h / 2, mx - size.w / 2) * 180 / Math.PI;
      TRACKMAP.viewRotDeg = wrapTrackmapRot(rotDrag.startRot + (ang - rotDrag.startAng));
      syncTrackmapRotUi(box);
      drawTrackmap(box);
    });
    function endRotDrag(e) {
      if (!rotDrag || (e && e.pointerId !== rotDrag.pointerId)) return;
      rotDrag = null;
      wrap.classList.remove('tm-rotating');
    }
    wrap.addEventListener('pointerup', endRotDrag);
    wrap.addEventListener('pointercancel', endRotDrag);

    if (!window.__tmZoomKeysWired) {
      window.__tmZoomKeysWired = true;
      document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key !== '0' && e.code !== 'Digit0' && e.code !== 'Numpad0') return;
        var elBox = document.querySelector('.b-trackmap');
        if (!elBox) return;
        e.preventDefault();
        resetTrackmapView();
        syncTrackmapRotUi(elBox);
        drawTrackmap(elBox);
      });
    }
    syncTrackmapRotUi(box);
  }

  function zoomTrackmapAt(box, wrap, mx, my, factor) {
    var size = trackmapViewSize(box, wrap);
    var w = size.w, h = size.h;
    var fitPts = TRACKMAP.outline.concat(TRACKMAP.positions);
    var bounds = computeBounds(fitPts);
    if (!bounds) {
      TRACKMAP.viewZoom = clampTrackmapZoom(TRACKMAP.viewZoom * factor);
      drawTrackmap(box);
      return;
    }
    var bw = bounds.maxX - bounds.minX;
    var bh = bounds.maxY - bounds.minY;
    if (bw < 1) bw = 1;
    if (bh < 1) bh = 1;
    var pad = 0.06;
    var baseScale = Math.min(w / bw, h / bh) * (1 - pad * 2);
    var oldZ = clampTrackmapZoom(TRACKMAP.viewZoom);
    var oldS = baseScale * oldZ;
    var oldOx = (w - bw * oldS) / 2 + (TRACKMAP.viewPanX || 0);
    var oldOy = (h - bh * oldS) / 2 + (TRACKMAP.viewPanY || 0);
    var wx = (mx - oldOx) / oldS + bounds.minX;
    var wy = bounds.maxY - (my - oldOy) / oldS;
    var newZ = clampTrackmapZoom(oldZ * factor);
    var newS = baseScale * newZ;
    TRACKMAP.viewZoom = newZ;
    TRACKMAP.viewPanX = mx - (w - bw * newS) / 2 - (wx - bounds.minX) * newS;
    TRACKMAP.viewPanY = my - (h - bh * newS) / 2 - (bounds.maxY - wy) * newS;
    drawTrackmap(box);
  }

  var CIRCUIT_SVG = {
    'singapore': 'circuits/marina-bay-4.svg',
    'marina bay': 'circuits/marina-bay-4.svg',
    'sakhir': 'circuits/bahrain-3.svg',
    'bahrain': 'circuits/bahrain-3.svg',
    'melbourne': 'circuits/melbourne-2.svg',
    'suzuka': 'circuits/suzuka-2.svg',
    'shanghai': 'circuits/shanghai-1.svg',
    'miami': 'circuits/miami-1.svg',
    'imola': 'circuits/imola-3.svg',
    'monaco': 'circuits/monaco-6.svg',
    'monte carlo': 'circuits/monaco-6.svg',
    'montreal': 'circuits/montreal-6.svg',
    'catalunya': 'circuits/catalunya-6.svg',
    'barcelona': 'circuits/catalunya-6.svg',
    'spielberg': 'circuits/spielberg-3.svg',
    'red bull ring': 'circuits/spielberg-3.svg',
    'silverstone': 'circuits/silverstone-8.svg',
    'hungaroring': 'circuits/hungaroring-3.svg',
    'spa': 'circuits/spa-francorchamps-4.svg',
    'spa-francorchamps': 'circuits/spa-francorchamps-4.svg',
    'zandvoort': 'circuits/zandvoort-5.svg',
    'monza': 'circuits/monza-7.svg',
    'baku': 'circuits/baku-1.svg',
    'austin': 'circuits/austin-1.svg',
    'cota': 'circuits/austin-1.svg',
    'mexico city': 'circuits/mexico-city-3.svg',
    'mexico': 'circuits/mexico-city-3.svg',
    'interlagos': 'circuits/interlagos-2.svg',
    'sao paulo': 'circuits/interlagos-2.svg',
    'las vegas': 'circuits/las-vegas-1.svg',
    'lusail': 'circuits/lusail-1.svg',
    'losail': 'circuits/lusail-1.svg',
    'yas marina': 'circuits/yas-marina-2.svg',
    'abu dhabi': 'circuits/yas-marina-2.svg',
    'jeddah': 'circuits/jeddah-1.svg'
  };

  var OPENF1_CIRCUIT = {
    'singapore': 'Singapore',
    'marina bay': 'Singapore',
    'sakhir': 'Sakhir',
    'bahrain': 'Sakhir',
    'melbourne': 'Melbourne',
    'suzuka': 'Suzuka',
    'shanghai': 'Shanghai',
    'miami': 'Miami',
    'imola': 'Imola',
    'monaco': 'Monte Carlo',
    'monte carlo': 'Monte Carlo',
    'montreal': 'Montreal',
    'catalunya': 'Catalunya',
    'barcelona': 'Catalunya',
    'spielberg': 'Spielberg',
    'red bull ring': 'Spielberg',
    'silverstone': 'Silverstone',
    'hungaroring': 'Hungaroring',
    'spa': 'Spa-Francorchamps',
    'spa-francorchamps': 'Spa-Francorchamps',
    'zandvoort': 'Zandvoort',
    'monza': 'Monza',
    'baku': 'Baku',
    'austin': 'Austin',
    'cota': 'Austin',
    'mexico city': 'Mexico City',
    'mexico': 'Mexico City',
    'interlagos': 'Interlagos',
    'sao paulo': 'Interlagos',
    'las vegas': 'Las Vegas',
    'lusail': 'Lusail',
    'losail': 'Lusail',
    'yas marina': 'Yas Marina Circuit',
    'abu dhabi': 'Yas Marina Circuit',
    'jeddah': 'Jeddah'
  };

  function normCircuit(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function lookupMap(map, circuit) {
    var n = normCircuit(circuit);
    if (!n) return '';
    if (map[n]) return map[n];
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (n.indexOf(keys[i]) >= 0 || keys[i].indexOf(n) >= 0) return map[keys[i]];
    }
    return '';
  }

  function teamColourCss(c) {
    if (!c) return '#90caf9';
    var s = String(c).replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s;
    if (/^[0-9a-fA-F]{3}$/.test(s)) return '#' + s;
    return '#90caf9';
  }

  function carLookup() {
    var m = {};
    var cars = (state && state.cars) || [];
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c && c.number != null) m[String(c.number)] = c;
    }
    return m;
  }

  function raceKey() {
    var r = (state && state.race) || {};
    return [r.meeting || '', r.circuit || '', r.session || ''].join('|');
  }

  function isoUtc(d) {
    return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  }

  function parseOpenF1Date(s) {
    // OpenF1 uses +00:00; Date parses ISO fine
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  function enrichPositions(list) {
    var cars = carLookup();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var num = String(p.number);
      var c = cars[num] || {};
      out.push({
        number: num,
        x: p.x, y: p.y, z: p.z || 0,
        status: p.status || 'OnTrack',
        tla: c.tla || num,
        teamColour: teamColourCss(c.teamColour),
        inPit: !!c.inPit,
        retired: !!c.retired
      });
    }
    return out;
  }

  function applyOfficialPositions() {
    var cp = state && state.carPositions;
    if (!cp || !cp.cars || !cp.cars.length) return false;
    // Ignore stale empty / never-updated
    if (!cp.updatedAt) return false;
    TRACKMAP.positions = enrichPositions(cp.cars);
    TRACKMAP.source = 'official';
    TRACKMAP.status = '官方 Position.z · ' + TRACKMAP.positions.length + ' 车';
    // 轮廓仍用 OpenF1 同系采样（若有）；切勿把多车瞬时点连成折线
    return true;
  }

  // 不要用「同一时刻多台车」拼轮廓：连线顺序不是圈上顺序，会画出乱麻。
  // 轮廓只来自 loadOpenF1Outline 的单车时间序列密采样（与车点同一坐标系）。
  function thinTrail(rows, minDist2) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.x == null || r.y == null) continue;
      if (out.length) {
        var last = out[out.length - 1];
        var dx = r.x - last.x, dy = r.y - last.y;
        if (dx * dx + dy * dy < minDist2) continue;
      }
      out.push({ x: r.x, y: r.y });
    }
    return out;
  }

  function closeTrailIfNear(pts, maxDist2) {
    if (!pts || pts.length < 8) return pts;
    var a = pts[0], b = pts[pts.length - 1];
    var dx = a.x - b.x, dy = a.y - b.y;
    if (dx * dx + dy * dy <= maxDist2) {
      pts = pts.slice();
      pts.push({ x: a.x, y: a.y });
    }
    return pts;
  }

  function stopTrackmapPoll() {
    if (TRACKMAP.timer) {
      clearInterval(TRACKMAP.timer);
      TRACKMAP.timer = null;
    }
  }

  function ensureTrackmapPoll() {
    if (TRACKMAP.frozen && TRACKMAP.positions.length && TRACKMAP.source !== 'official') {
      return;
    }
    if (TRACKMAP.timer) return;
    TRACKMAP.timer = setInterval(function () {
      tickTrackmapData();
    }, 1500);
    tickTrackmapData();
  }

  function tickTrackmapData() {
    if (applyOfficialPositions()) {
      TRACKMAP.frozen = false;
      if (document.querySelector('.b-trackmap')) {
        var box = document.querySelector('.b-trackmap');
        if (box) drawTrackmap(box);
      }
      // Official cars paint immediately; outline still needs OpenF1 (same coords).
      if (TRACKMAP.outline.length < 30) {
        if (!TRACKMAP.sessionKey) resolveOpenF1Session();
        else loadOpenF1Outline();
      }
      return;
    }
    if (TRACKMAP.frozen && TRACKMAP.positions.length) return;
    if (!TRACKMAP.sessionKey) {
      resolveOpenF1Session();
      return;
    }
    pollOpenF1Locations();
  }

  function resolveOpenF1Session() {
    if (TRACKMAP.resolving) return;
    var r = (state && state.race) || {};
    var circuit = r.circuit || '';
    var session = r.session || '';
    var meeting = r.meeting || '';
    if (!circuit && !meeting) {
      TRACKMAP.status = '等待场次信息';
      return;
    }
    var ofCircuit = lookupMap(OPENF1_CIRCUIT, circuit);
    if (!ofCircuit && meeting) {
      ofCircuit = lookupMap(OPENF1_CIRCUIT, meeting);
    }
    if (!ofCircuit) {
      TRACKMAP.status = '未识别赛道：' + (circuit || meeting || '?');
      return;
    }
    TRACKMAP.resolving = true;
    TRACKMAP.status = '匹配 OpenF1 场次…';
    var year = new Date().getFullYear();
    // SessionInfo path often like 2025/...
    try {
      var m = /(\b20\d{2})\b/.exec(meeting + ' ' + (r.path || ''));
      if (m) year = parseInt(m[1], 10);
    } catch (e) {}

    var url = 'https://api.openf1.org/v1/sessions?year=' + year
      + '&circuit_short_name=' + encodeURIComponent(ofCircuit);
    fetch(url, { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (list) {
        TRACKMAP.resolving = false;
        if (!Array.isArray(list) || !list.length) {
          TRACKMAP.status = 'OpenF1 无此赛道场次';
          return;
        }
        var want = String(session || '').toLowerCase();
        var best = null;
        for (var i = 0; i < list.length; i++) {
          var sn = String(list[i].session_name || '').toLowerCase();
          if (want && sn === want) { best = list[i]; break; }
        }
        if (!best && want) {
          for (var j = 0; j < list.length; j++) {
            var sn2 = String(list[j].session_name || '').toLowerCase();
            if (sn2.indexOf(want) >= 0 || want.indexOf(sn2) >= 0) {
              best = list[j]; break;
            }
          }
        }
        if (!best) {
          // Prefer Race, else latest by date_start
          for (var k = 0; k < list.length; k++) {
            if (list[k].session_name === 'Race') { best = list[k]; break; }
          }
        }
        if (!best) best = list[list.length - 1];
        TRACKMAP.sessionKey = best.session_key;
        TRACKMAP.sessionMeta = best;
        TRACKMAP.status = 'OpenF1 · ' + (best.session_name || '') + ' #' + best.session_key;
        saveTrackmapCache();
        loadOpenF1Outline();
        pollOpenF1Locations();
      })
      .catch(function () {
        TRACKMAP.resolving = false;
        TRACKMAP.status = 'OpenF1 场次查询失败';
      });
  }

  function loadOpenF1Outline() {
    if (TRACKMAP.outlineBusy || !TRACKMAP.sessionKey || !TRACKMAP.sessionMeta) return;
    if (TRACKMAP.outline.length >= 30) return;
    TRACKMAP.outlineBusy = true;
    var meta = TRACKMAP.sessionMeta;
    var start = parseOpenF1Date(meta.date_start);
    var end = parseOpenF1Date(meta.date_end);
    if (!start || !end) { TRACKMAP.outlineBusy = false; return; }
    // 取赛中段约 2 分钟、单车时间序列 —— 与车点同一 OpenF1 坐标系，可画成连贯赛道线
    var a = start + Math.floor((end - start) * 0.28);
    var b = Math.min(end, a + 120000);
    // 优先用场上常见号，缺数据再换
    var drivers = [1, 44, 16, 11, 63, 55, 4, 81];
    var di = 0;

    function tryDriver() {
      if (di >= drivers.length) {
        TRACKMAP.outlineBusy = false;
        return;
      }
      var dn = drivers[di++];
      var url = 'https://api.openf1.org/v1/location?session_key=' + TRACKMAP.sessionKey
        + '&driver_number=' + dn
        + '&date%3E=' + encodeURIComponent(isoUtc(new Date(a)))
        + '&date%3C=' + encodeURIComponent(isoUtc(new Date(b)));
      fetch(url, { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (rows) {
          if (!Array.isArray(rows) || rows.length < 40) {
            tryDriver();
            return;
          }
          rows = rows.slice().sort(function (p, q) {
            return String(p.date).localeCompare(String(q.date));
          });
          // ~8–12m 抽稀，避免过密；单位同 OpenF1（约 0.1m）
          var pts = thinTrail(rows, 10000);
          pts = closeTrailIfNear(pts, 500 * 500);
          if (pts.length > 30) {
            TRACKMAP.outline = pts;
            saveTrackmapCache();
            TRACKMAP.outlineBusy = false;
            var box = document.querySelector('.b-trackmap');
            if (box) drawTrackmap(box);
          } else {
            tryDriver();
          }
        })
        .catch(function () { tryDriver(); });
    }
    tryDriver();
  }

  function pollOpenF1Locations() {
    if (TRACKMAP.pollBusy || !TRACKMAP.sessionKey || !TRACKMAP.sessionMeta) return;
    TRACKMAP.pollBusy = true;
    var meta = TRACKMAP.sessionMeta;
    var start = parseOpenF1Date(meta.date_start);
    var end = parseOpenF1Date(meta.date_end);
    var now = Date.now();
    var live = now >= (start - 30 * 60 * 1000) && now <= (end + 30 * 60 * 1000);
    // 历史场次：取开赛后约 30% 处，终点附近经常 404 无点
    var winEnd = live ? now : (start + Math.floor((end - start) * 0.35));
    var winStart = winEnd - 2500;
    if (winStart < start) winStart = start;
    if (winEnd > end) winEnd = end;
    var url = 'https://api.openf1.org/v1/location?session_key=' + TRACKMAP.sessionKey
      + '&date%3E=' + encodeURIComponent(isoUtc(new Date(winStart)))
      + '&date%3C=' + encodeURIComponent(isoUtc(new Date(winEnd)));
    fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
      .then(function (rows) {
        TRACKMAP.pollBusy = false;
        if (!Array.isArray(rows) || !rows.length) {
          if (!TRACKMAP.positions.length) {
            TRACKMAP.status = '等待位置数据';
          }
          var box0 = document.querySelector('.b-trackmap');
          if (box0) drawTrackmap(box0);
          return;
        }
        // latest per driver
        var latest = {};
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var dn = String(row.driver_number);
          var prev = latest[dn];
          if (!prev || String(row.date) > String(prev.date)) latest[dn] = row;
        }
        var list = [];
        Object.keys(latest).forEach(function (dn) {
          var r = latest[dn];
          list.push({ number: dn, x: r.x, y: r.y, z: r.z, status: 'OnTrack' });
        });
        TRACKMAP.positions = enrichPositions(list);
        TRACKMAP.source = 'openf1';
        TRACKMAP.status = (live ? 'OpenF1 实时' : 'OpenF1 历史快照')
          + ' · ' + TRACKMAP.positions.length + ' 车';
        TRACKMAP.frozen = !live;
        var box = document.querySelector('.b-trackmap');
        if (box) drawTrackmap(box);
        if (!live) {
          // 历史快照不用每 1.5s 打一次 OpenF1
          stopTrackmapPoll();
        }
      })
      .catch(function () {
        TRACKMAP.pollBusy = false;
        TRACKMAP.status = 'OpenF1 位置拉取失败';
      });
  }

  function circuitSvgFor(circuit, meeting) {
    return lookupMap(CIRCUIT_SVG, circuit) || lookupMap(CIRCUIT_SVG, meeting) || '';
  }

  function computeBounds(pts) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) return null;
    var padX = (maxX - minX) * 0.08 || 200;
    var padY = (maxY - minY) * 0.08 || 200;
    return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
  }

  function drawTrackmap(box) {
    var wrap = box.querySelector('.tm-wrap');
    if (!wrap) return;
    var cv = wrap.querySelector('canvas.tm-canvas');
    var badge = box.querySelector('.tm-status');
    var svgHost = wrap.querySelector('.tm-svg');
    applyTrackmapStatusBadge(badge);

    // f1db SVG 与 OpenF1/Position.z 不是同一投影，叠上去必错位。
    // 有坐标时一律隐藏装饰 SVG，轮廓改用同坐标系的密采样折线。
    if (svgHost) {
      svgHost.innerHTML = '';
      svgHost.style.opacity = '0';
      TRACKMAP.svgPath = '';
      TRACKMAP.svgOk = false;
    }

    var w = wrap.clientWidth || box.clientWidth || 320;
    var h = wrap.clientHeight || Math.max(180, (box.clientHeight || 240) - 28);
    if (w < 40 || h < 40) {
      if (refitLeft > 0) {
        refitLeft--;
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(function () { repaint(); });
        }
      }
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var day = document.documentElement.getAttribute('data-theme') === 'day';
    // Opaque backdrop so theme flips never leave the previous theme's "holes".
    g.fillStyle = day ? '#d5dee9' : '#080b10';
    g.fillRect(0, 0, w, h);
    var fitPts = TRACKMAP.outline.concat(TRACKMAP.positions);
    var bounds = computeBounds(fitPts);

    if (!bounds || (!TRACKMAP.positions.length && TRACKMAP.outline.length < 3)) {
      g.fillStyle = day ? 'rgba(91,107,124,0.95)' : 'rgba(176,190,197,0.9)';
      g.font = '600 13px "Noto Sans SC", Segoe UI, Microsoft YaHei, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(TRACKMAP.status || '等待位置数据', w / 2, h / 2);
      return;
    }

    var bw = bounds.maxX - bounds.minX;
    var bh = bounds.maxY - bounds.minY;
    if (bw < 1) bw = 1;
    if (bh < 1) bh = 1;
    var pad = 0.06;
    var baseScale = Math.min(w / bw, h / bh) * (1 - pad * 2);
    var zoom = clampTrackmapZoom(TRACKMAP.viewZoom);
    TRACKMAP.viewZoom = zoom;
    TRACKMAP.viewRotDeg = wrapTrackmapRot(TRACKMAP.viewRotDeg);
    var scale = baseScale * zoom;
    var usedW = bw * scale, usedH = bh * scale;
    var ox = (w - usedW) / 2 + (TRACKMAP.viewPanX || 0);
    var oy = (h - usedH) / 2 + (TRACKMAP.viewPanY || 0);
    var rot = TRACKMAP.viewRotDeg * Math.PI / 180;
    var cosR = Math.cos(rot), sinR = Math.sin(rot);
    var viewCx = w / 2, viewCy = h / 2;
    function mapPoint(x, y) {
      var sx = ox + (x - bounds.minX) * scale;
      var sy = oy + (bounds.maxY - y) * scale;
      if (!rot) return { x: sx, y: sy };
      var dx = sx - viewCx, dy = sy - viewCy;
      return {
        x: viewCx + dx * cosR - dy * sinR,
        y: viewCy + dx * sinR + dy * cosR
      };
    }

    // 同坐标系赛道线（单车时间序列），不是装饰 SVG
    if (TRACKMAP.outline.length > 2) {
      g.beginPath();
      g.strokeStyle = day ? 'rgba(55,71,79,0.5)' : 'rgba(176,190,197,0.4)';
      g.lineWidth = Math.max(4, Math.min(10, Math.sqrt(scale) * 18));
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (var i = 0; i < TRACKMAP.outline.length; i++) {
        var o = TRACKMAP.outline[i];
        var mp = mapPoint(o.x, o.y);
        if (i === 0) g.moveTo(mp.x, mp.y); else g.lineTo(mp.x, mp.y);
      }
      g.stroke();
      g.beginPath();
      g.strokeStyle = day ? 'rgba(255,255,255,0.92)' : 'rgba(236,239,241,0.88)';
      g.lineWidth = Math.max(1.5, Math.min(4, Math.sqrt(scale) * 8));
      for (var j = 0; j < TRACKMAP.outline.length; j++) {
        var o2 = TRACKMAP.outline[j];
        var mp2 = mapPoint(o2.x, o2.y);
        if (j === 0) g.moveTo(mp2.x, mp2.y); else g.lineTo(mp2.x, mp2.y);
      }
      g.stroke();
    }

    var pos = TRACKMAP.positions.slice();
    pos.sort(function (a, b) {
      return String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
    });
    for (var k = 0; k < pos.length; k++) {
      var p = pos[k];
      if (p.retired) continue;
      if (p.x == null || p.y == null) continue;
      var pt = mapPoint(p.x, p.y);
      var cx = pt.x, cy = pt.y;
      var rDot = Math.max(5, Math.min(10, 6 + scale * 80));
      g.beginPath();
      g.fillStyle = p.teamColour || '#90caf9';
      g.arc(cx, cy, rDot, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = day ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.8)';
      g.stroke();
      g.font = '700 10px "Noto Sans SC", Segoe UI, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = day ? '#102027' : '#fff';
      g.fillText(p.tla || p.number, cx, cy - rDot - 8);
    }
    syncTrackmapRotUi(box);
  }

  function renderTrackmap(box) {
    var rk = raceKey();
    if (rk !== TRACKMAP.lastRaceKey) {
      TRACKMAP.lastRaceKey = rk;
      TRACKMAP.sessionKey = null;
      TRACKMAP.sessionMeta = null;
      TRACKMAP.outline = [];
      TRACKMAP.positions = [];
      TRACKMAP.source = '';
      TRACKMAP.svgPath = '';
      TRACKMAP.status = '等待位置数据';
      TRACKMAP.frozen = false;
      resetTrackmapView();
      stopTrackmapPoll();
      restoreTrackmapCache(rk);
    }

    if (!box.getAttribute('data-tm')) {
      clear(box);
      box.setAttribute('data-tm', '1');
      if (!ONCE) panelTitle(box, '赛道图');
      var wrap = el('div', 'tm-wrap');
      wrap.appendChild(el('div', 'tm-svg'));
      wrap.appendChild(el('canvas', 'tm-canvas'));
      box.appendChild(wrap);
      placeTrackmapChrome(box);
      wireTrackmapZoom(wrap, box);
    } else {
      ensureTrackmapChrome(box);
      wireTrackmapZoom(box.querySelector('.tm-wrap'), box);
    }

    if (applyOfficialPositions()) {
      // official path still start poller only if needed for outline? skip
    }
    ensureTrackmapPoll();
    drawTrackmap(box);
  }


  var RENDER = {
    flags: renderFlags, ring: renderRing, trackmap: renderTrackmap, track: renderTrack,
    tyres: renderTyres, timing: renderTiming, sectors: renderSectors, weather: renderWeather,
    fastest: renderFastest, session: renderSession, messages: renderMessages
  };

  var TITLES = {
    // ★ 圆环就叫「赛段状态」—— 它画的就是赛道（一圈区段），和安卓一致
    //   （安卓 MODE_NAMES 第一项就是"赛段状态"）。以前这里写"车手圆环"，
    //   用户直接指出来了。下面那个 track 板其实是**文字**状态汇总，不是地图，
    //   所以改名"赛道状态"，免得两块板同名。
    flags: '顶部旗语栏', ring: '赛段状态', trackmap: '赛道图', track: '赛道状态', tyres: '轮胎进站',
    timing: '成绩榜', sectors: '赛段成绩', weather: '天气', fastest: '最快圈', session: '环节',
    messages: '赛事通报'
  };

  // ---------------------------------------------------------------
  // 手机版主界面（和安卓同款：只显示该显的）
  // ---------------------------------------------------------------

  /**
   * 这是不是手机屏；是的话该按哪种排布。
   *
   * 判据用**短边**：手机不管横竖，短边都在 400 上下；平板和桌面窗口的短边
   * 明显更大。只看宽度会在横屏时把手机错判成桌面（844 宽的横屏手机）。
   *
   * 返回 'portrait' / 'landscape' / null（null = 按桌面版渲染）。
   */
  function phoneMode() {
    var w = window.innerWidth, h = window.innerHeight;
    if (Math.min(w, h) > 560) { return null; }
    return h >= w ? 'portrait' : 'landscape';
  }

  /** 手机横屏右栏那条窄框图标；点谁切谁（对应安卓的 buildIconStrip）。 */
  function phoneIconStrip() {
    var strip = el('div', 'm-strip');
    for (var i = 0; i < PHONE_MODES.length; i++) {
      var b = el('button', 'strip-btn'
        + (PHONE_MODES[i][0] === mobilePanel ? ' on' : ''));
      b.type = 'button';
      b.textContent = PHONE_MODES[i][1];
      b.title = PHONE_MODES[i][2];
      b.setAttribute('data-mode', PHONE_MODES[i][0]);
      // ★ 用闭包把 id 定住。循环变量直接进回调的话，点哪个都是最后一屏。
      b.addEventListener('click', (function (id) {
        return function () {
          mobilePanel = id;
          repaint();
        };
      })(PHONE_MODES[i][0]));
      strip.appendChild(b);
    }
    return strip;
  }

  /**
   * 全屏按钮（手机用）。
   *
   * 手机浏览器地址栏吃掉的高度很值这一下（安卓那边没这个按钮，但网页版是在
   * 浏览器里跑，比不了）。
   *
   * 按钮**总是**摆出来 —— 但要是这台浏览器压根不支持对任意元素全屏
   * （iOS 的 Safari 只给 video 元素全屏），点下去会如实说一句"该怎么办"
   * （iPhone 那条路是「分享 → 添加到主屏幕」），而不是装作没这回事。
   */
  function fullscreenButton() {
    var doc = document.documentElement;
    var req = doc.requestFullscreen || doc.webkitRequestFullscreen;
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    var b = el('button', 'phone-btn phone-btn-fs' + (on ? ' on' : ''),
      on ? '退出全屏' : '全屏');
    b.type = 'button';
    b.title = on ? '退出全屏' : '全屏（藏起浏览器的地址栏）';
    b.addEventListener('click', function () {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (exit) { exit.call(document); }
        return;
      }
      if (!req) {
        notice('这台浏览器不支持网页全屏；iPhone 可用「分享 → 添加到主屏幕」');
        return;
      }
      try {
        var r = req.call(doc);
        // 有的浏览器返回 Promise：被拒（比如没算作"用户手势"）时如实说一句
        if (r && r.catch) {
          r.catch(function (e) { notice('全屏没成功：' + ((e && e.message) || e)); });
        }
      } catch (e) {
        notice('全屏没成功：' + e.message);
      }
    });
    return b;
  }

  /** 在手机状态行上说一句，8 秒后自己消失。 */
  function notice(msg) {
    phoneNotice = msg;
    repaint();
    setTimeout(function () {
      if (phoneNotice === msg) {
        phoneNotice = '';
        repaint();
      }
    }, 8000);
  }

  /**
   * 手机上那一行薄状态行。
   *
   * 安卓的状态行是塞在左栏顶部的（buildStatusRow 加在 left 里），不在旗语栏里 ——
   * 所以手机版也放这儿，而不是像桌面版那样占一整条头部。手机屏就那么点高。
   * 右端两个按钮：单独打开（当前这一屏开成新标签页）、全屏。
   */
  function phoneStatusRow() {
    var row = el('div', 'm-phone-status');
    row.appendChild(el('span', 'dot' + (connected ? ' ok' : ' bad')));
    row.appendChild(el('span', 'phone-status-text',
      phoneNotice || (connected ? ('已连接 · ' + ago(lastPush))
                                : (errNote || '未连接'))));
    row.appendChild(el('span', 'spacer'));

    var bid = phoneMode() === 'landscape' ? mobilePanel : 'messages';
    var pop = el('button', 'phone-btn', '单独打开');
    pop.type = 'button';
    pop.title = '在新标签页里单独打开「' + (TITLES[bid] || bid) + '」';
    pop.addEventListener('click', function () { popout(bid); });
    row.appendChild(pop);

    var fs = fullscreenButton();
    if (fs) {
      row.appendChild(fs);
    }
    return row;
  }

  /**
   * 手机版主界面 —— 只显示和安卓一致的内容，**比例也照安卓来**。
   *
   * 安卓的排布（F1MainActivity.buildLayout / buildBody）：
   *   旗语栏   固定 42dp 高
   *   竖屏     旗语栏 + [ 状态行 + 消息列表 ]
   *   横屏     旗语栏 + [ 状态行 + 消息列表 | 右侧面板 | 窄框图标条(38dp) ]
   *   左右两栏各 weight=1f（各一半），窄条固定 38dp；面板一次只显示一屏
   *
   * ★ 安卓**没有**顶部大标题行 —— 状态行是塞在左栏里的。手机屏就这么点高，
   *   照抄桌面版的头部 + 每块面板的标题行纯属浪费：我第一版就是这么做的，
   *   横屏 390px 里光旗语栏 86px、头部 80px，比例明显不对（用户一眼看出来）。
   */
  function renderPhoneMain(root, mode) {
    var wrap = el('div', 'phone phone-' + mode);

    // 旗语栏：只要那一条（42px，见 CSS），标题行和摘要行都不给
    var flags = el('div', 'm-flags');
    renderFlags(flags);
    wrap.appendChild(flags);

    var body = el('div', 'm-phone-body');

    var left = el('div', 'm-phone-left');
    left.appendChild(phoneStatusRow());
    var msgs = el('div', 'panel m-msgs m-phone-msgs');
    msgs.setAttribute('data-board', 'messages');
    left.appendChild(msgs);
    body.appendChild(left);

    var area = null;
    if (mode === 'landscape') {
      // 面板和左栏是**兄弟**（各 weight 1），窄条也是兄弟（固定 38px）——
      // 和安卓一样。要是把面板和窄条包在一起，左栏就比面板宽了。
      if (mobilePanel === 'ring') {
        // 圆环：标题在外、被测量的画布区在内（这个坑踩过一次）
        area = el('div', 'ring-area');
      } else {
        area = el('div', 'panel m-phone-box');
        area.setAttribute('data-board', mobilePanel);
      }
      body.appendChild(area);
      body.appendChild(phoneIconStrip());
    }
    wrap.appendChild(body);
    root.appendChild(wrap);

    // ★ 先入树再渲染（圆环要量盒子尺寸），和别处一致
    renderMessages(msgs);
    if (area) {
      RENDER[mobilePanel](area);
    }
  }

  // ---------------------------------------------------------------
  // 主界面：顶部旗语栏 + 左侧圆环 + 右侧 6 屏
  // ---------------------------------------------------------------

  function renderMain(root) {
    clear(root);

    // 手机：只显示和安卓同款的内容，**而且比例也照安卓**。
    // ★ 必须一开始就分叉：第一版我把手机版"追加"在桌面排布**后面**，
    //   于是手机上出现了两个旗语栏、上面还压着 80px 的头部（头部 + 旗语栏
    //   吃掉 390px 里的 43%）。用 CDP 量高度才看出来 —— 眼睛看截图只觉得"有点挤"。
    var phone = phoneMode();
    if (phone) {
      renderPhoneMain(root, phone);
      return;
    }

    var head = el('div', 'm-head');
    var brand = el('div', 'm-brand');
    var r = (state && state.race) || {};
    brand.appendChild(el('div', 'm-title', (r.meeting || 'F1 Director')));
    brand.appendChild(el('div', 'm-sub',
      (r.session || '') + ' · ' + (r.status || '')
      + ' · 第 ' + (r.lap || 0) + '/' + (r.totalLaps || 0) + ' 圈'
      + (r.remaining ? ' · 剩 ' + r.remaining : '')));
    head.appendChild(brand);

    var right = el('div', 'm-status');
    var dot = el('span', 'dot' + (connected ? ' ok' : ' bad'));
    right.appendChild(dot);
    right.appendChild(el('span', null, connected
      ? ('已连接 · ' + ago(lastPush)) : (errNote || '未连接')));
    if (state && state.replay) {
      right.appendChild(el('span', 'badge', '回放 ' + (state.replayName || '')));
    }
    right.appendChild(el('span', 'badge', 'v' + ((state && state.version) || '?')));
    // 只要有小窗弹出去，头部就给一个"一次全关"的出口。
    // 没有这个按钮时用户只能一个个点「收回」，或者去关窗口 —— 他反馈过。
    var all = popAllButton();
    if (all) {
      right.appendChild(all);
    }
    head.appendChild(right);

    root.appendChild(head);

    // 旗语栏也要能弹出去，所以套一层：标题栏在外、横条在内。
    // （renderFlags 会 clear 自己的容器，标题不能和它共用同一个容器）
    var flagsCol = el('div', 'm-flags-col');
    flagsCol.appendChild(titleRow(TITLES.flags, 'flags'));
    var flags = el('div', 'm-flags');
    renderFlags(flags);
    flagsCol.appendChild(flags);
    root.appendChild(flagsCol);

    // 最新一条通报做成横幅 —— 这是"刚刚发生了什么"最该被一眼看到的地方。
    // 和安卓一样：有中文用中文，没有就用英文原文。
    var msgs = (state && state.messages) || [];
    if (msgs.length) {
      var line = msgLine(msgs[0]);
      var banner = el('div', 'm-banner');
      banner.appendChild(el('span', 'banner-time', msgTime(msgs[0])));
      banner.appendChild(el('span', 'banner-text', line.zh));
      if (line.translated) {
        banner.appendChild(el('span', 'banner-en', line.en));
      }
      root.appendChild(banner);
    }

    // 手机上只显示安卓同款的内容（竖屏只看通报、横屏两栏），不走下面那套
    // "圆环 + 右侧 6 块全铺"的桌面排布。分叉在函数开头（见上）。

    var body = el('div', 'm-body');
    var left = el('div', 'm-left');

    // 圆环也一样：标题在外、正方形画布区在内。
    // renderRing 量的是"画布区"的短边，所以标题不能放在被测量的那个盒子里，
    // 否则量到的短边会少了标题那一行，圆会画得偏大。
    var ringCol = el('div', 'm-ring');
    ringCol.appendChild(titleRow(TITLES.ring, 'ring'));
    var ringArea = el('div', 'ring-area');
    ringCol.appendChild(ringArea);   // 画布区先入树，最后才画（见本函数末尾）
    left.appendChild(ringCol);

    var msgBox = el('div', 'panel m-msgs');
    msgBox.setAttribute('data-board', 'messages');
    renderMessages(msgBox);
    left.appendChild(msgBox);
    body.appendChild(left);

    var grid = el('div', 'm-grid');
    var ids = ['track', 'tyres', 'timing', 'weather', 'fastest', 'session'];
    for (var i = 0; i < ids.length; i++) {
      var p = el('div', 'panel');
      p.setAttribute('data-board', ids[i]);
      RENDER[ids[i]](p);
      grid.appendChild(p);
    }
    body.appendChild(grid);
    root.appendChild(body);

    // ★ 圆环必须等挂进文档之后再画，而且必须在最后。
    //   它是按"画布区的短边"定边长的 —— 盒子还不在文档里时 clientWidth/Height
    //   都是 0，只能走 320 的回退值。那不只是圆不圆的问题：因为每次重绘都会
    //   重建整棵树，这个 0 会被反复量到，圆环就"永远只有 320px"、周围一大片空。
    renderRing(ringArea);
  }

  function renderBoard(root) {
    clear(root);
    var m = /^\/board\/([a-z]+)/.exec(location.pathname);
    var id = m ? m[1] : (new URLSearchParams(location.search)).get('id');
    if (!id || !RENDER[id]) {
      root.appendChild(el('div', 'big', '未知看板: ' + id));
      return;
    }
    // Director panels show board name + status dot in the chrome dropdown.
    // Skip the whole inner status row when embedded via ?once=1 to save a line.
    if (!ONCE) {
      var head = el('div', 'b-head');
      head.appendChild(el('div', 'b-title', TITLES[id] || id));
      var dot = el('span', 'dot' + (connected ? ' ok' : ' bad'));
      head.appendChild(dot);
      head.appendChild(el('span', 'b-sub', connected ? ago(lastPush) : (errNote || '未连接')));
      // 在小窗里也能一键收回所有小窗（包括自己这个）—— 省得回到主界面去点。
      var all = popAllButton();
      if (all) {
        head.appendChild(all);
      }
      root.appendChild(head);
    }
    var box = el('div', 'b-box b-' + id);
    // ★ 先入树再渲染。
    //   反过来的话盒子还没有布局，clientWidth/Height 都是 0 ——
    //   圆环这类"按盒子算尺寸"的看板会永远按回退值画（320px），
    //   而且 ?once=1 快照模式下没有后续重绘来纠正。
    root.appendChild(box);
    RENDER[id](box);
  }

  // ---------------------------------------------------------------
  // 连接
  // ---------------------------------------------------------------

  function repaint(opts) {
    opts = opts || {};
    var layoutOnly = !!opts.layoutOnly;
    var main = document.getElementById('main');
    // Resize/layout passes skip the main grid rebuild (trackmap etc. still re-render below).
    if (main && !layoutOnly) { renderMain(main); }
    var board = document.getElementById('board');
    if (board) {
      // 看板不做全量重建：重建会闪、也会丢掉 canvas 的滚动手感。
      // — 但骨架必须先存在 — 第一次 repaint 时 #board 还是空的，
      //   这时候得走一次完整渲染，否则页面永远是白的。
      var box0 = board.querySelector('.b-box');
      if (!box0) { renderBoard(board); return; }
      var m = /^\/board\/([a-z]+)/.exec(location.pathname);
      var id = m ? m[1] : null;
      if (id && RENDER[id]) {
        var head = board.querySelector('.b-head .b-sub');
        if (head) {
          head.textContent = connected ? ago(lastPush) : (errNote || '未连接');
        }
        var dot = board.querySelector('.b-head .dot');
        if (dot) { dot.className = 'dot' + (connected ? ' ok' : ' bad'); }
        var box = board.querySelector('.b-box');
        if (box) {
          // Timing / sectors: resize only needs density re-fit, not DOM rebuild.
          if (layoutOnly && (id === 'timing' || id === 'sectors')) {
            var wrap = box.querySelector(id === 'sectors' ? '.sectors-wrap' : '.timing-wrap');
            if (wrap) {
              if (id === 'sectors') fitSectorsTable(wrap, 'exact');
              else fitTimingTable(wrap, 'exact');
              return;
            }
          }
          RENDER[id](box);
        }
      } else {
        renderBoard(board);
      }
    }
  }

  function onState(s) {
    state = s;
    lastPush = s.lastUpdateAt || Date.now();
    repaint();
  }

  function connect() {
    if (es) { es.close(); }
    es = new EventSource('/api/events');
    es.addEventListener('state', function (ev) {
      connected = true;
      errNote = '';
      try { onState(JSON.parse(ev.data)); } catch (e) { errNote = '解析失败'; }
    });
    es.addEventListener('open', function () { connected = true; errNote = ''; });
    es.addEventListener('error', function () {
      connected = false;
      errNote = '连接断了，正在重连……';
      repaint();
    });
  }

  // 每秒刷新"多久以前"，即使没有新数据
  setInterval(function () {
    if (!connected || ONCE) { return; }
    repaint();
  }, 1000);

  // 每 3 秒问一次"哪些看板弹出来了"：用户可能直接用窗口的 X 关掉，
  // 那样按钮上的"收回"要能自己变回"弹出"。
  setInterval(function () {
    if (!ONCE) { refreshPopped(); }
  }, 3000);

  // 窗口被拉大/拉小时立刻重画。不靠等下一次推送 —— 拖拽过程中
  // 圆环会明显看到"被拉扁"，哪怕只有一秒也很难看。
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) { clearTimeout(resizeTimer); }
    resizeTimer = setTimeout(function () { resizeTimer = null; repaint({ layoutOnly: true }); }, 120);
  });

  // 进出全屏也要重画：不仅是按钮上的字要换，圆环也得按新高度重新量一次。
  // （转屏会触发 resize，但全屏不一定 —— 两者都挂上。）
  var fsEvents = ['fullscreenchange', 'webkitfullscreenchange'];
  for (var fi = 0; fi < fsEvents.length; fi++) {
    document.addEventListener(fsEvents[fi], function () {
      if (resizeTimer) { clearTimeout(resizeTimer); }
      resizeTimer = setTimeout(function () { resizeTimer = null; repaint({ layoutOnly: true }); }, 120);
    });
  }

  // Director console (and other embeds) can push live state into ?once=1
  // boards without each iframe opening its own EventSource. Browsers only
  // allow ~6 HTTP/1.1 connections per host; 7 board iframes each with SSE
  // leave later panels stuck on a forever-pending /api/state → blank body.
  function pushState(s) {
    if (!s) { return; }
    connected = true;
    errNote = '';
    onState(s);
  }

  function relayout() {
    // Parent director resized our iframe; window.resize may not fire for CSS size changes.
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    repaint();
  }

  window.addEventListener('message', function (ev) {
    try {
      var d = ev.data;
      if (!d || typeof d !== 'object') { return; }
      if (d.type === 'f1-set-board' && d.board) {
        setBoard(d.board);
        return;
      }
      if (d.type === 'f1-push-state' && d.state) {
        pushState(d.state);
        return;
      }
      if (d.type === 'f1-resize') {
        relayout();
        return;
      }
      if (d.type === 'f1-timing-cols-refresh') {
        refreshTimingColumnsFromStorage();
        return;
      }
      if (d.type === 'f1-timing-cols-set' && d.vis) {
        saveTimingColumns(d.vis);
        refreshTimingColumnsFromStorage();
        return;
      }
      if (d.type === 'f1-trackmap-rot') {
        if (d.deg != null && d.deg !== '') setTrackmapRotDeg(d.deg);
        else rotateTrackmapBy(d.delta);
        return;
      }
      if (d.type === 'f1-trackmap-ui-req') {
        notifyTrackmapParentUi();
        return;
      }
      if (d.type === 'f1-theme' && d.theme) {
        applyTheme(d.theme);
        try { localStorage.setItem(STORAGE_THEME, d.theme === 'day' ? 'day' : 'night'); } catch (e) {}
        try { repaint(); } catch (e) {}
      }
    } catch (e) { /* ignore */ }
  });

  // Theme toggles from the parent director may only flip data-theme (or arrive
  // via storage); keep canvas boards in sync without requiring a full reload.
  try {
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].attributeName === 'data-theme') {
            scheduleThemeCanvasRedraw();
            break;
          }
        }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  } catch (e) { /* ignore */ }
  try {
    window.addEventListener('storage', function (ev) {
      if (!ev || ev.key !== STORAGE_THEME) return;
      if (ev.newValue === 'day' || ev.newValue === 'night') applyTheme(ev.newValue);
    });
  } catch (e) { /* ignore */ }

  // iframe CSS size changes often skip window.resize — observe the document box.
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var __ro = new ResizeObserver(function () {
        if (resizeTimer) { clearTimeout(resizeTimer); }
        resizeTimer = setTimeout(function () { resizeTimer = null; repaint({ layoutOnly: true }); }, 80);
      });
      __ro.observe(document.documentElement);
    } catch (e) { /* ignore */ }
  }


  function setBoard(id) {
    if (!id || !RENDER[id]) return false;
    try {
      var q = location.search || '';
      history.replaceState(null, '', '/board/' + id + q);
    } catch (e) { /* ignore */ }
    if (id !== 'trackmap') {
      try { stopTrackmapPoll(); } catch (e2) { /* ignore */ }
    }
    var board = document.getElementById('board');
    if (!board) return false;
    renderBoard(board);
    return true;
  }
  window.F1 = {
    connect: connect, RENDER: RENDER, TITLES: TITLES, argb: argb,
    renderMain: renderMain, renderBoard: renderBoard, setBoard: setBoard,
    state: function () { return state; },
    pushState: pushState,
    relayout: relayout,
    applyTheme: applyTheme,
    timingCols: TIMING_COLS,
    getTimingColumns: loadTimingColumns,
    setTimingColumns: function (vis) {
      saveTimingColumns(vis || loadTimingColumns());
      refreshTimingColumnsFromStorage();
    },
    refreshTimingColumns: refreshTimingColumnsFromStorage,
    rotateTrackmap: rotateTrackmapBy,
    setTrackmapRot: setTrackmapRotDeg,
    getTrackmapRot: function () { return wrapTrackmapRot(TRACKMAP.viewRotDeg); },
    getTrackmapStatus: trackmapStatusText
  };

  document.addEventListener('DOMContentLoaded', function () {
    // ★ 先拉一次快照立刻画，再挂 SSE。
    //   只靠 SSE 的话首屏要等第一条事件才出内容 —— 局域网上是几十毫秒，
    //   但手机刚解锁、页面刚打开时那一下空白很显眼。
    //   （顺带让无头浏览器截图变得确定：load 事件之后页面就已有内容。）
    fetch('/api/state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) { connected = true; onState(s); })
      .catch(function () {
        errNote = '首屏快照没拉到，等推送……';
        repaint();
      })
      .then(function () {
        refreshPopped();   // 首屏就问清楚"哪些看板已经弹出来了"
        if (!ONCE) { connect(); }
      });
  });
}());
