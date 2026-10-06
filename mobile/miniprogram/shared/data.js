/**
 * 官方数据拉取层 — 小程序端共享模块
 *
 * 来源：口径对齐插件 modules/official.js 的 slimShelf / slimNotebook / fetchNotebooks /
 *       ensurePersonaCorpus；只做「取数 + 整形 + 缓存」，不做任何 UI。
 * 红线：API Key 由调用方传入，本模块只转发、不落库、不写日志（日志仅掩码）。
 */

const { callGateway } = require('./gateway');
const { notebookStats } = require('./report-core');

const OVERVIEW_CACHE_KEY = 'wre_overview_cache';
const OVERVIEW_TTL_MS = 30 * 60 * 1000;   // 书架 + 笔记概览缓存：30 分钟（与周期无关，变动慢）
const CORPUS_CACHE_KEY = 'wre_persona_corpus_cache';
const CORPUS_TTL_MS = 10 * 60 * 1000;     // 语料缓存：10 分钟

const NOTEBOOKS_PAGE_SIZE = 100;          // /user/notebooks 每页条数
const NOTEBOOKS_MAX_PAGES = 5;            // 最多翻 5 页（500 本）
const PERSONA_TOP_BOOKS = 5;              // 语料：取「笔记最多」的前 N 本书
const PERSONA_MARK_MAX = 400;             // 语料：单本书最多取 N 条划线
const PERSONA_CORPUS_MAX = 2000;          // 语料：总条数上限（防极端账号卡顿）

// ---- 单次 readdata ----
function fetchReadData(mode, apiKey) {
  return callGateway('/readdata/detail', { mode: mode || 'overall', baseTime: 0 }, apiKey);
}

// ---- 书架整形 ----
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
      cover: info.cover || '',
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

// ---- 逐页拉取 /user/notebooks（游标分页：count + lastSort）----
async function fetchNotebooks(apiKey) {
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
    const res = await callGateway('/user/notebooks', params, apiKey);
    if (!res.ok) {
      if (page === 0) {
        return { ok: false, code: res.code, error: res.error };
      }
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

// ---- 书架 + 笔记概览（30 分钟缓存）----
async function fetchOverview(apiKey, force) {
  if (!force) {
    const cached = readCache(OVERVIEW_CACHE_KEY);
    if (cached && (Date.now() - (cached.at || 0)) < OVERVIEW_TTL_MS) {
      return { ok: true, fromCache: true, shelf: cached.shelf || null, notebooks: cached.notebooks || null };
    }
  }
  const shelfRes = await callGateway('/shelf/sync', {}, apiKey);
  const notesRes = await fetchNotebooks(apiKey);
  const shelf = shelfRes.ok ? slimShelf(shelfRes.data) : null;
  const notebooks = notesRes.ok ? notesRes : null;

  if (!shelf && !notebooks) {
    return {
      ok: false,
      code: shelfRes.code || notesRes.code || 'overview',
      error: '书架与笔记数据均未取到：' + (shelfRes.error || notesRes.error || '未知原因'),
    };
  }
  const payload = { at: Date.now(), shelf: shelf, notebooks: notebooks };
  writeCache(OVERVIEW_CACHE_KEY, payload);
  return { ok: true, fromCache: false, shelf: shelf, notebooks: notebooks };
}

// ---- 书架 + 笔记概览：只读本机缓存，绝不发请求（供首页懒加载 B 档）----
function peekOverview() {
  const cached = readCache(OVERVIEW_CACHE_KEY);
  if (cached && (Date.now() - (cached.at || 0)) < OVERVIEW_TTL_MS) {
    return { ok: true, fromCache: true, shelf: cached.shelf || null, notebooks: cached.notebooks || null };
  }
  return { ok: false, code: 'nocache', error: '暂无本地缓存' };
}

// ---- 单本书划线原文 ----
async function fetchBookMarks(bookId, apiKey) {
  const marks = [];
  const res = await callGateway('/book/bookmarklist', { bookId: bookId }, apiKey);
  if (res && res.ok && res.data) {
    const updated = Array.isArray(res.data.updated) ? res.data.updated : [];
    updated.forEach((item) => {
      const text = item && item.markText;
      if (typeof text === 'string' && text.trim()) {
        marks.push({ text: text.trim(), at: item.createTime || item.markTime || 0 });
      }
    });
  }
  return marks.slice(0, PERSONA_MARK_MAX);
}

// ---- 单本书想法/点评原文（游标分页）----
async function fetchBookReviewItems(bookId, apiKey) {
  const items = [];
  let synckey = 0;
  let more = true;
  for (let page = 0; page < 5 && more; page += 1) {
    const res = await callGateway('/review/list/mine', { bookid: bookId, synckey: synckey, count: 50 }, apiKey);
    if (!res || !res.ok || !res.data) {
      break;
    }
    const reviews = Array.isArray(res.data.reviews) ? res.data.reviews : [];
    reviews.forEach((item) => {
      const r = item && item.review;
      if (r && typeof r.content === 'string' && r.content.trim()) {
        items.push({ text: r.content.trim(), at: r.createTime || 0 });
      }
    });
    synckey = res.data.synckey != null ? res.data.synckey : synckey;
    more = Number(res.data.hasMore) === 1;
  }
  return items;
}

// ---- 人格语料：笔记最多的前 N 本书的划线/想法全文（10 分钟缓存）----
async function fetchCorpus(notebooks, apiKey, force) {
  if (!force) {
    const cached = readCache(CORPUS_CACHE_KEY);
    if (cached && Array.isArray(cached.books) && (Date.now() - (cached.at || 0)) < CORPUS_TTL_MS) {
      return { ok: true, fromCache: true, corpus: cached };
    }
  }
  const stats = notebookStats(notebooks);
  const topBooks = stats && Array.isArray(stats.topBooks) ? stats.topBooks.slice(0, PERSONA_TOP_BOOKS) : [];
  if (!topBooks.length) {
    return { ok: false, code: 'nocorpus', error: '暂无带笔记的书，暂时做不了词语分析' };
  }
  try {
    const books = [];
    let total = 0;
    for (let i = 0; i < topBooks.length; i += 1) {
      if (total >= PERSONA_CORPUS_MAX) {
        break;
      }
      const book = topBooks[i];
      const bookId = book && book.bookId;
      if (!bookId) {
        continue;
      }
      const pair = await Promise.all([fetchBookMarks(bookId, apiKey), fetchBookReviewItems(bookId, apiKey)]);
      const marks = pair[0];
      const reviews = pair[1];
      books.push({
        bookId: bookId,
        title: (book && book.title) || '未命名',
        author: (book && book.author) || '',
        marks: marks,
        reviews: reviews,
      });
      total += marks.length + reviews.length;
    }
    const corpus = { at: Date.now(), books: books };
    writeCache(CORPUS_CACHE_KEY, corpus);
    return { ok: true, fromCache: false, corpus: corpus };
  } catch (err) {
    return { ok: false, code: 'corpus', error: '语料拉取失败：' + ((err && err.message) || '未知错误') };
  }
}

// ---- 本地缓存工具 ----
function readCache(key) {
  try {
    const value = wx.getStorageSync(key);
    return value || null;
  } catch (err) {
    return null;
  }
}

function writeCache(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {
    // 缓存写失败不影响主流程
  }
}

module.exports = {
  fetchReadData,
  fetchNotebooks,
  fetchOverview,
  peekOverview,
  fetchBookMarks,
  fetchBookReviewItems,
  fetchCorpus,
  slimShelf,
  slimNotebook,
};
