/**
 * 微信悦读 · 笔记增强模块（v0.11.0）
 *
 * 定位：独立模块，不改动 content.js 既有逻辑。通过 manifest 的 content_scripts
 * 在 content.js 之前加载，与 content.js 共享同一个隔离世界（isolated world），
 * 可直接复用 content.js 的全局函数（如 log）与 #we-read-enhancer-root 容器。
 *
 * 职责：
 *   0. Key 必选：读取划线/想法依赖「官方 API Key」（wrk- 开头）。未配置或已失效时
 *      不再尝试其它来源，面板直接进入「引导态」，并一键跳转到「🔑 API Key」设置入口。
 *   1. 数据获取：优先微信读书「同源接口」（用你自己的登录态，数据不外传），
 *      接口不可用时回退「页面抓取」，并在面板上明示数据来源
 *   2. 面板：主菜单「📝 笔记」入口，按章节分组展示本书划线、想法与批注；内置搜索框，
 *      输入关键词实时过滤（命中章节名整组保留，否则按「摘要 + 正文」逐条匹配），便于定位某条笔记
 *   3. 导出：Markdown / 纯文本 / HTML / PDF（打印视图），样式与「阅读统计」报表同一套
 *   4. 复制笔记：一次复制全文（剪贴板同时带「富文本」与「干净纯文本」——粘到富文本编辑器
 *      用前者保留排版，粘到记事本/微信等纯文本场景用后者，纯文本不含 Markdown 符号）
 *   5. 选中即复制：选中正文文字后在选区旁显示「复制」浮标，一键复制
 *   6. Ctrl/Cmd+C 增强：拦截 copy 事件，清掉官方附加的版权声明（水印）
 *
 * 数据来源说明（重要，优先级由高到低）：
 *   1. 官方 Agent 网关（推荐，需先在「🔑 API Key」入口配好 wrk- Key）：
 *        POST https://i.weread.qq.com/api/agent/gateway（由 background.js 代发）
 *        api_name=/book/bookmarklist（划线）
 *        api_name=/review/list/mine（想法/批注，注意参数是小写 bookid）
 *   2. 微信读书网页同源接口（备用，走浏览器登录 Cookie，可能被反爬拦截）：
 *        GET  /web/book/bookmarklist?bookId=<id>
 *        GET  /web/review/list?bookId=<id>&listType=11&mine=1&synckey=0&listMode=1
 *        POST /web/book/chapterInfos      （用于拿章节名与章节顺序）
 *   3. 页面抓取（最后兜底，只能拿到当前已渲染内容，可能不完整）
 *   - 不向任何第三方服务器发送数据；面板数据只在内存里缓存 5 分钟，不落盘。
 */
(function () {
  'use strict';

  const NOTES_CACHE_TTL = 5 * 60 * 1000; // 面板数据内存缓存时长
  // 阅读页 URL 形如 /web/reader/{bookId}k{chapterHash}，需整体捕获后再切出 bookId
  const READER_SEGMENT_RE = /\/web\/reader\/([^/?#]+)/;
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
  let searchQuery = ''; // 笔记搜索关键词（实时过滤划线/想法）
  let searchComposing = false; // 输入法（IME）组合态标记：组合期间不重绘，避免打断中文输入
  let panelState = { loading: false, error: '', emptyReason: '', needsKey: '', data: null };

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

  // ---------- 数据层：官方 Agent 网关（已配置 wrk- Key 时优先） ----------

  // 与后台 service worker 通信：Key 与网关请求都只在后台发生，内容脚本拿不到 Key
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

  // Key 必选：判断后台返回是否属于「Key 缺失/失效」这类必须先去配置的错误
  //   code 'nokey' → 从未配置；code 'auth' → HTTP 401/403，Key 无效或已失效
  function isKeyError(result) {
    return !!result && (result.code === 'nokey' || result.code === 'auth');
  }

  // 跳转到「🔑 API Key」设置入口：跨模块用 document 自定义事件解耦，
  // 由 modules/official.js 监听并打开 Key 面板（不模拟点击、不暴露全局函数）
  function openOfficialKeySettings() {
    logNotes('info', '引导用户前往「🔑 API Key」配置 API Key');
    document.dispatchEvent(new CustomEvent('wre-open-key-settings'));
    closePanel();
  }

  // 官方网关的章节表：chapters[{ chapterUid, chapterIdx, title }]
  function buildChapterMapFromOfficial(chapters) {
    const map = {};
    (Array.isArray(chapters) ? chapters : []).forEach((chapter, index) => {
      if (chapter && chapter.chapterUid != null) {
        map[String(chapter.chapterUid)] = {
          name: chapter.title || chapter.chapterName || '',
          index: chapter.chapterIdx != null ? chapter.chapterIdx : index,
        };
      }
    });
    return map;
  }

  // 用书名反查官方 bookId（/store/search）。网页阅读页 URL 里的 ID 与官方接口的 bookId
  // 可能属于两套编号，直接用 URL 里的 ID 调笔记接口会回 -2003「参数格式错误」。
  async function resolveOfficialBookId(title) {
    const keyword = String(title || '').trim();
    if (!keyword) {
      return '';
    }
    const res = await sendBg({
      type: 'wre-official-call',
      apiName: '/store/search',
      params: { keyword: keyword, scope: 10 },
    });
    if (!res.ok || !res.data) {
      logNotes('warn', '官方 bookId 反查失败', { keyword, code: res.code || '', error: res.error || '' });
      return '';
    }
    const candidates = [];
    pickArrayDeep(res.data, '', ['results']).forEach((group) => {
      pickArrayDeep(group, '', ['books']).forEach((entry) => {
        const info = (entry && entry.bookInfo) || entry || {};
        if (info.bookId) {
          candidates.push({ bookId: info.bookId, title: info.title || '' });
        }
      });
    });
    logNotes('info', '官方 bookId 反查结果', { keyword, candidates: candidates.slice(0, 3) });
    if (candidates.length === 0) {
      return '';
    }
    // 优先取书名对得上的那本，避免搜到同名/相似书导致取错笔记
    const exact = candidates.find((item) => item.title && (
      item.title === keyword || item.title.indexOf(keyword) === 0 || keyword.indexOf(item.title) === 0
    ));
    return (exact || candidates[0]).bookId;
  }

  // /review/list/mine 是分页接口（默认每页 20 条），循环取完，避免想法多于 20 条时被截断
  async function fetchOfficialReviews(bookId) {
    const items = [];
    let synckey = 0;
    let more = true;
    let lastData = null;
    for (let page = 0; page < 10 && more; page += 1) {
      const res = await sendBg({
        type: 'wre-official-call',
        apiName: '/review/list/mine',
        params: { bookid: bookId, synckey: synckey, count: 50 },
      });
      if (!res.ok || !res.data) {
        return { ok: items.length > 0, items: items, keys: [], code: res.code || '', error: res.error || '' };
      }
      pickArrayDeep(res.data, bookId, ['reviews']).forEach((item) => items.push(item));
      synckey = res.data.synckey != null ? res.data.synckey : synckey;
      more = Number(res.data.hasMore) === 1;
      lastData = res.data;
    }
    return { ok: true, items: items, keys: lastData ? Object.keys(lastData) : [], code: '', error: '' };
  }

  // 尝试走官方网关取本书笔记。
  //   - Key 缺失/失效 → 返回 { __needsKey: 'missing'|'invalid' }，由上层转「引导态」
  //   - 其它失败或取不到任何数据 → 返回 null，交给网页同源接口 / 页面抓取兜底
  async function fetchBookNotesViaOfficial(bookId) {
    const status = await sendBg({ type: 'wre-official-status' });
    if (!status.ok || !status.hasKey) {
      return { __needsKey: 'missing' }; // 没配 Key：Key 必选，交由上层引导配置
    }

    // 官方易错点：划线接口参数是驼峰 bookId，想法接口参数是小写 bookid
    const withBookId = async (id) => {
      const [b, r] = await Promise.all([
        sendBg({ type: 'wre-official-call', apiName: '/book/bookmarklist', params: { bookId: id } }),
        fetchOfficialReviews(id),
      ]);
      return { b: b, r: r };
    };

    let attempt = await withBookId(bookId);
    let usedBookId = bookId;
    if (isKeyError(attempt.b) || isKeyError(attempt.r)) {
      // Key 缺失/失效不属于「bookId 不对」，反查重试没有意义，直接引导去配置
      logNotes('warn', '官方网关鉴权失败（Key 缺失或失效），引导去配置', {
        bookmark: { code: attempt.b.code, error: attempt.b.error },
        review: { code: attempt.r.code, error: attempt.r.error },
      });
      const missing = attempt.b.code === 'nokey' || attempt.r.code === 'nokey';
      return { __needsKey: missing ? 'missing' : 'invalid' };
    }
    if (!attempt.b.ok && !attempt.r.ok) {
      logNotes('warn', '官方网关取笔记失败，尝试用书名反查 bookId 后重试', {
        bookId,
        bookmark: { code: attempt.b.code, error: attempt.b.error, snippet: attempt.b.snippet || '' },
        review: { code: attempt.r.code, error: attempt.r.error, snippet: attempt.r.snippet || '' },
      });
      const altBookId = await resolveOfficialBookId(getBookTitle());
      if (altBookId && altBookId !== bookId) {
        const retry = await withBookId(altBookId);
        logNotes('info', '官方 bookId 反查重试结果', {
          urlBookId: bookId,
          altBookId,
          bookmarkOk: retry.b.ok,
          reviewOk: retry.r.ok,
          bookmarkError: retry.b.ok ? '' : (retry.b.error || ''),
          reviewError: retry.r.ok ? '' : (retry.r.error || ''),
        });
        if (retry.b.ok || retry.r.ok) {
          attempt = retry;
          usedBookId = altBookId;
        }
      }
    }

    const bookmarkRes = attempt.b;
    const reviewRes = attempt.r;
    if (isKeyError(bookmarkRes) || isKeyError(reviewRes)) {
      const missing = bookmarkRes.code === 'nokey' || reviewRes.code === 'nokey';
      logNotes('warn', '官方网关鉴权失败（重试后仍失败），引导去配置');
      return { __needsKey: missing ? 'missing' : 'invalid' };
    }
    if (!bookmarkRes.ok && !reviewRes.ok) {
      logNotes('warn', '官方网关两个接口均不可用，回退网页接口', { bookId });
      return null;
    }

    const bookmarkData = bookmarkRes.ok ? bookmarkRes.data : null;
    const highlights = pickArrayDeep(bookmarkData, usedBookId, ['updated', 'bookmarks', 'bookmarkList'])
      .map(normalizeBookmark)
      .filter(Boolean);
    const thoughts = (reviewRes.items || [])
      .map(normalizeReview)
      .filter(Boolean);

    logNotes('info', '官方网关取笔记完成', {
      requestedBookId: bookId,
      usedBookId,
      highlights: highlights.length,
      thoughts: thoughts.length,
      chapterCount: bookmarkData && Array.isArray(bookmarkData.chapters) ? bookmarkData.chapters.length : 0,
      bookmarkKeys: bookmarkData ? Object.keys(bookmarkData) : [],
      reviewKeys: reviewRes.keys || [],
    });

    if (highlights.length === 0 && thoughts.length === 0 && (!bookmarkRes.ok || !reviewRes.ok)) {
      // 有接口失败且没取到任何数据 → 无法判断是「真没笔记」还是「取失败」，交旧路兜底
      return null;
    }

    return {
      source: 'official',
      sourceNote: '数据来自微信读书官方网关（用你自己的 API Key 读取，只存本机、不外传）' +
        (bookmarkRes.ok && reviewRes.ok ? '' : '；有一项数据本次未取到，可能不完整'),
      highlights,
      thoughts,
      chapterMap: buildChapterMapFromOfficial(bookmarkData && bookmarkData.chapters),
    };
  }

  async function fetchBookNotes(bookId) {
    // 1) 优先官方网关（Key 必选；缺失/失效时抛 needsKey，由上层转「引导态」）
    const official = await fetchBookNotesViaOfficial(bookId);
    if (official && official.__needsKey) {
      const err = new Error('需要先配置或更新 API Key');
      err.code = 'needsKey';
      err.reason = official.__needsKey;
      throw err;
    }
    if (official) {
      return official;
    }

    // 2) 回退网页同源接口
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
    panelState.needsKey = '';
    if (!context.bookId) {
      panelState.data = null;
      panelState.loading = false;
      panelState.emptyReason = '当前不在微信读书阅读页，先打开一本书的阅读页再来～';
      renderPanel();
      return null;
    }
    // Key 必选：先确认已配置 API Key，未配置直接进「引导态」，不尝试网页/抓取兜底
    const keyStatus = await sendBg({ type: 'wre-official-status' });
    if (!keyStatus.ok || !keyStatus.hasKey) {
      panelState.data = null;
      panelState.loading = false;
      panelState.needsKey = 'missing';
      renderPanel();
      logNotes('warn', '未配置官方 API Key，拦截笔记读取并引导去配置');
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
      if (error && error.code === 'needsKey') {
        panelState.loading = false;
        panelState.data = null;
        panelState.needsKey = error.reason || 'invalid';
        renderPanel();
        logNotes('warn', '官方 API Key 失效，已拦截笔记读取并引导重新配置', { reason: error.reason || '' });
        return null;
      }
      if (error && error.code === 'unauthorized') {
        panelState.loading = false;
        panelState.data = null;
        panelState.error = '接口返回未登录：请先在微信读书网页版登录，再点「刷新」重试。';
        renderPanel();
        logNotes('warn', '笔记接口未登录', { bookId: context.bookId });
        return null;
      }
      data = scrapeDomNotes();
      logNotes('warn', '官方网关与网页接口都不可用，已回退页面抓取（可能不完整）', {
        bookId: context.bookId,
        error: error && error.message ? String(error.message) : String(error),
      });
      // Key 已配置却仍失败：多为网关临时抖动或 bookId 反查失败，提示去「🔑 API Key」检查 Key
      data.sourceNote = '官方网关与网页接口本次都不可用，已回退「页面抓取」，只能拿到当前已渲染的内容。' +
        '可到「🔑 API Key」检查 API Key 状态后点「重新检测」。';
      data.needKeyHint = true;
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
    const anchor = menu.querySelector('[data-wre-stats-entry]') || menu.querySelector('[data-action="read-settings"]');
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
      body.addEventListener('input', handlePanelInput);
      // 输入法组合态标记：组合期间不重绘，组合结束后再统一过滤，保证中文可正常输入
      body.addEventListener('compositionstart', (event) => {
        if (event.target && event.target.closest && event.target.closest('[data-wre-notes-search]')) {
          searchComposing = true;
        }
      });
      body.addEventListener('compositionend', (event) => {
        const target = event.target;
        if (target && target.closest && target.closest('[data-wre-notes-search]')) {
          searchComposing = false;
          applySearch(target.value);
        } else {
          searchComposing = false;
        }
      });
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
    searchQuery = '';
    renderPanel();
    logNotes('info', '打开笔记面板');
    loadNotes(false).catch((error) => {
      logNotes('error', '读取笔记失败', { error: String(error && error.message ? error.message : error) });
    });
  }

  function closePanel() {
    stopTts();
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
    const ttsOk = !!ttsApi();
    const listenActions = data && ttsOk
      ? '<button class="wre-btn wre-btn-small" data-wre-notes-listen-all title="按当前列表顺序连续朗读">▶ 连续朗读</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-notes-listen-book title="把本书的划线 / 想法排队朗读">▶ 听全部</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-notes-listen-thoughts title="只朗读自己写的想法 / 批注">▶ 只听想法</button>'
      : '';
    const ttsNote = ttsOk
      ? (data ? '<div class="wre-notes-note">🔊 朗读在本机合成，不联网、不上传；不提供音频导出。</div>' : '')
      : '<div class="wre-notes-note">当前浏览器不支持本机语音朗读，「听」相关功能不可用。</div>';
    return '<div class="wre-notes-toolbar">' +
        '<div class="wre-notes-summary">' + (data
          ? '《' + escapeHtml(data.title || '未知书籍') + '》 · 划线 ' + highlightCount + ' 条 · 想法 ' + thoughtCount + ' 条'
          : '正在读取…') + '</div>' +
        '<div class="wre-notes-actions">' +
          listenActions +
          '<button class="wre-btn wre-btn-small" data-wre-notes-refresh>刷新</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-copy>复制笔记</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-export="markdown">导出 Markdown</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-export="html">导出 HTML</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-export="pdf">导出 PDF</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-export="text">导出纯文本</button>' +
        '</div>' +
        ttsNote +
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

  function renderSearchBar() {
    return '<div class="wre-notes-search">' +
        '<input type="text" class="wre-notes-search-input" data-wre-notes-search ' +
          'placeholder="搜索划线 / 想法内容…" autocomplete="off" spellcheck="false" value="' + escapeHtml(searchQuery) + '">' +
        (searchQuery
          ? '<button class="wre-notes-search-clear" data-wre-notes-search-clear title="清空搜索">×</button>'
          : '') +
      '</div>';
  }

  // 按关键词过滤分组：章节名命中 → 该章节整组保留；否则按「摘要 + 正文」逐条匹配
  function filterGroups(groups) {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) {
      return { groups: groups, matched: 0, active: false };
    }
    const result = [];
    let matched = 0;
    groups.forEach((group) => {
      if (group.name.toLowerCase().indexOf(keyword) !== -1) {
        result.push(group);
        matched += group.items.length;
        return;
      }
      const items = group.items.filter((item) => {
        return ((item.abstract || '') + ' ' + (item.text || '')).toLowerCase().indexOf(keyword) !== -1;
      });
      if (items.length > 0) {
        result.push(Object.assign({}, group, { items: items }));
        matched += items.length;
      }
    });
    return { groups: result, matched: matched, active: true };
  }

  // ---------- 语音复习（M14，见 modules/tts.js）----------

  function ttsApi() {
    const api = typeof window !== 'undefined' ? window.WRETTS : null;
    return api && api.supported ? api : null;
  }

  // 从已渲染的条目标签里取朗读文本（只取正文，不含时间 / 按钮）
  function itemSpeechText(itemEl) {
    if (!itemEl || !itemEl.querySelectorAll) {
      return '';
    }
    const parts = [];
    Array.prototype.forEach.call(
      itemEl.querySelectorAll('.wre-notes-quote, .wre-notes-thought, .wre-notes-text'),
      (node) => {
        const text = (node.textContent || '').trim();
        if (text) {
          parts.push(text);
        }
      }
    );
    return parts.join('。');
  }

  // 从数据条目里取朗读文本（用于「听全部 / 只听想法」这类当前页签之外的内容）
  function speechTextFromItem(item) {
    if (!item) {
      return '';
    }
    const parts = [];
    if (item.kind === 'thought') {
      if (item.abstract) {
        parts.push(String(item.abstract).trim());
      }
      if (item.text) {
        parts.push(String(item.text).trim());
      }
    } else if (item.text) {
      parts.push(String(item.text).trim());
    }
    return parts.filter(Boolean).join('。');
  }

  function flattenGroupsToQueue(groups) {
    const queue = [];
    (groups || []).forEach((group) => {
      const items = group && group.items ? group.items : [];
      items.forEach((item) => {
        const text = speechTextFromItem(item);
        if (text) {
          queue.push({ text: text, element: null });
        }
      });
    });
    return queue;
  }

  // 当前列表（含搜索过滤 / 当前页签）的可见条目，按 DOM 顺序
  function collectVisibleQueue() {
    const body = document.querySelector('#wre-notes-body');
    if (!body) {
      return [];
    }
    const queue = [];
    Array.prototype.forEach.call(body.querySelectorAll('.wre-notes-item'), (el) => {
      const text = itemSpeechText(el);
      if (text) {
        queue.push({ text: text, element: el });
      }
    });
    return queue;
  }

  function stopTts() {
    if (typeof window !== 'undefined' && window.WRETTS && typeof window.WRETTS.stop === 'function') {
      window.WRETTS.stop();
    }
  }

  function renderGroups(groups, emptyText) {
    if (groups.length === 0) {
      return '<div class="wre-notes-empty">' + emptyText + '</div>';
    }
    const listenBtn = ttsApi()
      ? '<button class="wre-notes-listen" data-wre-notes-listen title="朗读这一条（本机朗读，不联网、不上传）">▶</button>'
      : '';
    return groups.map((group) => {
      const items = group.items.map((item) => {
        if (item.kind === 'thought') {
          return '<div class="wre-notes-item is-thought">' + listenBtn +
              (item.abstract ? '<div class="wre-notes-quote">' + escapeHtml(item.abstract) + '</div>' : '') +
              '<div class="wre-notes-thought">' + escapeHtml(item.text) + '</div>' +
              '<div class="wre-notes-meta">' + escapeHtml(formatDateTime(item.createTime)) + '</div>' +
            '</div>';
        }
        return '<div class="wre-notes-item">' + listenBtn +
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

  // 「引导态」：Key 未配置或已失效时的拦截视图，一键跳去「🔑 API Key」设置入口
  function renderKeyGuide(reason) {
    const invalid = reason === 'invalid';
    const title = invalid ? '⚠️ API Key 已失效' : '🔑 需要先配置 API Key';
    const text = invalid
      ? '本机保存的 API Key 未能通过官方校验（可能已过期或被重置）。请到「🔑 API Key」重新填写后再回来使用笔记功能。'
      : '读取本书的划线 / 想法需要「微信读书官方 API Key」（wrk- 开头）。配置一次即可长期使用，Key 只保存在本机、不会上传。';
    return '<div class="wre-notes-guide">' +
        '<div class="wre-notes-guide-title">' + title + '</div>' +
        '<div class="wre-notes-guide-text">' + escapeHtml(text) + '</div>' +
        '<div class="wre-notes-guide-actions">' +
          '<button class="wre-btn" data-wre-notes-goto-key>🔑 去配置 Key</button>' +
          '<button class="wre-btn wre-btn-small" data-wre-notes-recheck>我已配置，重新检测</button>' +
        '</div>' +
        '<div class="wre-notes-note">获取方式：微信读书 App →「微信读书 Skill」页面 → 复制 wrk- 开头的 API Key。</div>' +
      '</div>';
  }

  function renderPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    const body = root ? root.querySelector('#wre-notes-body') : null;
    if (!body) {
      return;
    }
    // 列表重绘（切换页签 / 搜索 / 刷新）会让朗读中的条目引用失效，先停止播放
    stopTts();
    const data = panelState.data || (cache.data && cache.bookId === getBookContext().bookId ? cache.data : null);

    if (panelState.needsKey) {
      body.innerHTML = renderKeyGuide(panelState.needsKey);
      return;
    }

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
    const allGroups = panelTab === 'thoughts' ? data.thoughtGroups : data.highlightGroups;
    const filtered = filterGroups(allGroups);
    const baseEmptyText = panelTab === 'thoughts'
      ? '这本书还没有想法/批注～'
      : '这本书还没有划线～';

    let groupHtml;
    if (filtered.active && filtered.groups.length === 0) {
      groupHtml = '<div class="wre-notes-empty">没有找到包含「' + escapeHtml(searchQuery.trim()) + '」的' +
        (panelTab === 'thoughts' ? '想法/批注' : '划线') + '</div>';
    } else {
      groupHtml = renderGroups(filtered.groups, baseEmptyText) +
        (filtered.active
          ? '<div class="wre-notes-note">找到 ' + filtered.matched + ' 条匹配</div>'
          : '');
    }

    body.innerHTML = renderToolbar(data) +
      renderSearchBar() +
      renderTabs(data) +
      (data.source === 'dom' || data.source === 'mixed'
        ? '<div class="wre-notes-warn">' + escapeHtml(data.sourceNote) +
          (data.needKeyHint
            ? '<div class="wre-notes-warn-actions"><button class="wre-btn wre-btn-small" data-wre-notes-goto-key>🔑 去配置 Key</button></div>'
            : '') +
          '</div>'
        : '') +
      groupHtml +
      '<div class="wre-notes-note">' + escapeHtml(data.sourceNote || '') + '</div>';
    body.scrollTop = scrollTop;
  }

  // 应用搜索关键词并重绘，重绘后恢复焦点与光标位置（避免每次击键失焦）
  function applySearch(rawValue) {
    searchQuery = rawValue;
    renderPanel();
    const box = document.querySelector('[data-wre-notes-search]');
    if (box) {
      box.focus();
      const caret = searchQuery.length;
      try {
        box.setSelectionRange(caret, caret);
      } catch (err) {
        /* 部分输入框不支持 setSelectionRange，忽略 */
      }
    }
  }

  // 搜索框实时输入：更新关键词并重绘
  // 注意：输入法（中文等）组合期间不能重绘——重绘会替换 input 元素、打断组合态，导致中文无法上屏
  function handlePanelInput(event) {
    const input = event.target;
    if (!input || !input.closest || !input.closest('[data-wre-notes-search]')) {
      return;
    }
    if (searchComposing || event.isComposing) {
      return;
    }
    applySearch(input.value);
  }

  function handlePanelClick(event) {
    const tts = ttsApi();
    if (tts) {
      const listenBtn = event.target.closest('[data-wre-notes-listen]');
      if (listenBtn) {
        const itemEl = listenBtn.closest('.wre-notes-item');
        const text = itemSpeechText(itemEl);
        if (text) {
          tts.playOne(text, itemEl);
        }
        return;
      }
      if (event.target.closest('[data-wre-notes-listen-all]')) {
        const queue = collectVisibleQueue();
        if (queue.length) {
          tts.playList(queue);
        } else {
          toast('当前列表没有可朗读的内容');
        }
        return;
      }
      if (event.target.closest('[data-wre-notes-listen-book]')) {
        const data = currentData();
        const queue = data ? flattenGroupsToQueue([].concat(data.highlightGroups || [], data.thoughtGroups || [])) : [];
        if (queue.length) {
          tts.playList(queue);
        } else {
          toast('这本书还没有可朗读的笔记');
        }
        return;
      }
      if (event.target.closest('[data-wre-notes-listen-thoughts]')) {
        const data = currentData();
        const queue = data ? flattenGroupsToQueue(data.thoughtGroups || []) : [];
        if (queue.length) {
          tts.playList(queue);
        } else {
          toast('这本书还没有想法/批注');
        }
        return;
      }
    }
    if (event.target.closest('[data-wre-notes-search-clear]')) {
      searchQuery = '';
      renderPanel();
      const box = document.querySelector('[data-wre-notes-search]');
      if (box) {
        box.focus();
      }
      return;
    }
    if (event.target.closest('[data-wre-notes-goto-key]')) {
      openOfficialKeySettings();
      return;
    }
    if (event.target.closest('[data-wre-notes-recheck]')) {
      cache = { bookId: null, at: 0, data: null };
      loadNotes(true).catch((error) => {
        logNotes('error', '重新检测 Key 后读取失败', { error: String(error && error.message ? error.message : error) });
      });
      return;
    }
    const refresh = event.target.closest('[data-wre-notes-refresh]');
    if (refresh) {
      cache = { bookId: null, at: 0, data: null };
      loadNotes(true).catch((error) => {
        logNotes('error', '刷新笔记失败', { error: String(error && error.message ? error.message : error) });
      });
      return;
    }
    const copyBtn = event.target.closest('[data-wre-notes-copy]');
    if (copyBtn) {
      handleCopyNotes();
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
  }

  // ---------- 导出 ----------

  function currentData() {
    return panelState.data || (cache.data && cache.bookId === getBookContext().bookId ? cache.data : null);
  }

  // 复制 / 导出用的数据：处于搜索态时只作用于当前搜索结果，未搜索时等同完整数据
  function currentFilteredData() {
    const data = currentData();
    if (!data || !searchQuery.trim()) {
      return data;
    }
    const flatten = (groups) => groups.reduce((acc, group) => acc.concat(group.items), []);
    const highlightGroups = filterGroups(data.highlightGroups || []).groups;
    const thoughtGroups = filterGroups(data.thoughtGroups || []).groups;
    return Object.assign({}, data, {
      highlightGroups: highlightGroups,
      thoughtGroups: thoughtGroups,
      highlights: flatten(highlightGroups),
      thoughts: flatten(thoughtGroups)
    });
  }

  function sourceLabel(data) {
    if (data.source === 'official') {
      return '微信读书官方网关（本地读取）';
    }
    if (data.source === 'api') {
      return '微信读书接口（本地读取）';
    }
    return '页面抓取（可能不完整）';
  }

  function escapeMultiline(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function buildMarkdown(data) {
    const lines = [];
    lines.push('# 《' + (data.title || '未知书籍') + '》读书笔记');
    lines.push('');
    lines.push('- 导出时间：' + formatDateTime(Date.now()));
    lines.push('- 数据来源：' + sourceLabel(data));
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

  // ---------- 复制 / 导出 HTML / 导出 PDF ----------

  // 导出样式：与「阅读统计」报表保持同一套视觉语言（绿色主色 / 卡片 / 打印优化）
  function notesReportStyles() {
    return [
      ':root{--accent:#07c160;--accent-soft:#e8f8ef;--ink:#1f2328;--ink-2:#5b6570;--line:#e8ebe9;--bg:#f4f6f5}',
      '*{box-sizing:border-box}',
      'html,body{margin:0;padding:0}',
      'body{background:var(--bg);color:var(--ink);font:14px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      '.page{max-width:820px;margin:32px auto;padding:40px 44px;background:#fff;border-radius:18px;box-shadow:0 12px 32px rgba(17,24,28,.08)}',
      '.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:22px;border-bottom:2px solid var(--line)}',
      '.hero h1{margin:0;font-size:24px;line-height:1.4;letter-spacing:.3px}',
      '.hero h1::before{content:"";display:inline-block;width:10px;height:22px;margin-right:10px;border-radius:3px;background:var(--accent);vertical-align:-2px}',
      '.hero .sub{margin:8px 0 0;font-size:12px;color:var(--ink-2)}',
      '.hero .meta{text-align:right;font-size:12px;color:var(--ink-2);white-space:nowrap}',
      '.hero .meta strong{display:block;margin-top:2px;font-size:14px;color:var(--ink)}',
      '.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0 8px}',
      '.card{padding:16px 18px;border-radius:14px;background:var(--accent-soft);border-left:4px solid var(--accent)}',
      '.card .label{font-size:12px;color:var(--ink-2)}',
      '.card .value{margin-top:8px;font-size:20px;font-weight:700}',
      '.block{margin-top:32px}',
      '.block>h2{margin:0 0 14px;font-size:15px;font-weight:600}',
      '.block>h2 span{color:var(--ink-2);font-weight:400;font-size:12px;margin-left:6px}',
      '.chapter{margin-bottom:22px}',
      '.chapter h3{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 10px;padding-bottom:6px;border-bottom:1px dashed var(--line);font-size:13.5px;font-weight:600;color:var(--accent)}',
      '.chapter h3 .count{flex:none;font-size:12px;font-weight:400;color:var(--ink-2)}',
      'ol.highlights{margin:0;padding-left:22px}',
      'ol.highlights>li{margin-bottom:12px}',
      'ol.highlights>li::marker{color:var(--accent);font-weight:600}',
      'ol.highlights p{margin:0}',
      '.thought{margin-bottom:14px;padding:12px 16px;background:#fafbfa;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:0 12px 12px 0}',
      '.thought blockquote{margin:0 0 8px;padding:0;font-size:13px;color:var(--ink-2)}',
      '.thought blockquote::before{content:"「"}',
      '.thought blockquote::after{content:"」"}',
      '.thought .text{margin:0}',
      'time{display:block;margin-top:6px;font-size:12px;color:#9aa3ab}',
      '.empty{padding:18px;font-size:13px;color:var(--ink-2);background:#fafbfa;border:1px dashed var(--line);border-radius:10px}',
      '.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;line-height:1.8;color:var(--ink-2)}',
      '.print-btn{position:fixed;right:24px;bottom:24px;padding:12px 20px;border:0;border-radius:999px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(7,193,96,.35)}',
      '.print-btn:hover{filter:brightness(1.05)}',
      '@media screen{body{padding-bottom:96px}}',
      '@media (max-width:720px){.page{margin:16px;padding:24px}.cards{grid-template-columns:1fr}.hero{flex-direction:column;align-items:flex-start}.hero .meta{text-align:left}}',
      '@media print{@page{size:A4;margin:14mm}body{background:#fff}.page{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}.no-print{display:none!important}.chapter,.thought,ol.highlights>li{break-inside:avoid}.chapter h3{break-after:avoid}}',
    ].join('');
  }

  function countChapters(data) {
    const names = {};
    data.highlightGroups.concat(data.thoughtGroups).forEach((group) => {
      names[group.name] = 1;
    });
    return Object.keys(names).length;
  }

  function buildHighlightChapter(group) {
    const items = group.items.map((item) =>
      '<li><p>' + escapeMultiline(item.text) + '</p>' +
        (item.createTime ? '<time>' + escapeHtml(formatDateTime(item.createTime)) + '</time>' : '') +
      '</li>'
    ).join('');
    return '<div class="chapter"><h3>' + escapeHtml(group.name) +
      '<span class="count">' + group.items.length + ' 条</span></h3>' +
      '<ol class="highlights">' + items + '</ol></div>';
  }

  function buildThoughtChapter(group) {
    const items = group.items.map((item) =>
      '<div class="thought">' +
        (item.abstract ? '<blockquote>' + escapeMultiline(item.abstract) + '</blockquote>' : '') +
        '<p class="text">' + escapeMultiline(item.text) + '</p>' +
        (item.createTime ? '<time>' + escapeHtml(formatDateTime(item.createTime)) + '</time>' : '') +
      '</div>'
    ).join('');
    return '<div class="chapter"><h3>' + escapeHtml(group.name) +
      '<span class="count">' + group.items.length + ' 条</span></h3>' + items + '</div>';
  }

  function buildNotesReportBody(data) {
    const parts = [
      '<header class="hero">',
      '  <div><h1>《' + escapeHtml(data.title || '未知书籍') + '》读书笔记</h1>',
      '    <p class="sub">' + escapeHtml(sourceLabel(data)) + '</p></div>',
      '  <div class="meta">导出时间<strong>' + escapeHtml(formatDateTime(Date.now())) + '</strong></div>',
      '</header>',
      '<div class="cards">',
      '  <div class="card"><div class="label">划线</div><div class="value">' + data.highlights.length + ' 条</div></div>',
      '  <div class="card"><div class="label">想法 / 批注</div><div class="value">' + data.thoughts.length + ' 条</div></div>',
      '  <div class="card"><div class="label">覆盖章节</div><div class="value">' + countChapters(data) + ' 个</div></div>',
      '</div>',
    ];

    parts.push('<div class="block"><h2>划线<span>共 ' + data.highlights.length + ' 条</span></h2>');
    if (data.highlightGroups.length === 0) {
      parts.push('<div class="empty">这本书还没有划线～</div>');
    } else {
      data.highlightGroups.forEach((group) => parts.push(buildHighlightChapter(group)));
    }
    parts.push('</div>');

    if (data.thoughts.length > 0) {
      parts.push('<div class="block"><h2>想法与批注<span>共 ' + data.thoughts.length + ' 条</span></h2>');
      if (data.thoughtGroups.length === 0) {
        parts.push('<div class="empty">这本书还没有想法～</div>');
      } else {
        data.thoughtGroups.forEach((group) => parts.push(buildThoughtChapter(group)));
      }
      parts.push('</div>');
    }

    parts.push('<footer class="foot">',
      '  <div>数据来源：' + escapeHtml(sourceLabel(data)) + '。</div>',
      '  <div>由「微信悦读」在本地生成并导出，数据不会上传到任何服务器。</div>',
      '</footer>');
    return parts.join('\n');
  }

  function buildNotesReportHtml(data) {
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>《' + escapeHtml(data.title || '未知书籍') + '》读书笔记</title>',
      '<style>' + notesReportStyles() + '</style>',
      '</head>',
      '<body>',
      '<div class="page">',
      buildNotesReportBody(data),
      '</div>',
      '<button class="print-btn no-print" id="wre-notes-print">打印 / 另存为 PDF</button>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  // 复制用的富文本用内联样式：粘贴到 Word / 飞书 / 公众号编辑器等目标里也能保留排版
  function buildNotesClipboardHtml(data) {
    const style = {
      h1: 'font-size:19px;margin:0 0 6px;line-height:1.5;',
      meta: 'font-size:12px;color:#6b7280;margin:0 0 16px;',
      h2: 'font-size:15px;margin:20px 0 8px;padding-bottom:4px;border-bottom:1px solid #e8ebe9;color:#07c160;',
      h3: 'font-size:13.5px;margin:14px 0 6px;',
      quote: 'margin:0 0 6px;padding:6px 10px;border-left:3px solid #07c160;background:#f6f8f7;color:#4b5563;font-size:13px;',
      text: 'margin:0 0 4px;',
      time: 'display:block;margin:2px 0 12px;font-size:12px;color:#9ca3af;',
    };
    const parts = [
      '<div style="font:14px/1.75 -apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#1f2328;">',
      '<p style="' + style.h1 + '"><strong>《' + escapeHtml(data.title || '未知书籍') + '》读书笔记</strong></p>',
      '<p style="' + style.meta + '">划线 ' + data.highlights.length + ' 条 · 想法/批注 ' + data.thoughts.length + ' 条 · ' +
        escapeHtml(sourceLabel(data)) + ' · ' + escapeHtml(formatDateTime(Date.now())) + '</p>',
    ];
    if (data.highlights.length > 0) {
      parts.push('<p style="' + style.h2 + '"><strong>划线</strong></p>');
      data.highlightGroups.forEach((group) => {
        parts.push('<p style="' + style.h3 + '"><strong>' + escapeHtml(group.name) + '</strong>（' + group.items.length + ' 条）</p>');
        parts.push('<ul style="margin:0 0 10px;padding-left:20px;">');
        group.items.forEach((item) => {
          parts.push('<li style="' + style.text + '">' + escapeMultiline(item.text) +
            (item.createTime ? '<span style="' + style.time + '">' + escapeHtml(formatDateTime(item.createTime)) + '</span>' : '') +
            '</li>');
        });
        parts.push('</ul>');
      });
    }
    if (data.thoughts.length > 0) {
      parts.push('<p style="' + style.h2 + '"><strong>想法与批注</strong></p>');
      data.thoughtGroups.forEach((group) => {
        parts.push('<p style="' + style.h3 + '"><strong>' + escapeHtml(group.name) + '</strong>（' + group.items.length + ' 条）</p>');
        group.items.forEach((item) => {
          parts.push('<div style="margin:0 0 10px;">');
          if (item.abstract) {
            parts.push('<p style="' + style.quote + '">' + escapeMultiline(item.abstract) + '</p>');
          }
          parts.push('<p style="' + style.text + '">' + escapeMultiline(item.text) + '</p>');
          if (item.createTime) {
            parts.push('<span style="' + style.time + '">' + escapeHtml(formatDateTime(item.createTime)) + '</span>');
          }
          parts.push('</div>');
        });
      });
    }
    parts.push('</div>');
    return parts.join('');
  }

  // 一次性写入「富文本 + 干净纯文本」两种格式：粘到富文本编辑器用 HTML，
  // 粘到记事本 / 微信等纯文本场景用 plainText（不含 Markdown 符号，直接可读）
  async function copyNotesRich(plainText, html) {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
        return 'rich';
      } catch (error) {
        logNotes('warn', '富文本复制失败，退回纯文本复制', { reason: String(error) });
      }
    }
    return (await copyText(plainText)) ? 'text' : '';
  }

  async function handleCopyNotes() {
    const data = currentFilteredData();
    if (!data) {
      toast('还没有可复制的笔记，先等数据读出来～');
      logNotes('warn', '笔记数据未就绪，忽略复制请求');
      return;
    }
    const mode = await copyNotesRich(buildPlainText(data), buildNotesClipboardHtml(data));
    if (!mode) {
      toast('复制失败，请重试');
      logNotes('warn', '复制笔记失败');
      return;
    }
    toast(mode === 'rich' ? '已复制笔记（可直接粘贴）' : '已复制笔记（纯文本）');
    logNotes('info', '已复制笔记到剪贴板', {
      mode,
      highlights: data.highlights.length,
      thoughts: data.thoughts.length,
      source: data.source,
    });
  }

  function openNotesForPrint(html) {
    const win = window.open('', '_blank');
    if (!win) {
      toast('浏览器拦截了新窗口，请允许本站弹窗后重试');
      logNotes('warn', 'PDF 导出被拦截：浏览器阻止了新窗口');
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    const printBtn = win.document.getElementById('wre-notes-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => win.print());
    }
    // 等浏览器完成首帧渲染再唤起打印对话框
    setTimeout(() => {
      try {
        win.print();
      } catch (error) {
        logNotes('warn', '唤起打印失败，可手动按 Ctrl/Cmd+P', { error: String(error) });
      }
    }, 400);
    return true;
  }

  function exportFileName(data, ext) {
    return '微信悦读-读书笔记-' + toDateKey(Date.now()) + '-' + sanitizeFileName(data.title || '未知书籍') + '.' + ext;
  }

  function handleExport(format) {
    const data = currentFilteredData();
    if (!data) {
      toast('还没有可导出的笔记，先等数据读出来～');
      logNotes('warn', '笔记数据未就绪，忽略导出请求', { format });
      return;
    }
    if (format === 'pdf') {
      if (openNotesForPrint(buildNotesReportHtml(data))) {
        toast('已打开打印视图，在对话框里选「另存为 PDF」即可');
        logNotes('info', '已打开 PDF 打印视图', { highlights: data.highlights.length, thoughts: data.thoughts.length });
      }
      return;
    }
    if (format === 'html') {
      downloadFile(exportFileName(data, 'html'), buildNotesReportHtml(data), 'text/html;charset=utf-8');
    } else if (format === 'text') {
      downloadFile(exportFileName(data, 'txt'), buildPlainText(data), 'text/plain;charset=utf-8');
    } else {
      downloadFile(exportFileName(data, 'md'), buildMarkdown(data), 'text/markdown;charset=utf-8');
    }
    const names = { html: ' HTML', text: '纯文本', markdown: ' Markdown' };
    toast('已导出' + (names[format] || format));
    logNotes('info', '已导出笔记', {
      format,
      highlights: data.highlights.length,
      thoughts: data.thoughts.length,
      source: data.source,
    });
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
