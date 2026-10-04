/**
 * 微信悦读 · 官方数据模块（v0.14.2）
 *
 * 定位：独立模块，不改动 content.js 与既有模块逻辑。经 manifest 的 content_scripts
 * 在 content.js 之前加载，与 content.js 共享隔离世界，可复用其全局 log() 与
 * #we-read-enhancer-root 容器。
 *
 * 职责（阶段十三 V1 + V2·上半 + v0.14.0 AI + v0.14.2 Key 集中入口）：
 *   1. 主菜单「☁️ 官方数据」入口
 *   2. 面板：📊 阅读行为报告（时长与天数趋势 / 书架结构 / 知识脉络 / 笔记行为 /
 *      完读率 / 已读完书目 / 周期切换 / 环比 / 导出 Markdown / HTML / PDF）
 *   3. 主菜单「🔑 API Key」独立入口：集中填写微信读书 wrk- Key 与 DeepSeek Key
 *      （保存即校验 / 清除）；并监听 `wre-open-key-settings` 事件，供其它模块（如笔记）一键跳来配 Key
 *
 * 数据来源：微信读书官方 Agent Skill 网关（经 background.js 转发）：
 *   /readdata/detail（按周期）＋ /shelf/sync（书架）＋ /user/notebooks（笔记概览，游标分页）。
 * 隐私口径：Key 只存本机 chrome.storage.local；报告在本机生成，数据不上传。
 * 口径红线：官方所有时长字段单位是秒（严禁当分钟/小时）；Unix 时间戳展示转日期；
 *           分桶时间戳按「中国时区」取日期（网关按中国零点分桶但编码成 UTC 秒，
 *           直接按 UTC 或浏览器本地时区换算都会差一天）。
 */
(function () {
  'use strict';

  const CACHE_KEY = 'wreOfficialReportCache';
  const CACHE_TTL_MS = 10 * 60 * 1000;   // 报告缓存有效期：10 分钟
  const OVERVIEW_CACHE_KEY = 'wreOfficialOverviewCache';
  const OVERVIEW_TTL_MS = 30 * 60 * 1000; // 书架 + 笔记概览缓存：30 分钟（与周期无关，变动慢）
  const NOTEBOOKS_PAGE_SIZE = 100;        // /user/notebooks 每页条数
  const NOTEBOOKS_MAX_PAGES = 5;          // 最多翻 5 页（500 本），避免异常账号无限翻页
  const SHELF_BOOK_LIMIT = 20;            // 「已读完书目」最多列出条数
  const CATEGORY_LIMIT = 15;              // 「知识脉络」分类最多列出条数
  const CST_OFFSET_MS = 8 * 3600 * 1000; // 官方分桶时间戳是「中国时区零点」的 UTC 秒，展示需 +8h

  // ---- AI 增强（DeepSeek，可选）：数字本地算、人格化文字交给 AI 生成 ----
  const AI_TOP_BOOKS = 5;      // 取「笔记最多」的前 N 本书拉原文
  const AI_MARK_SAMPLE = 6;    // 每本书最多取 N 条划线样本
  const AI_REVIEW_SAMPLE = 6;  // 每本书最多取 N 条想法样本
  const AI_ANNUAL_YEARS = 4;   // 年度趋势：查最近 N 年（含当年）
  const AI_SYSTEM_PROMPT = '你是一位克制、客观的阅读分析师。请根据用户提供的微信读书真实统计值与少量划线/想法原文样本，为这位读者写一段「人格化执行摘要」。' +
    '要求：1) 用中文，真诚、有洞察，但不浮夸、不编造、不堆形容词；2) 严格基于所给数据，不得虚构任何数字，也不得杜撰用户没做过的事；3) 结构分三段——' +
    '① 一句话定性＋总体投入（书架数、累计时长、划线数、想法数）；② 2~3 个最突出的阅读特征（每个必须引用具体数据或原文佐证）；③ 时间轨迹信号（如年度时长变化）；' +
    '4) 直接输出正文自然段，不要加任何标题、序号或 Markdown 符号。';
  const AI_PERSONA_PROMPT = '你是一位克制、客观的阅读分析师。请根据用户提供的微信读书真实统计值、分类偏好、笔记最多的几本书及划线/想法原文样本、年度时长变化，为这位读者写一段有深度、有洞察的「人性化人格分析」。' +
    '要求：1) 用中文，真诚、有洞察，像朋友的口吻，但不浮夸、不编造、不堆形容词；2) 严格基于所给数据与原文，不得虚构任何数字，也不得杜撰用户没做过的事；' +
    '3) 分 4~6 个要点输出，每个要点揭示一个最鲜明的阅读/思维特质，做深挖而非概述，每个论断都要落到具体证据上（须点出具体书名、划线/想法条数、引用原文或年度数字）；' +
    '4) 输出格式必须严格如下——每个要点两行起步：第一行是「第N、小标题」（小标题 2~6 个字，如「第一性原理」「系统进阶」「深夜思考者」），下一行开始为该要点的论述正文；要点之间空一行。示例：\n' +
    '第一、第一性原理\n他不接受给定的知识，而是追问概念的起源……（正文）\n\n' +
    '第二、系统进阶\n他每进入一个新领域都沿一条路径系统性地读多本书……（正文）\n' +
    '5) 不要输出总标题，不要用 Markdown 符号，直接按上述格式输出。';
  const MODES = [
    { key: 'weekly', label: '本周' },
    { key: 'monthly', label: '本月' },
    { key: 'annually', label: '本年' },
    { key: 'overall', label: '累计' },
  ];

  let mode = 'monthly';
  let report = null;        // 当前展示的报告数据（/readdata/detail，按周期）
  let reportState = 'idle'; // idle | loading | ok | error
  let reportError = '';
  let reportFromCache = false;
  let reportAt = 0;
  let overallReport = null; // 累计（总体）数据：执行摘要 / 人格分析固定基于它，与周期选择无关
  let upgradeInfo = null;
  let overview = null;        // 与周期无关的书架 + 笔记概览：{ at, shelf, notebooks }
  let overviewState = 'idle'; // idle | loading | ok | partial | error
  let overviewError = '';
  let keyStatus = { hasKey: false, apiKey: '', savedAt: 0, lastVerifiedAt: 0, skillVersion: '' };
  let settingsMessage = '';
  let aiSettingsMessage = '';   // DeepSeek Key 区的提示（独立于微信读书 Key 区）
  let draftWrkKey = '';   // 输入框草稿：保存/重渲染后仍保留用户粘贴的微信读书 Key
  let draftAiKey = '';    // 输入框草稿：保留用户粘贴的 DeepSeek Key
  let aiKeyStatus = { hasKey: false, apiKey: '', savedAt: 0 };  // DeepSeek Key 状态（可选）
  let aiSummary = null;   // AI 生成的人格化执行摘要（字符串数组，每项一段）
  let aiPersona = null;   // AI 生成的人性化人格分析（[{ title, body }] 分点数组）
  let aiState = 'idle';   // idle | loading | ok | error | skipped
  let aiError = '';
  let aiPersonaError = '';   // 人格分析失败原因（成功后清空）

  // ---------- 通用小工具 ----------

  function logOfficial(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[official] ' + message, meta);
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /** 官方分桶时间戳 → 中国时区的 年/月/日
   *  实测：网关按「中国时区零点」分桶，但编码成 UTC 秒（例如 1790524800 是
   *  2026-09-27 16:00 UTC = 2026-09-28 00:00 中国时间）。因此必须固定 +8h 再取
   *  UTC 年月日，不能直接按 UTC 或按浏览器本地时区换算（否则日期会差一天）。 */
  function bucketParts(seconds) {
    const date = new Date(Number(seconds) * 1000 + CST_OFFSET_MS);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }

  function fmtDateTime(timestamp) {
    if (!timestamp) {
      return '—';
    }
    const date = new Date(timestamp);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  /** 官方时长字段单位是秒，这里统一转成中文可读文案 */
  function fmtDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) {
      return total > 0 ? '不足 1 分钟' : '0 分钟';
    }
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    if (hours <= 0) {
      return minutes + ' 分钟';
    }
    return minutes > 0 ? hours + ' 小时 ' + minutes + ' 分钟' : hours + ' 小时';
  }

  /** 分桶 key（秒）→ 展示标签 */
  function fmtBucketLabel(seconds, currentMode) {
    const part = bucketParts(seconds);
    if (currentMode === 'overall') {
      return part.year + ' 年';
    }
    if (currentMode === 'annually') {
      return part.month + ' 月';
    }
    return part.month + ' 月 ' + part.day + ' 日';
  }

  function fmtCompare(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return null;
    }
    const percent = value * 100;
    const sign = percent > 0 ? '+' : '';
    return sign + percent.toFixed(1) + '%';
  }

  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function modeLabel(currentMode) {
    const found = MODES.filter((item) => item.key === currentMode)[0];
    return found ? found.label : currentMode;
  }

  /** 与后台 service worker 通信 */
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

  // ---------- 数据 ----------

  async function readCache() {
    try {
      const result = await chrome.storage.local.get([CACHE_KEY]);
      return result[CACHE_KEY] || {};
    } catch (err) {
      return {};
    }
  }

  async function writeCache(currentMode, data) {
    try {
      const cache = await readCache();
      cache[currentMode] = { at: Date.now(), data: data };
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    } catch (err) {
      logOfficial('warn', '报告缓存写入失败（不影响展示）', { message: err && err.message });
    }
  }

  async function readOverviewCache() {
    try {
      const result = await chrome.storage.local.get([OVERVIEW_CACHE_KEY]);
      return result[OVERVIEW_CACHE_KEY] || null;
    } catch (err) {
      return null;
    }
  }

  async function writeOverviewCache(payload) {
    try {
      await chrome.storage.local.set({ [OVERVIEW_CACHE_KEY]: payload });
    } catch (err) {
      logOfficial('warn', '书架/笔记缓存写入失败（不影响展示）', { message: err && err.message });
    }
  }

  async function refreshKeyStatus() {
    const result = await sendBg({ type: 'wre-official-status' });
    if (result.ok) {
      keyStatus = {
        hasKey: !!result.hasKey,
        apiKey: result.apiKey || '',
        savedAt: result.savedAt || 0,
        lastVerifiedAt: result.lastVerifiedAt || 0,
        skillVersion: result.skillVersion || '',
      };
    }
    return keyStatus;
  }

  async function loadReport(force) {
    reportState = 'loading';
    reportError = '';
    upgradeInfo = null;
    // 执行摘要 / 人格分析固定基于「累计（总体）」数据，与周期选择无关：
    // 已成功生成过就保留，切换周期不重复调用 DeepSeek（省 token）。
    if (aiState !== 'ok') {
      aiSummary = null;
      aiPersona = null;
      aiError = '';
      aiPersonaError = '';
      aiState = aiKeyStatus.hasKey ? 'idle' : 'skipped';
    }
    render();

    if (!keyStatus.hasKey) {
      reportState = 'error';
      reportError = '尚未配置 API Key';
      render();
      return;
    }

    // 报告（按周期）、概览（书架 + 笔记）、累计数据并行拉取，互不阻塞
    await Promise.all([loadDetail(force), loadOverview(force), loadOverallData(force)]);
    render();

    // AI 解读改为「导出时」按需生成，避免打开报告就消耗 DeepSeek token（见 handleExport）
  }

  /** 拉取「累计（总体）」数据（命中缓存则跳过网络）；失败不影响报告主体 */
  async function loadOverallData(force) {
    if (!force) {
      const cache = await readCache();
      const hit = cache.overall;
      if (hit && hit.data && (Date.now() - (hit.at || 0)) < CACHE_TTL_MS) {
        overallReport = hit.data;
        logOfficial('info', '命中累计数据缓存');
        return;
      }
    }

    const result = await sendBg({
      type: 'wre-official-call',
      apiName: '/readdata/detail',
      params: { mode: 'overall', baseTime: 0 },
    });
    if (!result.ok) {
      logOfficial('warn', '累计数据拉取失败（不影响报告主体）', { code: result.code });
      return;
    }
    overallReport = result.data;
    await writeCache('overall', result.data);
    logOfficial('info', '累计数据拉取成功', { readDays: result.data && result.data.readDays });
  }

  /** 按周期拉取 /readdata/detail（命中缓存则跳过网络） */
  async function loadDetail(force) {
    if (!force) {
      const cache = await readCache();
      const hit = cache[mode];
      if (hit && hit.data && (Date.now() - (hit.at || 0)) < CACHE_TTL_MS) {
        report = hit.data;
        reportAt = hit.at;
        reportFromCache = true;
        reportState = 'ok';
        logOfficial('info', '命中报告缓存', { mode: mode });
        return;
      }
    }

    const result = await sendBg({
      type: 'wre-official-call',
      apiName: '/readdata/detail',
      params: { mode: mode, baseTime: 0 },
    });

    if (!result.ok) {
      reportState = 'error';
      reportError = result.error || '读取官方数据失败';
      logOfficial('warn', '报告拉取失败', { mode: mode, code: result.code });
      return;
    }

    report = result.data;
    reportAt = Date.now();
    reportFromCache = false;
    upgradeInfo = result.upgrade || null;
    reportState = 'ok';
    await writeCache(mode, report);
    logOfficial('info', '报告拉取成功', { mode: mode, readDays: report.readDays });
  }

  /** 拉取书架 + 笔记概览（与周期无关；失败只影响对应章节，不影响报告主体） */
  async function loadOverview(force) {
    if (!force) {
      const cache = await readOverviewCache();
      if (cache && cache.shelf && cache.notebooks && (Date.now() - (cache.at || 0)) < OVERVIEW_TTL_MS) {
        overview = cache;
        overviewState = 'ok';
        overviewError = '';
        logOfficial('info', '命中书架/笔记缓存');
        return;
      }
    }

    overviewState = 'loading';
    const shelfRes = await sendBg({ type: 'wre-official-call', apiName: '/shelf/sync', params: {} });
    const notesRes = await fetchNotebooks();
    const shelf = shelfRes.ok ? slimShelf(shelfRes.data) : null;
    const notebooks = notesRes.ok ? notesRes : null;

    if (!upgradeInfo && shelfRes.upgrade) {
      upgradeInfo = shelfRes.upgrade;
    }

    if (shelf && notebooks) {
      overviewState = 'ok';
      overviewError = '';
    } else if (shelf || notebooks) {
      overviewState = 'partial';
      overviewError = (!shelf ? '书架数据' : '笔记数据') + '本次未取到：' +
        ((!shelf ? shelfRes.error : notesRes.error) || '未知原因');
    } else {
      overviewState = 'error';
      overviewError = '书架与笔记数据均未取到：' + (shelfRes.error || notesRes.error || '未知原因');
    }

    overview = { at: Date.now(), shelf: shelf, notebooks: notebooks };
    // 只在两路都成功时写入缓存，避免把失败结果缓存住
    if (overviewState === 'ok') {
      await writeOverviewCache(overview);
    }
    logOfficial(overviewState === 'ok' ? 'info' : 'warn', '书架/笔记概览拉取完成', {
      state: overviewState,
      books: shelf ? shelf.books.length : 0,
      notebooks: notebooks ? notebooks.books.length : 0,
    });
  }

  /** 逐页拉取 /user/notebooks（游标分页：count + lastSort） */
  async function fetchNotebooks() {
    const collected = [];
    let lastSort = 0;
    let totalBookCount = 0;
    let totalNoteCount = null;
    let truncated = false;

    for (let page = 0; page < NOTEBOOKS_MAX_PAGES; page += 1) {
      const params = { count: NOTEBOOKS_PAGE_SIZE };
      if (lastSort) {
        params.lastSort = lastSort;
      }
      const res = await sendBg({ type: 'wre-official-call', apiName: '/user/notebooks', params: params });
      if (!res.ok) {
        if (page === 0) {
          return { ok: false, code: res.code, error: res.error };
        }
        // 已经拿到部分数据：降级为「部分成功」
        truncated = true;
        break;
      }
      const data = res.data || {};
      if (typeof data.totalBookCount === 'number') {
        totalBookCount = data.totalBookCount;
      }
      if (typeof data.totalNoteCount === 'number') {
        totalNoteCount = data.totalNoteCount;
      }
      const books = Array.isArray(data.books) ? data.books : [];
      books.forEach((item) => collected.push(slimNotebook(item)));
      if (!data.hasMore || !books.length) {
        break;
      }
      lastSort = books[books.length - 1].sort;
      if (page === NOTEBOOKS_MAX_PAGES - 1) {
        truncated = true;
      }
    }

    return {
      ok: true,
      totalBookCount: totalBookCount || collected.length,
      totalNoteCount: totalNoteCount,
      books: collected,
      truncated: truncated,
    };
  }

  /** 只保留报告需要的字段，减小缓存体积（不展示封面，故丢弃 cover） */
  function slimShelf(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const books = (Array.isArray(data.books) ? data.books : []).map((item) => ({
      bookId: item.bookId || '',
      title: item.title || '',
      author: item.author || '',
      category: item.category || '',
      readUpdateTime: item.readUpdateTime || 0,
      finishReading: Number(item.finishReading) === 1 ? 1 : 0,
      isTop: Number(item.isTop) === 1 ? 1 : 0,
      secret: Number(item.secret) === 1 ? 1 : 0,
    }));
    const albums = (Array.isArray(data.albums) ? data.albums : []).map((item) => {
      const info = item.albumInfo || {};
      const extra = item.albumInfoExtra || {};
      return {
        albumId: info.albumId || '',
        name: info.name || '',
        authorName: info.authorName || '',
        finish: Number(info.finish) === 1 ? 1 : 0,
        secret: Number(extra.secret) === 1 ? 1 : 0,
        isTop: Number(extra.isTop) === 1 ? 1 : 0,
        readUpdateTime: extra.lectureReadUpdateTime || 0,
      };
    });
    return {
      books: books,
      albums: albums,
      hasMp: !!data.mp,
      bookCount: typeof data.bookCount === 'number' ? data.bookCount : books.length,
    };
  }

  function slimNotebook(item) {
    const book = item.book || {};
    return {
      bookId: item.bookId || '',
      title: book.title || '',
      author: book.author || '',
      reviewCount: Number(item.reviewCount) || 0,
      noteCount: Number(item.noteCount) || 0,
      bookmarkCount: Number(item.bookmarkCount) || 0,
      readingProgress: Number(item.readingProgress) || 0,
      markedStatus: Number(item.markedStatus) || 0,
      sort: Number(item.sort) || 0,
    };
  }

  // ---------- AI 增强（DeepSeek，可选）----------

  function splitParagraphs(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }
    return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  }

  // 解析 DeepSeek 人格分析的结构化分点文本为 [{ title, body }]
  // 约定格式：每点首行「第N、小标题」，其后为论述正文；点与点之间空行分隔。
  function splitPersonaPoints(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }
    const points = [];
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    blocks.forEach((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) {
        return;
      }
      let title = lines[0];
      // 保留「第N、小标题」完整编号（如「第一、第一性原理」），仅归一化编号与标题间的空白
      const m = title.match(/^(第\s*[一二三四五六七八九十百]+\s*[、，.:：])\s*(.+)$/);
      if (m) {
        title = m[1] + m[2].trim();
      }
      const body = lines.slice(1).join('\n');
      if (body) {
        points.push({ title: title, body: body });
      } else {
        // 首行后无正文，整块作为无标题段落兜底
        points.push({ title: '', body: block });
      }
    });
    return points;
  }

  // 年度趋势：对最近 N 年（含当年）逐次查 /readdata/detail annually
  async function fetchAnnualTrend() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const rows = [];
    for (let i = 0; i < AI_ANNUAL_YEARS; i += 1) {
      const year = currentYear - i;
      // baseTime 取该年 6 月 30 日 12:00（秒），避开年初/年末边界与时区歧义
      const baseTime = Math.floor(new Date(year, 5, 30, 12, 0, 0).getTime() / 1000);
      const res = await sendBg({ type: 'wre-official-call', apiName: '/readdata/detail', params: { mode: 'annually', baseTime: baseTime } });
      if (res && res.ok && res.data) {
        rows.push({ year: year, totalReadTime: Number(res.data.totalReadTime) || 0, readDays: Number(res.data.readDays) || 0 });
      }
    }
    return rows;
  }

  // 单本书的个人想法（/review/list/mine，游标分页，参数小写 bookid）
  async function fetchBookReviews(bookId) {
    const items = [];
    let synckey = 0;
    let more = true;
    for (let page = 0; page < 5 && more; page += 1) {
      const res = await sendBg({
        type: 'wre-official-call',
        apiName: '/review/list/mine',
        params: { bookid: bookId, synckey: synckey, count: 50 },
      });
      if (!res || !res.ok || !res.data) {
        break;
      }
      const reviews = Array.isArray(res.data.reviews) ? res.data.reviews : [];
      reviews.forEach((item) => {
        const r = item && item.review;
        if (r && typeof r.content === 'string' && r.content.trim()) {
          items.push(r.content.trim());
        }
      });
      synckey = res.data.synckey != null ? res.data.synckey : synckey;
      more = Number(res.data.hasMore) === 1;
    }
    return items;
  }

  // 对「笔记最多」的前 N 本书拉取划线/想法原文样本
  async function fetchBookContents(topBooks) {
    const contents = [];
    for (const book of topBooks) {
      const bookId = book && book.bookId;
      if (!bookId) {
        continue;
      }
      const title = (book && book.title) || '未命名';
      const author = (book && book.author) || '';
      const [markRes, reviews] = await Promise.all([
        sendBg({ type: 'wre-official-call', apiName: '/book/bookmarklist', params: { bookId: bookId } }),
        fetchBookReviews(bookId),
      ]);
      const marks = [];
      if (markRes && markRes.ok && markRes.data) {
        const updated = Array.isArray(markRes.data.updated) ? markRes.data.updated : [];
        updated.slice(0, AI_MARK_SAMPLE).forEach((m) => {
          const t = m && m.markText;
          if (typeof t === 'string' && t.trim()) {
            marks.push(t.trim());
          }
        });
      }
      contents.push({
        title: title,
        author: author,
        noteCount: (book && book.noteCount) || 0,
        reviewCount: (book && book.reviewCount) || 0,
        bookmarkCount: (book && book.bookmarkCount) || 0,
        markSamples: marks,
        reviewSamples: reviews.slice(0, AI_REVIEW_SAMPLE),
      });
    }
    return contents;
  }

  // 把客观数据 + 原文样本拼成给 AI 的 user 内容
  function buildAIPrompt(overallData, shelf, notes, annual, contents) {
    const lines = [];
    const counts = shelf ? shelfCounts(shelf) : null;
    const fin = shelf ? finishStats(shelf) : null;
    const stats = notes ? notebookStats(notes) : null;

    if (counts) {
      lines.push('【书架】共 ' + counts.total + ' 个条目（电子书 ' + counts.books + '、有声书/专辑 ' + counts.albums + (counts.hasMp ? '、文章收藏 1' : '') + '）。');
    }
    if (overallData) {
      lines.push('【累计阅读】' + fmtDuration(overallData.totalReadTime) + '，覆盖 ' + (overallData.readDays || 0) + ' 天。');
    }
    if (stats) {
      lines.push('【笔记】划线 ' + stats.noteTotal + ' 条、想法/点评 ' + stats.reviewTotal + ' 条、书签 ' + stats.bookmarkTotal + ' 条（合计 ' + stats.totalNoteCount + ' 条）。');
    }
    if (fin) {
      lines.push('【完读】电子书读完 ' + fin.finished + '/' + fin.ebooks + ' 本（完读率 ' + (fin.rate * 100).toFixed(0) + '%）。');
    }

    const cats = shelf ? shelfCategories(shelf) : null;
    if (cats && cats.list.length) {
      lines.push('【分类偏好】' + cats.list.slice(0, 5).map((c) => c.name + '(' + c.count + '本)').join('、') + '。');
    }

    if (contents.length) {
      lines.push('【笔记最多的书及原文样本】');
      contents.forEach((c) => {
        lines.push('《' + c.title + '》' + (c.author ? '（' + c.author + '）' : '') + '—— 划线 ' + c.noteCount + ' 条、想法 ' + c.reviewCount + ' 条');
        if (c.markSamples.length) {
          lines.push('  划线样本：' + c.markSamples.join(' | '));
        }
        if (c.reviewSamples.length) {
          lines.push('  想法样本：' + c.reviewSamples.join(' | '));
        }
      });
    }

    if (annual.length) {
      lines.push('【年度趋势】' + annual.map((r) => r.year + '年 ' + fmtDuration(r.totalReadTime)).join('，') + '。');
    }

    return lines.join('\n');
  }

  // 串联：年度趋势 + 原文 → prompt → DeepSeek → aiSummary
  async function runAIEnhance() {
    aiState = 'loading';
    aiError = '';
    aiSummary = null;
    aiPersona = null;
    aiPersonaError = '';
    render();
    try {
      const shelf = overview && overview.shelf ? overview.shelf : null;
      const notes = overview && overview.notebooks ? overview.notebooks : null;
      const topBooks = [];
      if (notes) {
        const stats = notebookStats(notes);
        if (stats && Array.isArray(stats.topBooks)) {
          topBooks.push.apply(topBooks, stats.topBooks.slice(0, AI_TOP_BOOKS));
        }
      }
      const [annual, contents, overallRes] = await Promise.all([
        fetchAnnualTrend(),
        topBooks.length ? fetchBookContents(topBooks) : Promise.resolve([]),
        // 复用报告页已拉取的累计数据，避免重复请求（未取到时再补一次）
        overallReport ? Promise.resolve({ ok: true, data: overallReport }) :
          sendBg({ type: 'wre-official-call', apiName: '/readdata/detail', params: { mode: 'overall', baseTime: 0 } }),
      ]);
      const overallData = (overallRes && overallRes.ok && overallRes.data) ? overallRes.data : null;
      const prompt = buildAIPrompt(overallData, shelf, notes, annual, contents);

      // 先执行摘要（失败退回规则化摘要）
      const summaryRes = await sendBg({
        type: 'wre-ai-chat',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      });
      if (!summaryRes || !summaryRes.ok) {
        aiState = 'error';
        aiError = (summaryRes && summaryRes.error) ? summaryRes.error : 'AI 生成失败';
      } else {
        aiSummary = splitParagraphs(summaryRes.text);
        aiState = aiSummary.length ? 'ok' : 'error';
        if (!aiSummary.length) {
          aiError = 'AI 返回内容为空';
        }
      }

      // 再生成人格分析（串行，避免与摘要并发触发限流；失败只影响人格分析，不影响报告主体）
      try {
        const personaRes = await sendBg({
          type: 'wre-ai-chat',
          messages: [
            { role: 'system', content: AI_PERSONA_PROMPT },
            { role: 'user', content: prompt },
          ],
        });
        if (personaRes && personaRes.ok) {
          const persona = splitPersonaPoints(personaRes.text);
          aiPersona = persona.length ? persona : null;
          if (!persona.length) {
            aiPersonaError = 'AI 返回内容为空';
          }
        } else {
          aiPersona = null;
          aiPersonaError = (personaRes && personaRes.error) ? personaRes.error : 'AI 生成失败';
        }
      } catch (err) {
        aiPersona = null;
        aiPersonaError = '生成异常';
      }
      if (aiPersonaError) {
        logOfficial('warn', '人格分析未生成', { error: aiPersonaError });
      }
    } catch (err) {
      aiState = 'error';
      aiError = 'AI 生成异常';
      logOfficial('error', 'AI 增强失败', { message: err && err.message });
    }
    // 生成结束后面板刷新一次，把「生成中」状态更新为最终结果（ok / error）
    render();
  }

  // ---------- 渲染片段 ----------

  function exportButton(format, label) {
    return '<button class="wre-btn wre-btn-small" data-wre-off-export="' + format + '"' +
      (reportState === 'ok' ? '' : ' disabled') + '>' + label + '</button>';
  }

  function buildCards(data) {
    const compare = fmtCompare(data.compare);
    const dayAverage = data.dayAverageReadTime == null ? null : fmtDuration(data.dayAverageReadTime);
    const cards = [
      { label: '总时长', value: fmtDuration(data.totalReadTime) },
      { label: '阅读天数', value: (data.readDays || 0) + ' 天' },
      {
        label: '自然日均',
        value: dayAverage === null ? '—' : dayAverage,
        hint: dayAverage === null ? '官方未提供该周期' : '分母是自然日，非阅读天数',
      },
      {
        label: '较上期',
        value: compare === null ? '—' : compare,
        hint: compare === null ? '官方仅当前周期提供环比' : '官方口径 compare',
      },
    ];
    return cards.map((card) =>
      '<div class="wre-off-card">' +
        '<div class="wre-off-card-label">' + escapeHtml(card.label) + '</div>' +
        '<div class="wre-off-card-value">' + escapeHtml(card.value) + '</div>' +
        (card.hint ? '<div class="wre-off-card-hint">' + escapeHtml(card.hint) + '</div>' : '') +
      '</div>'
    ).join('');
  }

  function buildStatChips(data) {
    if (!Array.isArray(data.readStat) || !data.readStat.length) {
      return '';
    }
    const chips = data.readStat.map((item) =>
      '<span class="wre-off-chip">' + escapeHtml(item.stat) + ' <b>' + escapeHtml(item.counts) + '</b></span>'
    ).join('');
    return '<div class="wre-off-chips">' + chips + '</div>';
  }

  function buildBucketTable(data, currentMode) {
    const buckets = Object.keys(data.readTimes || {}).map((key) => ({
      ts: Number(key),
      seconds: Number((data.readTimes || {})[key]) || 0,
    })).sort((a, b) => a.ts - b.ts);

    if (!buckets.length) {
      return '<div class="wre-off-empty">官方未返回分桶明细</div>';
    }

    const visible = buckets.filter((item) => item.seconds > 0);
    const hiddenCount = buckets.length - visible.length;
    const max = visible.reduce((acc, item) => Math.max(acc, item.seconds), 0) || 1;
    const total = visible.reduce((acc, item) => acc + item.seconds, 0) || 1;

    const rows = visible.map((item) => {
      const width = Math.max(2, Math.round((item.seconds / max) * 100));
      const share = ((item.seconds / total) * 100).toFixed(1);
      return '<tr>' +
        '<td class="wre-off-td-label">' + escapeHtml(fmtBucketLabel(item.ts, currentMode)) + '</td>' +
        '<td class="wre-off-td-bar"><span class="wre-off-bar" style="width:' + width + '%"></span></td>' +
        '<td class="wre-off-td-num">' + escapeHtml(fmtDuration(item.seconds)) + '</td>' +
        '<td class="wre-off-td-share">' + share + '%</td>' +
      '</tr>';
    }).join('');

    return '<table class="wre-off-table">' +
      '<thead><tr><th>周期</th><th>分布</th><th>时长</th><th>占比</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>' +
      (hiddenCount > 0 ? '<div class="wre-off-note">已隐藏 ' + hiddenCount + ' 个 0 时长周期</div>' : '');
  }

  function buildTrendChart(data, currentMode) {
    const buckets = Object.keys(data.readTimes || {}).map((key) => ({
      ts: Number(key),
      seconds: Number((data.readTimes || {})[key]) || 0,
    })).sort((a, b) => a.ts - b.ts);
    const positive = buckets.filter((item) => item.seconds > 0);
    if (!positive.length) {
      return '';
    }
    return '<div class="wre-chart" data-kind="line" data-payload="' +
      escapeHtml(JSON.stringify({
        labels: positive.map((item) => fmtBucketLabel(item.ts, currentMode)),
        values: positive.map((item) => item.seconds),
      })) + '"></div>';
  }

  function buildLongestList(data) {
    const list = Array.isArray(data.readLongest) ? data.readLongest : [];
    if (!list.length) {
      return '<div class="wre-off-empty">该周期内没有达到展示门槛的书（官方过滤低于 5 分钟的内容）</div>';
    }
    const items = list.slice(0, 5).map((item, index) => {
      const book = item.book || {};
      const album = item.albumInfo || {};
      const title = book.title || album.name || '未命名';
      const tags = Array.isArray(item.tags) && item.tags.length
        ? '<span class="wre-off-tag">' + item.tags.map(escapeHtml).join(' · ') + '</span>'
        : '';
      return '<li class="wre-off-list-item">' +
        '<span class="wre-off-rank">' + (index + 1) + '</span>' +
        '<span class="wre-off-list-title">' + escapeHtml(title) + tags + '</span>' +
        '<span class="wre-off-list-value">' + escapeHtml(fmtDuration(item.readTime)) + '</span>' +
      '</li>';
    }).join('');
    return '<ul class="wre-off-list">' + items + '</ul>';
  }

  function buildReportHtml() {
    const privacy = '<div class="wre-off-privacy">🔒 ' +
      (aiKeyStatus.hasKey
        ? '数字在本机计算；启用 AI 后，划线/想法原文样本会发送给 DeepSeek 生成解读'
        : '本报告在本机生成，数据不上传') +
      '</div>';
    const toolbar =
      '<div class="wre-off-toolbar">' +
        '<div class="wre-off-modes">' +
          MODES.map((item) =>
            '<button class="wre-off-mode' + (item.key === mode ? ' is-active' : '') + '" data-wre-off-mode="' + item.key + '">' +
              item.label +
            '</button>'
          ).join('') +
        '</div>' +
        '<div class="wre-off-actions">' +
          '<button class="wre-btn wre-btn-small" data-wre-off-refresh="1">刷新</button>' +
          exportButton('markdown', '导出 Markdown') +
          exportButton('html', '导出 HTML') +
          exportButton('pdf', '导出 PDF') +
        '</div>' +
      '</div>';

    if (!keyStatus.hasKey) {
      return privacy + toolbar +
        '<div class="wre-off-empty">还没有配置 API Key。<br>去「🔑 API Key」粘贴你自己的 wrk- Key 后即可生成报告。' +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-goto-settings="1">去配置 API Key</button></div></div>';
    }

    if (reportState === 'loading') {
      return privacy + toolbar + '<div class="wre-off-empty">正在从官方网关读取数据…</div>';
    }

    if (reportState === 'error') {
      return privacy + toolbar +
        '<div class="wre-off-error">' + escapeHtml(reportError) +
        '<div style="margin-top:12px"><button class="wre-btn" data-wre-off-refresh="1">重试</button></div></div>';
    }

    const data = report || {};
    const upgradeBanner = upgradeInfo
      ? '<div class="wre-off-upgrade">⚠️ 官方提示需要升级 skill：' +
        escapeHtml(upgradeInfo.message || upgradeInfo.skill_version || '请更新到最新版') +
        '<a href="https://cdn.weread.qq.com/skills/weread-skills.zip" target="_blank" rel="noreferrer">下载官方 skill 包</a></div>'
      : '';
    const sourceNote = '<div class="wre-off-note">数据来源：官方 /readdata/detail（mode=' + escapeHtml(mode) +
      '，skill_version ' + escapeHtml(keyStatus.skillVersion || '1.0.4') + '）；' +
      (reportFromCache ? '来自 ' + escapeHtml(fmtDateTime(reportAt)) + ' 的缓存' : '刚刚拉取 ' + escapeHtml(fmtDateTime(reportAt))) +
      '。时长单位已由秒转为可读文案；「自然日均」分母是自然日，不是阅读天数。</div>';

    const exportParts = [];
    if (overview && (overview.shelf || overview.notebooks)) {
      exportParts.push('书架结构、知识脉络、笔记行为、完读率、已读完书目等章节');
    }
    if (aiState === 'ok') {
      exportParts.push('DeepSeek AI 生成的人格化执行摘要');
    }
    if (aiPersona && aiPersona.length) {
      exportParts.push('人性化人格分析');
    }
    const exportHint = exportParts.length
      ? '<div class="wre-off-note">导出的报告还包含：' + exportParts.join('、') + '。</div>'
      : '';

    const aiHint = aiState === 'loading'
      ? '<div class="wre-off-note">🤖 正在用 DeepSeek 生成人格化执行摘要与人性化人格分析…</div>'
      : (aiState === 'error'
        ? '<div class="wre-off-note">🤖 AI 解读生成失败（' + escapeHtml(aiError) + '），导出时改用规则化摘要。</div>'
        : (aiState === 'ok'
          ? '<div class="wre-off-note">🤖 已用 DeepSeek 生成人格化执行摘要' + (aiPersona && aiPersona.length ? '与人性化人格分析' : '') + '（导出报告可见）。</div>'
            + (aiPersonaError ? '<div class="wre-off-note">⚠️ 人性化人格分析未生成：' + escapeHtml(aiPersonaError) + '（不影响报告主体，可在「🔑 API Key」确认 DeepSeek Key 有效后重试）。</div>' : '')
          : (aiKeyStatus.hasKey
            ? '<div class="wre-off-note">🤖 已配置 DeepSeek Key：点击「导出」时将生成人格化执行摘要与人性化人格分析（打开报告不消耗 token）。</div>'
            : '')));

    return privacy + toolbar + upgradeBanner + aiHint +
      '<div class="wre-off-section-title">一、总览</div>' +
      '<div class="wre-off-cards">' + buildCards(data) + '</div>' +
      buildStatChips(data) +
      '<div class="wre-off-section-title">二、时长分布</div>' +
      buildBucketTable(data, mode) +
      buildTrendChart(data, mode) +
      '<div class="wre-off-section-title">三、读得最多</div>' +
      buildLongestList(data) +
      exportHint +
      sourceNote;
  }

  function buildSettingsHtml() {
    const wrkKeyValue = draftWrkKey || keyStatus.apiKey;
    const aiKeyValue = draftAiKey || aiKeyStatus.apiKey;
    const statusLines = [
      '状态：' + (keyStatus.hasKey ? '已配置' : '未配置'),
      keyStatus.hasKey ? '保存于 ' + fmtDateTime(keyStatus.savedAt) : '',
      keyStatus.hasKey && keyStatus.lastVerifiedAt ? '最近校验 ' + fmtDateTime(keyStatus.lastVerifiedAt) : '',
      keyStatus.skillVersion ? 'skill_version ' + keyStatus.skillVersion : '',
    ].filter(Boolean).join('　·　');

    return '<div class="wre-off-privacy">🔒 Key 只保存在本机浏览器（chrome.storage.local），不会上传给任何人</div>' +
      '<div class="wre-off-section-title">API Key</div>' +
      '<div class="wre-off-note">获取方式：微信读书 App → 「微信读书 Skill」页面 → 复制 wrk- 开头的 API Key。</div>' +
      '<div class="wre-off-set-row">' +
        '<input type="password" id="wre-off-key-input" class="wre-off-input" placeholder="wrk-xxxxxxxx" autocomplete="off" spellcheck="false" value="' + escapeHtml(wrkKeyValue) + '">' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-off-toggle-key="1">显示</button>' +
      '</div>' +
      '<div class="wre-off-set-row">' +
        '<button class="wre-btn" data-wre-off-save="1">保存并校验</button>' +
        '<button class="wre-btn" data-wre-off-clear="1">清除 Key</button>' +
        '<button class="wre-btn wre-btn-small" data-wre-off-refresh-status="1">刷新状态</button>' +
      '</div>' +
      '<div class="wre-off-set-status">' + escapeHtml(statusLines) + '</div>' +
      (settingsMessage ? '<div class="wre-off-set-message">' + escapeHtml(settingsMessage) + '</div>' : '') +
      '<div class="wre-off-note">安全提醒：Key 等同你的账号读取权限，请勿粘贴到聊天、截图或提交到代码仓库；怀疑泄露时可在 App 里重置。</div>' +
      '<div class="wre-off-section-title">AI 增强（DeepSeek，可选）</div>' +
      '<div class="wre-off-note">可选：接入 DeepSeek 后，报告「执行摘要」由 AI 生成人格化解读（数字仍由本机规则计算，不交给 AI 算）。不配置则用默认的规则化摘要。</div>' +
      '<div class="wre-off-set-row">' +
        '<input type="password" id="wre-off-ai-key-input" class="wre-off-input" placeholder="sk-xxxxxxxx（可选）" autocomplete="off" spellcheck="false" value="' + escapeHtml(aiKeyValue) + '">' +
        '<button type="button" class="wre-btn wre-btn-small" data-wre-off-toggle-aikey="1">显示</button>' +
      '</div>' +
      '<div class="wre-off-set-row">' +
        '<button class="wre-btn" data-wre-off-save-ai="1">保存并校验</button>' +
        '<button class="wre-btn" data-wre-off-clear-ai="1">清除 AI Key</button>' +
      '</div>' +
      (aiSettingsMessage ? '<div class="wre-off-set-message">' + escapeHtml(aiSettingsMessage) + '</div>' : '') +
      '<div class="wre-off-set-status">AI 状态：' + (aiKeyStatus.hasKey ? '已配置（保存于 ' + fmtDateTime(aiKeyStatus.savedAt) + '）' : '未配置') + '</div>' +
      '<div class="wre-off-note">隐私提醒：启用 AI 后，报告生成时会把「笔记最多几本书」的划线/想法原文样本发送给 DeepSeek（api.deepseek.com）用于生成文字，请知悉。</div>';
  }

  // ---------- 面板 ----------

  function menuEntryExists(menu) {
    return !!menu.querySelector('[data-wre-official-entry]');
  }

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu) {
      return;
    }
    if (!menuEntryExists(menu)) {
      const item = document.createElement('div');
      item.className = 'wre-menu-item';
      item.setAttribute('data-action', 'official');
      item.setAttribute('data-wre-official-entry', '1');
      item.innerHTML = '<span class="wre-menu-icon">☁️</span>官方数据';
      item.addEventListener('click', () => {
        openPanel();
      });
      const anchor = menu.querySelector('[data-wre-notes-entry]') ||
        menu.querySelector('[data-wre-stats-entry]') ||
        menu.querySelector('[data-action="read-settings"]');
      if (anchor && anchor.nextSibling) {
        menu.insertBefore(item, anchor.nextSibling);
      } else if (anchor) {
        menu.appendChild(item);
      } else {
        menu.appendChild(item);
      }
      logOfficial('info', '已注入「官方数据」菜单入口');
    }

    if (!menu.querySelector('[data-wre-api-key-entry]')) {
      const keyItem = document.createElement('div');
      keyItem.className = 'wre-menu-item';
      keyItem.setAttribute('data-action', 'api-key');
      keyItem.setAttribute('data-wre-api-key-entry', '1');
      keyItem.innerHTML = '<span class="wre-menu-icon">🔑</span>API Key';
      keyItem.addEventListener('click', () => {
        openKeyPanel();
      });
      const keyAnchor = menu.querySelector('[data-action="restore-default"]');
      if (keyAnchor && keyAnchor.nextSibling) {
        menu.insertBefore(keyItem, keyAnchor.nextSibling);
      } else {
        menu.appendChild(keyItem);
      }
      logOfficial('info', '已注入「API Key」菜单入口');
    }
  }

  function buildPanel(root) {
    const existing = root.querySelector('#wre-official-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay wre-off-overlay';
    overlay.id = 'wre-official-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-off-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">☁️ 官方数据</span>' +
          '<button class="wre-modal-close" data-wre-off-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body wre-off-body" id="wre-off-body"></div>' +
      '</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-off-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closePanel());
    }
    overlay.addEventListener('click', handlePanelClick);
    overlay.addEventListener('change', handlePanelChange);
    root.appendChild(overlay);
    return overlay;
  }

  function buildKeyPanel(root) {
    const existing = root.querySelector('#wre-api-key-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay wre-off-overlay';
    overlay.id = 'wre-api-key-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-off-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">🔑 API Key</span>' +
          '<button class="wre-modal-close" data-wre-key-close>&times;</button>' +
        '</div>' +
        '<div class="wre-modal-body wre-off-body" id="wre-key-body"></div>' +
      '</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeKeyPanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-key-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeKeyPanel());
    }
    overlay.addEventListener('click', handlePanelClick);
    overlay.addEventListener('change', handlePanelChange);
    root.appendChild(overlay);
    return overlay;
  }

  function handlePanelClick(event) {
    const target = event.target;
    if (!target || !target.closest) {
      return;
    }
    const modeBtn = target.closest('[data-wre-off-mode]');
    if (modeBtn) {
      const next = modeBtn.getAttribute('data-wre-off-mode');
      if (next !== mode) {
        mode = next;
        loadReport(false);
      }
      return;
    }
    if (target.closest('[data-wre-off-refresh]')) {
      loadReport(true);
      return;
    }
    const exportBtn = target.closest('[data-wre-off-export]');
    if (exportBtn) {
      handleExport(exportBtn.getAttribute('data-wre-off-export'));
      return;
    }
    if (target.closest('[data-wre-off-goto-settings]')) {
      openKeyPanel();
      return;
    }
    if (target.closest('[data-wre-off-toggle-key]')) {
      const btn = target.closest('[data-wre-off-toggle-key]');
      const input = document.getElementById('wre-off-key-input');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '显示' : '隐藏';
        logOfficial('info', '切换 API Key 输入框为 ' + (input.type === 'password' ? '掩码' : '明文'));
      } else {
        logOfficial('warn', '切换失败：未找到 #wre-off-key-input');
      }
      return;
    }
    if (target.closest('[data-wre-off-toggle-aikey]')) {
      const btn = target.closest('[data-wre-off-toggle-aikey]');
      const input = document.getElementById('wre-off-ai-key-input');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '显示' : '隐藏';
        logOfficial('info', '切换 DeepSeek Key 输入框为 ' + (input.type === 'password' ? '掩码' : '明文'));
      } else {
        logOfficial('warn', '切换失败：未找到 #wre-off-ai-key-input');
      }
      return;
    }
    if (target.closest('[data-wre-off-save]')) {
      saveKey();
      return;
    }
    if (target.closest('[data-wre-off-clear]')) {
      clearKey();
      return;
    }
    if (target.closest('[data-wre-off-save-ai]')) {
      saveAiKey();
      return;
    }
    if (target.closest('[data-wre-off-clear-ai]')) {
      clearAiKey();
      return;
    }
    if (target.closest('[data-wre-off-refresh-status]')) {
      refreshKeyStatus().then(() => {
        settingsMessage = '状态已刷新：' + (keyStatus.hasKey ? '已配置' : '未配置');
        renderSettings();
      });
    }
  }

  function handlePanelChange() {
    // 预留：后续阶段（可视化 / 书架 / 笔记）的表单控件统一在这里分发
  }

  function saveKey() {
    const input = document.getElementById('wre-off-key-input');
    const value = input ? input.value.trim() : '';
    if (!value) {
      settingsMessage = '请先粘贴 API Key';
      renderSettings();
      return;
    }
    draftWrkKey = value;
    settingsMessage = '正在校验 Key…';
    renderSettings();
    sendBg({ type: 'wre-official-save', apiKey: value }).then((result) => {
      if (!result.ok) {
        settingsMessage = '保存失败：' + (result.error || '未知原因');
        logOfficial('warn', 'Key 保存失败', { code: result.code });
        renderSettings();
        return;
      }
      settingsMessage = '保存成功，Key 已通过校验';
      renderSettings();
      refreshKeyStatus().then(() => loadReport(true));
    });
  }

  function clearKey() {
    if (!window.confirm('确定清除本机保存的 API Key？清除后将无法读取官方数据。')) {
      return;
    }
    sendBg({ type: 'wre-official-clear' }).then(() => {
      report = null;
      reportState = 'idle';
      draftWrkKey = '';
      settingsMessage = '已清除 Key';
      refreshKeyStatus().then(() => renderSettings());
    });
  }

  async function refreshAiKeyStatus() {
    const result = await sendBg({ type: 'wre-ai-status' });
    if (result && result.ok) {
      aiKeyStatus = { hasKey: result.hasKey, apiKey: result.apiKey || '', savedAt: result.savedAt || 0 };
    }
    return aiKeyStatus;
  }

  function saveAiKey() {
    const input = document.getElementById('wre-off-ai-key-input');
    const value = input ? input.value.trim() : '';
    if (!value) {
      aiSettingsMessage = '请先粘贴 DeepSeek Key';
      renderSettings();
      return;
    }
    draftAiKey = value;
    aiSettingsMessage = '正在校验 DeepSeek Key…';
    renderSettings();
    sendBg({ type: 'wre-ai-save', apiKey: value }).then((result) => {
      if (!result.ok) {
        aiSettingsMessage = '保存失败：' + (result.error || '未知原因');
        logOfficial('warn', 'AI Key 保存失败', { code: result.code });
        renderSettings();
        return;
      }
      aiSettingsMessage = '保存成功，Key 已通过校验';
      aiSummary = null;
      aiPersona = null;
      aiState = 'idle';
      refreshAiKeyStatus().then(() => renderSettings());
    });
  }

  function clearAiKey() {
    if (!window.confirm('确定清除本机保存的 DeepSeek Key？清除后报告将退回规则化摘要。')) {
      return;
    }
    sendBg({ type: 'wre-ai-clear' }).then(() => {
      aiSummary = null;
      aiPersona = null;
      aiState = 'idle';
      draftAiKey = '';
      aiSettingsMessage = '已清除 AI Key';
      refreshAiKeyStatus().then(() => renderSettings());
    });
  }

  function openPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    closeKeyPanel();
    const overlay = buildPanel(root);
    overlay.classList.add('wre-visible');
    refreshKeyStatus().then(() => refreshAiKeyStatus()).then(() => {
      render();
      if (keyStatus.hasKey && (reportState === 'idle' || reportState === 'error')) {
        loadReport(false);
      }
    });
    logOfficial('info', '打开官方数据面板');
  }

  function closePanel() {
    const overlay = document.getElementById('wre-official-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  function render() {
    const overlay = document.getElementById('wre-official-modal');
    if (!overlay) {
      return;
    }
    const body = overlay.querySelector('#wre-off-body');
    if (!body) {
      return;
    }
    body.innerHTML = buildReportHtml();
    drawCharts(body);
  }

  function renderSettings() {
    const overlay = document.getElementById('wre-api-key-modal');
    if (!overlay) {
      return;
    }
    const body = overlay.querySelector('#wre-key-body');
    if (!body) {
      return;
    }
    body.innerHTML = buildSettingsHtml();
  }

  function openKeyPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    closePanel();
    const overlay = buildKeyPanel(root);
    overlay.classList.add('wre-visible');
    renderSettings();
    refreshKeyStatus().then(() => refreshAiKeyStatus()).then(() => {
      renderSettings();
    });
    logOfficial('info', '打开 API Key 设置面板');
  }

  function closeKeyPanel() {
    const overlay = document.getElementById('wre-api-key-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  // ---------- 导出 ----------

  // ---------- 报告模型（Markdown 与 HTML 共用同一份内容，避免两套渲染漂移） ----------
  //
  // 章节骨架参考「深度阅读画像」类报告：封面元信息 → 执行摘要 → 数据全景 →
  // 阅读轨迹与时间线 → 时段分布 → 偏好画像 → 读得最多 → 书的印象 → 成就勋章 → 附录。
  // 仅用官方 /readdata/detail 单接口可得的字段；需要书架/笔记数据的章节留待下一阶段。

  const HOUR_START = 6;   // 官方 preferTime 从 06:00 起算，索引 0 = 06:00
  const MEDAL_LIMIT = 24; // 勋章表最多列出条数

  const TIME_BANDS = [
    { start: 6, end: 9, label: '清晨 06:00–09:00' },
    { start: 9, end: 12, label: '上午 09:00–12:00' },
    { start: 12, end: 14, label: '午间 12:00–14:00' },
    { start: 14, end: 18, label: '下午 14:00–18:00' },
    { start: 18, end: 22, label: '晚间 18:00–22:00' },
    { start: 22, end: 24, label: '深夜 22:00–24:00' },
    { start: 0, end: 6, label: '凌晨 00:00–06:00' },
  ];

  function mdCell(value) {
    return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function maxOf(numbers) {
    return numbers.reduce((acc, value) => Math.max(acc, Number(value) || 0), 0);
  }

  /** 分桶明细（升序，含 0 时长桶） */
  function reportBuckets(data) {
    const source = data.readTimes || {};
    return Object.keys(source).map((key) => ({
      ts: Number(key),
      seconds: Number(source[key]) || 0,
    })).sort((a, b) => a.ts - b.ts);
  }

  function bucketSectionLabel(currentMode) {
    if (currentMode === 'overall') {
      return '年度阅读时长';
    }
    if (currentMode === 'annually') {
      return '月度阅读时长';
    }
    return '每日阅读时长';
  }

  function metricCards(data) {
    const compare = fmtCompare(data.compare);
    return [
      { label: '总时长', value: fmtDuration(data.totalReadTime) },
      { label: '阅读天数', value: (data.readDays || 0) + ' 天' },
      { label: '自然日均', value: data.dayAverageReadTime == null ? '—' : fmtDuration(data.dayAverageReadTime) },
      { label: '较上期', value: compare === null ? '—' : compare },
    ];
  }

  function officialSummary(data) {
    if (!Array.isArray(data.readStat)) {
      return [];
    }
    return data.readStat.map((item) => ({ label: item.stat, value: item.counts }));
  }

  /** preferTime（索引 0 = 06:00）→ 按 24 小时还原 */
  function hourlyReadTime(data) {
    const list = Array.isArray(data.preferTime) ? data.preferTime : [];
    if (list.length !== 24) {
      return [];
    }
    return list.map((seconds, index) => ({
      hour: (HOUR_START + index) % 24,
      seconds: Number(seconds) || 0,
    }));
  }

  function timeBands(data) {
    const hourly = hourlyReadTime(data);
    if (!hourly.length) {
      return [];
    }
    const byHour = {};
    hourly.forEach((item) => { byHour[item.hour] = item.seconds; });
    return TIME_BANDS.map((band) => {
      let seconds = 0;
      for (let hour = band.start; hour < band.end; hour += 1) {
        seconds += byHour[hour] || 0;
      }
      return { label: band.label, seconds: seconds };
    });
  }

  /** 客观解读：只陈述数据本身，不做性格/价值观推断 */
  function buildInsights(data, currentMode, buckets) {
    const items = [];
    const positive = buckets.filter((item) => item.seconds > 0);
    const total = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;

    let head = (currentMode === 'overall' ? '累计阅读总时长 ' : '本周期阅读总时长 ') +
      fmtDuration(data.totalReadTime) + '，覆盖 ' + (data.readDays || 0) + ' 天';
    if (data.dayAverageReadTime != null) {
      head += '，自然日均 ' + fmtDuration(data.dayAverageReadTime);
    }
    items.push(head + '。');

    const compare = fmtCompare(data.compare);
    if (compare !== null) {
      items.push('较上一周期' + (data.compare >= 0 ? '增长' : '下降') + ' ' +
        Math.abs(data.compare * 100).toFixed(1) + '%（官方 compare 口径，仅当前周期提供）。');
    } else {
      items.push(currentMode === 'overall' ? '累计口径官方未提供环比数据。' : '该周期官方未提供环比数据。');
    }

    if (positive.length) {
      const peak = positive.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      items.push('阅读最集中的周期是 ' + fmtBucketLabel(peak.ts, currentMode) + '，' + fmtDuration(peak.seconds) +
        '（占 ' + ((peak.seconds / total) * 100).toFixed(1) + '%）。');
      items.push('共 ' + buckets.length + ' 个统计单元，其中 ' + positive.length + ' 个有阅读记录。');
      items.push('单元均值 ' + fmtDuration(total / positive.length) + '。');
    }

    if (data.preferCategoryWord) {
      items.push('官方偏好判定：' + data.preferCategoryWord + '。');
    }
    if (data.preferTimeWord) {
      items.push('官方时段判定：' + data.preferTimeWord + '。');
    }
    if (Array.isArray(data.preferAuthor) && data.preferAuthor.length) {
      items.push('读得最多的作者是 ' + data.preferAuthor[0].name + '（' + data.preferAuthor[0].count + ' 本）。');
    }
    return items;
  }

  // ---- 书架 / 笔记（第二步接入：/shelf/sync、/user/notebooks）----

  /** 书架计数（严格按官方口径：总数含专辑与文章收藏入口） */
  function shelfCounts(shelf) {
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const albums = Array.isArray(shelf.albums) ? shelf.albums : [];
    const bookSecret = books.filter((item) => Number(item.secret) === 1).length;
    const albumSecret = albums.filter((item) => Number(item.secret) === 1).length;
    const secret = bookSecret + albumSecret + (shelf.hasMp ? 1 : 0);
    const publicCount = (books.length - bookSecret) + (albums.length - albumSecret);
    const top = books.filter((item) => Number(item.isTop) === 1).length +
      albums.filter((item) => Number(item.isTop) === 1).length;
    return {
      books: books.length,
      albums: albums.length,
      hasMp: !!shelf.hasMp,
      total: books.length + albums.length + (shelf.hasMp ? 1 : 0),
      secret: secret,
      publicCount: publicCount,
      top: top,
      finished: books.filter((item) => Number(item.finishReading) === 1).length,
    };
  }

  /** 书架电子书按「分类」聚合（降序，取前 CATEGORY_LIMIT 个） */
  function shelfCategories(shelf) {
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const map = {};
    books.forEach((item) => {
      const raw = item.category;
      const name = (typeof raw === 'string' ? raw : (raw && (raw.title || raw.name)) || '').trim() || '未分类';
      map[name] = (map[name] || 0) + 1;
    });
    const sorted = Object.keys(map).map((name) => ({ name: name, count: map[name] }))
      .sort((a, b) => b.count - a.count);
    return { list: sorted.slice(0, CATEGORY_LIMIT), more: Math.max(0, sorted.length - CATEGORY_LIMIT) };
  }

  /** 笔记概览统计（总条数优先用官方 totalNoteCount，分项用已拉取明细求和） */
  function notebookStats(notebooks) {
    if (!notebooks || !notebooks.ok) {
      return null;
    }
    const books = Array.isArray(notebooks.books) ? notebooks.books : [];
    const sum = (field) => books.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);
    const reviewTotal = sum('reviewCount');
    const noteTotal = sum('noteCount');
    const bookmarkTotal = sum('bookmarkCount');
    const totalNoteCount = (typeof notebooks.totalNoteCount === 'number' && notebooks.totalNoteCount >= 0)
      ? notebooks.totalNoteCount
      : reviewTotal + noteTotal + bookmarkTotal;
    const sorted = books.slice().sort((a, b) =>
      (b.reviewCount + b.noteCount + b.bookmarkCount) - (a.reviewCount + a.noteCount + a.bookmarkCount));
    return {
      totalBookCount: notebooks.totalBookCount || books.length,
      totalNoteCount: totalNoteCount,
      reviewTotal: reviewTotal,
      noteTotal: noteTotal,
      bookmarkTotal: bookmarkTotal,
      topBooks: sorted.slice(0, 10),
      truncated: !!notebooks.truncated,
    };
  }

  function finishStats(shelf) {
    const counts = shelfCounts(shelf);
    return {
      ebooks: counts.books,
      finished: counts.finished,
      reading: Math.max(0, counts.books - counts.finished),
      rate: counts.books ? counts.finished / counts.books : 0,
    };
  }

  /** 已读完的电子书（按最近阅读时间降序，取前 SHELF_BOOK_LIMIT 本） */
  function finishedBooks(shelf) {
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const done = books.filter((item) => Number(item.finishReading) === 1)
      .sort((a, b) => (Number(b.readUpdateTime) || 0) - (Number(a.readUpdateTime) || 0));
    return { list: done.slice(0, SHELF_BOOK_LIMIT), total: done.length, more: Math.max(0, done.length - SHELF_BOOK_LIMIT) };
  }

  /**
   * 阅读人格画像（客观规则化类型归类）。
   * 只用客观统计指标按固定阈值归类，输出「维度 / 类型画像 / 判定依据」三元组；
   * 不做性格、价值观等主观推断（红线）。数据不足的维度自动跳过。
   */
  function buildPersona(data, currentMode, shelf, notebooks) {
    const tags = [];
    const counts = shelf ? shelfCounts(shelf) : null;
    const fin = shelf ? finishStats(shelf) : null;
    const notes = notebookStats(notebooks);
    const cats = shelf ? shelfCategories(shelf) : null;

    // A 完读倾向（电子书 finishReading）
    if (fin && fin.ebooks > 0) {
      const pct = (fin.rate * 100).toFixed(0) + '%';
      const basis = '电子书完读率 ' + pct + '（读完 ' + fin.finished + ' / ' + fin.ebooks + ' 本）';
      if (fin.rate >= 0.6) {
        tags.push(['完读倾向', '善始善终型', basis]);
      } else if (fin.rate >= 0.3) {
        tags.push(['完读倾向', '随性而为型', basis]);
      } else {
        tags.push(['完读倾向', '广泛涉猎型', basis]);
      }
    }

    // B 笔记投入（有笔记的书平均每本笔记条数）
    if (notes && notes.totalBookCount > 0) {
      const avg = notes.totalNoteCount / notes.totalBookCount;
      const basis = '有笔记的书平均每本约 ' + avg.toFixed(1) + ' 条笔记';
      if (avg >= 5) {
        tags.push(['笔记投入', '深度精读型', basis]);
      } else if (avg >= 1) {
        tags.push(['笔记投入', '适度批注型', basis]);
      } else {
        tags.push(['笔记投入', '少记浏览型', basis]);
      }
    }

    // C 主题聚焦（书架分类集中度）
    if (cats && cats.list.length && counts && counts.books > 0) {
      const top = cats.list[0];
      const share = top.count / counts.books;
      const basis = '「' + top.name + '」占电子书 ' + (share * 100).toFixed(0) + '%';
      if (share >= 0.5) {
        tags.push(['主题聚焦', '主题聚焦型', basis]);
      } else if (share < 0.3 && (cats.list.length + cats.more) >= 5) {
        tags.push(['主题聚焦', '兴趣广博型', basis + '，分类较分散']);
      } else {
        tags.push(['主题聚焦', '多元均衡型', basis]);
      }
    }

    // D 内容形态（电子书 vs 有声书/专辑）
    if (counts && counts.albums > 0 && counts.total > 0) {
      const basis = '书架含 ' + counts.albums + ' 个有声书/专辑';
      if (counts.albums / counts.total >= 0.3) {
        tags.push(['内容形态', '听读兼修型', basis]);
      } else {
        tags.push(['内容形态', '以读为主型', basis]);
      }
    }

    // E 阅读时段（官方仅在「累计」周期返回 preferTime）
    const hourly = hourlyReadTime(data);
    if (hourly.length) {
      const peak = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      const h = peak.hour;
      let label;
      if (h >= 21 || h < 6) {
        label = '夜读型';
      } else if (h >= 6 && h < 9) {
        label = '晨读型';
      } else if (h >= 11 && h < 14) {
        label = '午间型';
      } else {
        label = '日间型';
      }
      tags.push(['阅读时段', label, '全天峰值出现在 ' + pad2(h) + ':00 前后']);
    }

    return tags;
  }

  // 读取当前微信读书网页版登录昵称（本机账号）。
  // 优先从 cookie 的 wr_name（微信读书 web 登录态，昵称做了 URL 编码）读取；
  // 再尝试 localStorage 常见字段；均拿不到返回空串，由调用方回退默认文案。
  function getReaderNickname() {
    const readName = (raw) => {
      if (!raw) {
        return '';
      }
      let val = String(raw).trim();
      if (!val) {
        return '';
      }
      try {
        val = decodeURIComponent(val);
      } catch (e) {
        // 不是 URL 编码，直接用原文
      }
      val = String(val).trim();
      // 昵称一般很短；过长多半是误读，直接放弃
      return (val && val.length <= 40) ? val : '';
    };

    // 1) cookie：wr_name（URL 编码昵称）
    try {
      const m = document.cookie.match(/(?:^|;\s*)wr_name=([^;]*)/);
      const name = readName(m && m[1]);
      if (name) {
        logOfficial('info', '已取到读者昵称（来源 cookie.wr_name）', { len: name.length });
        return name;
      }
    } catch (e) {
      logOfficial('warn', '读取 cookie 昵称异常', { err: String(e && e.message) });
    }

    // 2) localStorage 常见字段
    try {
      const keys = ['wr_name', 'userName', 'nickname', 'userInfo', 'wr_userInfo', 'wr_user'];
      for (const key of keys) {
        let raw = null;
        try {
          raw = localStorage.getItem(key);
        } catch (e) {
          continue;
        }
        if (!raw) {
          continue;
        }
        // userInfo / user 可能是 JSON，先尝试解析出 name/nickname
        if (/info|user/i.test(key)) {
          try {
            const obj = JSON.parse(raw);
            const n = readName(obj && (obj.name || obj.nickname || obj.nickName));
            if (n) {
              logOfficial('info', '已取到读者昵称（来源 localStorage.' + key + '）', { len: n.length });
              return n;
            }
          } catch (e) {
            // 非 JSON，走下面的明文分支
          }
        }
        const n = readName(raw);
        if (n) {
          logOfficial('info', '已取到读者昵称（来源 localStorage.' + key + '）', { len: n.length });
          return n;
        }
      }
    } catch (e) {
      logOfficial('warn', '读取 localStorage 昵称异常', { err: String(e && e.message) });
    }

    logOfficial('info', '未取到读者昵称，回退默认文案');
    return '';
  }

  function buildReportModel(data, currentMode, overviewData) {
    const blocks = [];
    const buckets = reportBuckets(data);
    const shelf = overviewData && overviewData.shelf ? overviewData.shelf : null;
    const notebooks = overviewData && overviewData.notebooks ? overviewData.notebooks : null;
    const sources = ['/readdata/detail'];
    if (shelf) {
      sources.push('/shelf/sync');
    }
    if (notebooks) {
      sources.push('/user/notebooks');
    }

    blocks.push({ type: 'kv', rows: [
      ['报告对象', getReaderNickname() || '微信读书用户（本机账号）'],
      ['数据来源', '微信读书官方 Agent Skill · ' + sources.join(' · ')],
      ['统计周期', modeLabel(currentMode)],
      ['生成时间', fmtDateTime(Date.now())],
      ['skill 版本', keyStatus.skillVersion || '1.0.4'],
      ['分析方法', aiState === 'ok'
        ? '客观数据本机规则计算，执行摘要由 DeepSeek AI 生成'
        : '基于官方统计与偏好字段的规则化解读（纯本地执行）'],
    ]});

    if (overviewState === 'error' || overviewState === 'partial') {
      blocks.push({ type: 'note', text: '提示：' + overviewError + '，相关章节已省略（不影响其余章节）。' });
    }

    // 一、执行摘要（优先用 DeepSeek AI 生成的人格化解读，否则退回规则化摘要）
    // 两者都固定基于「累计（总体）」数据，与上方周期选择无关。
    blocks.push({ type: 'heading', level: 2, text: '一、执行摘要' });
    blocks.push({ type: 'note', text: overallReport
      ? '本节执行摘要与下方「人性化人格分析」均基于累计（总体）数据，不随上方周期切换变化；正文各章节仍按所选周期统计。'
      : '本次未取到累计（总体）数据，执行摘要暂按所选周期（' + modeLabel(currentMode) + '）展示。' });
    if (aiState === 'ok' && aiSummary && aiSummary.length) {
      aiSummary.forEach((para) => {
        blocks.push({ type: 'paragraph', text: para });
      });
      blocks.push({ type: 'note', text: '本执行摘要由 DeepSeek AI 基于本机计算的客观数据与划线/想法原文样本生成；具体数字以正文各章节的规则化统计为准。' });
    } else {
      const summaryData = overallReport || data;
      const summaryInsights = buildInsights(summaryData, overallReport ? 'overall' : currentMode, reportBuckets(summaryData));
      blocks.push({ type: 'paragraph', text: summaryInsights[0] });
      if (summaryInsights.length > 1) {
        blocks.push({ type: 'list', ordered: true, items: summaryInsights.slice(1) });
      }
      if (aiState === 'error') {
        blocks.push({ type: 'note', text: 'AI 解读生成失败（' + aiError + '），已退回规则化摘要。' });
      } else if (aiState === 'skipped') {
        blocks.push({ type: 'note', text: '未配置 DeepSeek Key，当前为规则化摘要。在「🔑 API Key」里配置 DeepSeek 后，导出时可生成人格化执行摘要与人性化人格分析。' });
      }
    }

    // 人性化人格分析（DeepSeek，可选）：紧跟在执行摘要之后，放在文档最上方
    if (aiPersona && aiPersona.length) {
      blocks.push({ type: 'heading', level: 3, text: '人性化人格分析' });
      aiPersona.forEach((point) => {
        if (point && point.title) {
          blocks.push({ type: 'heading', level: 4, text: point.title });
        }
        if (point && point.body) {
          blocks.push({ type: 'paragraph', text: point.body });
        }
      });
      blocks.push({ type: 'note', text: '本段人格分析由 DeepSeek AI 基于本机计算的客观数据与划线/想法原文样本生成，属参考性解读，不构成专业心理或性格鉴定。' });
    }

    // 二、数据全景
    blocks.push({ type: 'heading', level: 2, text: '二、数据全景' });
    blocks.push({ type: 'heading', level: 3, text: '2.1 核心指标' });
    blocks.push({ type: 'cards', items: metricCards(data) });
    if (shelf) {
      const counts = shelfCounts(shelf);
      blocks.push({ type: 'heading', level: 3, text: '2.2 书架结构' });
      blocks.push({ type: 'kv', rows: [
        ['书架条目总数', counts.total + ' 个'],
        ['电子书', counts.books + ' 本'],
        ['专辑 / 有声书', counts.albums + ' 个'],
        ['文章收藏入口', counts.hasMp ? '有' : '无'],
        ['公开 / 私密', counts.publicCount + ' / ' + counts.secret],
        ['置顶', counts.top + ' 个'],
      ]});
      blocks.push({ type: 'note', text: '官方口径：书架总数 = 电子书 + 专辑/有声书 +（有文章收藏入口时 +1）；文章收藏入口固定计入私密阅读。' });
    }
    const summary = officialSummary(data);
    if (summary.length) {
      blocks.push({ type: 'heading', level: 3, text: '2.3 官方概要' });
      blocks.push({ type: 'chips', items: summary });
    }
    const categories = Array.isArray(data.preferCategory) ? data.preferCategory : [];
    if (categories.length) {
      const categoryTotal = categories.reduce((acc, item) => acc + (item.readingTime || 0), 0) || 1;
      blocks.push({ type: 'heading', level: 3, text: '2.4 偏好分类（按阅读时长）' });
      blocks.push({
        type: 'table',
        head: ['分类', '读过', '时长', '占比'],
        num: [1, 2, 3],
        bar: { after: 0, max: maxOf(categories.map((item) => item.readingTime)), values: categories.map((item) => item.readingTime || 0) },
        rows: categories.map((item) => [
          item.parentCategoryTitle || item.categoryTitle || '未分类',
          (item.readingCount || 0) + ' 本',
          fmtDuration(item.readingTime),
          (((item.readingTime || 0) / categoryTotal) * 100).toFixed(1) + '%',
        ]),
      });
      blocks.push({
        type: 'chart',
        kind: 'hbar',
        payload: {
          labels: categories.map((item) => item.parentCategoryTitle || item.categoryTitle || '未分类'),
          values: categories.map((item) => item.readingTime || 0),
        },
      });
      if (data.preferCategoryWord) {
        blocks.push({ type: 'callout', text: '官方判定：' + data.preferCategoryWord });
      }
    }

    // 三、阅读轨迹与时间线
    blocks.push({ type: 'heading', level: 2, text: '三、阅读轨迹与时间线' });
    blocks.push({ type: 'heading', level: 3, text: '3.1 ' + bucketSectionLabel(currentMode) });
    const positive = buckets.filter((item) => item.seconds > 0);
    if (!positive.length) {
      blocks.push({ type: 'empty', text: '该周期官方未返回分桶明细' });
    } else {
      const bucketTotal = positive.reduce((acc, item) => acc + item.seconds, 0) || 1;
      blocks.push({
        type: 'table',
        head: ['周期', '时长', '占比'],
        num: [1, 2],
        bar: { after: 0, max: maxOf(positive.map((item) => item.seconds)), values: positive.map((item) => item.seconds) },
        rows: positive.map((item) => [
          fmtBucketLabel(item.ts, currentMode),
          fmtDuration(item.seconds),
          (((item.seconds) / bucketTotal) * 100).toFixed(1) + '%',
        ]),
      });
      blocks.push({
        type: 'chart',
        kind: 'line',
        payload: {
          labels: positive.map((item) => fmtBucketLabel(item.ts, currentMode)),
          values: positive.map((item) => item.seconds),
        },
      });
      const hidden = buckets.length - positive.length;
      if (hidden > 0) {
        blocks.push({ type: 'note', text: '已隐藏 ' + hidden + ' 个 0 时长周期。' });
      }
    }

    // 四、阅读时段分布（官方仅在「累计」周期提供 preferTime）
    const bands = timeBands(data);
    if (bands.length) {
      const bandTotal = bands.reduce((acc, item) => acc + item.seconds, 0) || 1;
      blocks.push({ type: 'heading', level: 2, text: '四、阅读时段分布' });
      blocks.push({
        type: 'table',
        head: ['时段', '时长', '占比'],
        num: [1, 2],
        bar: { after: 0, max: maxOf(bands.map((item) => item.seconds)), values: bands.map((item) => item.seconds) },
        rows: bands.map((item) => [item.label, fmtDuration(item.seconds), ((item.seconds / bandTotal) * 100).toFixed(1) + '%']),
      });
      const hourly = hourlyReadTime(data);
      if (hourly.length) {
        blocks.push({
          type: 'chart',
          kind: 'heatmap',
          payload: {
            hours: hourly.map((item) => item.hour),
            values: hourly.map((item) => item.seconds),
          },
        });
      }
      const peakHour = hourly.reduce((acc, item) => (item.seconds > acc.seconds ? item : acc));
      blocks.push({ type: 'note', text: '全天峰值出现在 ' + pad2(peakHour.hour) + ':00 前后，' + fmtDuration(peakHour.seconds) +
        '（占 ' + ((peakHour.seconds / bandTotal) * 100).toFixed(1) + '%）。' });
    }

    // 五、偏好画像
    const authors = Array.isArray(data.preferAuthor) ? data.preferAuthor : [];
    const publishers = Array.isArray(data.preferPublisher) ? data.preferPublisher : [];
    const partners = Array.isArray(data.preferCp) ? data.preferCp : [];
    if (authors.length || publishers.length || partners.length) {
      blocks.push({ type: 'heading', level: 2, text: '五、偏好画像' });
      if (authors.length) {
        blocks.push({ type: 'heading', level: 3, text: '5.1 偏好作者' });
        blocks.push({
          type: 'table',
          head: ['作者', '本数', '时长'],
          num: [1, 2],
          rows: authors.slice(0, 10).map((item) => [
            item.name || '未知',
            (item.count != null ? item.count : item.authorCount || 0) + ' 本',
            item.readTime != null ? fmtDuration(item.readTime) : '—',
          ]),
        });
      }
      if (publishers.length) {
        blocks.push({ type: 'heading', level: 3, text: '5.2 偏好出版社' });
        blocks.push({
          type: 'table',
          head: ['出版社', '本数'],
          num: [1],
          rows: publishers.slice(0, 10).map((item) => [item.name || '未知', (item.count || 0) + ' 本']),
        });
      }
      if (partners.length) {
        blocks.push({ type: 'heading', level: 3, text: '5.3 偏好版权方' });
        blocks.push({
          type: 'table',
          head: ['版权方', '本数'],
          num: [1],
          rows: partners.slice(0, 10).map((item) => [
            (item.copyrightInfo && item.copyrightInfo.name) || '未知',
            (item.count || 0) + ' 本',
          ]),
        });
      }
    }

    // 六、读得最多
    const longest = Array.isArray(data.readLongest) ? data.readLongest : [];
    blocks.push({ type: 'heading', level: 2, text: '六、读得最多' });
    if (!longest.length) {
      blocks.push({ type: 'empty', text: '该周期内没有达到官方展示门槛的书（官方会过滤约 5 分钟以下的内容）' });
    } else {
      blocks.push({
        type: 'table',
        head: ['排名', '书名', '作者', '时长', '标签'],
        num: [0, 3],
        rows: longest.slice(0, 10).map((item, index) => {
          const book = item.book || {};
          const album = item.albumInfo || {};
          return [
            String(index + 1),
            book.title || album.name || '未命名',
            book.author || album.author || '—',
            fmtDuration(item.readTime),
            Array.isArray(item.tags) && item.tags.length ? item.tags.join(' · ') : '—',
          ];
        }),
      });
    }

    // 七、书的印象（官方按书架语义给每个分类挑出的代表书）
    const impressions = Array.isArray(data.preferBooks) ? data.preferBooks : [];
    const impressionRows = impressions.map((item) => {
      const info = item.bookInfo || item.albumInfo || {};
      return [item.title || '—', info.title || info.name || '—', info.author || '—'];
    }).filter((row) => row[1] !== '—');
    if (impressionRows.length) {
      blocks.push({ type: 'heading', level: 2, text: '七、书的印象' });
      blocks.push({
        type: 'table',
        head: ['官方标签', '书名', '作者'],
        rows: impressionRows,
      });
    }

    // 八、成就勋章（官方仅在「累计」周期提供）
    const medals = Array.isArray(data.medals) ? data.medals : [];
    if (medals.length) {
      blocks.push({ type: 'heading', level: 2, text: '八、成就勋章' });
      blocks.push({
        type: 'table',
        head: ['勋章', '获取条件', '获得时间'],
        rows: medals.slice(0, MEDAL_LIMIT).map((item) => [
          item.name || item.title || '—',
          item.availableCond || item.hint || '—',
          item.atime ? fmtDateTime(item.atime * 1000) : '—',
        ]),
      });
      if (medals.length > MEDAL_LIMIT) {
        blocks.push({ type: 'note', text: '共 ' + medals.length + ' 枚勋章，此处列出前 ' + MEDAL_LIMIT + ' 枚。' });
      }
    }

    // 九、知识脉络（书架分类分布）—— 只做客观聚合，不做「认知/价值观」推断
    if (shelf) {
      const catRows = shelfCategories(shelf);
      if (catRows.list.length) {
        const catTotal = catRows.list.reduce((acc, item) => acc + item.count, 0) || 1;
        blocks.push({ type: 'heading', level: 2, text: '九、知识脉络' });
        blocks.push({ type: 'heading', level: 3, text: '9.1 书架分类分布' });
        blocks.push({
          type: 'table',
          head: ['分类', '本数', '占比'],
          num: [1, 2],
          bar: { after: 0, max: maxOf(catRows.list.map((item) => item.count)), values: catRows.list.map((item) => item.count) },
          rows: catRows.list.map((item) => [item.name, item.count + ' 本', ((item.count / catTotal) * 100).toFixed(1) + '%']),
        });
        if (catRows.more > 0) {
          blocks.push({ type: 'note', text: '另有 ' + catRows.more + ' 个分类未列出（按本数降序取前 ' + CATEGORY_LIMIT + ' 个）。' });
        }
        blocks.push({ type: 'note', text: '口径：按书架电子书的「分类」字段聚合，反映书架构成，不等同于实际阅读量。' });
      }
    }

    // 十、笔记行为
    const notes = notebookStats(notebooks);
    if (notes) {
      blocks.push({ type: 'heading', level: 2, text: '十、笔记行为' });
      blocks.push({ type: 'heading', level: 3, text: '10.1 概览' });
      blocks.push({ type: 'kv', rows: [
        ['有笔记的书', notes.totalBookCount + ' 本'],
        ['笔记总条数', notes.totalNoteCount + ' 条'],
        ['其中 · 想法 / 点评', notes.reviewTotal + ' 条'],
        ['其中 · 划线', notes.noteTotal + ' 条'],
        ['其中 · 书签', notes.bookmarkTotal + ' 条'],
      ]});
      blocks.push({ type: 'heading', level: 3, text: '10.2 笔记最多的书' });
      if (notes.topBooks.length) {
        blocks.push({
          type: 'table',
          head: ['书名', '想法·点评', '划线', '书签', '合计'],
          num: [1, 2, 3, 4],
          rows: notes.topBooks.map((item) => [
            item.title || '未命名',
            String(item.reviewCount),
            String(item.noteCount),
            String(item.bookmarkCount),
            String(item.reviewCount + item.noteCount + item.bookmarkCount),
          ]),
        });
      } else {
        blocks.push({ type: 'empty', text: '暂无带笔记的书。' });
      }
      if (notes.truncated) {
        blocks.push({ type: 'note', text: '已在 ' + NOTEBOOKS_MAX_PAGES + ' 页处截断（每页 ' + NOTEBOOKS_PAGE_SIZE + ' 本），「笔记最多的书」可能未覆盖全部。' });
      }
      blocks.push({ type: 'note', text: '口径：笔记数 = 想法/点评 + 划线 + 书签；书签只统计数量，不含内容。' });
    }

    // 十一、完读率
    if (shelf) {
      const fin = finishStats(shelf);
      if (fin.ebooks > 0) {
        blocks.push({ type: 'heading', level: 2, text: '十一、完读率' });
        blocks.push({ type: 'cards', items: [
          { label: '读完', value: fin.finished + ' 本' },
          { label: '在读', value: fin.reading + ' 本' },
          { label: '完读率', value: (fin.rate * 100).toFixed(1) + '%' },
          { label: '电子书总数', value: fin.ebooks + ' 本' },
        ]});
        blocks.push({
          type: 'chart',
          kind: 'donut',
          payload: { finished: fin.finished, reading: fin.reading },
        });
        blocks.push({ type: 'note', text: '口径：完读率 = 电子书中 finishReading=1 的本数 ÷ 电子书总数；不含专辑/有声书。' });
      }
    }

    // 十二、已读完书目
    if (shelf) {
      const finished = finishedBooks(shelf);
      if (finished.list.length) {
        blocks.push({ type: 'heading', level: 2, text: '十二、已读完书目' });
        blocks.push({
          type: 'table',
          head: ['书名', '作者', '分类', '最近阅读'],
          rows: finished.list.map((item) => [
            item.title || '未命名',
            item.author || '—',
            item.category || '—',
            item.readUpdateTime ? fmtDateTime(item.readUpdateTime * 1000) : '—',
          ]),
        });
        blocks.push({
          type: 'note',
          text: finished.more > 0
            ? '累计读完 ' + finished.total + ' 本，此处按最近阅读时间列出前 ' + SHELF_BOOK_LIMIT + ' 本。'
            : '累计读完 ' + finished.total + ' 本，已全部列出。',
        });
      }
    }

    // 十三、阅读人格画像（客观规则化类型归类；人性化解读见文档开头「人性化人格分析」）
    const persona = buildPersona(data, currentMode, shelf, notebooks);
    if (persona.length) {
      blocks.push({ type: 'heading', level: 2, text: '十三、阅读人格画像' });
      blocks.push({
        type: 'table',
        head: ['维度', '类型画像', '判定依据'],
        rows: persona,
      });
      blocks.push({ type: 'note', text: '口径：以上类型标签由客观统计指标按固定阈值归类（完读率 / 笔记密度 / 分类集中度 / 有声书占比 / 时段峰值），属客观画像，不构成性格、价值观等主观判断；数据不足的维度自动省略。' + (aiPersona && aiPersona.length ? '更深层的人性化解读见文档开头的「人性化人格分析」。' : '') });
    }

    // 附录：数据说明
    blocks.push({ type: 'heading', level: 2, text: '附录：数据说明' });
    blocks.push({ type: 'list', items: [
      '数据采集：微信读书官方 Agent Skill —— /readdata/detail（mode=' + currentMode + '，按时段统计）' +
        (shelf ? '、/shelf/sync（书架）' : '') +
        (notebooks ? '、/user/notebooks（笔记概览）' : '') +
        '；skill_version ' + (keyStatus.skillVersion || '1.0.4') + '。',
      '时长口径：官方所有时长字段单位为秒，本报告已转为可读文案。',
      '分桶口径：官方按「中国时区零点」划分统计单元并编码为 UTC 秒，本报告已按中国时区展示日期。',
      '自然日均：「分母」是自然日，非阅读天数，故数值偏小属正常。',
      '环比：官方仅对当前周期返回 compare，其它周期显示「—」。',
      '书架口径：书架条目 = 电子书 + 专辑/有声书 +（有文章收藏入口时 +1）；文章收藏入口固定计入私密阅读；分类分布按电子书「分类」字段聚合。',
      '笔记口径：笔记数 = 想法/点评(reviewCount) + 划线(noteCount) + 书签(bookmarkCount)；书签只统计数量、不含内容。',
      '偏好字段：preferCategory / preferAuthor / preferPublisher / preferCp / preferTime 由官方按各周期可得性返回，缺失即不展示对应小节。',
      '分析边界：本报告为基于官方统计与偏好字段的规则化解读；「阅读人格画像」的客观标签为按固定阈值的类型归类，「人性化人格分析」为 DeepSeek AI 参考性解读，均不构成性格、价值观等主观判断或专业鉴定。',
      '分析口径：「一、执行摘要」与「人性化人格分析」固定基于累计（总体）数据（mode=overall），不随上方周期切换变化；正文各章节按所选周期统计。',
      '隐私：报告在浏览器本机生成，数据不上传；API Key 仅保存在本机。',
    ]});
    blocks.push({ type: 'heading', level: 3, text: '尚未覆盖的章节' });
    blocks.push({ type: 'list', items: [
      '想法与划线深度解读（需接入 /review/list/mine、/book/bestbookmarks 的原文内容）',
      '价值取向与精神底色（主观语义层面，已由「十三、阅读人格画像」中的 AI 人性化人格分析提供参考性解读）',
    ]});
    return blocks;
  }

  // ---------- 渲染器 ----------

  // ---------- Canvas 图表（原生 Canvas，零依赖；面板与导出 HTML 共用） ----------
  // 自包含：不依赖任何闭包变量 / 外部函数，可被 toString() 序列化进导出 HTML。
  function drawCharts(container) {
    if (!container || !container.querySelectorAll) {
      return;
    }
    const COLORS = { accent: '#07c160', soft: '#e8f8ef', line: '#e8ebe9', ink: '#1f2328', ink2: '#5b6570' };
    const nodes = container.querySelectorAll('.wre-chart');
    if (!nodes.length) {
      return;
    }

    function setup(canvas, w, h) {
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      return ctx;
    }

    function shortDur(sec) {
      sec = Number(sec) || 0;
      if (sec >= 3600) {
        return (sec / 3600).toFixed(sec >= 36000 ? 0 : 1) + 'h';
      }
      if (sec >= 60) {
        return Math.round(sec / 60) + 'm';
      }
      return sec + 's';
    }

    function maxOf(values) {
      let m = 0;
      (values || []).forEach((v) => { m = Math.max(m, Number(v) || 0); });
      return m;
    }

    function font(size, weight) {
      return (weight || '') + ' ' + size + 'px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
    }

    function drawLine(canvas, data, w) {
      const h = 180;
      const padL = 46, padR = 14, padT = 16, padB = 26;
      const iw = Math.max(1, w - padL - padR);
      const ih = h - padT - padB;
      const values = (data.values || []).map((v) => Number(v) || 0);
      const labels = data.labels || [];
      const max = Math.max(1, maxOf(values));
      const ctx = setup(canvas, w, h);
      ctx.strokeStyle = COLORS.line;
      ctx.fillStyle = COLORS.ink2;
      ctx.font = font(10);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 2; i++) {
        const y = padT + ih - (ih * i / 2);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillText(shortDur(max * i / 2), padL - 6, y);
      }
      const step = values.length > 1 ? iw / (values.length - 1) : iw;
      const points = values.map((v, idx) => ({ x: padL + step * idx, y: padT + ih - (ih * v / max) }));
      if (points.length) {
        ctx.beginPath();
        ctx.moveTo(padL, padT + ih);
        points.forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, padT + ih);
        ctx.closePath();
        ctx.fillStyle = 'rgba(7,193,96,.10)';
        ctx.fill();
        ctx.beginPath();
        points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        points.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = COLORS.accent;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
      ctx.fillStyle = COLORS.ink2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelStep = Math.max(1, Math.ceil(labels.length / 6));
      labels.forEach((lb, idx) => {
        if (idx % labelStep === 0) {
          ctx.fillText(lb, padL + step * idx, padT + ih + 7);
        }
      });
    }

    function drawHbar(canvas, data, w) {
      const labels = data.labels || [];
      const values = (data.values || []).map((v) => Number(v) || 0);
      const rowH = 30;
      const padL = 92, padR = 48, padT = 8, padB = 8;
      const h = padT + padB + rowH * labels.length;
      const ctx = setup(canvas, w, h);
      const max = Math.max(1, maxOf(values));
      const barW = Math.max(1, w - padL - padR);
      ctx.font = font(12);
      labels.forEach((lb, idx) => {
        const y = padT + rowH * idx;
        const v = values[idx] || 0;
        const label = String(lb || '').length > 6 ? String(lb).slice(0, 6) + '…' : String(lb || '');
        ctx.fillStyle = COLORS.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, y + rowH / 2);
        ctx.fillStyle = COLORS.line;
        ctx.fillRect(padL, y + 8, barW, 12);
        const bw = barW * (v / max);
        if (bw > 0) {
          ctx.fillStyle = COLORS.accent;
          ctx.fillRect(padL, y + 8, bw, 12);
        }
        ctx.fillStyle = COLORS.ink2;
        ctx.textAlign = 'left';
        ctx.fillText(shortDur(v), padL + barW + 8, y + rowH / 2);
      });
    }

    function drawHeatmap(canvas, data, w) {
      const hours = data.hours || [];
      const values = (data.values || []).map((v) => Number(v) || 0);
      const cols = 6;
      const rows = Math.max(1, Math.ceil(hours.length / cols));
      const cellH = 32;
      const blockH = 16;
      const gap = 3;
      const h = 4 + cellH * rows;
      const ctx = setup(canvas, w, h);
      const max = Math.max(1, maxOf(values));
      const cellW = (w - gap * (cols - 1)) / cols;
      ctx.font = font(10);
      hours.forEach((hour, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = col * (cellW + gap);
        const y = 4 + row * cellH;
        const v = values[idx] || 0;
        const alpha = v > 0 ? 0.15 + 0.85 * (v / max) : 0.06;
        ctx.fillStyle = 'rgba(7,193,96,' + alpha.toFixed(3) + ')';
        ctx.fillRect(x, y, cellW, blockH);
        ctx.fillStyle = v > 0 ? '#0a5c30' : COLORS.ink2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((hour < 10 ? '0' : '') + hour, x + cellW / 2, y + blockH + 10);
      });
    }

    function drawDonut(canvas, data) {
      const size = 150;
      const ctx = setup(canvas, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const r = 56;
      const finished = Number(data.finished) || 0;
      const reading = Number(data.reading) || 0;
      const total = finished + reading;
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.soft;
      ctx.lineWidth = 18;
      ctx.stroke();
      if (total > 0) {
        const ang = (finished / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ang);
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 18;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.fillStyle = COLORS.ink;
      ctx.font = font(22, '700');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(total ? Math.round((finished / total) * 100) + '%' : '0%', cx, cy - 6);
      ctx.fillStyle = COLORS.ink2;
      ctx.font = font(11);
      ctx.fillText('完读率', cx, cy + 20);
    }

    nodes.forEach((node) => {
      const kind = node.getAttribute('data-kind');
      const w = node.clientWidth || 560;
      let payload = {};
      try {
        payload = JSON.parse(node.getAttribute('data-payload') || '{}');
      } catch (err) {
        payload = {};
      }
      const canvas = document.createElement('canvas');
      canvas.className = 'wre-chart-canvas';
      node.appendChild(canvas);
      if (kind === 'line') {
        drawLine(canvas, payload, w);
      } else if (kind === 'hbar') {
        drawHbar(canvas, payload, w);
      } else if (kind === 'heatmap') {
        drawHeatmap(canvas, payload, w);
      } else if (kind === 'donut') {
        drawDonut(canvas, payload);
      }
    });
  }

  function renderMarkdownModel(model) {
    const lines = [];
    model.forEach((block) => {
      if (block.type === 'heading') {
        lines.push('#'.repeat(block.level) + ' ' + mdCell(block.text), '');
      } else if (block.type === 'paragraph') {
        lines.push(mdCell(block.text), '');
      } else if (block.type === 'callout' || block.type === 'note') {
        lines.push('> ' + mdCell(block.text), '');
      } else if (block.type === 'empty') {
        lines.push('（' + mdCell(block.text) + '）', '');
      } else if (block.type === 'cards') {
        lines.push('| 指标 | 数值 |', '| --- | --- |');
        block.items.forEach((item) => lines.push('| ' + mdCell(item.label) + ' | ' + mdCell(item.value) + ' |'));
        lines.push('');
      } else if (block.type === 'chips') {
        lines.push(block.items.map((item) => '**' + mdCell(item.label) + '** ' + mdCell(item.value)).join(' ｜ '), '');
      } else if (block.type === 'list') {
        block.items.forEach((item, index) => {
          lines.push((block.ordered ? (index + 1) + '. ' : '- ') + mdCell(item));
        });
        lines.push('');
      } else if (block.type === 'kv') {
        lines.push('| 项目 | 内容 |', '| --- | --- |');
        block.rows.forEach((row) => lines.push('| ' + mdCell(row[0]) + ' | ' + mdCell(row[1]) + ' |'));
        lines.push('');
      } else if (block.type === 'table') {
        lines.push('| ' + block.head.map(mdCell).join(' | ') + ' |');
        lines.push('| ' + block.head.map(() => '---').join(' | ') + ' |');
        block.rows.forEach((row) => lines.push('| ' + row.map(mdCell).join(' | ') + ' |'));
        lines.push('');
      }
    });
    return lines.join('\n');
  }

  function renderHtmlBlock(block) {
    if (block.type === 'heading') {
      let tag = 'h2';
      let cls = 'sec';
      if (block.level === 3) {
        tag = 'h3';
        cls = 'sub';
      } else if (block.level >= 4) {
        tag = 'h4';
        cls = 'sub2';
      }
      let text = escapeHtml(block.text);
      // 分点编号高亮：「第一、」「第二、」等序号用强调色突出
      if (block.level >= 4) {
        const m = text.match(/^(第[一二三四五六七八九十百]+[、，.:：])/);
        if (m) {
          text = '<span class="idx">' + m[1] + '</span>' + text.slice(m[1].length);
        }
      }
      return '<' + tag + ' class="' + cls + '">' + text + '</' + tag + '>';
    }
    if (block.type === 'paragraph') {
      return '<p class="p">' + escapeHtml(block.text) + '</p>';
    }
    if (block.type === 'callout') {
      return '<div class="callout">' + escapeHtml(block.text) + '</div>';
    }
    if (block.type === 'note') {
      return '<div class="note">' + escapeHtml(block.text) + '</div>';
    }
    if (block.type === 'empty') {
      return '<div class="empty">' + escapeHtml(block.text) + '</div>';
    }
    if (block.type === 'cards') {
      return '<div class="cards">' + block.items.map((item) =>
        '<div class="card"><div class="label">' + escapeHtml(item.label) + '</div>' +
        '<div class="value">' + escapeHtml(item.value) + '</div></div>'
      ).join('') + '</div>';
    }
    if (block.type === 'chips') {
      return '<div class="chips">' + block.items.map((item) =>
        '<span class="chip">' + escapeHtml(item.label) + ' <b>' + escapeHtml(item.value) + '</b></span>'
      ).join('') + '</div>';
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return '<' + tag + ' class="list">' + block.items.map((item) =>
        '<li>' + escapeHtml(item) + '</li>'
      ).join('') + '</' + tag + '>';
    }
    if (block.type === 'kv') {
      return '<table class="kv"><tbody>' + block.rows.map((row) =>
        '<tr><th>' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1]) + '</td></tr>'
      ).join('') + '</tbody></table>';
    }
    if (block.type === 'table') {
      const bar = block.bar || null;
      const isNum = (index) => Array.isArray(block.num) && block.num.indexOf(index) >= 0;
      const head = block.head.map((cell, index) => {
        const extra = (bar && index === bar.after) ? '<th class="bar-th"></th>' : '';
        return '<th' + (isNum(index) ? ' class="num"' : '') + '>' + escapeHtml(cell) + '</th>' + extra;
      }).join('');
      const body = block.rows.map((row, rowIndex) => {
        const cells = row.map((cell, index) => {
          const extra = (bar && index === bar.after)
            ? '<td class="bar-td"><div class="bar"><i style="width:' +
              Math.max(2, Math.round(((Number(bar.values[rowIndex]) || 0) / (bar.max || 1)) * 100)) + '%"></i></div></td>'
            : '';
          return '<td' + (isNum(index) ? ' class="num"' : '') + '>' + escapeHtml(cell) + '</td>' + extra;
        }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
      return '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    }
    if (block.type === 'chart') {
      return '<div class="wre-chart" data-kind="' + escapeHtml(block.kind) + '" data-payload="' +
        escapeHtml(JSON.stringify(block.payload || {})) + '"></div>';
    }
    return '';
  }

  function buildStandaloneHtml() {
    const model = buildReportModel(report || {}, mode, overview);
    const exportedAt = fmtDateTime(Date.now());
    const source = reportFromCache
      ? '数据来自 ' + fmtDateTime(reportAt) + ' 的本地缓存'
      : '数据于 ' + fmtDateTime(reportAt) + ' 拉取';
    const upgradeBanner = upgradeInfo
      ? '<div class="warn">⚠️ 官方提示需要升级 skill：' +
        escapeHtml(upgradeInfo.message || upgradeInfo.skill_version || '请更新到最新版') +
        '<a href="https://cdn.weread.qq.com/skills/weread-skills.zip" target="_blank" rel="noreferrer">下载官方 skill 包</a></div>'
      : '';
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>微信悦读 · 阅读行为报告（' + escapeHtml(modeLabel(mode)) + '）</title>',
      '<style>' + reportStyles() + '</style>',
      '</head>',
      '<body>',
      '<div class="page">',
      '  <header class="hero">',
      '    <div>',
      '      <h1>阅读行为报告</h1>',
      '      <p class="sub">微信悦读 · weread-enhancer · ' + escapeHtml(modeLabel(mode)) + '</p>',
      '    </div>',
      '    <div class="meta">导出时间<strong>' + escapeHtml(exportedAt) + '</strong></div>',
      '  </header>',
      upgradeBanner,
      model.map(renderHtmlBlock).join('\n'),
      '  <footer class="foot">',
      '    <div>' + escapeHtml(source) + '。</div>',
      '    <div>本报告基于微信读书官方数据在本机生成，分析为规则化解读，仅供参考。</div>',
      '  </footer>',
      '</div>',
      '<button class="print-btn no-print" id="wre-off-report-print">打印 / 另存为 PDF</button>',
      '<script>(' + drawCharts.toString() + ')(document.body);</script>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stampSuffix() {
    const today = new Date();
    return today.getFullYear() + pad2(today.getMonth() + 1) + pad2(today.getDate());
  }

  function exportMarkdown() {
    if (!report) {
      return;
    }
    const filename = '微信悦读-阅读行为报告-' + mode + '-' + stampSuffix() + '.md';
    downloadFile(filename, renderMarkdownModel(buildReportModel(report, mode, overview)), 'text/markdown;charset=utf-8');
    logOfficial('info', '已导出报告', { format: 'markdown', mode: mode, filename: filename });
  }

  function exportHtml() {
    if (!report) {
      return;
    }
    const filename = '微信悦读-阅读行为报告-' + mode + '-' + stampSuffix() + '.html';
    downloadFile(filename, buildStandaloneHtml(), 'text/html;charset=utf-8');
    logOfficial('info', '已导出报告', { format: 'html', mode: mode, filename: filename });
  }

  function exportPdf() {
    if (!report) {
      return;
    }
    if (!openReportForPrint(buildStandaloneHtml())) {
      return;
    }
    logOfficial('info', '已打开打印视图（可另存为 PDF）', { mode: mode });
  }

  async function handleExport(format) {
    if (reportState !== 'ok' || !report) {
      logOfficial('warn', '报告未就绪，忽略导出请求', { format: format });
      return;
    }
    // 导出时才按需生成 AI 解读，避免打开报告就消耗 DeepSeek token；
    // 已生成过（ok/error）则不重复调用，切换周期后 aiState 会重置回 idle。
    if (aiKeyStatus.hasKey && aiState === 'idle') {
      await runAIEnhance();
    }
    if (format === 'html') {
      exportHtml();
    } else if (format === 'pdf') {
      exportPdf();
    } else {
      exportMarkdown();
    }
  }

  // ---------- HTML 报告样式（自包含，可下载 / 可打印成 PDF） ----------

  function reportStyles() {
    return [
      ':root{--accent:#07c160;--accent-soft:#e8f8ef;--ink:#1f2328;--ink-2:#5b6570;--line:#e8ebe9;--bg:#f4f6f5;--warn:#b8860b}',
      '*{box-sizing:border-box}',
      'html,body{margin:0;padding:0}',
      'body{background:var(--bg);color:var(--ink);font:14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      '.page{max-width:840px;margin:32px auto;padding:40px 44px;background:#fff;border-radius:18px;box-shadow:0 12px 32px rgba(17,24,28,.08)}',
      '.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:22px;border-bottom:2px solid var(--line)}',
      '.hero h1{margin:0;font-size:26px;letter-spacing:.5px}',
      '.hero h1::before{content:"";display:inline-block;width:10px;height:24px;margin-right:10px;border-radius:3px;background:var(--accent);vertical-align:-3px}',
      '.hero .sub{margin:6px 0 0;font-size:12px;color:var(--ink-2)}',
      '.hero .meta{text-align:right;font-size:12px;color:var(--ink-2);white-space:nowrap}',
      '.hero .meta strong{display:block;margin-top:2px;font-size:14px;color:var(--ink)}',
      'h2.sec{margin:34px 0 14px;font-size:16px;font-weight:700;letter-spacing:.3px;padding-left:12px;border-left:4px solid var(--accent)}',
      'h3.sub{margin:22px 0 10px;font-size:14px;font-weight:600}',
      'h4.sub2{margin:16px 0 6px;padding-left:10px;border-left:3px solid var(--accent);font-size:14px;font-weight:700;color:var(--ink)}',
      'h4.sub2 .idx{color:var(--accent)}',
      '.p{margin:0 0 12px;text-indent:2em}',
      '.callout{margin:12px 0;padding:10px 14px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0;font-size:13px}',
      '.note{margin:10px 0;font-size:12px;color:var(--ink-2)}',
      '.list{margin:0 0 12px;padding-left:2em}',
      '.list li{margin-bottom:6px;break-inside:avoid}',
      '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:14px 0}',
      '.card{padding:16px 18px;border-radius:14px;background:var(--accent-soft);border-left:4px solid var(--accent)}',
      '.card .label{font-size:12px;color:var(--ink-2)}',
      '.card .value{margin-top:8px;font-size:20px;font-weight:700;letter-spacing:.3px}',
      '.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}',
      '.chip{padding:4px 12px;border:1px solid var(--line);border-radius:999px;font-size:12px;color:var(--ink-2)}',
      '.chip b{color:var(--accent)}',
      '.warn{margin:16px 0;padding:12px 14px;border:1px dashed var(--warn);border-radius:12px;font-size:12px}',
      '.warn a{margin-left:6px;color:var(--accent)}',
      'table{width:100%;border-collapse:collapse;font-size:13px;margin:0 0 14px}',
      'th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}',
      'th{font-size:12px;font-weight:600;color:var(--ink-2);background:#fafbfa}',
      'tbody tr:nth-child(even){background:#f6f8f7}',
      'td.num,th.num{text-align:right;white-space:nowrap}',
      'table.kv{margin-bottom:22px}',
      'table.kv th{width:110px;font-weight:600;background:transparent;color:var(--ink-2);white-space:nowrap}',
      'th.bar-th,td.bar-td{width:34%}',
      '.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}',
      '.bar i{display:block;height:100%;border-radius:4px;background:var(--accent)}',
      '.empty{padding:18px;font-size:13px;color:var(--ink-2);background:#fafbfa;border:1px dashed var(--line);border-radius:10px}',
      '.wre-chart{margin:14px 0;width:100%;break-inside:avoid}',
      '.wre-chart-canvas{display:block;max-width:100%}',
      '.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;line-height:1.8;color:var(--ink-2)}',
      '.print-btn{position:fixed;right:24px;bottom:24px;padding:12px 20px;border:0;border-radius:999px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 20px rgba(7,193,96,.35)}',
      '.print-btn:hover{filter:brightness(1.05)}',
      '@media screen{body{padding-bottom:96px}}',
      '@media (max-width:720px){.page{margin:16px;padding:24px}.cards{grid-template-columns:repeat(2,1fr)}.hero{flex-direction:column;align-items:flex-start}.hero .meta{text-align:left}}',
      '@media print{@page{size:A4;margin:14mm}body{background:#fff}.page{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}.no-print{display:none!important}h2.sec,h3.sub,h4.sub2{break-after:avoid}.card,.list li,tr{break-inside:avoid}}',
    ].join('');
  }

  function openReportForPrint(html) {
    const win = window.open('', '_blank');
    if (!win) {
      logOfficial('warn', 'PDF 导出被拦截：浏览器阻止了新窗口，请允许本站弹出窗口后重试');
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    const printBtn = win.document.getElementById('wre-off-report-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => win.print());
    }
    // 等浏览器完成首帧渲染再唤起打印对话框
    setTimeout(() => {
      try {
        win.print();
      } catch (error) {
        logOfficial('warn', '唤起打印失败，可手动按 Ctrl/Cmd+P', { error: String(error) });
      }
    }, 400);
    return true;
  }

  // ---------- 启动 ----------

  function attach(root) {
    injectMenuEntry(root);
    refreshKeyStatus().then(() => {
      logOfficial('info', '官方数据模块已启动', { hasKey: keyStatus.hasKey });
    });
  }

  function bootstrap() {
    // 跨模块跳转：笔记模块遇到「未配置 / Key 失效」时会派发此事件，引导用户到设置页配 Key
    document.addEventListener('wre-open-key-settings', () => {
      settingsMessage = '';
      openKeyPanel();
      logOfficial('info', '收到跨模块跳转请求：打开 API Key 设置面板');
    });

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
    logOfficial('debug', '等待插件根容器出现后接入官方数据模块');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
