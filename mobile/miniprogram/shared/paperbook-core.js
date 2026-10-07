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

/** 书名是否算「对得上」：去掉空白后完全一致，或一方包含另一方 */
function titleMatches(a, b) {
  const x = String(a || '').replace(/\s+/g, '').toLowerCase();
  const y = String(b || '').replace(/\s+/g, '').toLowerCase();
  if (!x || !y) {
    return false;
  }
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/**
 * 自动匹配（M3）：先按 ISBN 试，不中再按书名试。
 * 命中即视为「建议」，用户可在详情页改（或走 M10 手动关联覆盖）。
 *
 * 关键：`/store/search` 是**模糊搜索**，直接取 `items[0]` 会把书认成另一本
 * （实测：扫《无人生还》9787513335287 被认成《金融怪杰》）。故只认「对得上」的结果：
 *   - ISBN 路径：搜索结果的 isbn 必须与扫到的 ISBN **完全一致**；
 *   - 书名路径：搜索结果的 title 必须与传入书名对得上。
 * 对不上 → 返回 hit:null，**不覆盖**已扫到的 ISBN（书名留空，用户可手动关联）。
 * → { ok, hit, via, exact }；失败时 { ok:false, code, error }。
 */
async function autoMatch(apiKey, isbn, title) {
  const byIsbn = String(isbn || '').trim();
  if (byIsbn) {
    const r1 = await pbData.searchStore(byIsbn, apiKey);
    if (!r1.ok) {
      if (r1.code === 'auth') {
        return r1;
      }
    } else {
      const exactHit = r1.items.filter((it) => String(it.isbn || '').trim() === byIsbn)[0];
      if (exactHit) {
        return { ok: true, hit: exactHit, via: 'isbn', exact: true };
      }
    }
  }
  const byTitle = String(title || '').trim();
  if (byTitle) {
    const r2 = await pbData.searchStore(byTitle, apiKey);
    if (!r2.ok) {
      return r2;
    }
    const titleHit = r2.items.filter((it) => titleMatches(it.title, byTitle))[0];
    if (titleHit) {
      return { ok: true, hit: titleHit, via: 'title', exact: false };
    }
  }
  return { ok: true, hit: null, via: '' };
}

module.exports = {
  autoMatch,
  isValidEan13,
  isIsbnBarcode,
};
