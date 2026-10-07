/**
 * 我的纸书 — 存储层（本机 + 云备份）
 *
 * 职责：① 本机纸书库读写（唯一数据源）；② 云端备份（集合 wre_paperbooks，按 openid 隔离）。
 * 定位：只管「存/取」，不联网搜书（那是 paperbook-data）、不做匹配决策（那是 paperbook-core）。
 * 红线：Key 不经过本模块；纸书档案属用户私有数据，云端仅按 openid 存一份，不含任何 Key。
 */
const { PROXY_FUNCTION } = require('../config');

const LOCAL_KEY = 'wre_paperbooks';
const ISBN_MAP_KEY = 'wre_pb_isbn_map'; // 记忆：ISBN → 微信读书电子版（关联一次，永久复用）

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
      status: '', // '' 未标记 | read 已读 | reading 在读 | want 想读（M7）
      tags: [], // 自定义标签（M7）
      feeling: '', // 我在纸书上写的感想（M6）
      location: '', // 纸质位置：哪个书架/哪一层（M9）
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

// ---------- 记忆式关联：ISBN → 电子版 映射 ----------
// 微信读书只认书名/作者、不认 ISBN，扫到的 ISBN 无法直接换到电子版。
// 故「关联一次就记住」：把 ISBN → {bookId, title, ...} 存本机，同 ISBN 再扫即零操作复用。

/** 全部映射（缺失/损坏时返回空对象） */
function getIsbnMap() {
  const value = wx.getStorageSync(ISBN_MAP_KEY);
  return value && typeof value === 'object' ? value : {};
}

/** 查某 ISBN 记住的电子版；没有返回 null */
function getIsbnMemory(isbn) {
  const key = String(isbn || '').trim();
  if (!key) {
    return null;
  }
  return getIsbnMap()[key] || null;
}

/** 记住「某 ISBN = 某电子版」（关联成功后调用；无 ISBN / 无 bookId 时忽略） */
function rememberIsbn(isbn, hit) {
  const key = String(isbn || '').trim();
  if (!key || !hit || !hit.bookId) {
    return;
  }
  const map = getIsbnMap();
  map[key] = {
    bookId: hit.bookId || '',
    deepLink: hit.deepLink || '',
    title: hit.title || '',
    author: hit.author || '',
    cover: hit.cover || '',
    ts: Date.now(),
  };
  wx.setStorageSync(ISBN_MAP_KEY, map);
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
  genId,
  addBook,
  updateBook,
  removeBook,
  findByIsbn,
  getIsbnMemory,
  rememberIsbn,
  backupSilent,
  restoreFromCloud,
};
