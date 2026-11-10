/**
 * 每日卡片回顾（H11 · M17 取数）· 素材池构建
 *
 * 来源：mobile/miniprogram/shared/daily-data.js（逐字移植）。
 * H5 差异：data.js 的签名不含 apiKey（Key 由服务端托管）→ fetchPool(force, mode)。
 *
 * 数据落点：划线 / 想法原文只存**本人浏览器**（素材库 material-store，7 天），
 *   云端只做「一次代拉」的中转（云函数 action:'pool'），不落库、不写原文日志。
 *
 * 取数策略（M17）：
 *   1) 素材库可用（≤7 天且当天已刷过）→ 直接返回，0 次请求；
 *   2) 需要刷新（超 1 天 / 不足 2 本 / 手动刷新）→ 按轮换取书，1 次代拉补齐；
 *   3) 代拉失败但库里有旧数据 → 降级用旧数据（断网也能出卡片）。
 */

import { pool as apiPool } from '../api.js';
import { peekNotebooksBrief, seedNotebooksBrief } from '../data.js';
import * as materialStore from './material-store.js';

// 每次代拉取几本书：每日 2 本（够跨书 ≥2），漫游 3 本（够跨书 ≥3）
const PICK_COUNT = { daily: 2, wander: 3 };

/** 语料（corpus）→ 扁平素材池（旧链路保留，供兜底 / 兼容调用） */
export function buildPool(corpus) {
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
 * @param {boolean} force true=手动刷新，忽略当天缓存强制代拉
 * @param {string} mode daily / wander
 * @returns {object} { ok:true, pool, fromCache, callCount } 或 { ok:false, code, error }
 */
export async function fetchPool(force, mode) {
  const m = mode === 'wander' ? 'wander' : 'daily';
  const store = materialStore.load();
  const cached = materialStore.toPool(store);
  const needRefresh = !!force || materialStore.isExpired(store) || !cached.length || materialStore.needsRefresh(store);

  if (!needRefresh) {
    return { ok: true, pool: cached, fromCache: true, callCount: 0 };
  }

  // 选书：优先读 24h 笔记缓存（不发请求）；没有缓存就交给云函数按笔记数兜底选书
  const peek = peekNotebooksBrief();
  const picked = peek.ok ? materialStore.pickBooks(peek.notebooks, m, PICK_COUNT[m]) : [];
  const res = await apiPool(m, picked);

  if (res.ok) {
    if (res.overview) {
      // 代拉接口已顺带返回概览，补种缓存供下次轮换，省一次调用
      seedNotebooksBrief(res.overview);
    }
    const merged = materialStore.mergeBooks(res.books);
    const next = materialStore.toPool(merged);
    if (next.length) {
      return { ok: true, pool: next, fromCache: false, callCount: 1 };
    }
  }

  // 代拉失败 / 没拉到素材：库里还有旧数据就先顶着（断网也能出卡片）
  if (cached.length) {
    return { ok: true, pool: cached, fromCache: true, degraded: true, callCount: 1 };
  }
  if (res.code === 'nocorpus') {
    return { ok: false, code: 'nocorpus', error: '暂无带笔记的书，暂时做不了每日卡片' };
  }
  return { ok: false, code: res.code || 'pool', error: res.error || '素材拉取失败' };
}
