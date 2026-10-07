/**
 * 我的纸书 — 核心逻辑层
 *
 * 职责：匹配决策等纯业务逻辑（不直接存储、不直接联网，取数走 paperbook-data）。
 * 定位：页面只调这里的「决定」，细节交给 data / store。
 * 红线：API Key 由调用方传入，本模块只转发、不落库、不写日志。
 */
const pbData = require('./paperbook-data');

/** EAN-13 校验位是否正确（用来挡掉扫码误读 / 乱码） */
function isValidEan13(code) {
  const s = String(code || '');
  if (!/^\d{13}$/.test(s)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(s.charAt(i)) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(s.charAt(12));
}

/**
 * 是否是图书 ISBN 条码：EAN-13 + 978/979 图书段位 + 校验位正确。
 * 书上的其它条码（出版社自编码、物流/防伪码等）不以 978/979 开头，会被挡掉。
 */
function isIsbnBarcode(code) {
  const s = String(code || '').trim();
  return /^97[89]\d{10}$/.test(s) && isValidEan13(s);
}

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
  isValidEan13,
  isIsbnBarcode,
};
