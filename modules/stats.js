/**
 * 微信悦读 · 阅读统计模块（v0.9.1）
 *
 * 定位：独立模块，不改动 content.js 既有逻辑。通过 manifest 的 content_scripts
 * 在 content.js 之前加载，与 content.js 共享同一个隔离世界（isolated world），
 * 因此可以直接复用 content.js 的全局函数（如 log）与 #we-read-enhancer-root 容器。
 *
 * 职责：
 *   1. 识别当前正在阅读的书（书名优先，书名缺失时退化为 URL 片段）
 *   2. 前台计时：页面可见且停留在阅读页时累计时长，切后台/关页自动结算
 *   3. 阅读进度：采集当前书的章节名与进度百分比（多候选选择器 + 正则，采不到留空）
 *   4. 本地存储：chrome.storage.local 的 wreReadingStats 键，按「书 × 日期」存明细
 *   5. 面板：主菜单「📊 阅读统计」入口，展示时长卡片、本书进度、近 14 天明细、最近书目
 *   6. 导出：JSON / CSV / Markdown / HTML 报表 / PDF 五种格式
 *
 * 计时口径说明：微信读书官方不提供时长接口，此处为「页面在前台且停留在阅读页」
 * 的本地估算，与官方 App 的统计不会完全一致。
 * 进度口径说明：官方页面没有稳定的进度接口，这里靠 DOM 文本探测，识别不到时显示「进度未知」。
 */
(function () {
  'use strict';

  const STATS_KEY = 'wreReadingStats';
  const SCHEMA_VERSION = 2;   // v2：书籍新增 progress（章节 / 百分比 / 更新时间）字段
  const TICK_MS = 15000;      // 计时心跳：每 15s 结算一次
  const FLUSH_MS = 30000;     // 落盘节流：最多每 30s 写一次 storage
  const KEEP_DAYS = 400;      // 明细保留天数
  const DETAIL_DAYS = 14;     // 面板展示的近 N 天
  const READER_PATH_RE = /\/web\/reader\/([0-9a-zA-Z]+)/;

  let stats = null;
  let activeBookKey = null;
  let activeBookSegment = null;
  let countingSince = 0;      // >0 表示正在计时，值为上次结算时间
  let lastFlushAt = 0;

  // ---------- 通用小工具 ----------

  function logStats(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[stats] ' + message, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function toDateKey(timestamp) {
    const date = new Date(timestamp);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function startOfToday(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function startOfWeek(timestamp) {
    // 以周一为一周起点
    const date = new Date(startOfToday(timestamp));
    const offset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - offset);
    return date.getTime();
  }

  function startOfMonth(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    date.setDate(1);
    return date.getTime();
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor((ms || 0) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return hours + '小时' + minutes + '分';
    }
    if (minutes > 0) {
      return minutes + '分钟';
    }
    return totalSeconds + '秒';
  }

  function formatDateTime(timestamp) {
    if (!timestamp) {
      return '—';
    }
    const date = new Date(timestamp);
    return toDateKey(timestamp) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function toCsvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
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

  function getCurrentBook() {
    const match = window.location.href.match(READER_PATH_RE);
    if (!match) {
      return { key: null, segment: null, title: '' };
    }
    const segment = match[1];
    const title = getBookTitle();
    return { key: title || 'url:' + segment, segment, title };
  }

  // ---------- 阅读进度 ----------

  // 可能承载「阅读进度」文本的容器（多候选，命中即用；微信读书改版时优先在这里补）
  const PROGRESS_TEXT_SELECTORS = [
    '.readerFooter',
    '.readerControls',
    '[class*="readerFooter"]',
    '[class*="readerControls"]',
    '[class*="readerProgress"]',
    '[class*="progress"]',
    '[class*="percent"]',
  ];

  // 可能承载「章节标题」的容器（多候选）
  const CHAPTER_SELECTORS = [
    '.readerChapterContent h1',
    '.readerChapterContent h2',
    '.readerChapterContent h3',
    '.readerChapterContent [class*="chapterTitle"]',
    '[class*="chapterTitle"]',
    '[class*="chapter_title"]',
  ];

  function readNodeText(node) {
    return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  }

  // 从一段文本里解析「百分比」或「x/y」位置，返回 { percent, index, total }
  function parseProgressText(text) {
    const parsed = { percent: null, index: 0, total: 0 };
    if (!text) {
      return parsed;
    }
    const percentMatch = text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      const value = parseFloat(percentMatch[1]);
      if (value >= 0 && value <= 100) {
        parsed.percent = value;
      }
    }
    const ratioMatch = text.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);
    if (ratioMatch) {
      const index = parseInt(ratioMatch[1], 10);
      const total = parseInt(ratioMatch[2], 10);
      if (total > 0 && index >= 0 && index <= total) {
        parsed.index = index;
        parsed.total = total;
        if (parsed.percent == null) {
          parsed.percent = Math.round((index / total) * 1000) / 10;
        }
      }
    }
    return parsed;
  }

  function pickChapterTitle() {
    for (const selector of CHAPTER_SELECTORS) {
      const text = readNodeText(document.querySelector(selector));
      if (text && text.length <= 60) {
        return text;
      }
    }
    return '';
  }

  function pickProgressText() {
    for (const selector of PROGRESS_TEXT_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const text = readNodeText(node);
        if (!text || text.length > 200) {
          continue;
        }
        const parsed = parseProgressText(text);
        if (parsed.percent != null || parsed.total > 0) {
          return parsed;
        }
      }
    }
    // 兜底：在 reader 相关元素里找「短且带 %」的文本（画布外的进度提示常在这里）
    const fallbackNodes = document.querySelectorAll('[class*="reader"]');
    const limit = Math.min(fallbackNodes.length, 400);
    for (let i = 0; i < limit; i += 1) {
      const text = readNodeText(fallbackNodes[i]);
      if (!text || text.length > 60 || text.indexOf('%') === -1) {
        continue;
      }
      const parsed = parseProgressText(text);
      if (parsed.percent != null) {
        return parsed;
      }
    }
    return { percent: null, index: 0, total: 0 };
  }

  function probeProgress() {
    const parsed = pickProgressText();
    return {
      percent: parsed.percent,
      index: parsed.index,
      total: parsed.total,
      chapter: pickChapterTitle(),
    };
  }

  // 采集当前书的进度；只有真正变化时才写入，避免无意义落盘
  function updateProgress() {
    if (!stats || !activeBookKey || document.visibilityState !== 'visible') {
      return;
    }
    const probe = probeProgress();
    if (probe.percent == null && !probe.chapter && probe.total === 0) {
      return;
    }
    const book = ensureBook(activeBookKey, '', activeBookSegment);
    if (!book) {
      return;
    }
    const previous = book.progress || {};
    const percent = probe.percent != null ? probe.percent : (previous.percent != null ? previous.percent : null);
    const chapter = probe.chapter || previous.chapter || '';
    const index = probe.index || previous.index || 0;
    const total = probe.total || previous.total || 0;
    if (percent === (previous.percent != null ? previous.percent : null)
      && chapter === (previous.chapter || '')
      && index === (previous.index || 0)
      && total === (previous.total || 0)) {
      return;
    }
    book.progress = { percent, chapter, index, total, updatedAt: Date.now() };
    logStats('info', '更新阅读进度', { key: activeBookKey, percent, chapter, index, total });
  }

  // ---------- 存储 ----------

  async function loadStats() {
    try {
      const result = await chrome.storage.local.get([STATS_KEY]);
      const raw = result[STATS_KEY];
      if (raw && typeof raw === 'object' && raw.books && typeof raw.books === 'object') {
        stats = { version: SCHEMA_VERSION, books: raw.books, updatedAt: raw.updatedAt || 0 };
      } else {
        stats = { version: SCHEMA_VERSION, books: {}, updatedAt: 0 };
      }
    } catch (error) {
      stats = { version: SCHEMA_VERSION, books: {}, updatedAt: 0 };
      logStats('error', '读取统计数据失败', { error: String(error) });
    }
  }

  async function flushStats(force) {
    if (!stats) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastFlushAt < FLUSH_MS) {
      return;
    }
    lastFlushAt = now;
    stats.updatedAt = now;
    try {
      await chrome.storage.local.set({ [STATS_KEY]: stats });
      logStats('debug', '统计数据已保存', {
        books: Object.keys(stats.books).length,
        activeBookKey,
      });
    } catch (error) {
      logStats('error', '保存统计数据失败', { error: String(error) });
    }
  }

  function pruneOldDays() {
    if (!stats) {
      return;
    }
    const cutoffKey = toDateKey(Date.now() - KEEP_DAYS * 86400000);
    let removed = 0;
    Object.values(stats.books).forEach((book) => {
      Object.keys(book.days || {}).forEach((key) => {
        if (key < cutoffKey) {
          delete book.days[key];
          removed += 1;
        }
      });
    });
    if (removed > 0) {
      logStats('info', '清理过期明细', { removed, cutoffKey });
    }
  }

  // ---------- 计时 ----------

  function ensureBook(key, title, segment) {
    if (!stats || !key) {
      return null;
    }
    let book = stats.books[key];
    if (!book) {
      book = { title: title || key, bookId: segment || '', totalMs: 0, lastReadAt: 0, days: {} };
      stats.books[key] = book;
    }
    if (title) {
      book.title = title;
    }
    if (segment && !book.bookId) {
      book.bookId = segment;
    }
    if (!book.days) {
      book.days = {};
    }
    return book;
  }

  function accumulate(ms) {
    if (!stats || !activeBookKey || ms <= 0) {
      return;
    }
    const book = ensureBook(activeBookKey, '', activeBookSegment);
    if (!book) {
      return;
    }
    const key = toDateKey(Date.now());
    book.days[key] = (book.days[key] || 0) + ms;
    book.totalMs += ms;
    book.lastReadAt = Date.now();
  }

  function settle() {
    if (!activeBookKey || !countingSince) {
      return;
    }
    const now = Date.now();
    const delta = now - countingSince;
    countingSince = now;
    // 异常场景（休眠/断点）下 delta 会很大，做上限保护
    accumulate(Math.min(delta, TICK_MS * 3));
  }

  function startCounting() {
    if (!activeBookKey || countingSince) {
      return;
    }
    countingSince = Date.now();
  }

  function stopCounting() {
    settle();
    countingSince = 0;
  }

  // 书名刚加载出来前会先用「url:片段」占位，拿到书名后合并成一条记录
  function migrateUrlKey(newKey, segment) {
    if (!stats || !segment) {
      return;
    }
    const urlKey = 'url:' + segment;
    if (newKey === urlKey) {
      return;
    }
    const legacy = stats.books[urlKey];
    if (!legacy) {
      return;
    }
    const target = ensureBook(newKey, '', segment);
    target.totalMs += legacy.totalMs || 0;
    Object.entries(legacy.days || {}).forEach(([key, value]) => {
      target.days[key] = (target.days[key] || 0) + value;
    });
    target.lastReadAt = Math.max(target.lastReadAt || 0, legacy.lastReadAt || 0);
    delete stats.books[urlKey];
    logStats('info', '临时书目标识已合并到书名', { newKey, segment, mergedMs: legacy.totalMs || 0 });
  }

  function syncBook() {
    const info = getCurrentBook();
    if (info.key !== activeBookKey) {
      stopCounting();
      if (info.key) {
        migrateUrlKey(info.key, info.segment);
        activeBookKey = info.key;
        activeBookSegment = info.segment;
        ensureBook(info.key, info.title, info.segment);
        if (document.visibilityState === 'visible') {
          startCounting();
        }
        logStats('info', '开始统计阅读时长', { key: info.key, segment: info.segment });
      } else {
        activeBookKey = null;
        activeBookSegment = null;
        logStats('debug', '离开阅读页，暂停统计', { href: window.location.href });
      }
      return;
    }
    if (info.key) {
      ensureBook(info.key, info.title, info.segment);
    }
  }

  function tick() {
    syncBook();
    settle();
    updateProgress();
    flushStats(false);
    refreshPanel();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      startCounting();
      return;
    }
    stopCounting();
    flushStats(true);
  }

  // ---------- 汇总计算 ----------

  function sumByDayKey(predicate) {
    if (!stats) {
      return 0;
    }
    let total = 0;
    Object.values(stats.books).forEach((book) => {
      Object.entries(book.days || {}).forEach(([key, value]) => {
        if (predicate(key)) {
          total += value;
        }
      });
    });
    return total;
  }

  function getSummary() {
    const now = Date.now();
    const todayKey = toDateKey(now);
    const weekStartKey = toDateKey(startOfWeek(now));
    const monthPrefix = toDateKey(startOfMonth(now)).slice(0, 7);
    const currentBook = activeBookKey && stats ? stats.books[activeBookKey] : null;
    return {
      todayMs: sumByDayKey((key) => key === todayKey),
      weekMs: sumByDayKey((key) => key >= weekStartKey && key <= todayKey),
      monthMs: sumByDayKey((key) => key.slice(0, 7) === monthPrefix),
      bookMs: currentBook ? currentBook.totalMs || 0 : 0,
      bookTitle: currentBook ? currentBook.title : '',
      bookDays: currentBook ? currentBook.days || {} : {},
      bookProgress: currentBook ? currentBook.progress || null : null,
      bookLastReadAt: currentBook ? currentBook.lastReadAt || 0 : 0,
    };
  }

  // ---------- 面板 ----------

  function menuEntryExists(root) {
    return !!root.querySelector('[data-wre-stats-entry]');
  }

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu || menuEntryExists(menu)) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'stats');
    item.setAttribute('data-wre-stats-entry', '1');
    item.innerHTML = '<span class="wre-menu-icon">📊</span>阅读统计';
    // 不阻断冒泡：菜单级别的监听会负责收起菜单并把 action 分发给 handleMenuClick('stats')
    item.addEventListener('click', () => {
      openPanel();
    });
    const anchor = menu.querySelector('[data-action="theme-settings"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else if (anchor) {
      menu.appendChild(item);
    } else {
      menu.appendChild(item);
    }
    logStats('info', '已注入「阅读统计」菜单入口');
  }

  function buildPanel(root) {
    const existing = root.querySelector('#wre-stats-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay';
    overlay.id = 'wre-stats-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-stats-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">📊 阅读统计</span>' +
          '<button class="wre-modal-close" data-wre-stats-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body" id="wre-stats-body"></div>' +
      '</div>';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-stats-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closePanel());
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
    renderPanel(root);
    overlay.classList.add('wre-visible');
    logStats('info', '打开阅读统计面板', { summary: getSummary().todayMs });
  }

  function closePanel() {
    const overlay = document.getElementById('wre-stats-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  function isPanelOpen() {
    const overlay = document.getElementById('wre-stats-modal');
    return !!overlay && overlay.classList.contains('wre-visible');
  }

  function buildCards(summary) {
    const cards = [
      { label: '今日阅读', value: formatDuration(summary.todayMs) },
      { label: '本周阅读', value: formatDuration(summary.weekMs) },
      { label: '本月阅读', value: formatDuration(summary.monthMs) },
      { label: summary.bookTitle ? '本书累计' : '当前书籍', value: summary.bookTitle ? formatDuration(summary.bookMs) : '未在阅读页' },
    ];
    return cards.map((card) =>
      '<div class="wre-stats-card">' +
        '<div class="wre-stats-card-label">' + card.label + '</div>' +
        '<div class="wre-stats-card-value">' + card.value + '</div>' +
      '</div>'
    ).join('');
  }

  function buildDailyBars(summary) {
    const now = Date.now();
    const days = summary.bookDays;
    const rows = [];
    for (let i = DETAIL_DAYS - 1; i >= 0; i -= 1) {
      const timestamp = now - i * 86400000;
      const key = toDateKey(timestamp);
      rows.push({ key, ms: days[key] || 0 });
    }
    const max = rows.reduce((acc, row) => Math.max(acc, row.ms), 0);
    if (max === 0) {
      return '<div class="wre-stats-empty">这本书还没有累计阅读记录，读一会儿再回来看～</div>';
    }
    return '<div class="wre-stats-bars">' + rows.map((row) => {
      const percent = max > 0 ? Math.round((row.ms / max) * 100) : 0;
      return '<div class="wre-stats-bar-row">' +
        '<span class="wre-stats-bar-date">' + row.key.slice(5) + '</span>' +
        '<span class="wre-stats-bar-track"><span class="wre-stats-bar-fill" style="width:' + percent + '%"></span></span>' +
        '<span class="wre-stats-bar-value">' + (row.ms > 0 ? formatDuration(row.ms) : '—') + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function progressTextOf(book) {
    const progress = book && book.progress ? book.progress : null;
    if (progress && progress.percent != null) {
      return progress.percent + '%';
    }
    if (progress && progress.total > 0) {
      return progress.index + ' / ' + progress.total;
    }
    return '';
  }

  function buildCurrentProgress(summary) {
    if (!summary.bookTitle) {
      return '<div class="wre-stats-empty">当前不在阅读页，去阅读页看本书进度～</div>';
    }
    const progress = summary.bookProgress;
    if (!progress || (progress.percent == null && !progress.chapter && progress.total === 0)) {
      return '<div class="wre-stats-empty">还没有捕捉到进度信息，读一会儿再回来看看～</div>';
    }
    const percent = progress.percent != null ? progress.percent : null;
    const barWidth = percent != null ? Math.max(0, Math.min(100, percent)) : 0;
    const metaParts = [];
    if (progress.chapter) {
      metaParts.push('章节：' + escapeHtml(progress.chapter));
    }
    if (progress.total > 0) {
      metaParts.push('位置：' + progress.index + ' / ' + progress.total);
    }
    if (progress.updatedAt) {
      metaParts.push('更新：' + formatDateTime(progress.updatedAt));
    }
    return '<div class="wre-stats-progress">' +
        '<div class="wre-stats-progress-head">' +
          '<span class="wre-stats-progress-book">' + escapeHtml(summary.bookTitle) + '</span>' +
          '<span class="wre-stats-progress-value">' + (percent != null ? percent + '%' : '进度未知') + '</span>' +
        '</div>' +
        '<span class="wre-stats-progress-track"><span class="wre-stats-progress-fill" style="width:' + barWidth + '%"></span></span>' +
        '<div class="wre-stats-progress-meta">' + metaParts.join(' · ') + '</div>' +
      '</div>';
  }

  function getRecentBooks(limit) {
    if (!stats) {
      return [];
    }
    return Object.values(stats.books)
      .filter((book) => (book.lastReadAt || 0) > 0)
      .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))
      .slice(0, limit);
  }

  function buildRecentBooks() {
    const books = getRecentBooks(10);
    if (books.length === 0) {
      return '<div class="wre-stats-empty">还没有阅读记录</div>';
    }
    return '<div class="wre-stats-recent">' + books.map((book) => {
      const progress = book.progress || null;
      const percentText = progress && progress.percent != null ? progress.percent + '%' : '';
      const subParts = [];
      if (progress && progress.chapter) {
        subParts.push(escapeHtml(progress.chapter));
      }
      subParts.push(formatDuration(book.totalMs || 0));
      subParts.push(formatDateTime(book.lastReadAt));
      const clickable = !!book.bookId;
      return '<div class="wre-stats-recent-item' + (clickable ? ' is-clickable' : '') + '"' +
          (clickable ? ' data-wre-stats-open="' + escapeHtml(book.bookId) + '"' : '') +
          (clickable ? ' title="打开这本书"' : '') + '>' +
          '<div class="wre-stats-recent-main">' +
            '<span class="wre-stats-recent-title">' + escapeHtml(book.title || '未知书籍') + '</span>' +
            (percentText ? '<span class="wre-stats-recent-percent">' + percentText + '</span>' : '') +
          '</div>' +
          '<div class="wre-stats-recent-sub">' + subParts.join(' · ') + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderPanel(root) {
    const body = root.querySelector('#wre-stats-body');
    if (!body) {
      return;
    }
    const scrollTop = body.scrollTop;
    if (!stats) {
      body.innerHTML = '<div class="wre-stats-empty">统计数据加载中…</div>';
      return;
    }
    const summary = getSummary();
    body.innerHTML =
      '<div class="wre-stats-cards">' + buildCards(summary) + '</div>' +
      '<div class="wre-stats-section-title">当前书籍进度</div>' +
      buildCurrentProgress(summary) +
      '<div class="wre-stats-section-title">近 ' + DETAIL_DAYS + ' 天明细</div>' +
      buildDailyBars(summary) +
      '<div class="wre-stats-section-title">最近阅读（最多 10 本）</div>' +
      buildRecentBooks() +
      '<div class="wre-stats-section-title">导出数据</div>' +
      '<div class="wre-stats-actions">' +
        '<button class="wre-btn wre-btn-small" data-wre-stats-export="html">HTML 报表</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-stats-export="pdf">PDF</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-stats-export="markdown">Markdown</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-stats-export="csv">CSV</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-stats-export="json">JSON</button>' +
      '</div>' +
      '<div class="wre-stats-note">「最近阅读」里可直接点击书名，在新标签页打开这本书。</div>' +
      '<div class="wre-stats-note">PDF 会先打开排版好的报表页，再弹出打印窗口，在打印窗口里选「另存为 PDF」即可（若被浏览器拦截弹出窗口，请允许后重试）。</div>' +
      '<div class="wre-stats-note">统计口径：仅统计「微信读书页面在前台且停留在阅读页」的时长（本地估算，官方不提供时长接口）。阅读进度靠页面文本探测，识别不到时会显示「进度未知」。数据只保存在你自己的浏览器里，不会上传。</div>';
    body.scrollTop = scrollTop;
  }

  function refreshPanel() {
    if (!isPanelOpen()) {
      return;
    }
    const root = document.getElementById('we-read-enhancer-root');
    if (root) {
      renderPanel(root);
    }
  }

  // ---------- 导出 ----------

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

  function stampSuffix() {
    return toDateKey(Date.now());
  }

  function buildJson() {
    return JSON.stringify({
      app: '微信悦读 · 阅读统计',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      stats,
    }, null, 2);
  }

  function collectRows() {
    const rows = [];
    if (!stats) {
      return rows;
    }
    Object.values(stats.books).forEach((book) => {
      Object.entries(book.days || {}).forEach(([key, ms]) => {
        rows.push({
          date: key,
          title: book.title || '',
          bookId: book.bookId || '',
          progress: progressTextOf(book),
          ms,
        });
      });
    });
    rows.sort((a, b) => (a.date === b.date ? b.ms - a.ms : (a.date < b.date ? 1 : -1)));
    return rows;
  }

  function buildCsv() {
    const lines = ['日期,书籍,当前进度,阅读时长(分钟),阅读时长(秒)'];
    collectRows().forEach((row) => {
      lines.push([
        row.date,
        toCsvCell(row.title),
        toCsvCell(row.progress),
        (row.ms / 60000).toFixed(1),
        Math.round(row.ms / 1000),
      ].join(','));
    });
    // 加 BOM，Excel 打开不乱码
    return '\ufeff' + lines.join('\n');
  }

  function buildMarkdown() {
    const summary = getSummary();
    const lines = [];
    lines.push('# 微信悦读 · 阅读统计');
    lines.push('');
    lines.push('- 导出时间：' + formatDateTime(Date.now()));
    lines.push('- 统计口径：页面在前台且停留在阅读页的时长（本地估算）');
    lines.push('');
    lines.push('## 汇总');
    lines.push('');
    lines.push('| 范围 | 时长 |');
    lines.push('| --- | --- |');
    lines.push('| 今日 | ' + formatDuration(summary.todayMs) + ' |');
    lines.push('| 本周 | ' + formatDuration(summary.weekMs) + ' |');
    lines.push('| 本月 | ' + formatDuration(summary.monthMs) + ' |');
    lines.push('| 本书累计（' + (summary.bookTitle || '未在阅读页') + '） | ' + formatDuration(summary.bookMs) + ' |');
    lines.push('');
    lines.push('## 按书籍累计');
    lines.push('');
    lines.push('| 书名 | 进度 | 累计时长 | 最近阅读 |');
    lines.push('| --- | --- | --- | --- |');
    const books = Object.values(stats ? stats.books : {}).sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0));
    if (books.length === 0) {
      lines.push('| — | — | — | — |');
    } else {
      books.forEach((book) => {
        lines.push('| ' + (book.title || '未知书籍') + ' | ' + (progressTextOf(book) || '—') + ' | ' + formatDuration(book.totalMs) + ' | ' + formatDateTime(book.lastReadAt) + ' |');
      });
    }
    lines.push('');
    lines.push('## 最近阅读（最多 10 本）');
    lines.push('');
    const recentBooks = getRecentBooks(10);
    if (recentBooks.length === 0) {
      lines.push('- 暂无阅读记录');
    } else {
      recentBooks.forEach((book) => {
        const progressText = progressTextOf(book);
        lines.push('- ' + (book.title || '未知书籍')
          + (progressText ? '（' + progressText + '）' : '')
          + '：' + formatDuration(book.totalMs || 0)
          + ' · 最近 ' + formatDateTime(book.lastReadAt));
      });
    }
    lines.push('');
    lines.push('## 每日明细（全部书籍）');
    lines.push('');
    lines.push('| 日期 | 时长 |');
    lines.push('| --- | --- |');
    const dailyTotals = {};
    collectRows().forEach((row) => {
      dailyTotals[row.date] = (dailyTotals[row.date] || 0) + row.ms;
    });
    const dates = Object.keys(dailyTotals).sort().reverse();
    if (dates.length === 0) {
      lines.push('| — | — |');
    } else {
      dates.forEach((date) => {
        lines.push('| ' + date + ' | ' + formatDuration(dailyTotals[date]) + ' |');
      });
    }
    lines.push('');
    return lines.join('\n');
  }

  // ---------- HTML / PDF 报表 ----------

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function reportStyles() {
    return [
      ':root{--accent:#07c160;--accent-soft:#e8f8ef;--ink:#1f2328;--ink-2:#5b6570;--line:#e8ebe9;--bg:#f4f6f5}',
      '*{box-sizing:border-box}',
      'html,body{margin:0;padding:0}',
      'body{background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      '.page{max-width:820px;margin:32px auto;padding:40px 44px;background:#fff;border-radius:18px;box-shadow:0 12px 32px rgba(17,24,28,.08)}',
      '.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:22px;border-bottom:2px solid var(--line)}',
      '.hero h1{margin:0;font-size:26px;letter-spacing:.5px}',
      '.hero h1::before{content:"";display:inline-block;width:10px;height:24px;margin-right:10px;border-radius:3px;background:var(--accent);vertical-align:-3px}',
      '.hero .sub{margin:6px 0 0;font-size:12px;color:var(--ink-2)}',
      '.hero .meta{text-align:right;font-size:12px;color:var(--ink-2);white-space:nowrap}',
      '.hero .meta strong{display:block;margin-top:2px;font-size:14px;color:var(--ink)}',
      '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:26px 0 8px}',
      '.card{padding:16px 18px;border-radius:14px;background:var(--accent-soft);border-left:4px solid var(--accent)}',
      '.card .label{font-size:12px;color:var(--ink-2)}',
      '.card .value{margin-top:8px;font-size:20px;font-weight:700;letter-spacing:.3px}',
      '.block{margin-top:32px}',
      '.block h2{margin:0 0 12px;font-size:15px;font-weight:600}',
      '.block h2 span{color:var(--ink-2);font-weight:400;font-size:12px;margin-left:6px}',
      'table{width:100%;border-collapse:collapse;font-size:13px}',
      'th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}',
      'th{font-size:12px;font-weight:600;color:var(--ink-2);background:#fafbfa}',
      'tbody tr:nth-child(even){background:#f6f8f7}',
      'td.num,th.num{text-align:right;white-space:nowrap}',
      '.empty{padding:18px;font-size:13px;color:var(--ink-2);background:#fafbfa;border:1px dashed var(--line);border-radius:10px}',
      '.recent-list{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}',
      '.recent-item{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fafbfa}',
      '.recent-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
      '.recent-title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.recent-percent{flex:none;font-size:12px;font-weight:600;color:var(--accent)}',
      '.recent-sub{margin-top:6px;font-size:12px;color:var(--ink-2)}',
      '.recent-sub .sub-inline+.sub-inline{margin-left:10px}',
      '.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;line-height:1.8;color:var(--ink-2)}',
      '.print-btn{position:fixed;right:24px;bottom:24px;padding:12px 20px;border:0;border-radius:999px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(7,193,96,.35)}',
      '.print-btn:hover{filter:brightness(1.05)}',
      '@media screen{body{padding-bottom:96px}}',
      '@media (max-width:720px){.page{margin:16px;padding:24px}.cards{grid-template-columns:repeat(2,1fr)}.recent-list{grid-template-columns:1fr}.hero{flex-direction:column;align-items:flex-start}.hero .meta{text-align:left}}',
      '@media print{@page{size:A4;margin:14mm}body{background:#fff}.page{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}.no-print{display:none!important}.cards{break-inside:avoid}.recent-item{break-inside:avoid}table{break-inside:auto}tr{break-inside:avoid}}',
    ].join('');
  }

  function buildReportCards(summary) {
    const cards = [
      { label: '今日阅读', value: formatDuration(summary.todayMs) },
      { label: '本周阅读', value: formatDuration(summary.weekMs) },
      { label: '本月阅读', value: formatDuration(summary.monthMs) },
      { label: '本书累计', value: formatDuration(summary.bookMs) },
    ];
    return '<div class="cards">' + cards.map((card) =>
      '<div class="card"><div class="label">' + card.label + '</div>' +
      '<div class="value">' + card.value + '</div></div>'
    ).join('') + '</div>';
  }

  function buildReportBooks(limit) {
    const books = Object.values(stats ? stats.books : {})
      .sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0));
    if (books.length === 0) {
      return '<div class="empty">还没有阅读记录，去读一会儿再导出吧～</div>';
    }
    const shown = books.slice(0, limit);
    const rows = shown.map((book) =>
      '<tr><td>' + escapeHtml(book.title || '未知书籍') + '</td>' +
      '<td class="num">' + (progressTextOf(book) || '—') + '</td>' +
      '<td class="num">' + formatDuration(book.totalMs) + '</td>' +
      '<td class="num">' + formatDateTime(book.lastReadAt) + '</td></tr>'
    ).join('');
    const more = books.length > shown.length
      ? '<div class="empty" style="margin-top:12px">仅展示时长最长的 ' + shown.length + ' 本（共 ' + books.length + ' 本）</div>'
      : '';
    return '<table><thead><tr><th>书名</th><th class="num">进度</th><th class="num">累计时长</th><th class="num">最近阅读</th></tr></thead><tbody>' +
      rows + '</tbody></table>' + more;
  }

  function buildReportRecent() {
    const books = getRecentBooks(10);
    if (books.length === 0) {
      return '<div class="empty">暂无阅读记录</div>';
    }
    const rows = books.map((book) => {
      const progress = book.progress || null;
      const subParts = [];
      if (progress && progress.chapter) {
        subParts.push('<span class="sub-inline">' + escapeHtml(progress.chapter) + '</span>');
      }
      subParts.push('<span class="sub-inline">' + formatDuration(book.totalMs || 0) + '</span>');
      subParts.push('<span class="sub-inline">' + formatDateTime(book.lastReadAt) + '</span>');
      return '<div class="recent-item"><div class="recent-head">' +
        '<span class="recent-title">' + escapeHtml(book.title || '未知书籍') + '</span>' +
        '<span class="recent-percent">' + (progressTextOf(book) || '进度未知') + '</span>' +
        '</div><div class="recent-sub">' + subParts.join('') + '</div></div>';
    }).join('');
    return '<div class="recent-list">' + rows + '</div>';
  }

  function buildReportDaily() {
    const dailyTotals = {};
    collectRows().forEach((row) => {
      dailyTotals[row.date] = (dailyTotals[row.date] || 0) + row.ms;
    });
    const dates = Object.keys(dailyTotals).sort().reverse();
    if (dates.length === 0) {
      return '<div class="empty">暂无每日明细</div>';
    }
    const rows = dates.map((date) =>
      '<tr><td>' + date + '</td><td class="num">' + formatDuration(dailyTotals[date]) + '</td></tr>'
    ).join('');
    return '<table><thead><tr><th>日期</th><th class="num">阅读时长</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function buildReportHtml() {
    const summary = getSummary();
    const exportedAt = formatDateTime(Date.now());
    const totalMs = sumByDayKey(() => true);
    const bookLine = summary.bookTitle ? '当前书籍：' + summary.bookTitle : '当前不在阅读页';
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>微信悦读 · 阅读统计 ' + stampSuffix() + '</title>',
      '<style>' + reportStyles() + '</style>',
      '</head>',
      '<body>',
      '<div class="page">',
      '  <header class="hero">',
      '    <div>',
      '      <h1>阅读统计</h1>',
      '      <p class="sub">微信悦读 · weread-enhancer</p>',
      '    </div>',
      '    <div class="meta">导出时间<strong>' + exportedAt + '</strong></div>',
      '  </header>',
      buildReportCards(summary),
      '  <div class="block"><h2>按书籍累计<span>共 ' + Object.keys(stats ? stats.books : {}).length + ' 本 · 累计 ' + formatDuration(totalMs) + '</span></h2>',
      buildReportBooks(50),
      '  </div>',
      '  <div class="block"><h2>最近阅读<span>最多 10 本 · 按最近阅读时间</span></h2>',
      buildReportRecent(),
      '  </div>',
      '  <div class="block"><h2>每日明细</h2>',
      buildReportDaily(),
      '  </div>',
      '  <footer class="foot">',
      '    <div>' + escapeHtml(bookLine) + '</div>',
      '    <div>统计口径：仅统计「微信读书页面在前台且停留在阅读页」的时长，为本地估算值，与微信读书官方统计不会完全一致。</div>',
      '    <div>数据仅保存在本机浏览器（chrome.storage.local），不会上传到任何服务器。</div>',
      '  </footer>',
      '</div>',
      '<button class="print-btn no-print" id="wre-report-print">打印 / 另存为 PDF</button>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  function openReportForPrint(html) {
    const win = window.open('', '_blank');
    if (!win) {
      logStats('warn', 'PDF 导出被拦截：浏览器阻止了新窗口，请允许本站弹出窗口后重试');
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    const printBtn = win.document.getElementById('wre-report-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => win.print());
    }
    // 等浏览器完成首帧渲染再唤起打印对话框
    setTimeout(() => {
      try {
        win.print();
      } catch (error) {
        logStats('warn', '唤起打印失败，可手动按 Ctrl/Cmd+P', { error: String(error) });
      }
    }, 400);
    return true;
  }

  function handleExport(format) {
    if (!stats) {
      logStats('warn', '统计数据未就绪，忽略导出请求', { format });
      return;
    }
    const suffix = stampSuffix();
    if (format === 'csv') {
      downloadFile('微信悦读-阅读统计-' + suffix + '.csv', buildCsv(), 'text/csv;charset=utf-8');
    } else if (format === 'markdown') {
      downloadFile('微信悦读-阅读统计-' + suffix + '.md', buildMarkdown(), 'text/markdown;charset=utf-8');
    } else if (format === 'html') {
      downloadFile('微信悦读-阅读统计-' + suffix + '.html', buildReportHtml(), 'text/html;charset=utf-8');
    } else if (format === 'pdf') {
      if (!openReportForPrint(buildReportHtml())) {
        return;
      }
    } else {
      downloadFile('微信悦读-阅读统计-' + suffix + '.json', buildJson(), 'application/json;charset=utf-8');
    }
    logStats('info', '已导出统计数据', { format, books: Object.keys(stats.books).length });
  }

  // ---------- 启动 ----------

  function attach(root) {
    injectMenuEntry(root);
    const overlay = buildPanel(root);
    const body = overlay.querySelector('#wre-stats-body');
    if (body) {
      body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-wre-stats-export]');
        if (button) {
          handleExport(button.getAttribute('data-wre-stats-export'));
          return;
        }
        const openItem = event.target.closest('[data-wre-stats-open]');
        if (openItem) {
          const bookId = openItem.getAttribute('data-wre-stats-open');
          if (bookId) {
            window.open('https://weread.qq.com/web/reader/' + bookId, '_blank');
            logStats('info', '从最近书目打开书籍', { bookId });
          }
        }
      });
    }
    syncBook();
    updateProgress();
    setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', () => {
      stopCounting();
      flushStats(true);
    });
    logStats('info', '阅读统计模块已启动', {
      activeBookKey,
      interval: TICK_MS,
    });
  }

  function bootstrap() {
    loadStats().then(() => {
      pruneOldDays();
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
      logStats('debug', '等待插件根容器出现后接入统计模块');
    });
  }

  // content.js 在 DOMContentLoaded 才初始化 UI，这里同样等 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
