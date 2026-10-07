/**
 * 我的纸书 — 核心逻辑层
 *
 * 职责：匹配决策等纯业务逻辑（不直接存储、不直接联网，取数走 paperbook-data）。
 * 定位：页面只调这里的「决定」，细节交给 data / store。
 * 红线：API Key 由调用方传入，本模块只转发、不落库、不写日志。
 */
const pbData = require('./paperbook-data');

/**
 * 自动匹配（M3）：先按 ISBN 试，不中再按书名试。
 * 命中即视为「建议」，用户可在详情页改（或走 M10 手动关联覆盖）。
 * → { ok, hit, via, exact }；失败时 { ok:false, code, error }。
 */
async function autoMatch(apiKey, isbn, title) {
  const byIsbn = String(isbn || '').trim();
  if (byIsbn) {
    const r1 = await pbData.searchStore(byIsbn, apiKey);
    if (r1.ok && r1.items.length) {
      const hit = r1.items[0];
      const exact = String(hit.isbn || '').trim() === byIsbn;
      return { ok: true, hit: hit, via: 'isbn', exact: exact };
    }
    if (!r1.ok && r1.code === 'auth') {
      return r1;
    }
  }
  const byTitle = String(title || '').trim();
  if (byTitle) {
    const r2 = await pbData.searchStore(byTitle, apiKey);
    if (r2.ok && r2.items.length) {
      return { ok: true, hit: r2.items[0], via: 'title', exact: false };
    }
    if (!r2.ok) {
      return r2;
    }
  }
  return { ok: true, hit: null, via: '' };
}

module.exports = {
  autoMatch,
};
