/**
 * 我的纸书 — 共享模块
 *
 * 职责：① 本机纸书库读写；② 微信读书搜书（自动匹配 M3 / 手动关联 M10 共用）；
 *      ③ 云端备份（集合 wre_paperbooks，按 openid 隔离，换机可拉回）。
 *
 * 红线：API Key 由调用方传入，本模块只转发、不落库、不写日志（日志仅掩码）；
 *      纸书档案属用户私有数据，云端仅按 openid 存一份备份，不含任何 Key。
 */
const { callGateway } = require('./gateway');
const { PROXY_FUNCTION } = require('../config');

const LOCAL_KEY = 'wre_paperbooks';
const SEARCH_PAGE_SIZE = 20;

// ---------- 本机读写 ----------

function listLocal() {
  const value = wx.getStorageSync(LOCAL_KEY);
  return Array.isArray(value) ? value : [];
}

function saveAll(books) {
  wx.setStorageSync(LOCAL_KEY, Array.isArray(books) ? books : []);
}

function genId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function addBook(book) {
  const books = listLocal();
  const now = Date.now();
  const item = Object.assign(
    {
      id: genId(),
      isbn: '',
      title: '',
      author: '',
      cover: '',
      bookId: '',
      deepLink: '',
      linkTitle: '',
      linkManual: false,
      createdAt: now,
    },
    book || {}
  );
  item.id = item.id || genId();
  item.updatedAt = now;
  books.unshift(item);
  saveAll(books);
  return item;
}

function updateBook(id, patch) {
  const books = listLocal();
  let updated = null;
  const next = books.map((b) => {
    if (b.id !== id) {
      return b;
    }
    updated = Object.assign({}, b, patch || {}, { updatedAt: Date.now() });
    return updated;
  });
  saveAll(next);
  return updated;
}

function removeBook(id) {
  const next = listLocal().filter((b) => b.id !== id);
  saveAll(next);
  return next;
}

/** 去重：同 ISBN 视为同一本（无 ISBN 时不算重复） */
function findByIsbn(isbn) {
  const norm = String(isbn || '').trim();
  if (!norm) {
    return null;
  }
  return listLocal().filter((b) => String(b.isbn || '').trim() === norm)[0] || null;
}

// ---------- 微信读书搜书 ----------

function pickString(node, keys) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  for (let i = 0; i < keys.length; i += 1) {
    const v = node[keys[i]];
    if (typeof v === 'string' && v) {
      return v;
    }
  }
  return '';
}

function pickNumber(node, keys) {
  if (!node || typeof node !== 'object') {
    return 0;
  }
  for (let i = 0; i < keys.length; i += 1) {
    const n = Number(node[keys[i]]);
    if (!isNaN(n) && n) {
      return n;
    }
  }
  return 0;
}

/** 官方 deepLink 只能取接口给的，严禁自行拼接 weread:// 链接 */
function pickDeepLink(entry) {
  const candidates = [entry, entry && entry.bookInfo, entry && entry.book];
  for (let i = 0; i < candidates.length; i += 1) {
    const node = candidates[i];
    if (node && typeof node.deepLink === 'string' && node.deepLink) {
      return node.deepLink;
    }
  }
  return '';
}

/** 把 /store/search 的结果整形为纸书关联用的精简列表 */
function slimSearch(data) {
  const out = [];
  const seen = {};
  const push = (entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const info = entry.bookInfo || entry.book || entry;
    const bookId = pickString(info, ['bookId']) || pickString(entry, ['bookId']);
    const title = pickString(info, ['title', 'name']);
    if (!title) {
      return;
    }
    const key = bookId || title;
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    out.push({
      bookId: bookId,
      title: title,
      author: pickString(info, ['author', 'authorName']) || pickString(entry, ['authorName', 'author']),
      cover: pickString(info, ['cover']) || pickString(entry, ['cover']),
      isbn: pickString(info, ['isbn']) || pickString(entry, ['isbn']),
      readingCount: pickNumber(info, ['readingCount', 'readerCount', 'readCount']),
      deepLink: pickDeepLink(entry),
    });
  };

  const groups = Array.isArray(data && data.results) ? data.results : [];
  groups.forEach((group) => {
    const arr = group && (group.books || group.list);
    if (Array.isArray(arr)) {
      arr.forEach(push);
    }
  });
  ['books', 'list', 'items'].forEach((key) => {
    const arr = data && data[key];
    if (Array.isArray(arr)) {
      arr.forEach(push);
    }
  });
  return out;
}

/** 调官方 /store/search（scope:10 找书）→ { ok, items } */
async function searchStore(keyword, apiKey) {
  const kw = String(keyword || '').trim();
  if (!kw) {
    return { ok: true, items: [] };
  }
  const res = await callGateway('/store/search', { keyword: kw, scope: 10, count: SEARCH_PAGE_SIZE }, apiKey);
  if (!res.ok) {
    return { ok: false, code: res.code, error: res.error };
  }
  return { ok: true, items: slimSearch(res.data) };
}

/**
 * 自动匹配（M3）：先按 ISBN 试，不中再按书名试。
 * 返回命中的第一条（可能为空）；命中即视为建议，用户可在详情页改。
 */
async function autoMatch(apiKey, isbn, title) {
  const byIsbn = String(isbn || '').trim();
  if (byIsbn) {
    const r1 = await searchStore(byIsbn, apiKey);
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
    const r2 = await searchStore(byTitle, apiKey);
    if (r2.ok && r2.items.length) {
      return { ok: true, hit: r2.items[0], via: 'title', exact: false };
    }
    if (!r2.ok) {
      return r2;
    }
  }
  return { ok: true, hit: null, via: '' };
}

// ---------- 云端备份（换机拉回；失败静默，不影响本机使用） ----------

function cloudAvailable() {
  return !!(wx.cloud && typeof wx.cloud.callFunction === 'function');
}

/** 静默备份全量（不 await；失败不打扰用户） */
function backupSilent() {
  if (!cloudAvailable()) {
    return;
  }
  try {
    wx.cloud
      .callFunction({ name: PROXY_FUNCTION, data: { action: 'pbPut', books: listLocal() } })
      .catch(() => {});
  } catch (err) {
    // 云开发未开通等情况忽略
  }
}

/** 从云端恢复（手动触发）→ { ok, books } */
function restoreFromCloud() {
  return new Promise((resolve) => {
    if (!cloudAvailable()) {
      resolve({ ok: false, code: 'nocloud', error: '云开发未开通' });
      return;
    }
    wx.cloud
      .callFunction({ name: PROXY_FUNCTION, data: { action: 'pbGet' } })
      .then((res) => {
        const result = res && res.result;
        if (!result || !result.ok) {
          resolve({ ok: false, code: (result && result.code) || 'cloud', error: (result && result.error) || '云端恢复失败' });
          return;
        }
        resolve({ ok: true, books: Array.isArray(result.books) ? result.books : [] });
      })
      .catch((err) => resolve({ ok: false, code: 'cloud', error: '云函数调用失败：' + ((err && err.errMsg) || '未知错误') }));
  });
}

module.exports = {
  listLocal,
  saveAll,
  addBook,
  updateBook,
  removeBook,
  findByIsbn,
  searchStore,
  autoMatch,
  backupSilent,
  restoreFromCloud,
  slimSearch,
};
