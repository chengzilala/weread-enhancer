/**
 * 每日卡片回顾（M11 · M17 取数）· 素材池构建
 *
 * 数据落点：划线 / 想法原文只存**本人手机**（素材库 material-store，7 天），
 *   云端只做「一次代拉」的中转（云函数 action:'pool'），不落库、不写原文日志。
 *
 * 取数策略（M17）：
 *   1) 素材库可用（≤7 天且当天已刷过）→ 直接返回，0 次云函数调用；
 *   2) 需要刷新（超 1 天 / 不足 2 本 / 手动刷新）→ 按轮换取书，1 次代拉补齐；
 *   3) 代拉失败但库里有旧数据 → 降级用旧数据（断网也能出卡片）。
 */
const data = require('./data');
const gateway = require('./gateway');
const materialStore = require('./material-store');
const logger = require('./logger');

// 每次代拉取几本书：每日 2 本（够跨书 ≥2），漫游 3 本（够跨书 ≥3）
const PICK_COUNT = { daily: 2, wander: 3 };

/** 语料（corpus）→ 扁平素材池（旧链路保留，供兜底 / 兼容调用） */
function buildPool(corpus) {
  const out = [];
  const books = corpus && Array.isArray(corpus.books) ? corpus.books : [];
  books.forEach((book) => {
    const bookId = (book && book.bookId) || '';
    const title = (book && book.title) || '';
    const author = (book && book.author) || '';
    const marks = (book && book.marks) || [];
    const reviews = (book && book.reviews) || [];
    marks.forEach((item) => {
      if (item && typeof item.text === 'string' && item.text.trim()) {
        out.push({ bookId: bookId, title: title, author: author, kind: 'mark', text: item.text.trim(), at: item.at || 0 });
      }
    });
    reviews.forEach((item) => {
      if (item && typeof item.text === 'string' && item.text.trim()) {
        out.push({ bookId: bookId, title: title, author: author, kind: 'review', text: item.text.trim(), at: item.at || 0 });
      }
    });
  });
  return out;
}

/**
 * 拉取素材池（优先本机素材库）。
 * @param {string} apiKey 显式 Key（一般不传，走云端托管 Key）
 * @param {boolean} force true=手动刷新，忽略当天缓存强制代拉
 * @param {string} mode daily / wander
 * @returns {object} { ok:true, pool, fromCache, callCount } 或 { ok:false, code, error }
 */
async function fetchPool(apiKey, force, mode) {
  const m = mode === 'wander' ? 'wander' : 'daily';
  const started = Date.now();
  const store = materialStore.load();
  const cached = materialStore.toPool(store);
  const needRefresh = !!force || materialStore.isExpired(store) || !cached.length || materialStore.needsRefresh(store);

  if (!needRefresh) {
    logger.log('material', '素材库命中', {
      mode: m,
      books: materialStore.bookCount(store),
      items: cached.length,
      ms: Date.now() - started,
    });
    return { ok: true, pool: cached, fromCache: true, callCount: 0 };
  }

  // 选书：优先读 24h 笔记缓存（不发请求）；没有缓存就交给云函数按笔记数兜底选书
  const peek = data.peekNotebooksBrief();
  const picked = peek.ok ? materialStore.pickBooks(peek.notebooks, m, PICK_COUNT[m]) : [];
  const res = await gateway.callPool(m, picked);

  if (res.ok) {
    if (res.overview) {
      // 云函数已顺带返回概览，补种缓存供下次轮换，省一次调用
      data.seedNotebooksBrief(res.overview);
    }
    const merged = materialStore.mergeBooks(res.books);
    const next = materialStore.toPool(merged);
    logger.log('material', '素材库已刷新', {
      mode: m,
      books: materialStore.bookCount(merged),
      items: next.length,
      ms: Date.now() - started,
    });
    if (next.length) {
      return { ok: true, pool: next, fromCache: false, callCount: 1 };
    }
  }

  // 代拉失败 / 没拉到素材：库里还有旧数据就先顶着（断网也能出卡片）
  if (cached.length) {
    logger.warn('material', '代拉失败，沿用本机素材', res.code || res.error);
    return { ok: true, pool: cached, fromCache: true, degraded: true, callCount: 1 };
  }
  if (res.code === 'nocorpus') {
    return { ok: false, code: 'nocorpus', error: '暂无带笔记的书，暂时做不了每日卡片' };
  }
  return { ok: false, code: res.code || 'pool', error: res.error || '素材拉取失败' };
}

module.exports = { buildPool, fetchPool };
