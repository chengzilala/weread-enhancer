/**
 * 微信悦读 · 笔记增强模块（v0.10.0）
 *
 * 定位：独立模块，不改动 content.js 既有逻辑。通过 manifest 的 content_scripts
 * 在 content.js 之前加载，与 content.js 共享同一个隔离世界（isolated world），
 * 可直接复用 content.js 的全局函数（如 log）与 #we-read-enhancer-root 容器。
 *
 * 职责：
 *   1. 数据获取：优先微信读书「同源接口」（用你自己的登录态，数据不外传），
 *      接口不可用时回退「页面抓取」，并在面板上明示数据来源
 *   2. 面板：主菜单「📝 笔记」入口，按章节分组展示本书划线、想法与批注
 *   3. 导出：Markdown / 纯文本（按 RPD 9.2.2 的结构）
 *   4. 选中即复制：选中正文文字后在选区旁显示「复制」浮标，一键复制
 *   5. Ctrl/Cmd+C 增强：拦截 copy 事件，清掉官方附加的版权声明（水印）
 *   6. 点击条目跳原文：同书直接在当前页定位；跨书打开阅读页后延时定位（尽力而为）
 *
 * 数据来源说明（重要）：
 *   - 接口路径（均为 weread.qq.com 同源，走浏览器自带的登录 Cookie）：
 *       GET  /web/book/bookmarklist?bookId=<id>
 *       GET  /web/review/list?bookId=<id>&listType=11&mine=1&synckey=0&listMode=1
 *       POST /web/book/chapterInfos      （用于拿章节名与章节顺序）
 *   - 不向任何第三方服务器发送数据；面板数据只在内存里缓存 5 分钟，不落盘。
 */
(function () {
  'use strict';

  const NOTES_CACHE_TTL = 5 * 60 * 1000; // 面板数据内存缓存时长
  // 阅读页 URL 形如 /web/reader/{bookId}k{chapterHash}，需整体捕获后再切出 bookId
  const READER_SEGMENT_RE = /\/web\/reader\/([^/?#]+)/;
  const PENDING_JUMP_KEY = 'wrePendingJump'; // 跨书跳转的待办定位（存 localStorage，跨标签页可见）
  const PENDING_JUMP_TTL = 2 * 60 * 1000;
  const MIN_SELECTION_LENGTH = 1;
  const MAX_SELECTION_LENGTH = 2000;

  // 官方复制时附加的版权声明（水印）候选形式，命中才清洗，尽量不误伤正常文本
  const TAIL_WATERMARKS = [
    /^[-—–~～]{1,4}\s*微信读书\s*[。.]?$/,
    /^来自\s*微信读书[。.]?$/,
    /^微信读书\s*[·・]\s*weread\.qq\.com$/i,
    /^《[^》]{1,60}》\s*[·・\-—]?\s*微信读书.*$/,
    /^侵权必究[。.]?$/,
  ];
  const BARE_WATERMARK = /^微信读书[。.]?$/; // 「微信读书」单独一行：要求前面隔了空行才认定是水印
  const TAIL_INLINE_WATERMARK = /\s*[-—–·]{1,4}\s*微信读书\s*$/;

  let cache = { bookId: null, at: 0, data: null };
  let panelTab = 'highlights';
  let panelState = { loading: false, error: '', emptyReason: '', data: null };
  let jumpTargets = []; // 当前面板条目的跳转信息，index ↔ DOM data 属性

  // ---------- 通用小工具 ----------

  function logNotes(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[notes] ' + message, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function toDateKey(timestamp) {
    const date = new Date(timestamp);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function formatDateTime(timestamp) {
    if (!timestamp) {
      return '—';
    }
    const date = new Date(timestamp);
    return toDateKey(timestamp) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sanitizeFileName(name) {
    return String(name || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || '未命名';
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // 兼容：无剪贴板权限时退回 execCommand
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (inner) {
        ok = false;
      }
      textarea.remove();
      logNotes('warn', '剪贴板 API 不可用，已尝试兼容复制', { fallbackOk: ok, reason: String(error) });
      return ok;
    }
  }

  // ---------- 版权声明（水印）清洗 ----------

  function stripWatermark(text) {
    if (!text) {
      return text;
    }
    const normalized = String(text).replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    let index = lines.length - 1;
    while (index >= 0 && !lines[index].trim()) {
      index -= 1;
    }
    let removed = 0;
    while (index >= 0) {
      const candidate = lines[index].trim();
      if (!candidate) {
        break;
      }
      const isTail = TAIL_WATERMARKS.some((re) => re.test(candidate));
      // 「微信读书」单独一行：只有与正文隔了空行才认作水印，避免误删正文
      const prevLine = index > 0 ? lines[index - 1] : '';
      const isBare = BARE_WATERMARK.test(candidate) && prevLine.trim() === '';
      if (!isTail && !isBare) {
        break;
      }
      removed += 1;
      index -= 1;
    }
    if (removed > 0) {
      const kept = lines.slice(0, index + 1);
      while (kept.length && !kept[kept.length - 1].trim()) {
        kept.pop();
      }
      const result = kept.join('\n');
      logNotes('info', '已清洗复制内容里的官方版权声明（逐行命中）', { removed });
      return result;
    }
    // 水印与正文在同一行（形如「……——微信读书」）
    const result = normalized.replace(TAIL_INLINE_WATERMARK, '');
    if (result !== normalized) {
      logNotes('info', '已清洗复制内容里的官方版权声明（行尾命中）');
      return result;
    }
    return text;
  }

  function cleanClipboardHtml(html) {
    if (!html) {
      return html;
    }
    let result = html;
    // 形如 <p>—— 微信读书</p> 的尾部声明块
    result = result.replace(/<([a-z0-9]+)[^>]*>\s*(?:[-—–~～]{0,4}\s*)?微信读书[^<]{0,20}<\/\1>\s*$/i, '');
    // 形如 ……——微信读书（无包裹标签）
    result = result.replace(/\s*(?:<br\s*\/?>)?\s*(?:[-—–·]{1,4}\s*)?微信读书\s*$/i, '');
    if (result !== html) {
      logNotes('info', '已清洗复制内容（富文本）里的官方版权声明');
    }
    return result;
  }

  // ---------- 书籍识别 ----------

  function getBookTitle() {
    const nodes = document.querySelectorAll(
      '.readerTopBar_title_link, .readerTopBar_title, .readerTopBar [class*="title"]'
    );
    for (const node of nodes) {
      const text = (node.textContent || '').trim();
      if (text && text.length <= 100) {
        return text;
      }
    }
    const pageTitle = (document.title || '').replace(/\s*[-–—|]\s*微信读书.*$/, '').trim();
    if (pageTitle && pageTitle !== '微信读书') {
      return pageTitle;
    }
    return '';
  }

  // 从阅读页 URL 段中取 bookId：`{bookId}k{chapterHash}` → 取第一个 k 之前的部分
  // （bookId 字符集为 0-9a-g，不含 k；chapterHash 为纯十六进制）
  function extractBookId(segment) {
    return String(segment || '').split('k')[0];
  }

  function getBookContext() {
    const match = window.location.href.match(READER_SEGMENT_RE);
    return {
      bookId: extractBookId(match ? match[1] : ''),
      title: getBookTitle(),
    };
  }

  // ---------- 数据层：同源接口 ----------

  // 统一请求封装：永不抛错，返回带诊断信息的对象（status / keys / error），
  // 便于一次性定位「为什么取回 0 条」——是没登录、被风控、还是字段名不认识。
  async function requestJson(url, options, label) {
    try {
      const response = await fetch(url, Object.assign({
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }, options || {}));
      const status = response.status;
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseError) {
        const error = new Error('接口返回的不是 JSON（可能被重定向到登录页或被风控拦截）');
        error.code = 'parse';
        return { label, url, status, ok: false, error, keys: [], sample: String(text).slice(0, 120) };
      }
      if (status === 401 || status === 403) {
        const error = new Error('未登录或登录已过期');
        error.code = 'unauthorized';
        return { label, url, status, ok: false, error, keys: [] };
      }
      if (!response.ok) {
        const error = new Error('接口返回 HTTP ' + status);
        error.code = 'http';
        return { label, url, status, ok: false, error, keys: [] };
      }
      const bizCode = data && (data.errcode != null ? data.errcode : data.errCode);
      if (bizCode != null && bizCode !== 0) {
        const error = new Error('接口业务错误：' + (data.errmsg || data.errMsg || bizCode));
        error.code = 'biz';
        return { label, url, status, ok: false, error, keys: Object.keys(data || {}), data };
      }
      return { label, url, status, ok: true, data, keys: Object.keys(data || {}) };
    } catch (error) {
      return { label, url, status: 0, ok: false, error, keys: [] };
    }
  }

  function pickArray(payload, keys) {
    if (!payload) {
      return [];
    }
    for (const key of keys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }
    return [];
  }

  // 兼容多种返回层级：顶层 / data / data[bookId]，取第一个非空数组
  function pickArrayDeep(payload, bookId, keys) {
    if (!payload) {
      return [];
    }
    const containers = [payload];
    if (payload.data && typeof payload.data === 'object') {
      containers.push(payload.data);
      if (payload.data[bookId]) {
        containers.push(payload.data[bookId]);
      }
    }
    for (const container of containers) {
      for (const key of keys) {
        if (container && Array.isArray(container[key]) && container[key].length) {
          return container[key];
        }
      }
    }
    return [];
  }

  function describeEndpoint(res, count) {
    if (!res.ok) {
      return 'HTTP ' + (res.status || 'ERR') + ' 失败（' + (res.error ? res.error.message : '未知') + '）';
    }
    return 'HTTP ' + res.status + '，字段[' + (res.keys.join(',') || '空') + ']，取到 ' + count + ' 条';
  }

  function buildDiagText(bookmarkRes, reviewRes, chapterRes, highlightCount, thoughtCount) {
    return '接口诊断 → 划线：' + describeEndpoint(bookmarkRes, highlightCount) +
      '；想法：' + describeEndpoint(reviewRes, thoughtCount) +
      '；章节：' + (chapterRes.ok ? 'HTTP ' + chapterRes.status : describeEndpoint(chapterRes, 0));
  }

  function normalizeBookmark(raw) {
    const text = String(raw.markText || raw.markTextWithWhiteSpace || '').trim();
    if (!text) {
      return null;
    }
    return {
      kind: 'highlight',
      id: raw.bookmarkId || '',
      chapterUid: raw.chapterUid != null ? String(raw.chapterUid) : '',
      chapterName: raw.chapterName || raw.chapterTitle || '',
      text,
      createTime: Number(raw.createTime || 0) * (raw.createTime > 1e12 ? 1 : 1000),
      range: raw.range || '',
    };
  }

  function normalizeReview(rawItem) {
    const raw = rawItem && rawItem.review ? rawItem.review : (rawItem || {});
    const content = String(raw.content || '').trim();
    const abstract = String(raw.abstract || raw.contextAbstract || '').trim();
    if (!content && !abstract) {
      return null;
    }
    return {
      kind: 'thought',
      id: raw.reviewId || '',
      chapterUid: raw.chapterUid != null ? String(raw.chapterUid) : '',
      chapterName: raw.chapterName || raw.chapterTitle || '',
      text: content || abstract,
      abstract,
      createTime: Number(raw.createTime || 0) * (raw.createTime > 1e12 ? 1 : 1000),
      range: raw.range || '',
    };
  }

  function buildChapterMap(payload, bookId) {
    const map = {};
    const container = (payload && payload.data ? payload.data[bookId] : null)
      || (payload ? payload[bookId] : null)
      || payload
      || {};
    const list = pickArray(container, ['updated', 'chapters', 'chapterInfos']);
    list.forEach((chapter, index) => {
      if (chapter && chapter.chapterUid != null) {
        map[String(chapter.chapterUid)] = {
          name: chapter.chapterName || chapter.title || '',
          index,
        };
      }
    });
    return map;
  }

  async function fetchBookNotes(bookId) {
    const [bookmarkRes, reviewRes, chapterRes] = await Promise.all([
      requestJson('/web/book/bookmarklist?bookId=' + encodeURIComponent(bookId), null, 'bookmarklist'),
      requestJson('/web/book/review/list?bookId=' + encodeURIComponent(bookId) + '&listType=11&mine=1&synckey=0&listMode=1', null, 'review/list'),
      requestJson('/web/book/chapterInfos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds: [bookId], synckeys: [0], teenmode: 0 }),
      }, 'chapterInfos'),
    ]);

    // 两块核心数据都失败 → 抛错，由上层回退页面抓取（未登录优先抛出，提示去登录）
    if (!bookmarkRes.ok && !reviewRes.ok) {
      const unauthorized = [bookmarkRes, reviewRes].find((res) => res.error && res.error.code === 'unauthorized');
      throw (unauthorized ? unauthorized.error : bookmarkRes.error);
    }

    const chapterMap = chapterRes.ok ? buildChapterMap(chapterRes.data, bookId) : {};
    let highlights = pickArrayDeep(bookmarkRes.ok ? bookmarkRes.data : null, bookId, ['updated', 'bookmarks', 'bookmarkList'])
      .map(normalizeBookmark)
      .filter(Boolean);
    const thoughts = pickArrayDeep(reviewRes.ok ? reviewRes.data : null, bookId, ['reviews'])
      .map(normalizeReview)
      .filter(Boolean);

    // 接口没拿到划线时，用页面已渲染的划线兜底（可能是渲染模式/字段差异导致的空）
    let source = 'api';
    let sourceNote = '数据来自微信读书接口（用你自己的登录态读取，不会外传）';
    if (highlights.length === 0) {
      const domHighlights = scrapeDomHighlights();
      if (domHighlights.length > 0) {
        highlights = domHighlights;
        source = 'mixed';
        sourceNote = '划线部分为「页面抓取」结果（接口未返回划线），只能拿到当前已渲染的内容，可能不完整';
      }
    }

    // 统一走项目调试日志（🧪 调试日志面板 → 复制/下载日志 即可取证）
    logNotes('info', '接口诊断 · ' + buildDiagText(bookmarkRes, reviewRes, chapterRes, highlights.length, thoughts.length), {
      bookId,
      href: window.location.href,
      source,
      bookmark: { status: bookmarkRes.status, ok: bookmarkRes.ok, keys: bookmarkRes.keys, count: highlights.length, error: bookmarkRes.error ? String(bookmarkRes.error.message) : '', sample: bookmarkRes.sample || '' },
      review: { status: reviewRes.status, ok: reviewRes.ok, keys: reviewRes.keys, count: thoughts.length, error: reviewRes.error ? String(reviewRes.error.message) : '', sample: reviewRes.sample || '' },
      chapter: { status: chapterRes.status, ok: chapterRes.ok, keys: chapterRes.keys, error: chapterRes.error ? String(chapterRes.error.message) : '' },
    });

    return {
      source,
      sourceNote,
      highlights,
      thoughts,
      chapterMap,
    };
  }

  // ---------- 数据层：页面抓取（接口不可用时的兜底） ----------

  const DOM_HIGHLIGHT_SELECTORS = [
    '.readerChapterContent [class*="reader_highlight"]',
    '.readerChapterContent [class*="wr_underline"]',
    '.readerChapterContent [class*="highlight"]',
    '.renderTargetContainer [class*="underline"]',
    '.readerNotePanel [class*="highlight"]',
  ];

  function scrapeDomHighlights() {
    const seen = {};
    const highlights = [];
    DOM_HIGHLIGHT_SELECTORS.forEach((selector) => {
      let nodes = [];
      try {
        nodes = document.querySelectorAll(selector);
      } catch (error) {
        return;
      }
      nodes.forEach((node) => {
        const text = (node.textContent || '').trim();
        if (!text || text.length > 1000 || seen[text]) {
          return;
        }
        seen[text] = true;
        highlights.push({
          kind: 'highlight',
          id: '',
          chapterUid: '',
          chapterName: '',
          text,
          createTime: 0,
          range: '',
        });
      });
    });
    return highlights;
  }

  function scrapeDomNotes() {
    const highlights = scrapeDomHighlights();
    logNotes('warn', '接口不可用，已回退页面抓取', { highlights: highlights.length });
    return {
      source: 'dom',
      sourceNote: '接口读取失败，本次为「页面抓取」结果，只能拿到当前已渲染的内容，可能不完整',
      highlights,
      thoughts: [],
      chapterMap: {},
    };
  }

  // ---------- 分组 ----------

  function groupByChapter(items, chapterMap) {
    const groups = {};
    items.forEach((item) => {
      const key = item.chapterUid || ('name:' + (item.chapterName || '未知章节'));
      if (!groups[key]) {
        const mapped = chapterMap[item.chapterUid];
        groups[key] = {
          key,
          name: item.chapterName || (mapped && mapped.name) || '未知章节',
          order: mapped && mapped.index != null ? mapped.index : Number.MAX_SAFE_INTEGER,
          items: [],
        };
      }
      if (!groups[key].name || groups[key].name === '未知章节') {
        groups[key].name = item.chapterName || (chapterMap[item.chapterUid] || {}).name || '未知章节';
      }
      groups[key].items.push(item);
    });
    return Object.values(groups)
      .map((group) => {
        group.items.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
        return group;
      })
      .sort((a, b) => (a.order === b.order ? 0 : (a.order < b.order ? -1 : 1)));
  }

  // 统一的状态入口：负责请求、缓存、错误与重绘，调用方只管调它
  async function loadNotes(force) {
    const context = getBookContext();
    panelState.error = '';
    panelState.emptyReason = '';
    if (!context.bookId) {
      panelState.data = null;
      panelState.loading = false;
      panelState.emptyReason = '当前不在微信读书阅读页，先打开一本书的阅读页再来～';
      renderPanel();
      return null;
    }
    const now = Date.now();
    if (!force && cache.bookId === context.bookId && cache.data && now - cache.at < NOTES_CACHE_TTL) {
      panelState.data = cache.data;
      panelState.loading = false;
      renderPanel();
      return cache.data;
    }
    panelState.loading = true;
    renderPanel();

    let data;
    try {
      data = await fetchBookNotes(context.bookId);
    } catch (error) {
      if (error && error.code === 'unauthorized') {
        panelState.loading = false;
        panelState.data = null;
        panelState.error = '接口返回未登录：请先在微信读书网页版登录，再点「刷新」重试。';
        renderPanel();
        logNotes('warn', '笔记接口未登录', { bookId: context.bookId });
        return null;
      }
      data = scrapeDomNotes();
      logNotes('warn', '两个接口都不可用，已回退页面抓取（可能不完整）', {
        bookId: context.bookId,
        error: error && error.message ? String(error.message) : String(error),
      });
    }
    data.bookId = context.bookId;
    data.title = context.title || '';
    data.highlightGroups = groupByChapter(data.highlights, data.chapterMap);
    data.thoughtGroups = groupByChapter(data.thoughts, data.chapterMap);
    cache = { bookId: context.bookId, at: now, data };
    panelState.data = data;
    panelState.loading = false;
    panelState.emptyReason = '';
    renderPanel();
    return data;
  }

  // ---------- 面板 ----------

  function menuEntryExists(root) {
    return !!root.querySelector('[data-wre-notes-entry]');
  }

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu || menuEntryExists(menu)) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'notes');
    item.setAttribute('data-wre-notes-entry', '1');
    item.innerHTML = '<span class="wre-menu-icon">📝</span>笔记';
    item.addEventListener('click', () => {
      openPanel();
    });
    const anchor = menu.querySelector('[data-wre-stats-entry]') || menu.querySelector('[data-action="theme-settings"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else if (anchor) {
      menu.appendChild(item);
    } else {
      menu.appendChild(item);
    }
    logNotes('info', '已注入「笔记」菜单入口');
  }

  function buildPanel(root) {
    const existing = root.querySelector('#wre-notes-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay';
    overlay.id = 'wre-notes-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-notes-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">📝 笔记</span>' +
          '<button class="wre-modal-close" data-wre-notes-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body" id="wre-notes-body"></div>' +
      '</div>';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-notes-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closePanel());
    }
    const body = overlay.querySelector('#wre-notes-body');
    if (body) {
      body.addEventListener('click', handlePanelClick);
    }
    root.appendChild(overlay);
    return overlay;
  }

  function openPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    const overlay = buildPanel(root);
    overlay.classList.add('wre-visible');
    panelTab = panelTab === 'thoughts' ? 'thoughts' : 'highlights';
    renderPanel();
    logNotes('info', '打开笔记面板');
    loadNotes(false).catch((error) => {
      logNotes('error', '读取笔记失败', { error: String(error && error.message ? error.message : error) });
    });
  }

  function closePanel() {
    const overlay = document.getElementById('wre-notes-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  function isPanelOpen() {
    const overlay = document.getElementById('wre-notes-modal');
    return !!overlay && overlay.classList.contains('wre-visible');
  }

  function renderToolbar(data) {
    const highlightCount = data ? data.highlights.length : 0;
    const thoughtCount = data ? data.thoughts.length : 0;
    return '<div class="wre-notes-toolbar">' +
        '<div class="wre-notes-summary">' + (data
          ? '《' + escapeHtml(data.title || '未知书籍') + '》 · 划线 ' + highlightCount + ' 条 · 想法 ' + thoughtCount + ' 条'
          : '正在读取…') + '</div>' +
        '<div class="wre-notes-actions">' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-refresh>刷新</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-export="markdown">导出 Markdown</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-export="text">导出纯文本</button>' +
        '</div>' +
      '</div>';
  }

  function renderTabs(data) {
    const highlightCount = data ? data.highlights.length : 0;
    const thoughtCount = data ? data.thoughts.length : 0;
    return '<div class="wre-notes-tabs">' +
        '<button class="wre-notes-tab' + (panelTab === 'highlights' ? ' is-active' : '') + '" data-wre-notes-tab="highlights">划线 ' + highlightCount + '</button>' +
        '<button class="wre-notes-tab' + (panelTab === 'thoughts' ? ' is-active' : '') + '" data-wre-notes-tab="thoughts">想法/批注 ' + thoughtCount + '</button>' +
      '</div>';
  }

  function renderGroups(groups, emptyText) {
    if (groups.length === 0) {
      return '<div class="wre-notes-empty">' + emptyText + '</div>';
    }
    return groups.map((group) => {
      const items = group.items.map((item) => {
        const index = jumpTargets.length;
        jumpTargets.push({
          bookId: cache.bookId || '',
          anchorText: item.abstract || item.text || '',
          chapterName: group.name,
        });
        if (item.kind === 'thought') {
          return '<div class="wre-notes-item is-thought" data-wre-notes-jump="' + index + '" title="点击尝试定位到原文">' +
              (item.abstract ? '<div class="wre-notes-quote">' + escapeHtml(item.abstract) + '</div>' : '') +
              '<div class="wre-notes-thought">' + escapeHtml(item.text) + '</div>' +
              '<div class="wre-notes-meta">' + escapeHtml(formatDateTime(item.createTime)) + '</div>' +
            '</div>';
        }
        return '<div class="wre-notes-item" data-wre-notes-jump="' + index + '" title="点击尝试定位到原文">' +
            '<div class="wre-notes-text">' + escapeHtml(item.text) + '</div>' +
            (item.createTime ? '<div class="wre-notes-meta">' + escapeHtml(formatDateTime(item.createTime)) + '</div>' : '') +
          '</div>';
      }).join('');
      return '<div class="wre-notes-chapter">' +
          '<div class="wre-notes-chapter-title">' + escapeHtml(group.name) +
            '<span class="wre-notes-chapter-count">' + group.items.length + ' 条</span>' +
          '</div>' +
          items +
        '</div>';
    }).join('');
  }

  function renderPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    const body = root ? root.querySelector('#wre-notes-body') : null;
    if (!body) {
      return;
    }
    const data = panelState.data || (cache.data && cache.bookId === getBookContext().bookId ? cache.data : null);
    jumpTargets = [];

    if (panelState.loading && !data) {
      body.innerHTML = renderToolbar(null) + '<div class="wre-notes-empty">正在读取笔记…</div>';
      return;
    }
    if (panelState.error) {
      body.innerHTML = renderToolbar(null) +
        '<div class="wre-notes-error">' + escapeHtml(panelState.error) + '</div>' +
        '<div class="wre-notes-note">可以点阅读页右侧工具栏的「批注」按钮查看原文；登录后重试即可。</div>';
      return;
    }
    if (!data) {
      body.innerHTML = renderToolbar(null) +
        '<div class="wre-notes-empty">' + escapeHtml(panelState.emptyReason || '先打开一本书的阅读页，再打开这个面板～') + '</div>';
      return;
    }

    const scrollTop = body.scrollTop;
    const groups = panelTab === 'thoughts' ? data.thoughtGroups : data.highlightGroups;
    const emptyText = panelTab === 'thoughts'
      ? '这本书还没有想法/批注～'
      : '这本书还没有划线～';
    body.innerHTML = renderToolbar(data) +
      renderTabs(data) +
      (data.source === 'dom' || data.source === 'mixed' ? '<div class="wre-notes-warn">' + escapeHtml(data.sourceNote) + '</div>' : '') +
      renderGroups(groups, emptyText) +
      '<div class="wre-notes-note">' + escapeHtml(data.sourceNote || '') + '</div>' +
      '<div class="wre-notes-note">点击任意条目，会尝试在正文里定位这段原文（同书直接定位；换书会打开阅读页后定位）。</div>';
    body.scrollTop = scrollTop;
  }

  function handlePanelClick(event) {
    const refresh = event.target.closest('[data-wre-notes-refresh]');
    if (refresh) {
      cache = { bookId: null, at: 0, data: null };
      loadNotes(true).catch((error) => {
        logNotes('error', '刷新笔记失败', { error: String(error && error.message ? error.message : error) });
      });
      return;
    }
    const exportBtn = event.target.closest('[data-wre-notes-export]');
    if (exportBtn) {
      handleExport(exportBtn.getAttribute('data-wre-notes-export'));
      return;
    }
    const tab = event.target.closest('[data-wre-notes-tab]');
    if (tab) {
      panelTab = tab.getAttribute('data-wre-notes-tab');
      renderPanel();
      return;
    }
    const jump = event.target.closest('[data-wre-notes-jump]');
    if (jump) {
      const index = Number(jump.getAttribute('data-wre-notes-jump'));
      jumpToItem(jumpTargets[index]);
    }
  }

  // ---------- 导出 ----------

  function currentData() {
    return panelState.data || (cache.data && cache.bookId === getBookContext().bookId ? cache.data : null);
  }

  function buildMarkdown(data) {
    const lines = [];
    lines.push('# 《' + (data.title || '未知书籍') + '》读书笔记');
    lines.push('');
    lines.push('- 导出时间：' + formatDateTime(Date.now()));
    lines.push('- 数据来源：' + (data.source === 'api' ? '微信读书接口（本地读取）' : '页面抓取（可能不完整）'));
    lines.push('- 划线 ' + data.highlights.length + ' 条 · 想法/批注 ' + data.thoughts.length + ' 条');
    lines.push('');
    lines.push('## 划线');
    lines.push('');
    if (data.highlightGroups.length === 0) {
      lines.push('（暂无划线）');
      lines.push('');
    } else {
      data.highlightGroups.forEach((group) => {
        lines.push('### ' + group.name);
        lines.push('');
        group.items.forEach((item) => {
          lines.push('- ' + item.text.replace(/\n+/g, ' '));
        });
        lines.push('');
      });
    }
    if (data.thoughts.length > 0) {
      lines.push('## 想法与批注');
      lines.push('');
      if (data.thoughtGroups.length === 0) {
        lines.push('（暂无想法）');
        lines.push('');
      } else {
        data.thoughtGroups.forEach((group) => {
          lines.push('### ' + group.name);
          lines.push('');
          group.items.forEach((item) => {
            if (item.abstract) {
              lines.push('> ' + item.abstract.replace(/\n+/g, ' '));
              lines.push('');
            }
            lines.push(item.text.replace(/\n+/g, ' '));
            lines.push('');
            if (item.createTime) {
              lines.push('<small>' + formatDateTime(item.createTime) + '</small>');
              lines.push('');
            }
          });
        });
      }
    }
    return lines.join('\n');
  }

  function buildPlainText(data) {
    const lines = [];
    lines.push('《' + (data.title || '未知书籍') + '》读书笔记');
    lines.push('导出时间：' + formatDateTime(Date.now()));
    lines.push('划线 ' + data.highlights.length + ' 条 · 想法/批注 ' + data.thoughts.length + ' 条');
    lines.push('='.repeat(30));
    lines.push('');
    lines.push('【划线】');
    lines.push('');
    if (data.highlightGroups.length === 0) {
      lines.push('（暂无划线）');
      lines.push('');
    } else {
      data.highlightGroups.forEach((group) => {
        lines.push('[' + group.name + ']');
        group.items.forEach((item, index) => {
          lines.push((index + 1) + '. ' + item.text.replace(/\n+/g, ' '));
        });
        lines.push('');
      });
    }
    if (data.thoughts.length > 0) {
      lines.push('【想法与批注】');
      lines.push('');
      data.thoughtGroups.forEach((group) => {
        lines.push('[' + group.name + ']');
        group.items.forEach((item) => {
          if (item.abstract) {
            lines.push('原文：' + item.abstract.replace(/\n+/g, ' '));
          }
          lines.push('想法：' + item.text.replace(/\n+/g, ' '));
          if (item.createTime) {
            lines.push('时间：' + formatDateTime(item.createTime));
          }
          lines.push('');
        });
      });
    }
    return lines.join('\n');
  }

  function handleExport(format) {
    const data = currentData();
    if (!data) {
      toast('还没有可导出的笔记，先等数据读出来～');
      logNotes('warn', '笔记数据未就绪，忽略导出请求', { format });
      return;
    }
    const suffix = toDateKey(Date.now()) + '-' + sanitizeFileName(data.title || '未知书籍');
    if (format === 'text') {
      downloadFile('微信悦读-读书笔记-' + suffix + '.txt', buildPlainText(data), 'text/plain;charset=utf-8');
    } else {
      downloadFile('微信悦读-读书笔记-' + suffix + '.md', buildMarkdown(data), 'text/markdown;charset=utf-8');
    }
    toast('已导出' + (format === 'text' ? '纯文本' : ' Markdown'));
    logNotes('info', '已导出笔记', {
      format,
      highlights: data.highlights.length,
      thoughts: data.thoughts.length,
      source: data.source,
    });
  }

  // ---------- 跳原文 ----------

  function findTextInPage(text) {
    const needle = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!needle) {
      return false;
    }
    try {
      if (typeof window.find === 'function') {
        // aString, aCaseSensitive, aBackwards, aWrapAround
        const found = window.find(needle, false, false, true);
        if (found) {
          logNotes('info', '已在正文定位到目标文本', { needle });
          return true;
        }
      }
    } catch (error) {
      logNotes('warn', 'window.find 定位失败', { error: String(error) });
    }
    return false;
  }

  function jumpToItem(target) {
    if (!target) {
      return;
    }
    const context = getBookContext();
    if (context.bookId && context.bookId === target.bookId) {
      if (findTextInPage(target.anchorText)) {
        toast('已定位到原文');
      } else {
        toast('当前章节里没找到这段原文，先翻到对应章节再试');
      }
      return;
    }
    const data = currentData();
    try {
      localStorage.setItem(PENDING_JUMP_KEY, JSON.stringify({
        bookId: target.bookId,
        text: target.anchorText,
        at: Date.now(),
      }));
    } catch (error) {
      logNotes('warn', '写入待定位目标失败', { error: String(error) });
    }
    logNotes('info', '跳转到其他书籍的阅读页', { bookId: target.bookId, title: data ? data.title : '' });
    window.open('https://weread.qq.com/web/reader/' + target.bookId, '_blank');
  }

  // 页面加载后处理「从笔记面板跳过来」的待定位目标
  function handlePendingJump() {
    let pending = null;
    try {
      const raw = localStorage.getItem(PENDING_JUMP_KEY);
      if (raw) {
        pending = JSON.parse(raw);
      }
    } catch (error) {
      pending = null;
    }
    if (!pending || !pending.text) {
      return;
    }
    const context = getBookContext();
    const expired = !pending.at || Date.now() - pending.at > PENDING_JUMP_TTL;
    if (expired || !context.bookId || context.bookId !== pending.bookId) {
      return;
    }
    try {
      localStorage.removeItem(PENDING_JUMP_KEY);
    } catch (error) {
      // 忽略
    }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (findTextInPage(pending.text)) {
        clearInterval(timer);
        toast('已定位到原文');
        return;
      }
      if (attempts >= 20) {
        clearInterval(timer);
        toast('没能自动定位到原文，可以手动翻到对应章节');
        logNotes('warn', '跨书定位超时', { bookId: pending.bookId });
      }
    }, 500);
  }

  // ---------- 选中即复制 ----------

  let floatButton = null;
  let lastSelectionText = '';
  let toastTimer = null;

  function ensureFloatButton(root) {
    if (floatButton) {
      return floatButton;
    }
    floatButton = document.createElement('div');
    floatButton.id = 'wre-notes-copybtn';
    floatButton.textContent = '📋 复制';
    floatButton.title = '复制选中的文字（自动去掉官方版权声明）';
    // 阻止默认行为，避免点按钮时页面选区被清掉
    floatButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    floatButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = stripWatermark(lastSelectionText);
      if (!text) {
        hideFloatButton();
        return;
      }
      const ok = await copyText(text);
      hideFloatButton();
      toast(ok ? '已复制' : '复制失败，请手动复制');
      logNotes(ok ? 'info' : 'warn', '选中复制', { length: text.length, ok });
    });
    root.appendChild(floatButton);
    return floatButton;
  }

  function hideFloatButton() {
    if (floatButton) {
      floatButton.classList.remove('wre-visible');
    }
  }

  function showFloatButtonAt(rect) {
    if (!floatButton) {
      return;
    }
    const top = Math.min(rect.bottom + 8, window.innerHeight - 44);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 96));
    floatButton.style.top = top + 'px';
    floatButton.style.left = left + 'px';
    floatButton.classList.add('wre-visible');
  }

  function isInsidePlugin(element) {
    return !!element && !!element.closest && !!element.closest('#we-read-enhancer-root');
  }

  function handleSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hideFloatButton();
      return;
    }
    const text = String(selection.toString() || '').trim();
    if (text.length < MIN_SELECTION_LENGTH || text.length > MAX_SELECTION_LENGTH) {
      hideFloatButton();
      return;
    }
    if (isInsidePlugin(selection.anchorNode && selection.anchorNode.parentElement)) {
      hideFloatButton();
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideFloatButton();
      return;
    }
    lastSelectionText = text;
    showFloatButtonAt(rect);
  }

  function handleCopyEvent(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }
    const plain = clipboard.getData('text/plain');
    const cleaned = stripWatermark(plain);
    if (cleaned !== plain) {
      clipboard.setData('text/plain', cleaned);
    }
    const html = clipboard.getData('text/html');
    if (html) {
      const cleanedHtml = cleanClipboardHtml(html);
      if (cleanedHtml !== html) {
        clipboard.setData('text/html', cleanedHtml);
      }
    }
  }

  // ---------- 轻提示 ----------

  function ensureToast(root) {
    let el = root.querySelector('#wre-notes-toast');
    if (el) {
      return el;
    }
    el = document.createElement('div');
    el.id = 'wre-notes-toast';
    root.appendChild(el);
    return el;
  }

  function toast(message) {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    const el = ensureToast(root);
    el.textContent = message;
    el.classList.add('wre-visible');
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      el.classList.remove('wre-visible');
    }, 2000);
  }

  // ---------- 启动 ----------

  function attach(root) {
    injectMenuEntry(root);
    buildPanel(root);
    ensureFloatButton(root);

    document.addEventListener('mouseup', () => {
      // mouseup 之后再读选区，拿到的才是最终结果
      setTimeout(handleSelectionChange, 0);
    });
    document.addEventListener('keyup', (event) => {
      if (event.key === 'Shift' || event.key.startsWith('Arrow')) {
        setTimeout(handleSelectionChange, 0);
      }
      if (event.key === 'Escape') {
        hideFloatButton();
      }
    });
    document.addEventListener('mousedown', (event) => {
      if (!isInsidePlugin(event.target)) {
        hideFloatButton();
      }
    });
    window.addEventListener('scroll', hideFloatButton, true);
    window.addEventListener('copy', handleCopyEvent);

    handlePendingJump();
    logNotes('info', '笔记增强模块已启动');
  }

  function bootstrap() {
    const existing = document.getElementById('we-read-enhancer-root');
    if (existing) {
      attach(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const root = document.getElementById('we-read-enhancer-root');
      if (root) {
        observer.disconnect();
        attach(root);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    logNotes('info', '等待插件根容器出现后接入笔记模块');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
