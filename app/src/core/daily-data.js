/**
 * 每日卡片回顾（H11）· 素材池构建
 *
 * 来源：mobile/miniprogram/shared/daily-data.js（逐字移植）。
 * H5 差异：data.js 的签名不含 apiKey（Key 由服务端托管）→ fetchPool(force)。
 */

import { fetchOverview, fetchCorpus } from '../data.js';

/** 语料（corpus）→ 扁平素材池 */
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
 * 拉取并构建素材池。force=true 时绕过本机缓存。
 * @returns {object} { ok:true, pool } 或 { ok:false, code, error }
 */
export async function fetchPool(force) {
  const overviewRes = await fetchOverview(force);
  if (!overviewRes.ok) {
    return { ok: false, code: overviewRes.code, error: overviewRes.error };
  }
  if (!overviewRes.notebooks) {
    return { ok: false, code: 'nocorpus', error: '暂无带笔记的书，暂时做不了每日卡片' };
  }
  const corpusRes = await fetchCorpus(overviewRes.notebooks, force);
  if (!corpusRes.ok) {
    return { ok: false, code: corpusRes.code || 'corpus', error: corpusRes.error || '语料拉取失败' };
  }
  return { ok: true, pool: buildPool(corpusRes.corpus) };
}
