/**
 * 官方数据取数层（H5 版）
 *
 * 来源：mobile/miniprogram/shared/data.js（口径一致），仅把 wx 存储 / 云调用换成：
 *   - 缓存：localStorage（见 store.js 的 cacheGet/cacheSet）
 *   - 网关：api.relay（Key 由服务端按 deviceId 托管）
 * 只做「取数 + 整形 + 缓存」，不做任何 UI。
 */

import { relay } from './api.js';
import { cacheGet, cacheSet } from './store.js';
import { notebookStats } from './core/report-core.js';

const OVERVIEW_CACHE_KEY = 'overview';
const OVERVIEW_TTL_MS = 30 * 60 * 1000;   // 书架 + 笔记概览缓存：30 分钟
const CORPUS_CACHE_KEY = 'persona_corpus';
const CORPUS_TTL_MS = 10 * 60 * 1000;     // 语料缓存：10 分钟

const NOTEBOOKS_PAGE_SIZE = 100;
const NOTEBOOKS_MAX_PAGES = 5;
const PERSONA_TOP_BOOKS = 5;
const PERSONA_MARK_MAX = 400;
const PERSONA_CORPUS_MAX = 2000;

// ---- 单次 readdata ----
export function fetchReadData(mode) {
  return relay('/readdata/detail', { mode: mode || 'overall', baseTime: 0 });
}

// ---- 书架整形 ----
export function slimShelf(data) {
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

export function slimNotebook(item) {
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
export async function fetchNotebooks() {
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
    const res = await relay('/user/notebooks', params);
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
export async function fetchOverview(force) {
  if (!force) {
    const cached = cacheGet(OVERVIEW_CACHE_KEY, OVERVIEW_TTL_MS);
    if (cached) {
      return { ok: true, fromCache: true, shelf: cached.shelf || null, notebooks: cached.notebooks || null };
    }
  }
  const shelfRes = await relay('/shelf/sync', {});
  const notesRes = await fetchNotebooks();
  const shelf = shelfRes.ok ? slimShelf(shelfRes.data) : null;
  const notebooks = notesRes.ok ? notesRes : null;

  if (!shelf && !notebooks) {
    return {
      ok: false,
      code: shelfRes.code || notesRes.code || 'overview',
      error: '书架与笔记数据均未取到：' + (shelfRes.error || notesRes.error || '未知原因'),
    };
  }
  cacheSet(OVERVIEW_CACHE_KEY, { shelf: shelf, notebooks: notebooks });
  return { ok: true, fromCache: false, shelf: shelf, notebooks: notebooks };
}

/** 只读本机缓存，绝不发请求（供首页懒加载 B 档） */
export function peekOverview() {
  const cached = cacheGet(OVERVIEW_CACHE_KEY, OVERVIEW_TTL_MS);
  if (cached) {
    return { ok: true, fromCache: true, shelf: cached.shelf || null, notebooks: cached.notebooks || null };
  }
  return { ok: false, code: 'nocache', error: '暂无本地缓存' };
}

// ---- 单本书划线原文 ----
export async function fetchBookMarks(bookId) {
  const marks = [];
  const res = await relay('/book/bookmarklist', { bookId: bookId });
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
export async function fetchBookReviewItems(bookId) {
  const items = [];
  let synckey = 0;
  let more = true;
  for (let page = 0; page < 5 && more; page += 1) {
    const res = await relay('/review/list/mine', { bookid: bookId, synckey: synckey, count: 50 });
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
export async function fetchCorpus(notebooks, force) {
  if (!force) {
    const cached = cacheGet(CORPUS_CACHE_KEY, CORPUS_TTL_MS);
    if (cached && Array.isArray(cached.books)) {
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
      const pair = await Promise.all([fetchBookMarks(bookId), fetchBookReviewItems(bookId)]);
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
    cacheSet(CORPUS_CACHE_KEY, corpus);
    return { ok: true, fromCache: false, corpus: corpus };
  } catch (err) {
    return { ok: false, code: 'corpus', error: '语料拉取失败：' + ((err && err.message) || '未知错误') };
  }
}
