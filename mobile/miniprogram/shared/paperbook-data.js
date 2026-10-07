/**
 * 我的纸书 — 取数层（联网）
 *
 * 职责：① 调官方 /store/search 搜书（自动匹配 M3 / 手动关联 M10 共用）；
 *      ② 取「已关联电子版」的笔记计数与明细（M5，复用 data.js 的官方取数）。
 * 定位：只做「取数 + 整形」，不做存储（那是 paperbook-store）、不做匹配决策（那是 paperbook-core）。
 * 红线：API Key 由调用方传入，本模块只转发、不落库、不写日志（日志仅掩码）。
 */
const { callGateway } = require('./gateway');
const data = require('./data');
const { PROXY_FUNCTION } = require('../config');

const SEARCH_PAGE_SIZE = 20;
const SCAN_CLOUD_DIR = 'pb-scan';

// ---------- /store/search 搜书 ----------

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
function slimSearch(raw) {
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

  const groups = Array.isArray(raw && raw.results) ? raw.results : [];
  groups.forEach((group) => {
    const arr = group && (group.books || group.list);
    if (Array.isArray(arr)) {
      arr.forEach(push);
    }
  });
  ['books', 'list', 'items'].forEach((key) => {
    const arr = raw && raw[key];
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

// ---------- 拍照识码（M2，云函数 imgScan → 云调用 img.scanQRCode）----------

function cloudReady() {
  return !!(wx.cloud && typeof wx.cloud.uploadFile === 'function' && typeof wx.cloud.callFunction === 'function');
}

/** 云端临时路径：pb-scan/<随机>.<扩展名> */
function scanCloudPath(filePath) {
  const m = String(filePath || '').toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)$/);
  const ext = m ? m[1] : 'jpg';
  const rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return SCAN_CLOUD_DIR + '/' + rnd + '.' + ext;
}

/** 上传本地图片到云存储（临时）→ { ok, fileID } */
function uploadScanImage(filePath) {
  return new Promise((resolve) => {
    if (!cloudReady()) {
      resolve({ ok: false, code: 'nocloud', error: '云开发未开通，无法拍照识码' });
      return;
    }
    wx.cloud
      .uploadFile({ cloudPath: scanCloudPath(filePath), filePath: filePath })
      .then((res) => {
        if (!res || !res.fileID) {
          resolve({ ok: false, code: 'upload', error: '图片上传失败，请重试' });
          return;
        }
        resolve({ ok: true, fileID: res.fileID });
      })
      .catch((err) => resolve({ ok: false, code: 'upload', error: '图片上传失败：' + ((err && err.errMsg) || '未知错误') }));
  });
}

/** 删除云存储临时图片（失败静默，不打扰用户） */
function removeScanImage(fileID) {
  if (!fileID || !cloudReady() || typeof wx.cloud.deleteFile !== 'function') {
    return;
  }
  try {
    wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
  } catch (err) {
    // 忽略
  }
}

/**
 * 本地图片 → 上传云存储 → 云函数云调用识别条码 → 清理临时图片。
 * → { ok, isbn, codes }；失败时 { ok:false, code, error }。
 */
async function scanImageCode(filePath) {
  const path = String(filePath || '').trim();
  if (!path) {
    return { ok: false, code: 'param', error: '没有图片' };
  }
  const up = await uploadScanImage(path);
  if (!up.ok) {
    return up;
  }
  let res = null;
  try {
    res = await wx.cloud.callFunction({ name: PROXY_FUNCTION, data: { action: 'imgScan', fileID: up.fileID } });
  } catch (err) {
    removeScanImage(up.fileID);
    return { ok: false, code: 'cloud', error: '识别服务调用失败：' + ((err && err.errMsg) || '未知错误') };
  }
  removeScanImage(up.fileID);
  const result = res && res.result;
  if (!result || !result.ok) {
    return { ok: false, code: (result && result.code) || 'scan', error: (result && result.error) || '没识别到条码' };
  }
  return { ok: true, isbn: result.isbn || '', codes: result.codes || [] };
}

// ---------- 关联电子版的笔记（M5）----------

/**
 * 取某本电子版在微信读书的笔记计数（复用 30 分钟缓存的概览，避免重复请求）。
 * → { ok, found, bookmarkCount, noteCount, reviewCount, total }
 */
async function fetchBookNoteCounts(bookId, apiKey) {
  const id = String(bookId || '').trim();
  if (!id) {
    return { ok: true, found: false, bookmarkCount: 0, noteCount: 0, reviewCount: 0, total: 0 };
  }
  const res = await data.fetchOverview(apiKey);
  if (!res || !res.ok || !res.notebooks) {
    return { ok: false, code: (res && res.code) || 'overview', error: (res && res.error) || '读取笔记概览失败' };
  }
  const books = Array.isArray(res.notebooks.books) ? res.notebooks.books : [];
  const hit = books.filter((b) => b.bookId === id)[0];
  if (!hit) {
    return { ok: true, found: false, bookmarkCount: 0, noteCount: 0, reviewCount: 0, total: 0 };
  }
  const bookmarkCount = Number(hit.bookmarkCount) || 0;
  const noteCount = Number(hit.noteCount) || 0;
  const reviewCount = Number(hit.reviewCount) || 0;
  return {
    ok: true,
    found: true,
    bookmarkCount: bookmarkCount,
    noteCount: noteCount,
    reviewCount: reviewCount,
    total: bookmarkCount + noteCount + reviewCount,
  };
}

/** 取某本电子版的笔记明细 → { ok, marks, reviews }（marks=划线，reviews=想法/点评） */
async function fetchBookNoteItems(bookId, apiKey) {
  const id = String(bookId || '').trim();
  if (!id) {
    return { ok: true, marks: [], reviews: [] };
  }
  const pair = await Promise.all([data.fetchBookMarks(id, apiKey), data.fetchBookReviewItems(id, apiKey)]);
  return { ok: true, marks: pair[0] || [], reviews: pair[1] || [] };
}

module.exports = {
  searchStore,
  slimSearch,
  pickDeepLink,
  scanImageCode,
  fetchBookNoteCounts,
  fetchBookNoteItems,
};
