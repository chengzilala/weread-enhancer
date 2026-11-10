/**
 * 本机素材库（M17）— 划线 / 想法原文只在本人手机上，云端只做「一次代拉」的中转。
 *
 * 为什么不再每次现拉：
 *   过去每天首次生成要串行调用 12–36 次云函数（概览 2–6 次 + 语料 10–30 次），
 *   过夜缓存必过期，所以「每天第一次最慢」。现在把原文落本机，7 天内复用，每天最多增量刷新一次。
 *
 * 存储键：wre_material_v1
 *   { at, books: { bookId: {bookId,title,author,marks,reviews,fetchedAt} }, rotation: {daily:[],wander:[]} }
 * 红线：只存本机；不上传、不写日志正文；单键写保护（小程序单 key 上限 1MB）。
 */
const logger = require('./logger');

const KEY = 'wre_material_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 7 * DAY_MS;        // 素材库有效期：7 天
const REFRESH_MS = DAY_MS;        // 每天最多增量刷新一次
const MAX_ITEMS = 3000;           // 总条数上限
const MAX_CHARS = 700000;         // 单键体积保护
const PER_BOOK_MARKS = 150;       // 单本最多留 N 条划线
const PER_BOOK_REVIEWS = 60;      // 单本最多留 N 条想法
const ROTATION_MAX = 10;          // 取书轮换窗口

function empty() {
  return { at: 0, books: {}, rotation: { daily: [], wander: [] } };
}

function read() {
  try {
    const value = wx.getStorageSync(KEY);
    if (!value || typeof value !== 'object') {
      return empty();
    }
    return {
      at: Number(value.at) || 0,
      books: value.books && typeof value.books === 'object' ? value.books : {},
      rotation: {
        daily: Array.isArray(value.rotation && value.rotation.daily) ? value.rotation.daily : [],
        wander: Array.isArray(value.rotation && value.rotation.wander) ? value.rotation.wander : [],
      },
    };
  } catch (err) {
    return empty();
  }
}

function write(store) {
  try {
    wx.setStorageSync(KEY, store);
    return true;
  } catch (err) {
    logger.warn('material', '本机素材库写入失败', err);
    return false;
  }
}

function load() {
  return read();
}

function bookCount(store) {
  return Object.keys((store || read()).books).length;
}

/** 归一化文本（去空白与标点），只用于库内去重 */
function textKey(text) {
  return String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
}

/** 单本内去重 + 截断 */
function slimItems(list, max) {
  const seen = {};
  const out = [];
  (Array.isArray(list) ? list : []).forEach((item) => {
    const text = item && typeof item.text === 'string' ? item.text.trim() : '';
    const key = textKey(text);
    if (!key || seen[key] || out.length >= max) {
      return;
    }
    seen[key] = true;
    out.push({ text: text, at: Number(item.at) || 0 });
  });
  return out;
}

/** 条数 / 体积双重保护：先按条数丢，再从最旧的书开始丢 */
function compact(store) {
  const ids = Object.keys(store.books).sort((a, b) => (store.books[b].fetchedAt || 0) - (store.books[a].fetchedAt || 0));
  let total = 0;
  ids.forEach((id) => {
    const book = store.books[id];
    if (!book) {
      return;
    }
    if (total >= MAX_ITEMS) {
      delete store.books[id];
      return;
    }
    total += (book.marks ? book.marks.length : 0) + (book.reviews ? book.reviews.length : 0);
  });
  const oldestFirst = ids.slice().reverse();
  for (let i = 0; i < oldestFirst.length; i += 1) {
    if (JSON.stringify(store).length <= MAX_CHARS) {
      break;
    }
    delete store.books[oldestFirst[i]];
  }
}

/** 合并一批云端代拉的原文（同书整体替换，刷新 fetchedAt） */
function mergeBooks(books) {
  const store = read();
  const now = Date.now();
  let changed = 0;
  (Array.isArray(books) ? books : []).forEach((book) => {
    if (!book || !book.bookId) {
      return;
    }
    const old = store.books[book.bookId] || {};
    const marks = slimItems(book.marks, PER_BOOK_MARKS);
    const reviews = slimItems(book.reviews, PER_BOOK_REVIEWS);
    if (!marks.length && !reviews.length) {
      return;
    }
    store.books[book.bookId] = {
      bookId: book.bookId,
      title: book.title || old.title || '未命名',
      author: book.author || old.author || '',
      marks: marks,
      reviews: reviews,
      fetchedAt: now,
    };
    changed += 1;
  });
  if (!changed) {
    return store;
  }
  store.at = now;
  compact(store);
  write(store);
  return store;
}

/** 素材库 → 扁平素材池 [{bookId,title,author,kind,text,at}]（新的书在前） */
function toPool(store) {
  const s = store || read();
  const ids = Object.keys(s.books).sort((a, b) => (s.books[b].fetchedAt || 0) - (s.books[a].fetchedAt || 0));
  const out = [];
  ids.forEach((id) => {
    const book = s.books[id];
    if (!book) {
      return;
    }
    (Array.isArray(book.marks) ? book.marks : []).forEach((item) => {
      if (item && item.text && out.length < MAX_ITEMS) {
        out.push({ bookId: id, title: book.title || '', author: book.author || '', kind: 'mark', text: item.text, at: item.at || 0 });
      }
    });
    (Array.isArray(book.reviews) ? book.reviews : []).forEach((item) => {
      if (item && item.text && out.length < MAX_ITEMS) {
        out.push({ bookId: id, title: book.title || '', author: book.author || '', kind: 'review', text: item.text, at: item.at || 0 });
      }
    });
  });
  return out;
}

/** 是否需要刷新：超过 1 天，或素材库不足 2 本书 */
function needsRefresh(store) {
  const s = store || read();
  if (!s.at || (Date.now() - s.at) > REFRESH_MS) {
    return true;
  }
  return bookCount(s) < 2;
}

/** 是否已整体过期（7 天） */
function isExpired(store) {
  const s = store || read();
  return !s.at || (Date.now() - s.at) > TTL_MS;
}

/**
 * 取书轮换：优先取「最近没取过」的书，取完再回到最早的书。
 * @param {object} notebooks /user/notebooks 整形结果 {books:[{bookId,title,author,noteCount,reviewCount,...}]}
 * @param {string} mode daily / wander
 * @param {number} count 本次取几本
 * @returns {Array} [{bookId,title,author}]
 */
function pickBooks(notebooks, mode, count) {
  const list = notebooks && Array.isArray(notebooks.books) ? notebooks.books : [];
  const score = (book) => (Number(book.noteCount) || 0) + (Number(book.reviewCount) || 0) + (Number(book.bookmarkCount) || 0);
  const candidates = list.filter((book) => book && book.bookId && score(book) > 0);
  if (!candidates.length) {
    return [];
  }
  const sorted = candidates.slice().sort((a, b) => score(b) - score(a));
  const store = read();
  const key = mode === 'wander' ? 'wander' : 'daily';
  const used = store.rotation[key] || [];
  const ids = sorted.map((book) => book.bookId);
  const freshIds = ids.filter((id) => used.indexOf(id) < 0);
  const oldIds = ids.filter((id) => used.indexOf(id) >= 0);
  const picked = freshIds.concat(oldIds).slice(0, Math.max(1, Number(count) || 3));
  const merged = [];
  used.concat(picked).forEach((id) => {
    if (merged.indexOf(id) < 0) {
      merged.push(id);
    }
  });
  store.rotation[key] = merged.slice(-ROTATION_MAX);
  write(store);
  return picked.map((id) => {
    const book = sorted.filter((item) => item.bookId === id)[0] || {};
    return { bookId: id, title: book.title || '', author: book.author || '' };
  });
}

module.exports = {
  KEY,
  TTL_MS,
  read,
  load,
  bookCount,
  mergeBooks,
  toPool,
  needsRefresh,
  isExpired,
  pickBooks,
};
