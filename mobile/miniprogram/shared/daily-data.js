/**
 * 每日卡片回顾（M11）· 素材池构建
 *
 * 由 data.fetchOverview（书架 + 笔记概览）→ fetchCorpus（笔记最多的前 N 本书）拉取
 * 划线 / 想法原文，归一为素材池 {bookId,title,author,kind,text,at}。
 * 单本失败由 data.js 内部跳过（不整体失败）；结果沿用 fetchCorpus 的 10 分钟本机缓存。
 */
const data = require('./data');

/** 语料（corpus）→ 扁平素材池 */
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
 * 拉取并构建素材池。force=true 时绕过本机缓存。
 * @returns {object} { ok:true, pool } 或 { ok:false, code, error }
 */
async function fetchPool(apiKey, force) {
  const overviewRes = await data.fetchOverview(apiKey, force);
  if (!overviewRes.ok) {
    return { ok: false, code: overviewRes.code, error: overviewRes.error };
  }
  if (!overviewRes.notebooks) {
    return { ok: false, code: 'nocorpus', error: '暂无带笔记的书，暂时做不了每日卡片' };
  }
  const corpusRes = await data.fetchCorpus(overviewRes.notebooks, apiKey, force);
  if (!corpusRes.ok) {
    return { ok: false, code: corpusRes.code || 'corpus', error: corpusRes.error || '语料拉取失败' };
  }
  return { ok: true, pool: buildPool(corpusRes.corpus) };
}

module.exports = { buildPool, fetchPool };
