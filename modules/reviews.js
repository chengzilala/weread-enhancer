/**
 * 微信悦读 · 阅读页评论侧栏（v0.28.0）
 *
 * 定位：读书时「边读边看别人怎么说」——在阅读页右侧挂一个侧栏，
 *       按「当前章节」展示微信读书公开评论（头像 / 昵称 / 时间 / 正文 + 可展开引用原文）。
 *
 * 数据来源：微信读书**同源网页接口**（复用登录 Cookie，免 API Key、免新增权限）。
 *   - 评论：GET /web/review/list?bookId=&chapterUid=&listType=
 *   - 章节表：POST /web/book/chapterInfos（用于取真实 chapterUid，防错位）
 * 隐私口径：只读展示、不落盘、不上传；评论内容一律转义后渲染（防 XSS）。
 *   —— 与「📝 笔记」（展示我自己的划线/想法，Key 必选）是两回事，文案已分别写清。
 *
 * 复用 content.js 的全局 log()；菜单入口与面板由本模块自行注入。
 * 接口名 / 参数集中在文件顶部 API 常量，接口变动时只改这一处。
 */
(function () {
  'use strict';

  // ---------- 集中配置（接口 / 参数集中一处，便于实测标定） ----------
  const API = {
    REVIEW: '/web/review/list',            // 同源公开评论接口（免 Key）
    CHAPTER_INFO: '/web/book/chapterInfos', // 章节表（章节名 ↔ chapterUid）
    LIST_TYPE: 8,                          // 公开章节评论的 listType（沿用参考实现固定值，待实测标定）
    TIMEOUT: 8000,
  };
  const READER_RE = /\/web\/reader\/([^/?#]+)/;
  const REFRESH_DEBOUNCE = 500;

  // 默认收起：打开一本书时不自动弹出，只在主菜单点「💭 评论」时展开
  let collapsed = true;
  let sidebar = null;
  let reqSeq = 0;          // 请求序号：拦截旧任务，防止章节快速切换时错乱
  let lastKey = '';        // bookId|chapterUid：相同则不重复拉取
  let chapterCache = { bookId: '', byTitle: {} };
  let bookIdCache = { urlId: '', numeric: '' };  // 会话内缓存已解析的 bookId，避免重复请求
  let refreshTimer = null;
  let rootObserver = null;

  // ---------- 通用小工具（模块内自带，不污染全局） ----------

  function logReviews(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[reviews] ' + message, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  // 时间戳（秒）→ YYYY-MM-DD HH:mm:ss
  function formatDateTime(seconds) {
    const ts = Number(seconds);
    if (!ts || ts <= 0) {
      return '—';
    }
    const date = new Date(ts * 1000);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 纯文本 → 安全 HTML（转义 + 换行转 <br>），杜绝直接注入 UGC 的 HTML
  function textToHtml(text) {
    return escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  }

  function pickArrayDeep(payload, bookId, keys) {
    if (!payload) {
      return [];
    }
    const containers = [payload];
    if (payload.data && typeof payload.data === 'object') {
      containers.push(payload.data);
      if (bookId && payload.data[bookId]) {
        containers.push(payload.data[bookId]);
      }
    }
    for (const container of containers) {
      for (const key of keys) {
        if (container && Array.isArray(container[key])) {
          return container[key];
        }
      }
    }
    return [];
  }

  // 统一请求封装：永不抛错；带超时；返回 { ok, data, status, keys, error }
  function requestJson(url, options, label) {
    return new Promise((resolve) => {
      let settled = false;
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        if (controller) {
          controller.abort();
        }
        finish({ label, url, ok: false, status: 0, keys: [], error: new Error('请求超时') });
      }, API.TIMEOUT);

      const init = Object.assign({
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }, options || {});
      if (controller) {
        init.signal = controller.signal;
      }

      fetch(url, init)
        .then((response) => response.text().then((text) => ({ response, text })))
        .then(({ response, text }) => {
          const status = response.status;
          let data = null;
          try {
            data = text ? JSON.parse(text) : {};
          } catch (parseError) {
            finish({ label, url, ok: false, status, keys: [], error: new Error('接口返回的不是 JSON（可能未登录或被拦截）') });
            return;
          }
          const bizCode = data && (data.errcode != null ? data.errcode : data.errCode);
          if (bizCode != null && bizCode !== 0) {
            finish({ label, url, ok: false, status, keys: Object.keys(data || {}), data, error: new Error('接口业务错误：' + (data.errmsg || data.errMsg || bizCode)) });
            return;
          }
          if (status === 401 || status === 403) {
            finish({ label, url, ok: false, status, keys: [], error: new Error('未登录或登录已过期') });
            return;
          }
          if (!response.ok) {
            finish({ label, url, ok: false, status, keys: [], error: new Error('接口返回 HTTP ' + status) });
            return;
          }
          finish({ label, url, ok: true, status, data, keys: Object.keys(data || {}) });
        })
        .catch((error) => {
          finish({ label, url, ok: false, status: 0, keys: [], error: error || new Error('网络错误') });
        });
    });
  }

  // ---------- 阅读页 / 书籍识别 ----------

  function isReaderPage() {
    return READER_RE.test(location.href);
  }

  // 网址里的 bookId（23 位字符串，取 'k' 前一段）；仅作兜底
  function getUrlBookId() {
    const match = location.href.match(READER_RE);
    return match ? String(match[1]).split('k')[0] : '';
  }

  // 官方接口要的是纯数字 bookId。免权限获取：① 读页面已发出的同源请求记录 ② 扫内联脚本 JSON
  function getNumericBookId() {
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const entry of entries) {
        const url = (entry && entry.name) || '';
        if (url.indexOf('/web/') === -1) {
          continue;
        }
        const match = url.match(/[?&]bookId=(\d{5,})/);
        if (match) {
          return match[1];
        }
      }
    } catch (e) { /* ignore */ }
    try {
      const scripts = document.querySelectorAll('script:not([src])');
      for (const script of scripts) {
        const text = script.textContent || '';
        const match = text.match(/"bookId"\s*:\s*"?(\d{5,})"?/);
        if (match) {
          return match[1];
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // 从任意回包对象里深挖数字 bookId
  function extractNumericBookId(payload) {
    const seen = new Set();
    const stack = [payload];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) {
        continue;
      }
      seen.add(cur);
      for (const key of Object.keys(cur)) {
        const value = cur[key];
        if ((key === 'bookId' || key === 'book_id') && (typeof value === 'string' || typeof value === 'number')) {
          if (/^\d{5,}$/.test(String(value))) {
            return String(value);
          }
        }
        if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }
    return '';
  }

  // bookId 解析（异步，逐级降级）：
  //   ① 免权限读网络记录 / 内联脚本里的数字 bookId
  //   ② 用网址 23 位 bookId 调同源 /web/book/info 反查数字 ID
  //   ③ 都没有 → 退回网址 bookId（接口多半会失败，走空态提示）
  async function resolveBookId() {
    const urlId = getUrlBookId();
    if (bookIdCache.urlId === urlId && bookIdCache.numeric) {
      return bookIdCache.numeric;
    }
    const numeric = getNumericBookId();
    if (numeric) {
      logReviews('info', 'bookId 命中网络记录 / 内联脚本', { bookId: numeric });
      bookIdCache = { urlId, numeric };
      return numeric;
    }
    if (!urlId) {
      return '';
    }
    const res = await requestJson('/web/book/info?bookId=' + encodeURIComponent(urlId), null, 'book-info');
    if (res.ok && res.data) {
      const found = extractNumericBookId(res.data);
      if (found) {
        logReviews('info', 'bookId 由 /web/book/info 反查得到', { urlBookId: urlId, bookId: found });
        bookIdCache = { urlId, numeric: found };
        return found;
      }
    }
    logReviews('warn', '未能取到数字 bookId，退回网址 bookId 兜底', {
      urlBookId: urlId, infoOk: res.ok, infoKeys: res.keys,
    });
    bookIdCache = { urlId, numeric: urlId };
    return urlId;
  }

  // 当前章节名（顶栏）。切换章节时此节点的文本会变化，作为「章节跟随」的监听锚点
  function getCurrentChapterTitle() {
    const el = document.querySelector('.readerTopBar_title_chapter') ||
      document.querySelector('.readerTopBar_title');
    return el ? (el.textContent || '').trim() : '';
  }

  // 兜底：目录面板里「选中项」的下标 + 2（参考实现推算，多级目录/长篇可能错位）
  function getChapterUidFromCatalog() {
    const items = document.querySelectorAll('li.readerCatalog_list_item');
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].classList.contains('readerCatalog_list_item_selected')) {
        return 2 + i;
      }
    }
    return 0;
  }

  // ---------- 数据层 ----------

  function collectChapters(payload) {
    const out = [];
    const data = payload && payload.data;
    let groups = [];
    if (Array.isArray(data)) {
      groups = data;
    } else if (data && typeof data === 'object') {
      groups = Object.keys(data).map((key) => data[key]);
    }
    groups.forEach((group) => {
      const list = (group && (group.updated || group.chapters || group.chapterInfos)) || [];
      (Array.isArray(list) ? list : []).forEach((chapter) => {
        if (chapter && chapter.chapterUid != null) {
          out.push({
            chapterUid: chapter.chapterUid,
            title: String(chapter.title || chapter.chapterName || '').trim(),
          });
        }
      });
    });
    return out;
  }

  // 取「章节名 → chapterUid」映射（按 bookId 缓存，避免每次刷新都请求）
  async function ensureChapterMap(bookId) {
    if (chapterCache.bookId === bookId && Object.keys(chapterCache.byTitle).length) {
      return chapterCache.byTitle;
    }
    const res = await requestJson(API.CHAPTER_INFO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ bookIds: [bookId] }),
    }, 'chapterInfos');
    const byTitle = {};
    if (res.ok && res.data) {
      collectChapters(res.data).forEach((chapter) => {
        if (chapter.title) {
          byTitle[chapter.title] = chapter.chapterUid;
        }
      });
    } else {
      logReviews('warn', '章节表获取失败，将退回目录序号推算', {
        status: res.status, error: res.error ? res.error.message : '',
      });
    }
    logReviews('info', '章节表就绪', { bookId, chapters: Object.keys(byTitle).length });
    chapterCache = { bookId, byTitle };
    return byTitle;
  }

  // chapterUid 解析：优先官方章节表按标题匹配，其次目录序号推算
  async function resolveChapterUid(bookId) {
    const title = getCurrentChapterTitle();
    const byTitle = await ensureChapterMap(bookId);
    if (title && byTitle[title]) {
      return { uid: byTitle[title], source: 'chapterInfo' };
    }
    if (title) {
      const keys = Object.keys(byTitle);
      for (const key of keys) {
        if (key.indexOf(title) === 0 || title.indexOf(key) === 0) {
          return { uid: byTitle[key], source: 'chapterInfo~' };
        }
      }
    }
    const uid = getChapterUidFromCatalog();
    if (uid) {
      return { uid, source: 'catalog' };
    }
    return { uid: 0, source: 'none' };
  }

  function normalizeReview(item) {
    const raw = (item && item.review) ? item.review : item;
    if (!raw) {
      return null;
    }
    const content = String(raw.content || '').trim();
    const abstract = String(raw.abstract || '').trim();
    if (!content && !abstract) {
      return null;
    }
    const author = raw.author || {};
    return {
      id: raw.reviewId || '',
      name: String(author.name || '书友').trim(),
      avatar: String(author.avatar || ''),
      createTime: Number(raw.createTime || 0),
      content,
      abstract,
      chapterTitle: String(raw.chapterTitle || '').trim(),
    };
  }

  async function fetchReviews(bookId, chapterUid) {
    const params = new URLSearchParams();
    params.set('bookId', bookId);
    params.set('chapterUid', String(chapterUid));
    params.set('listType', String(API.LIST_TYPE));
    const url = API.REVIEW + '?' + params.toString();
    const res = await requestJson(url, null, 'review-list');
    if (!res.ok) {
      logReviews('warn', '评论接口失败', {
        url, status: res.status, keys: res.keys,
        error: res.error ? res.error.message : '',
      });
      return { ok: false, error: res.error ? res.error.message : '评论接口不可用', status: res.status };
    }
    const rawItems = pickArrayDeep(res.data, bookId, ['reviews', 'reviewList', 'list']);
    const items = rawItems.map(normalizeReview).filter(Boolean);
    logReviews('info', '评论拉取完成', {
      url, raw: rawItems.length, kept: items.length, keys: res.keys,
    });
    return { ok: true, items };
  }

  // ---------- 侧栏渲染 ----------

  function buildSidebar() {
    const el = document.createElement('div');
    el.id = 'wre-reviews-sidebar';
    el.className = 'wre-reviews-sidebar';
    el.innerHTML =
      '<div class="wre-reviews-panel">' +
        '<div class="wre-reviews-header">' +
          '<span class="wre-reviews-heading">💭 评论</span>' +
          '<div class="wre-reviews-tools">' +
            '<button class="wre-reviews-iconbtn" data-wre-reviews-refresh title="刷新">⟳</button>' +
            '<button class="wre-reviews-iconbtn wre-reviews-iconbtn--text" data-wre-reviews-collapse title="收起评论">收起 ›</button>' +
          '</div>' +
        '</div>' +
        '<div class="wre-reviews-sub" id="wre-reviews-sub">正在读取评论…</div>' +
        '<div class="wre-reviews-body" id="wre-reviews-body"></div>' +
        '<div class="wre-reviews-privacy">评论来自微信读书公开数据，仅在本机展示、不上传</div>' +
      '</div>';
    el.addEventListener('click', handleSidebarClick);
    document.body.appendChild(el);
    return el;
  }

  function applyTheme() {
    if (!sidebar) {
      return;
    }
    // 参考插件同款判据：body 无 wr_whiteTheme 即深色主题
    const isDark = !document.body.classList.contains('wr_whiteTheme');
    sidebar.classList.toggle('wre-dark', isDark);
  }

  // 面板顶部避让阅读页顶栏：实测顶栏高度写入 CSS 变量，避免面板头部被顶栏压住
  function syncTopOffset() {
    if (!sidebar) {
      return;
    }
    const bar = document.querySelector('.readerTopBar');
    const height = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
    sidebar.style.setProperty('--wre-rv-top', (height > 0 ? height : 0) + 'px');
  }

  function mountSidebar() {
    if (!isReaderPage()) {
      return;
    }
    if (!sidebar || !document.body.contains(sidebar)) {
      sidebar = sidebar || buildSidebar();
      if (!document.body.contains(sidebar)) {
        document.body.appendChild(sidebar);
      }
      logReviews('info', '已挂载评论侧栏');
    }
    sidebar.classList.toggle('wre-collapsed', collapsed);
    syncTopOffset();
    applyTheme();
  }

  // 收起 / 展开面板（收起后面板整体隐藏，不留右边缘小标签）
  function setCollapsed(value) {
    const next = !!value;
    if (collapsed === next) {
      return;
    }
    collapsed = next;
    if (sidebar) {
      sidebar.classList.toggle('wre-collapsed', collapsed);
    }
    logReviews('info', collapsed ? '评论侧栏已收起' : '评论侧栏已展开');
    if (!collapsed) {
      lastKey = '';
      refresh(true);
    }
  }

  function unmountSidebar() {
    if (sidebar && document.body.contains(sidebar)) {
      sidebar.remove();
      logReviews('info', '已移除评论侧栏');
    }
  }

  function setSub(text) {
    const sub = sidebar && sidebar.querySelector('#wre-reviews-sub');
    if (sub) {
      sub.innerHTML = text;
    }
  }

  function setBody(html) {
    const body = sidebar && sidebar.querySelector('#wre-reviews-body');
    if (body) {
      body.innerHTML = html;
    }
  }

  function renderLoading() {
    setBody('<div class="wre-reviews-state">正在读取评论…</div>');
  }

  function renderError(message) {
    setBody(
      '<div class="wre-reviews-state wre-reviews-state--error">' +
        escapeHtml(message) +
        '<button class="wre-reviews-retry" data-wre-reviews-refresh>重试</button>' +
      '</div>'
    );
  }

  function renderEmpty() {
    setBody('<div class="wre-reviews-state">本章还没有评论</div>');
  }

  function avatarHtml(item) {
    if (item.avatar) {
      return '<img class="wre-reviews-avatar" src="' + escapeHtml(item.avatar) +
        '" alt="" referrerpolicy="no-referrer" loading="lazy">';
    }
    const ch = escapeHtml((item.name || '书').slice(0, 1));
    return '<span class="wre-reviews-avatar wre-reviews-avatar--text">' + ch + '</span>';
  }

  function renderList(items) {
    const cards = items.map((item) => {
      const abstract = item.abstract
        ? '<div class="wre-reviews-abstract" data-wre-reviews-abstract>' +
            '<span class="wre-reviews-abstract-label">引用原文</span>' +
            '<span class="wre-reviews-abstract-text">' + textToHtml(item.abstract) + '</span>' +
          '</div>'
        : '';
      const content = item.content
        ? '<div class="wre-reviews-content">' + textToHtml(item.content) + '</div>'
        : '';
      return '<div class="wre-reviews-item">' +
          '<div class="wre-reviews-item-head">' +
            avatarHtml(item) +
            '<span class="wre-reviews-name">' + escapeHtml(item.name) + '</span>' +
            '<span class="wre-reviews-time">' + escapeHtml(formatDateTime(item.createTime)) + '</span>' +
          '</div>' +
          content +
          abstract +
        '</div>';
    }).join('');
    setBody(cards);
  }

  function handleSidebarClick(event) {
    const target = event.target;
    if (!target || !target.closest) {
      return;
    }
    if (target.closest('[data-wre-reviews-collapse]')) {
      setCollapsed(true);
      return;
    }
    if (target.closest('[data-wre-reviews-refresh]')) {
      lastKey = '';
      refresh(true);
      return;
    }
    const abstract = target.closest('[data-wre-reviews-abstract]');
    if (abstract) {
      abstract.classList.toggle('wre-reviews-abstract--open');
    }
  }

  // ---------- 主流程：拉取 + 渲染 ----------

  async function refresh(force) {
    if (collapsed || !isReaderPage()) {
      return;
    }
    mountSidebar();
    const bookId = await resolveBookId();
    if (!bookId) {
      setSub('未识别到书籍');
      renderError('未识别到书籍 ID，请确认已打开阅读页并登录');
      return;
    }
    const resolved = await resolveChapterUid(bookId);
    if (!resolved.uid) {
      setSub('未识别到当前章节');
      renderError('未识别到当前章节，请打开「目录」后再点刷新');
      return;
    }
    const key = bookId + '|' + resolved.uid;
    if (!force && key === lastKey) {
      return;
    }
    lastKey = key;

    const seq = ++reqSeq;
    const title = getCurrentChapterTitle() || '当前章节';
    setSub('《' + escapeHtml(title) + '》 · 正在读取…');
    renderLoading();

    const result = await fetchReviews(bookId, resolved.uid);
    if (seq !== reqSeq) {
      return; // 期间又切了章节，丢弃本次结果
    }
    if (!result.ok) {
      setSub('《' + escapeHtml(title) + '》');
      renderError(result.error || '评论加载失败，请稍后重试');
      return;
    }
    if (!result.items.length) {
      setSub('《' + escapeHtml(title) + '》 · 共 0 条评论');
      renderEmpty();
      return;
    }
    setSub('《' + escapeHtml(title) + '》 · 共 ' + result.items.length + ' 条评论');
    renderList(result.items);
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (isReaderPage()) {
        mountSidebar();
        applyTheme();
        if (!collapsed) {
          refresh(false);
        }
      } else {
        unmountSidebar();
      }
    }, REFRESH_DEBOUNCE);
  }

  function startObservers() {
    if (rootObserver) {
      return;
    }
    rootObserver = new MutationObserver(() => {
      scheduleRefresh();
    });
    rootObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
    logReviews('debug', '已监听阅读页章节变化');
  }

  // ---------- 菜单入口 ----------

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu || menu.querySelector('[data-wre-reviews-entry]')) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'reviews');
    item.setAttribute('data-wre-reviews-entry', '1');
    item.innerHTML = '<span class="wre-menu-icon">💭</span>评论';
    item.addEventListener('click', () => {
      onMenuEntryClick();
    });
    const anchor = menu.querySelector('[data-wre-notes-entry]') ||
      menu.querySelector('[data-action="read-settings"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else {
      menu.appendChild(item);
    }
    logReviews('info', '已注入「评论」菜单入口');
  }

  // 主菜单「💭 评论」入口：已收起 → 展开；已展开 → 收起（不持久化关闭，下次打开书仍默认收起）
  function onMenuEntryClick() {
    if (!isReaderPage()) {
      return;
    }
    setCollapsed(!collapsed);
  }

  // ---------- 启动 ----------

  function bootstrap() {
    const root = document.getElementById('we-read-enhancer-root');
    if (root) {
      injectMenuEntry(root);
    } else {
      const observer = new MutationObserver(() => {
        const r = document.getElementById('we-read-enhancer-root');
        if (r) {
          observer.disconnect();
          injectMenuEntry(r);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      logReviews('debug', '等待插件根容器出现后接入评论菜单');
    }

    startObservers();
    window.addEventListener('resize', syncTopOffset);
    scheduleRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
