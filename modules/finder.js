/**
 * 微信悦读 · 找书（v0.20.0）
 *
 * 定位：给书架补上官方所没有的「标签 + 多维度搜书」能力。
 *   1. 复用官方网关底座（/shelf/sync 书架、/user/notebooks 笔记概览、
 *      /book/bookmarklist + /review/list/mine 单本正文），不新增浏览器权限；
 *   2. 标签**只存本机**（chrome.storage.local → wreBookTags），不写回微信读书、
 *      不上传（官方 Agent 网关为只读，无法回写）；
 *   3. 支持按书名 / 作者 / 标签 / 笔记数 / 阅读状态 / 最近阅读筛选，
 *      并可「含划线·想法正文」按需检索（单本按需拉取 + 内存缓存 TTL）；
 *   4. 支持一键导出 / 导入 JSON（合并 / 覆盖），防清缓存或换设备丢标签。
 *
 * 复用 content.js 的全局 log() 与 #we-read-enhancer-root 容器；
 * 旧代码不动：本模块只新增文件，content.js 仅多一处菜单分流。
 */
(function () {
  'use strict';

  const TAGS_KEY = 'wreBookTags';                 // 本地标签层
  const SHELF_CACHE_KEY = 'wreFinderShelfCache';  // 书架缓存（与标签分开存）
  const SCHEMA_VERSION = 1;
  const SHELF_TTL_MS = 30 * 60 * 1000;            // 书架缓存 30 分钟
  const CONTENT_TTL_MS = 10 * 60 * 1000;          // 单本正文缓存 10 分钟
  const NOTES_MAX_PAGES = 5;                      // /user/notebooks 游标分页上限
  const NOTES_PAGE_SIZE = 100;
  const TAG_MAX_LEN = 20;
  const PAGE_SIZE = 150;                          // 列表分页渲染步长
  const CONTENT_CONCURRENCY = 4;                  // 正文检索并发数（书架可能数百本，串行太慢）
  const CONTENT_RENDER_EVERY = 10;                // 每检索多少本重绘一次（降低重绘频率防卡顿）

  // ---------- 状态 ----------

  let root = null;            // #we-read-enhancer-root 容器
  let tagsMap = {};           // { "<官方数字 bookId>": { title, author, tags: [], updatedAt } }
  let tagsReady = false;
  let keyStatus = { hasKey: false };
  let keyReady = false;       // 是否已拿到 Key 状态（避免首帧误闪「未配置」引导）
  let shelf = null;           // { books, albums, hasMp, bookCount }
  let shelfState = 'idle';    // idle | loading | ok | error
  let shelfError = '';
  let notesMap = {};          // bookId -> { noteCount, reviewCount, bookmarkCount, readingProgress }
  let notesState = 'idle';    // idle | loading | ok | error
  let shelfFromCache = false;
  let shown = PAGE_SIZE;
  let tagManagerOpen = false;
  let tagEdit = null;         // { tag, mode: 'rename' | 'merge' } 内联编辑
  let message = '';           // 面板内一次性提示（成功 / 失败）
  let contentState = { running: false, done: 0, total: 0, matched: {}, error: '' };
  const contentCache = {};    // bookId -> { at, marks: [], reviews: [] }

  const ui = {
    keyword: '',
    tags: [],                 // 已选标签（多选）
    tagMode: 'and',           // and | or
    status: 'all',            // all | reading | finished | never
    notes: 'all',             // all | has | none
    recent: 'all',            // all | 7 | 30 | 90 | older
    withContent: false,       // 是否含划线 / 想法正文检索
  };

  const STATUS_OPTIONS = [
    { key: 'all', label: '全部状态' },
    { key: 'reading', label: '在读' },
    { key: 'finished', label: '已读完' },
    { key: 'never', label: '从未打开' },
  ];
  const NOTE_OPTIONS = [
    { key: 'all', label: '笔记不限' },
    { key: 'none', label: '无笔记' },
    { key: 'has', label: '有笔记' },
    { key: '1-10', label: '1-10 条' },
    { key: '11-50', label: '11-50 条' },
    { key: '50+', label: '50 条以上' },
  ];
  const RECENT_OPTIONS = [
    { key: 'all', label: '时间不限' },
    { key: '7', label: '近 7 天' },
    { key: '30', label: '近 30 天' },
    { key: '90', label: '近 90 天' },
    { key: 'older', label: '更早' },
  ];

  // ---------- 通用小工具 ----------

  function logFinder(level, msg, meta) {
    if (typeof log === 'function') {
      log(level, '[finder] ' + msg, meta);
    }
  }

  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function fmtDateTime(timestamp) {
    const t = Number(timestamp) || 0;
    if (!t) {
      return '';
    }
    const d = new Date(t);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function normalize(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, '');
  }

  // ---------- 拼音首字母（离线数据表，见 modules/pinyin-data.js） ----------

  let pinyinMap = null;   // 字符 -> 首字母（首次使用时构建一次）

  function getPinyinMap() {
    if (pinyinMap !== null) {
      return pinyinMap;
    }
    pinyinMap = {};
    const data = window.WRE_PINYIN;
    if (data && typeof data.chars === 'string' && typeof data.inits === 'string') {
      const n = Math.min(data.chars.length, data.inits.length);
      for (let i = 0; i < n; i += 1) {
        pinyinMap[data.chars.charAt(i)] = data.inits.charAt(i);
      }
    }
    logFinder('debug', '拼音首字母表已构建', { size: Object.keys(pinyinMap).length });
    return pinyinMap;
  }

  /** 取文本的拼音首字母串（仅保留字母/数字；汉字取首字母，其它字符忽略） */
  function initialsOf(text) {
    const map = getPinyinMap();
    const s = String(text || '');
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      const ch = s.charAt(i);
      if (/[a-z0-9]/i.test(ch)) {
        out += ch.toLowerCase();
      } else if (map[ch]) {
        out += map[ch];
      }
    }
    return out;
  }

  function sendBg(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, code: 'channel', error: '扩展后台未响应，请重新加载扩展后再试' });
            return;
          }
          resolve(response || { ok: false, code: 'empty', error: '后台无响应内容' });
        });
      } catch (err) {
        resolve({ ok: false, code: 'channel', error: '扩展后台通信失败：' + (err && err.message ? err.message : '未知错误') });
      }
    });
  }

  function isHttpUrl(s) {
    return /^https?:\/\//i.test(String(s || '').trim());
  }

  function bookWebUrl(hashId) {
    const id = String(hashId || '').trim();
    return id ? ('https://weread.qq.com/web/bookDetail/' + encodeURIComponent(id)) : '';
  }

  function webUrlFromDeepLink(link) {
    const s = String(link || '').trim();
    if (!s) {
      return '';
    }
    const existing = s.match(/\/web\/bookDetail\/([^/?#]+)/i);
    if (existing && existing[1]) {
      return bookWebUrl(decodeURIComponent(existing[1]));
    }
    const v = s.match(/[?&]v=([^&]+)/i);
    return (v && v[1]) ? bookWebUrl(decodeURIComponent(v[1])) : '';
  }

  /** 把官方（手机端）链接换成电脑可打开的网页版详情页；失败按书名到同源搜索解析 */
  async function resolveWebBookUrl(title) {
    const kw = String(title || '').trim();
    if (!kw) {
      return '';
    }
    try {
      const res = await fetch('/web/search/global?keyword=' + encodeURIComponent(kw), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return '';
      }
      const data = await res.json();
      const books = Array.isArray(data && data.books) ? data.books : [];
      let fallback = '';
      for (let i = 0; i < books.length; i += 1) {
        const info = (books[i] && books[i].bookInfo) || {};
        const link = webUrlFromDeepLink(info.deepLink);
        if (!link) {
          continue;
        }
        if (!fallback) {
          fallback = link;
        }
        if (String(info.title || '').trim() === kw) {
          return link;
        }
      }
      return fallback;
    } catch (e) {
      logFinder('warn', '书名解析异常', { error: String((e && e.message) || e) });
      return '';
    }
  }

  async function openBookLink(title, rawLink) {
    let link = '';
    if (isHttpUrl(rawLink)) {
      link = webUrlFromDeepLink(rawLink) || String(rawLink || '').trim();
    }
    if (!link) {
      link = await resolveWebBookUrl(title);
    }
    if (!link) {
      link = String(rawLink || '').trim();
    }
    if (!link) {
      message = '这本书没有可打开的链接，试试用书名在搜索框里找。';
      render();
      return;
    }
    logFinder('info', '书籍跳转', { via: isHttpUrl(link) ? 'https' : 'scheme' });
    window.open(link, '_blank', 'noopener');
  }

  // ---------- 本地标签存储 ----------

  async function loadTags() {
    try {
      const res = await chrome.storage.local.get([TAGS_KEY]);
      const data = res[TAGS_KEY];
      if (data && typeof data === 'object' && data.map && typeof data.map === 'object') {
        tagsMap = data.map;
      } else {
        tagsMap = {};
      }
    } catch (e) {
      tagsMap = {};
      logFinder('warn', '读取本地标签失败', { error: String((e && e.message) || e) });
    }
    tagsReady = true;
    logFinder('info', '本地标签已载入', { books: Object.keys(tagsMap).length });
  }

  async function saveTags() {
    try {
      await chrome.storage.local.set({
        [TAGS_KEY]: { schemaVersion: SCHEMA_VERSION, updatedAt: Date.now(), map: tagsMap },
      });
      return true;
    } catch (e) {
      message = '标签保存失败：' + ((e && e.message) || '未知错误') + '（请检查浏览器存储空间）';
      logFinder('warn', '标签保存失败', { error: String((e && e.message) || e) });
      return false;
    }
  }

  function entryOf(key) {
    const k = String(key || '');
    if (!k) {
      return null;
    }
    return tagsMap[k] || null;
  }

  function tagsOf(key) {
    const entry = entryOf(key);
    return entry && Array.isArray(entry.tags) ? entry.tags : [];
  }

  function cleanTag(raw) {
    return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, TAG_MAX_LEN);
  }

  async function addTagTo(item, rawTag) {
    const tag = cleanTag(rawTag);
    if (!tag) {
      return;
    }
    const key = String(item.key || '');
    if (!key) {
      return;
    }
    const entry = tagsMap[key] || { title: item.title, author: item.author, tags: [], updatedAt: 0 };
    entry.title = item.title || entry.title;
    entry.author = item.author || entry.author;
    if (!Array.isArray(entry.tags)) {
      entry.tags = [];
    }
    if (entry.tags.indexOf(tag) < 0) {
      entry.tags.push(tag);
    }
    entry.updatedAt = Date.now();
    tagsMap[key] = entry;
    const ok = await saveTags();
    if (ok) {
      message = '已给《' + (item.title || '未命名') + '》加上标签「' + tag + '」';
      logFinder('info', '打标签', { key: key, tag: tag });
    }
    render();
  }

  async function removeTagFrom(item, tag) {
    const key = String(item.key || '');
    const entry = entryOf(key);
    if (!entry || !Array.isArray(entry.tags)) {
      return;
    }
    entry.tags = entry.tags.filter((t) => t !== tag);
    entry.updatedAt = Date.now();
    if (!entry.tags.length) {
      delete tagsMap[key];   // 没有标签就不留空壳
    } else {
      tagsMap[key] = entry;
    }
    await saveTags();
    message = '已移除标签「' + tag + '」';
    logFinder('info', '移除标签', { key: key, tag: tag });
    render();
  }

  /** 汇总所有标签及书籍数：[{ name, count }]，按书籍数降序 */
  function allTags() {
    const counter = {};
    Object.keys(tagsMap).forEach((key) => {
      const tags = tagsOf(key);
      tags.forEach((t) => {
        counter[t] = (counter[t] || 0) + 1;
      });
    });
    return Object.keys(counter).map((name) => ({ name: name, count: counter[name] }))
      .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  }

  async function renameTag(oldTag, newTag) {
    const target = cleanTag(newTag);
    if (!target || target === oldTag) {
      return;
    }
    let changed = 0;
    Object.keys(tagsMap).forEach((key) => {
      const entry = tagsMap[key];
      if (!entry || !Array.isArray(entry.tags) || entry.tags.indexOf(oldTag) < 0) {
        return;
      }
      entry.tags = entry.tags.filter((t) => t !== oldTag);
      if (entry.tags.indexOf(target) < 0) {
        entry.tags.push(target);
      }
      entry.updatedAt = Date.now();
      changed += 1;
    });
    // 重命名后可能与其他标签重复，做一次去重合并已有的
    ui.tags = ui.tags.map((t) => (t === oldTag ? target : t));
    ui.tags = ui.tags.filter((t, i) => ui.tags.indexOf(t) === i);
    await saveTags();
    message = changed ? ('标签「' + oldTag + '」已重命名为「' + target + '」') : '没有找到该标签';
    logFinder('info', '重命名标签', { from: oldTag, to: target, books: changed });
    render();
  }

  async function deleteTag(tag) {
    let changed = 0;
    Object.keys(tagsMap).forEach((key) => {
      const entry = tagsMap[key];
      if (!entry || !Array.isArray(entry.tags) || entry.tags.indexOf(tag) < 0) {
        return;
      }
      entry.tags = entry.tags.filter((t) => t !== tag);
      entry.updatedAt = Date.now();
      if (!entry.tags.length) {
        delete tagsMap[key];
      }
      changed += 1;
    });
    ui.tags = ui.tags.filter((t) => t !== tag);
    await saveTags();
    message = changed ? ('标签「' + tag + '」已删除（影响 ' + changed + ' 本书）') : '没有找到该标签';
    logFinder('info', '删除标签', { tag: tag, books: changed });
    render();
  }

  async function mergeTag(fromTag, toTag) {
    const target = cleanTag(toTag);
    if (!target || target === fromTag) {
      return;
    }
    let changed = 0;
    Object.keys(tagsMap).forEach((key) => {
      const entry = tagsMap[key];
      if (!entry || !Array.isArray(entry.tags) || entry.tags.indexOf(fromTag) < 0) {
        return;
      }
      entry.tags = entry.tags.filter((t) => t !== fromTag);
      if (entry.tags.indexOf(target) < 0) {
        entry.tags.push(target);
      }
      entry.updatedAt = Date.now();
      changed += 1;
    });
    ui.tags = ui.tags.filter((t) => t !== fromTag);
    if (ui.tags.indexOf(target) < 0 && changed) {
      ui.tags.push(target);
    }
    await saveTags();
    message = changed ? ('标签「' + fromTag + '」已合并到「' + target + '」（影响 ' + changed + ' 本书）') : '没有找到该标签';
    logFinder('info', '合并标签', { from: fromTag, to: target, books: changed });
    render();
  }

  // ---------- 数据：书架 / 笔记 ----------

  async function refreshKeyStatus() {
    const result = await sendBg({ type: 'wre-official-status' });
    if (result && result.ok) {
      keyStatus = { hasKey: !!result.hasKey };
    }
    keyReady = true;
    return keyStatus;
  }

  function slimShelf(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const books = (Array.isArray(data.books) ? data.books : []).map((item) => ({
      bookId: item.bookId || '',
      title: item.title || '',
      author: item.author || '',
      category: item.category || '',
      cover: item.cover || '',
      deepLink: item.deepLink || '',
      readUpdateTime: item.readUpdateTime || 0,
      finishReading: Number(item.finishReading) === 1 ? 1 : 0,
      isTop: Number(item.isTop) === 1 ? 1 : 0,
      secret: Number(item.secret) === 1 ? 1 : 0,
    }));
    const albums = (Array.isArray(data.albums) ? data.albums : []).map((item) => {
      const info = item.albumInfo || {};
      const extra = item.albumInfoExtra || {};
      return {
        bookId: info.albumId || '',
        title: info.name || '',
        author: info.authorName || '',
        category: '专辑 / 有声书',
        cover: info.cover || '',
        deepLink: item.deepLink || info.deepLink || '',
        finishReading: Number(info.finish) === 1 ? 1 : 0,
        isTop: Number(extra.isTop) === 1 ? 1 : 0,
        secret: Number(extra.secret) === 1 ? 1 : 0,
        readUpdateTime: extra.lectureReadUpdateTime || 0,
        isAlbum: true,
      };
    });
    return {
      books: books,
      albums: albums,
      hasMp: !!data.mp,
      bookCount: typeof data.bookCount === 'number' ? data.bookCount : books.length,
    };
  }

  async function loadShelf(force) {
    if (!force) {
      try {
        const cached = await chrome.storage.local.get([SHELF_CACHE_KEY]);
        const entry = cached[SHELF_CACHE_KEY];
        if (entry && entry.data && (Date.now() - (entry.at || 0)) < SHELF_TTL_MS) {
          shelf = entry.data;
          shelfFromCache = true;
          shelfState = 'ok';
          logFinder('info', '命中书架缓存');
          return;
        }
      } catch (e) { /* 缓存读失败则走网络 */ }
    }

    shelfState = 'loading';
    shelfError = '';
    render();
    const res = await sendBg({ type: 'wre-official-call', apiName: '/shelf/sync', params: {} });
    if (!res.ok) {
      shelfState = 'error';
      shelfError = res.error || '书架数据未取到';
      logFinder('warn', '书架拉取失败', { code: res.code });
      render();
      return;
    }
    shelf = slimShelf(res.data) || { books: [], albums: [], hasMp: false, bookCount: 0 };
    shelfFromCache = false;
    shelfState = 'ok';
    try {
      await chrome.storage.local.set({ [SHELF_CACHE_KEY]: { at: Date.now(), data: shelf } });
    } catch (e) { /* 缓存写失败不影响展示 */ }
    logFinder('info', '书架拉取成功', { books: shelf.books.length, albums: shelf.albums.length });
    render();
  }

  /** 逐页拉取 /user/notebooks（游标分页：count + lastSort），用于「笔记数」维度 */
  async function loadNotes(force) {
    notesState = 'loading';
    render();
    const map = {};
    let lastSort = 0;
    for (let page = 0; page < NOTES_MAX_PAGES; page += 1) {
      const params = { count: NOTES_PAGE_SIZE };
      if (lastSort) {
        params.lastSort = lastSort;
      }
      const res = await sendBg({ type: 'wre-official-call', apiName: '/user/notebooks', params: params });
      if (!res.ok) {
        notesState = page === 0 ? 'error' : 'ok';   // 已拿到部分则算降级成功
        notesMap = map;
        logFinder(page === 0 ? 'warn' : 'info', '笔记概览拉取结束', { code: res.code, books: Object.keys(map).length });
        render();
        return;
      }
      const data = res.data || {};
      const books = Array.isArray(data.books) ? data.books : [];
      books.forEach((item) => {
        const bookId = String((item && item.bookId) || '');
        if (!bookId) {
          return;
        }
        map[bookId] = {
          noteCount: Number(item.noteCount) || 0,
          reviewCount: Number(item.reviewCount) || 0,
          bookmarkCount: Number(item.bookmarkCount) || 0,
          readingProgress: Number(item.readingProgress) || 0,
        };
      });
      if (!data.hasMore || !books.length) {
        break;
      }
      lastSort = books[books.length - 1].sort;
    }
    notesMap = map;
    notesState = 'ok';
    logFinder('info', '笔记概览拉取成功', { books: Object.keys(map).length });
    render();
  }

  function loadData(force) {
    if (force) {
      shown = PAGE_SIZE;
    }
    // 书架与笔记并行拉取，各自完成即渲染，互不阻塞
    loadShelf(force);
    loadNotes(force);
  }

  function noteInfo(bookId) {
    const info = notesMap[String(bookId || '')];
    return info || { noteCount: 0, reviewCount: 0, bookmarkCount: 0, readingProgress: 0 };
  }

  function noteTotal(bookId) {
    const info = noteInfo(bookId);
    return info.noteCount + info.reviewCount + info.bookmarkCount;
  }

  // ---------- 归一化书架条目 ----------

  function shelfItems() {
    if (!shelf) {
      return [];
    }
    const books = (shelf.books || []).map((b) => Object.assign({}, b, { kind: 'book', key: String(b.bookId || '') }));
    const albums = (shelf.albums || []).map((a) => Object.assign({}, a, { kind: 'album', key: String(a.bookId || '') }));
    return books.concat(albums);
  }

  function itemStatus(item) {
    const progress = item.kind === 'book' ? noteInfo(item.key).readingProgress : 0;
    if (item.finishReading || progress >= 100) {
      return 'finished';
    }
    if (!item.readUpdateTime && !progress) {
      return 'never';
    }
    return 'reading';
  }

  function statusLabel(status) {
    if (status === 'finished') { return '已读完'; }
    if (status === 'never') { return '从未打开'; }
    return '在读';
  }

  // ---------- 筛选 ----------

  function matchRecent(item) {
    if (ui.recent === 'all') {
      return true;
    }
    const t = Number(item.readUpdateTime) || 0;
    if (ui.recent === 'older') {
      return !!t && (Date.now() - t) > 90 * 24 * 3600 * 1000;
    }
    const days = Number(ui.recent);
    if (!t) {
      return false;
    }
    return (Date.now() - t) <= days * 24 * 3600 * 1000;
  }

  function contentMatched(key) {
    return contentState.matched && contentState.matched[String(key || '')];
  }

  /** 笔记条数区间匹配（0 / 有话 / 无话 / 区间） */
  function matchNotes(total) {
    const n = Number(total) || 0;
    switch (ui.notes) {
      case 'all': return true;
      case 'none': return n <= 0;
      case 'has': return n > 0;
      case '1-10': return n >= 1 && n <= 10;
      case '11-50': return n >= 11 && n <= 50;
      case '50+': return n > 50;
      default: return true;
    }
  }

  function applyFilters() {
    const kw = normalize(ui.keyword);
    const kwIsLatin = /^[a-z0-9]+$/.test(kw);   // 纯字母/数字时才走拼音首字母
    return shelfItems().filter((item) => {
      if (ui.status !== 'all' && itemStatus(item) !== ui.status) {
        return false;
      }
      if (item.kind === 'book') {
        if (!matchNotes(noteTotal(item.key))) { return false; }
      } else if (ui.notes !== 'all') {
        return false;   // 专辑没有笔记维度
      }
      if (!matchRecent(item)) {
        return false;
      }
      const itemTags = tagsOf(item.key);
      if (ui.tags.length) {
        const hit = ui.tagMode === 'and'
          ? ui.tags.every((t) => itemTags.indexOf(t) >= 0)
          : ui.tags.some((t) => itemTags.indexOf(t) >= 0);
        if (!hit) {
          return false;
        }
      }
      if (kw) {
        const text = [item.title, item.author].concat(itemTags).join(' ');
        let hit = normalize(text).indexOf(kw) >= 0;
        if (!hit && kwIsLatin) {
          hit = initialsOf(text).indexOf(kw) >= 0;   // 拼音首字母模糊匹配
        }
        if (!hit && ui.withContent && item.kind === 'book') {
          hit = !!contentMatched(item.key);
        }
        if (!hit) {
          return false;
        }
      }
      return true;
    });
  }

  /** 是否处于「筛选 / 搜索」状态（决定列表标题是「书架」还是「筛选结果」） */
  function hasActiveFilter() {
    return !!(ui.keyword.trim() || ui.tags.length ||
      ui.status !== 'all' || ui.notes !== 'all' || ui.recent !== 'all');
  }

  // ---------- 划线 / 想法正文检索（按需 + 内存缓存） ----------

  async function fetchBookReviews(bookId) {
    const items = [];
    let synckey = 0;
    let more = true;
    for (let page = 0; page < 3 && more; page += 1) {
      const res = await sendBg({
        type: 'wre-official-call',
        apiName: '/review/list/mine',
        params: { bookid: bookId, synckey: synckey, count: 50 },
      });
      if (!res || !res.ok || !res.data) {
        break;
      }
      const reviews = Array.isArray(res.data.reviews) ? res.data.reviews : [];
      reviews.forEach((entry) => {
        const r = entry && entry.review;
        if (r && typeof r.content === 'string' && r.content.trim()) {
          items.push(r.content.trim());
        }
      });
      synckey = res.data.synckey != null ? res.data.synckey : synckey;
      more = Number(res.data.hasMore) === 1;
    }
    return items;
  }

  async function getBookContent(bookId) {
    const key = String(bookId || '');
    const hit = contentCache[key];
    if (hit && (Date.now() - hit.at) < CONTENT_TTL_MS) {
      return hit;
    }
    const [markRes, reviews] = await Promise.all([
      sendBg({ type: 'wre-official-call', apiName: '/book/bookmarklist', params: { bookId: key } }),
      fetchBookReviews(key),
    ]);
    const marks = [];
    if (markRes && markRes.ok && markRes.data) {
      const updated = Array.isArray(markRes.data.updated) ? markRes.data.updated : [];
      updated.forEach((m) => {
        const t = m && m.markText;
        if (typeof t === 'string' && t.trim()) {
          marks.push(t.trim());
        }
      });
    }
    const entry = { at: Date.now(), marks: marks, reviews: reviews };
    contentCache[key] = entry;
    return entry;
  }

  function findContentHit(content, kw) {
    const mark = (content.marks || []).find((t) => normalize(t).indexOf(kw) >= 0);
    if (mark) {
      return { type: '划线', text: mark };
    }
    const review = (content.reviews || []).find((t) => normalize(t).indexOf(kw) >= 0);
    if (review) {
      return { type: '想法', text: review };
    }
    return null;
  }

  /** 对「有笔记的书」逐本拉取正文并匹配关键词；用户主动触发，带进度与可中断 */
  async function runContentSearch() {
    if (contentState.running || !shelf) {
      return;
    }
    const kw = normalize(ui.keyword);
    if (!kw) {
      return;
    }
    const candidates = shelfItems().filter((item) => item.kind === 'book' && noteTotal(item.key) > 0);
    contentState = { running: true, done: 0, total: candidates.length, matched: {}, error: '' };
    renderDynamic();
    logFinder('info', '开始划线/想法正文检索', { keyword: kw, books: candidates.length });

    let cursor = 0;
    const aborted = () => !contentState.running || normalize(ui.keyword) !== kw || !ui.withContent;
    const worker = async () => {
      for (;;) {
        if (aborted()) {
          return;
        }
        const idx = cursor;
        cursor += 1;
        if (idx >= candidates.length) {
          return;
        }
        const item = candidates[idx];
        try {
          const content = await getBookContent(item.key);
          const hit = findContentHit(content, kw);
          if (hit) {
            contentState.matched[item.key] = hit;
          }
        } catch (e) { /* 单本失败跳过 */ }
        contentState.done += 1;
        if (contentState.done % CONTENT_RENDER_EVERY === 0 || contentState.done === candidates.length) {
          renderDynamic();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONTENT_CONCURRENCY, candidates.length) }, worker));

    if (aborted()) {
      contentState.running = false;
      renderDynamic();
      return;
    }
    contentState.running = false;
    const hitCount = Object.keys(contentState.matched).length;
    message = contentState.done
      ? ('已在 ' + contentState.done + ' 本有笔记的书里检索「' + ui.keyword.trim() + '」，命中 ' + hitCount + ' 本')
      : '没有可检索的书（书架里还没有带笔记的书）';
    logFinder('info', '正文检索完成', { matched: Object.keys(contentState.matched).length });
    renderDynamic();
  }

  function cancelContentSearch() {
    if (contentState.running) {
      contentState.running = false;
      logFinder('info', '正文检索被中断');
    }
  }

  // ---------- 导出 / 导入 ----------

  function buildExportObject() {
    const tags = {};
    Object.keys(tagsMap).forEach((key) => {
      const entry = tagsMap[key];
      if (!entry || !Array.isArray(entry.tags) || !entry.tags.length) {
        return;
      }
      tags[key] = { title: entry.title || '', author: entry.author || '', tags: entry.tags.slice() };
    });
    return {
      app: '微信悦读',
      kind: 'wre-book-tags',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tags: tags,
    };
  }

  function exportTags() {
    const payload = buildExportObject();
    const count = Object.keys(payload.tags).length;
    if (!count) {
      message = '还没有任何标签可以导出。先给几本书打上标签吧。';
      render();
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date();
      a.href = url;
      a.download = '微信悦读-找书标签-' +
        stamp.getFullYear() + pad2(stamp.getMonth() + 1) + pad2(stamp.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message = '已导出 ' + count + ' 本书的标签（JSON）';
      logFinder('info', '导出标签', { books: count });
    } catch (e) {
      message = '导出失败：' + ((e && e.message) || '未知错误');
      logFinder('warn', '导出标签失败', { error: String((e && e.message) || e) });
    }
    render();
  }

  /** 解析导入文件；mode: 'merge' 合并（并集）/ 'replace' 覆盖（清空后写入） */
  async function importTagsFromFile(file, mode) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming = data && data.tags;
      if (!incoming || typeof incoming !== 'object') {
        message = '导入失败：文件格式不对（缺少 tags 字段），请选择本插件导出的 JSON。';
        render();
        return;
      }
      const nextMap = mode === 'replace' ? {} : Object.assign({}, tagsMap);
      let books = 0;
      let tagCount = 0;
      Object.keys(incoming).forEach((key) => {
        const raw = incoming[key] || {};
        const tags = Array.isArray(raw.tags)
          ? raw.tags.map(cleanTag).filter(Boolean)
          : [];
        const uniq = tags.filter((t, i) => tags.indexOf(t) === i);
        if (!uniq.length) {
          return;
        }
        const existing = nextMap[key] || { title: '', author: '', tags: [], updatedAt: 0 };
        if (mode === 'merge') {
          uniq.forEach((t) => {
            if (existing.tags.indexOf(t) < 0) {
              existing.tags.push(t);
            }
          });
        } else {
          existing.tags = uniq.slice();
        }
        existing.title = raw.title || existing.title;
        existing.author = raw.author || existing.author;
        existing.updatedAt = Date.now();
        nextMap[key] = existing;
        books += 1;
        tagCount += uniq.length;
      });
      tagsMap = nextMap;
      await saveTags();
      ui.tags = [];   // 清空筛选，避免旧标签残留
      message = (mode === 'replace' ? '已覆盖导入：' : '已合并导入：') + books + ' 本书、约 ' + tagCount + ' 个标签';
      logFinder('info', '导入标签', { mode: mode, books: books });
      render();
    } catch (e) {
      message = '导入失败：' + ((e && e.message) || '文件无法解析') + '。请确认是本插件导出的 JSON 文件。';
      logFinder('warn', '导入标签失败', { error: String((e && e.message) || e) });
      render();
    }
  }

  function triggerImport(mode) {
    const input = document.getElementById('wre-find-import-input');
    if (!input) {
      return;
    }
    input.setAttribute('data-mode', mode);
    input.value = '';
    input.click();
  }

  // ---------- 渲染 ----------

  function chipsHtml(options, current, attr) {
    return options.map((opt) =>
      '<button type="button" class="wre-find-chip' + (opt.key === current ? ' is-active' : '') +
      '" data-' + attr + '="' + escapeHtml(opt.key) + '">' + escapeHtml(opt.label) + '</button>').join('');
  }

  function buildSearchHtml() {
    return '<div class="wre-find-search">' +
      '<input type="text" id="wre-find-keyword" class="wre-find-input" placeholder="搜书名 / 作者 / 标签 / 拼音首字母…" autocomplete="off" value="' + escapeHtml(ui.keyword) + '">' +
      '<button type="button" class="wre-btn wre-btn-small" data-wre-find-clear="1">清空</button>' +
    '</div>' +
    '<div class="wre-find-chiprow">' + chipsHtml(STATUS_OPTIONS, ui.status, 'wre-find-status') + '</div>' +
    '<div class="wre-find-chiprow">' + chipsHtml(NOTE_OPTIONS, ui.notes, 'wre-find-notes') + '</div>' +
    '<div class="wre-find-chiprow">' + chipsHtml(RECENT_OPTIONS, ui.recent, 'wre-find-recent') + '</div>' +
    '<div class="wre-find-note">支持拼音首字母搜索：如输入 rzjx 可命中《认知觉醒》</div>';
  }

  function buildTagFilterHtml() {
    const tags = allTags();
    let inner;
    if (!tags.length) {
      inner = '<div class="wre-find-note">还没有标签。给下面的书加几个标签，这里就会出现筛选入口。</div>';
    } else {
      inner = '<div class="wre-find-chiprow wre-find-tagrow">' +
        tags.map((t) =>
          '<button type="button" class="wre-find-chip wre-find-tagchip' + (ui.tags.indexOf(t.name) >= 0 ? ' is-active' : '') +
          '" data-wre-find-tag="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + ' <b>' + t.count + '</b></button>').join('') +
        '</div>' +
        '<div class="wre-find-chiprow">' +
          '<span class="wre-find-note" style="margin-right:6px">多标签匹配：</span>' +
          '<button type="button" class="wre-find-chip' + (ui.tagMode === 'and' ? ' is-active' : '') + '" data-wre-find-tagmode="and">同时命中(AND)</button>' +
          '<button type="button" class="wre-find-chip' + (ui.tagMode === 'or' ? ' is-active' : '') + '" data-wre-find-tagmode="or">任一命中(OR)</button>' +
          (ui.tags.length ? '<button type="button" class="wre-find-chip" data-wre-find-tagclear="1">清除已选(' + ui.tags.length + ')</button>' : '') +
        '</div>';
    }
    return '<div class="wre-find-section-title">按标签筛选</div>' + inner;
  }

  function buildToolbarHtml(total) {
    const contentOn = ui.withContent;
    const running = contentState.running;
    const progress = running
      ? '（正文检索中 ' + contentState.done + '/' + contentState.total + '…）'
      : '';
    const filtered = applyFilters().length;
    const countText = filtered === total
      ? ('共 ' + total + ' 本')
      : ('命中 ' + filtered + ' 本 · 共 ' + total + ' 本');
    return '<div class="wre-find-toolbar">' +
      '<div class="wre-find-count">' + countText + progress + '</div>' +
      '<div class="wre-find-actions">' +
        '<button type="button" class="wre-find-chip' + (contentOn ? ' is-active' : '') + '" data-wre-find-content="1">含划线/想法正文</button>' +
        (ui.keyword.trim()
          ? '<button type="button" class="wre-btn wre-btn-small" data-wre-find-run-content="1" title="在你所有「有笔记的书」里，搜你自己的划线 / 想法正文"' + (running ? ' disabled' : '') + '>' + (running ? '检索中…' : '搜我的划线/想法') + '</button>'
          : '') +
        (running ? '<button type="button" class="wre-btn wre-btn-small" data-wre-find-stop-content="1">停止</button>' : '') +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-find-refresh="1">刷新书架</button>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-find-export="1">导出 JSON</button>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-find-import-merge="1">导入(合并)</button>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-find-import-replace="1">导入(覆盖)</button>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-find-manager="1">' + (tagManagerOpen ? '收起标签管理' : '标签管理') + '</button>' +
      '</div>' +
    '</div>';
  }

  function buildTagManagerHtml() {
    if (!tagManagerOpen) {
      return '';
    }
    const tags = allTags();
    if (!tags.length) {
      return '<div class="wre-find-section-title">标签管理</div><div class="wre-find-note">还没有标签。</div>';
    }
    const rows = tags.map((t) => {
      if (tagEdit && tagEdit.tag === t.name) {
        const isRename = tagEdit.mode === 'rename';
        return '<div class="wre-find-tagrow-edit">' +
          '<span class="wre-find-tag-name">' + escapeHtml(t.name) + '</span>' +
          '<input type="text" class="wre-find-input" data-wre-find-tagedit-input="1" placeholder="' +
            (isRename ? '新标签名' : '合并到哪个标签') + '" autocomplete="off">' +
          '<button type="button" class="wre-btn wre-btn-small" data-wre-find-tagedit-ok="' + escapeHtml(t.name) + '" data-wre-find-tagedit-mode="' + tagEdit.mode + '">确定</button>' +
          '<button type="button" class="wre-btn wre-btn-small" data-wre-find-tagedit-cancel="1">取消</button>' +
        '</div>';
      }
      return '<div class="wre-find-tagrow">' +
        '<span class="wre-find-tag-name">' + escapeHtml(t.name) + ' <b>' + t.count + '</b></span>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-find-tag-rename="' + escapeHtml(t.name) + '">重命名</button>' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-find-tag-merge="' + escapeHtml(t.name) + '">合并…</button>' +
        '<button type="button" class="wre-btn wre-btn-small wre-btn-danger" data-wre-find-tag-delete="' + escapeHtml(t.name) + '">删除</button>' +
      '</div>';
    }).join('');
    return '<div class="wre-find-section-title">标签管理</div>' + rows +
      '<div class="wre-find-note">重命名 / 合并会同时更新「所有」挂了该标签的书；删除只移除标签、不删书。</div>';
  }

  function itemTagsHtml(item) {
    const itemTags = tagsOf(item.key);
    const tagChips = itemTags.map((t) =>
      '<span class="wre-find-booktag">' + escapeHtml(t) +
      '<button type="button" class="wre-find-tagx" data-wre-find-remove-tag="' + escapeHtml(t) +
      '" data-wre-find-remove-key="' + escapeHtml(item.key) + '" title="移除标签">×</button></span>').join('');
    return '<div class="wre-find-booktags">' + tagChips +
      '<input type="text" class="wre-find-taginput" list="wre-find-tag-suggest" placeholder="+ 加标签" ' +
      'data-wre-find-add-tag="' + escapeHtml(item.key) + '" data-wre-find-add-title="' + escapeHtml(item.title) +
      '" data-wre-find-add-author="' + escapeHtml(item.author || '') + '">' +
    '</div>';
  }

  function coverHtml(item) {
    let url = String(item.cover || '').trim();
    if (url.indexOf('//') === 0) {
      url = 'https:' + url;
    }
    if (isHttpUrl(url)) {
      return '<div class="wre-find-cover"><img src="' + escapeHtml(url) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>';
    }
    return '<div class="wre-find-cover wre-find-cover-empty"><span>📖</span></div>';
  }

  /** 书籍阅读进度条（仅书籍、进度 > 0 时显示） */
  function progressHtml(item) {
    if (item.kind !== 'book') {
      return '';
    }
    const p = Number(noteInfo(item.key).readingProgress) || 0;
    if (p <= 0) {
      return '';
    }
    const pct = Math.max(1, Math.min(100, Math.round(p)));
    return '<div class="wre-find-progress" title="阅读进度 ' + pct + '%">' +
      '<div class="wre-find-progress-bar"><span style="width:' + pct + '%"></span></div>' +
      '<span class="wre-find-progress-text">' + pct + '%</span></div>';
  }

  function buildItemHtml(item, index) {
    const status = itemStatus(item);
    const metaParts = [
      item.author,
      item.kind === 'album' ? '专辑 / 有声书' : item.category,
      item.kind === 'book' ? ('笔记 ' + noteTotal(item.key)) : '',
      item.readUpdateTime ? ('最近 ' + fmtDateTime(item.readUpdateTime)) : '',
    ].filter(Boolean);
    const badges = ['<span class="wre-find-badge">' + escapeHtml(statusLabel(status)) + '</span>'];
    if (item.isTop) { badges.push('<span class="wre-find-badge">置顶</span>'); }
    if (item.secret) { badges.push('<span class="wre-find-badge wre-find-badge-secret">私密</span>'); }

    const hit = contentMatched(item.key);
    const hitHtml = hit
      ? '<div class="wre-find-hit">命中' + escapeHtml(hit.type) + '：' + escapeHtml(String(hit.text).slice(0, 80)) + '</div>'
      : '';

    return '<li class="wre-find-item">' +
      coverHtml(item) +
      '<div class="wre-find-main">' +
        '<div class="wre-find-titleline">' +
          '<span class="wre-find-idx">' + (index + 1) + '</span>' +
          '<span class="wre-find-title">' + escapeHtml(item.title || '未命名') + '</span>' +
          badges.join('') +
          (item.deepLink || item.title
            ? '<button type="button" class="wre-find-open" data-wre-find-open="' + escapeHtml(item.deepLink || '') + '" data-wre-find-open-title="' + escapeHtml(item.title || '') + '">打开 ↗</button>'
            : '') +
        '</div>' +
        (metaParts.length ? '<div class="wre-find-meta">' + escapeHtml(metaParts.join(' · ')) + '</div>' : '') +
        progressHtml(item) +
        hitHtml +
        itemTagsHtml(item) +
      '</div>' +
    '</li>';
  }

  function buildListHtml() {
    const items = applyFilters();
    if (!items.length) {
      if (contentState.running) {
        return '<div class="wre-find-empty">正在检索划线 / 想法…（' + contentState.done + ' / ' + contentState.total + '）<br>命中会实时出现在这里，可随时点「停止」。</div>';
      }
      if (!hasActiveFilter()) {
        return '<div class="wre-find-empty">书架里没有可显示的书。</div>';
      }
      const kw = ui.keyword.trim();
      if (kw && !ui.withContent) {
        return '<div class="wre-find-empty">没有符合条件的书。' +
          '<div style="margin-top:10px">想搜「' + escapeHtml(kw) + '」在你<strong>划线 / 想法</strong>里的内容？' +
          '<div style="margin-top:10px"><button type="button" class="wre-btn wre-btn-small" data-wre-find-run-content="1">🔍 在划线/想法里搜「' + escapeHtml(kw) + '」</button></div>' +
          '<div class="wre-find-note" style="margin-top:8px">会在你所有「有笔记的书」里逐本查找，稍等片刻（可随时停止）。</div></div></div>';
      }
      return '<div class="wre-find-empty">没有符合条件的书。<br>试试放宽筛选，或清空搜索词。</div>';
    }
    const list = items.slice(0, shown).map((item, i) => buildItemHtml(item, i)).join('');
    const more = items.length > shown
      ? '<div class="wre-find-more"><button type="button" class="wre-btn wre-btn-small" data-wre-find-more="1">显示更多（还有 ' + (items.length - shown) + ' 本）</button></div>'
      : '';
    const title = (hasActiveFilter() ? '筛选结果' : '书架') + '（' + items.length + ' 本）';
    return '<div class="wre-find-section-title">' + title + '</div>' +
      '<ul class="wre-find-list">' + list + '</ul>' + more;
  }

  /** 列表区（随关键词 / 筛选变化而整体替换；不触碰搜索框，避免打断中文输入法） */
  function buildListAreaHtml() {
    if (shelfState === 'loading' || (shelfState === 'idle' && !shelf)) {
      return '<div class="wre-find-empty">正在读取书架…</div>';
    }
    if (shelfState === 'error') {
      return '<div class="wre-find-error">' + escapeHtml(shelfError || '书架数据未取到') +
        '<div style="margin-top:12px"><button type="button" class="wre-btn wre-btn-small" data-wre-find-refresh="1">重试</button></div></div>';
    }
    let html = '';
    if (notesState === 'error') {
      html += '<div class="wre-find-note">⚠️ 笔记数本次未取到，相关筛选可能不准；可点「刷新书架」重试。</div>';
    }
    return html + buildListHtml();
  }

  function buildToolbarAreaHtml() {
    return buildToolbarHtml(shelfItems().length) +
      (message ? '<div class="wre-find-message">' + escapeHtml(message) + '</div>' : '');
  }

  function buildBodyHtml() {
    const privacy = '<div class="wre-find-privacy">🔒 标签仅存本机（chrome.storage.local），不上传、不写回微信读书；官方接口为只读。</div>';

    if (!keyReady) {
      return privacy + '<div class="wre-find-empty">正在检查配置…</div>';
    }

    if (!keyStatus.hasKey) {
      return privacy +
        '<div class="wre-find-empty">找书要用到你的书架，需要先配置官方 API Key（wrk-）。' +
        '<div style="margin-top:12px"><button type="button" class="wre-btn" data-wre-find-goto-key="1">去配置 API Key</button></div></div>';
    }

    return privacy + buildSearchHtml() + buildTagFilterHtml() +
      '<div id="wre-find-toolbararea">' + buildToolbarAreaHtml() + '</div>' +
      '<div id="wre-find-listarea">' + buildListAreaHtml() + '</div>' +
      buildTagManagerHtml() +
      '<datalist id="wre-find-tag-suggest">' +
        allTags().map((t) => '<option value="' + escapeHtml(t.name) + '"></option>').join('') + '</datalist>' +
      '<input type="file" id="wre-find-import-input" accept="application/json,.json" style="display:none">' +
      '<div class="wre-find-note">' +
        (shelfFromCache ? '书架数据来自本机缓存（30 分钟内）。' : '书架数据为刚刚拉取。') +
        '标签是插件私有的，换电脑或清缓存前记得「导出 JSON」备份。</div>';
  }

  function render() {
    const overlay = document.getElementById('wre-find-modal');
    if (!overlay) {
      return;
    }
    const body = overlay.querySelector('#wre-find-body');
    if (!body) {
      return;
    }
    // 重绘会重建搜索框：先记住它的焦点与光标，重绘后还原，避免书架 / 笔记异步返回时
    // 把用户正在输入的搜索框打断（表现为「输入没反应，得点清空」）
    const prev = document.getElementById('wre-find-keyword');
    const wasFocused = !!(prev && prev === document.activeElement);
    const caret = wasFocused ? prev.selectionStart : null;
    body.innerHTML = buildBodyHtml();
    if (wasFocused) {
      const next = document.getElementById('wre-find-keyword');
      if (next) {
        next.focus();
        if (caret != null) {
          try { next.setSelectionRange(caret, caret); } catch (e) { /* 部分浏览器忽略 */ }
        }
      }
    }
  }

  /** 只替换工具条与列表两块（不重建搜索框），用于输入过滤与正文检索进度刷新 */
  function renderDynamic() {
    const toolbarArea = document.getElementById('wre-find-toolbararea');
    if (toolbarArea) {
      toolbarArea.innerHTML = buildToolbarAreaHtml();
    }
    const listArea = document.getElementById('wre-find-listarea');
    if (listArea) {
      listArea.innerHTML = buildListAreaHtml();
    }
  }

  // ---------- 面板 ----------

  function buildPanel(root) {
    const existing = root.querySelector('#wre-find-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay wre-find-overlay';
    overlay.id = 'wre-find-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-find-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">🔎 找书</span>' +
          '<button class="wre-modal-close" data-wre-find-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body wre-find-body" id="wre-find-body"></div>' +
      '</div>';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-find-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closePanel());
    }
    overlay.addEventListener('click', handleClick);
    overlay.addEventListener('input', handleInput);
    overlay.addEventListener('change', handleChange);
    overlay.addEventListener('keydown', handleKeydown);
    overlay.addEventListener('compositionend', (event) => {
      // 只处理搜索框：其它输入框（如加标签）组词结束不该触发列表重绘，以免打断输入
      if (event.target && event.target.id === 'wre-find-keyword') {
        onKeywordChanged();
      }
    });
    root.appendChild(overlay);
    return overlay;
  }

  async function openPanel() {
    root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    const overlay = buildPanel(root);
    // 与其它面板互斥：打开找书时收起同一容器内已展开的其它面板
    root.querySelectorAll('.wre-modal-overlay.wre-visible').forEach((el) => {
      if (el.id !== 'wre-find-modal') {
        el.classList.remove('wre-visible');
      }
    });
    overlay.classList.add('wre-visible');
    message = '';
    ui.keyword = '';   // 每次打开都从空搜索框开始，避免上次关键词残留导致「必须点清空才能重新搜」
    render();
    logFinder('info', '打开找书面板');
    await loadTags();
    render();
    await refreshKeyStatus();
    render();
    if (keyStatus.hasKey && shelfState !== 'loading' && !shelf) {
      loadData(false);
    }
  }

  function closePanel() {
    cancelContentSearch();
    const overlay = document.getElementById('wre-find-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  // ---------- 交互 ----------

  function onKeywordChanged() {
    // 关键词变化即取消进行中的正文检索（避免拉错数据），已缓存的命中一并清空
    cancelContentSearch();
    contentState.matched = {};
    renderDynamic();
  }

  function handleInput(event) {
    const target = event.target;
    if (!target) {
      return;
    }
    if (target.id === 'wre-find-keyword') {
      ui.keyword = target.value;
      if (event.isComposing) {
        return;   // 中文输入法组词中：不重绘，等 compositionend 再刷
      }
      onKeywordChanged();
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (!target) {
      return;
    }
    if (target.id === 'wre-find-import-input') {
      const file = target.files && target.files[0];
      const mode = target.getAttribute('data-mode') || 'merge';
      if (file) {
        importTagsFromFile(file, mode);
      }
    }
  }

  function handleKeydown(event) {
    const target = event.target;
    if (!target) {
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    if (target.hasAttribute && target.hasAttribute('data-wre-find-add-tag')) {
      event.preventDefault();
      const key = target.getAttribute('data-wre-find-add-tag');
      const title = target.getAttribute('data-wre-find-add-title') || '';
      const author = target.getAttribute('data-wre-find-add-author') || '';
      addTagTo({ key: key, title: title, author: author }, target.value);
      return;
    }
    if (target.hasAttribute && target.hasAttribute('data-wre-find-tagedit-input')) {
      event.preventDefault();
      const btn = document.querySelector('[data-wre-find-tagedit-ok]');
      if (btn) {
        confirmTagEdit(btn.getAttribute('data-wre-find-tagedit-ok'), btn.getAttribute('data-wre-find-tagedit-mode'), target.value);
      }
    }
  }

  function confirmTagEdit(tag, mode, value) {
    const next = String(value || '').trim();
    if (!next) {
      message = '请输入新的标签名。';
      render();
      return;
    }
    tagEdit = null;
    if (mode === 'merge') {
      mergeTag(tag, next);
    } else {
      renameTag(tag, next);
    }
  }

  function handleClick(event) {
    const target = event.target;
    if (!target || !target.closest) {
      return;
    }

    const gotoKey = target.closest('[data-wre-find-goto-key]');
    if (gotoKey) {
      closePanel();
      document.dispatchEvent(new Event('wre-open-key-settings'));
      return;
    }

    if (target.closest('[data-wre-find-clear]')) {
      ui.keyword = '';
      cancelContentSearch();
      contentState.matched = {};
      message = '';
      render();
      return;
    }

    const statusBtn = target.closest('[data-wre-find-status]');
    if (statusBtn) {
      ui.status = statusBtn.getAttribute('data-wre-find-status');
      shown = PAGE_SIZE;
      message = '';
      render();
      return;
    }
    const notesBtn = target.closest('[data-wre-find-notes]');
    if (notesBtn) {
      ui.notes = notesBtn.getAttribute('data-wre-find-notes');
      shown = PAGE_SIZE;
      message = '';
      render();
      return;
    }
    const recentBtn = target.closest('[data-wre-find-recent]');
    if (recentBtn) {
      ui.recent = recentBtn.getAttribute('data-wre-find-recent');
      shown = PAGE_SIZE;
      message = '';
      render();
      return;
    }

    const tagBtn = target.closest('[data-wre-find-tag]');
    if (tagBtn) {
      const tag = tagBtn.getAttribute('data-wre-find-tag');
      const idx = ui.tags.indexOf(tag);
      if (idx >= 0) {
        ui.tags.splice(idx, 1);
      } else {
        ui.tags.push(tag);
      }
      shown = PAGE_SIZE;
      message = '';
      render();
      return;
    }
    const tagModeBtn = target.closest('[data-wre-find-tagmode]');
    if (tagModeBtn) {
      ui.tagMode = tagModeBtn.getAttribute('data-wre-find-tagmode');
      render();
      return;
    }
    if (target.closest('[data-wre-find-tagclear]')) {
      ui.tags = [];
      render();
      return;
    }

    const contentBtn = target.closest('[data-wre-find-content]');
    if (contentBtn) {
      ui.withContent = !ui.withContent;
      if (!ui.withContent) {
        cancelContentSearch();
        contentState.matched = {};
      }
      message = '';
      render();
      return;
    }
    if (target.closest('[data-wre-find-run-content]')) {
      // 一键开始：自动打开「含划线/想法正文」开关再检索，避免两步操作被漏掉
      if (!ui.withContent) {
        ui.withContent = true;
      }
      runContentSearch();
      return;
    }
    if (target.closest('[data-wre-find-stop-content]')) {
      cancelContentSearch();
      message = '已停止正文检索。';
      render();
      return;
    }

    if (target.closest('[data-wre-find-refresh]')) {
      message = '';
      loadData(true);
      return;
    }
    if (target.closest('[data-wre-find-export]')) {
      exportTags();
      return;
    }
    if (target.closest('[data-wre-find-import-merge]')) {
      triggerImport('merge');
      return;
    }
    if (target.closest('[data-wre-find-import-replace]')) {
      triggerImport('replace');
      return;
    }
    if (target.closest('[data-wre-find-manager]')) {
      tagManagerOpen = !tagManagerOpen;
      tagEdit = null;
      render();
      return;
    }
    if (target.closest('[data-wre-find-more]')) {
      shown += PAGE_SIZE;
      render();
      return;
    }

    // 标签管理：重命名 / 合并 / 删除
    const renameBtn = target.closest('[data-wre-find-tag-rename]');
    if (renameBtn) {
      tagEdit = { tag: renameBtn.getAttribute('data-wre-find-tag-rename'), mode: 'rename' };
      render();
      return;
    }
    const mergeBtn = target.closest('[data-wre-find-tag-merge]');
    if (mergeBtn) {
      tagEdit = { tag: mergeBtn.getAttribute('data-wre-find-tag-merge'), mode: 'merge' };
      render();
      return;
    }
    const delBtn = target.closest('[data-wre-find-tag-delete]');
    if (delBtn) {
      deleteTag(delBtn.getAttribute('data-wre-find-tag-delete'));
      return;
    }
    if (target.closest('[data-wre-find-tagedit-cancel]')) {
      tagEdit = null;
      render();
      return;
    }
    const okBtn = target.closest('[data-wre-find-tagedit-ok]');
    if (okBtn) {
      const input = document.querySelector('[data-wre-find-tagedit-input]');
      confirmTagEdit(okBtn.getAttribute('data-wre-find-tagedit-ok'), okBtn.getAttribute('data-wre-find-tagedit-mode'), input ? input.value : '');
      return;
    }

    // 移除某本书的标签
    const removeBtn = target.closest('[data-wre-find-remove-tag]');
    if (removeBtn) {
      const key = removeBtn.getAttribute('data-wre-find-remove-key');
      const tag = removeBtn.getAttribute('data-wre-find-remove-tag');
      const item = shelfItems().find((it) => it.key === key);
      removeTagFrom(item || { key: key }, tag);
      return;
    }

    // 打开书籍
    const openBtn = target.closest('[data-wre-find-open]');
    if (openBtn) {
      openBookLink(openBtn.getAttribute('data-wre-find-open-title'), openBtn.getAttribute('data-wre-find-open'));
      return;
    }
  }

  // ---------- 菜单入口 ----------

  function injectMenuEntry(rootEl) {
    const menu = rootEl.querySelector('#wre-main-menu');
    if (!menu || menu.querySelector('[data-wre-find-entry]')) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'finder');
    item.setAttribute('data-wre-find-entry', '1');
    item.title = '用标签与多维度搜索，快速找到书架里的书';
    item.innerHTML = '<span class="wre-menu-icon">🔎</span>找书';
    item.addEventListener('click', () => openPanel());
    const anchor = menu.querySelector('[data-wre-official-entry]') ||
      menu.querySelector('[data-wre-notes-entry]') ||
      menu.querySelector('[data-wre-stats-entry]') ||
      menu.querySelector('[data-action="read-settings"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else {
      menu.appendChild(item);
    }
    logFinder('info', '已注入「找书」菜单入口');
  }

  // ---------- 启动 ----------

  function bootstrap() {
    const existing = document.getElementById('we-read-enhancer-root');
    if (existing) {
      injectMenuEntry(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const rootEl = document.getElementById('we-read-enhancer-root');
      if (rootEl) {
        observer.disconnect();
        injectMenuEntry(rootEl);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    logFinder('debug', '等待插件根容器出现后接入找书模块');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
