/**
 * 每日卡片回顾（M11）· 本机存储 + 每日限流
 *
 * 本机为唯一数据源；同时静默备份到云端（集合 `wre_udata` 的 daily 分区，按身份隔离），
 * 换机 / 清缓存 / 退出登录后可拉回。
 * 存储键沿用 `wre_` 前缀：
 *   - wre_daily_cards：卡片历史（每天至多 1 张，最多保留 HISTORY_MAX 张，可回看 / 收藏）
 *   - wre_daily_used ：已用素材集合（{hashKey: ts}，用于连续多日不重复）
 *   - wre_daily_quota：当日「重新生成」次数
 */
const { hashKey, dateKey } = require('./daily-core');
const udata = require('./udata');

const CARDS_KEY = 'wre_daily_cards';
const USED_KEY = 'wre_daily_used';
const QUOTA_KEY = 'wre_daily_quota';

const HISTORY_MAX = 30;   // 本机最多保留卡片数（回看）
const REGEN_LIMIT = 3;    // 每日「重新生成」上限（限流控成本）
const COOLDOWN_DAYS = 30; // 同一划线 30 天内不重复进正文（M17）
const RECENT_HASH_DAYS = 7; // 最近 7 天用过的 hash 一律避让（M17）
const USED_DAYS = 90;     // 已用集合滑动窗口：只保留最近 90 天（M17）
const USED_MAX = 1000;    // 已用集合滑动窗口：最多保留 1000 条（M17）
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- 本机读写 ----
function readJson(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value == null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {
    // 本机存储失败不影响主流程
  }
}

// ---- 已用素材（连续多日不重复）----

/** 滑动窗口：只留最近 USED_DAYS 天、最多 USED_MAX 条；不清空历史 */
function pruneUsed(used) {
  const cutoff = Date.now() - USED_DAYS * DAY_MS;
  const pairs = Object.keys(used)
    .map((key) => [key, Number(used[key]) || 0])
    .filter((pair) => pair[1] >= cutoff)
    .sort((a, b) => b[1] - a[1])
    .slice(0, USED_MAX);
  const out = {};
  pairs.forEach((pair) => { out[pair[0]] = pair[1]; });
  return out;
}

function getUsed() {
  const value = readJson(USED_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

/** 记一批素材为「已用」；接受 ['文本'] / [{text}] / 单条文本 */
function markUsed(list) {
  const used = getUsed();
  const now = Date.now();
  (Array.isArray(list) ? list : [list]).forEach((item) => {
    const text = item && typeof item === 'object' ? item.text : item;
    if (text) {
      used[hashKey(text)] = now;
    }
  });
  writeJson(USED_KEY, pruneUsed(used));
  backupSilent();
}

function usedCount() {
  return Object.keys(getUsed()).length;
}

/** 最近 N 天用过的所有 hash（文章级 + 已用集合），供选材避让 */
function getRecentHashes(days) {
  const limit = Date.now() - (Number(days) || RECENT_HASH_DAYS) * DAY_MS;
  const out = {};
  listCards().forEach((card) => {
    const at = Number(card && card.createdAt) || 0;
    if (!at || at < limit) {
      return;
    }
    const hashes = Array.isArray(card.hashes) ? card.hashes : [];
    if (hashes.length) {
      hashes.forEach((hash) => { out[hash] = at; });
    } else if (card.quote && card.quote.text) {
      out[hashKey(card.quote.text)] = at;
    }
  });
  const used = getUsed();
  Object.keys(used).forEach((key) => {
    if (Number(used[key]) >= limit) {
      out[key] = Number(used[key]);
    }
  });
  return out;
}

/** 最近 N 天「当主素材」的次数 {bookId: count}：同一本书 30 天内最多 2 次（M17） */
function getRecentMainBookIds(days) {
  const limit = Date.now() - (Number(days) || COOLDOWN_DAYS) * DAY_MS;
  const out = {};
  listCards().forEach((card) => {
    const at = Number(card && card.createdAt) || 0;
    const bookId = card && card.quote && card.quote.bookId;
    if (!bookId || !at || at < limit) {
      return;
    }
    out[bookId] = (out[bookId] || 0) + 1;
  });
  return out;
}

/** 最近 N 天用过的主题（每日卡片用；避免连续同主题） */
function getRecentThemes(days) {
  const limit = Date.now() - (Number(days) || RECENT_HASH_DAYS) * DAY_MS;
  const out = [];
  listCards().forEach((card) => {
    const at = Number(card && card.createdAt) || 0;
    if (!at || at < limit) {
      return;
    }
    (card.themes || []).forEach((theme) => {
      if (out.indexOf(theme) < 0) {
        out.push(theme);
      }
    });
  });
  return out;
}

/** 选材入参（页面 / 自动弹窗统一口径） */
function selectionOpts() {
  return {
    recentHashes: getRecentHashes(RECENT_HASH_DAYS),
    recentMainBookIds: getRecentMainBookIds(COOLDOWN_DAYS),
    avoidThemes: getRecentThemes(RECENT_HASH_DAYS),
  };
}

// ---- 每日「重新生成」限流 ----
function getQuota() {
  const today = dateKey();
  const quota = readJson(QUOTA_KEY, null);
  if (!quota || quota.date !== today) {
    return { date: today, regen: 0 };
  }
  return { date: today, regen: Number(quota.regen) || 0 };
}

function regenLeft() {
  return Math.max(0, REGEN_LIMIT - getQuota().regen);
}

/** 记一次重新生成，返回剩余次数 */
function bumpRegen() {
  const quota = getQuota();
  quota.regen += 1;
  writeJson(QUOTA_KEY, quota);
  backupSilent();
  return Math.max(0, REGEN_LIMIT - quota.regen);
}

// ---- 卡片历史（回看 / 收藏）----
function listCards() {
  const value = readJson(CARDS_KEY, { cards: [] });
  return value && Array.isArray(value.cards) ? value.cards : [];
}

/** 保存卡片：同一天只保留最新一张（每天至多 1 篇），历史最多 HISTORY_MAX 张 */
function saveCard(card) {
  const cards = listCards().filter((item) => item && item.date !== card.date);
  cards.unshift(card);
  writeJson(CARDS_KEY, { cards: cards.slice(0, HISTORY_MAX) });
  backupSilent();
}

function getTodayCard() {
  const today = dateKey();
  const cards = listCards();
  for (let i = 0; i < cards.length; i += 1) {
    if (cards[i] && cards[i].date === today) {
      return cards[i];
    }
  }
  return null;
}

/** 按 id 取单张卡片（往期回顾用） */
function getCardById(id) {
  const cards = listCards();
  for (let i = 0; i < cards.length; i += 1) {
    if (cards[i] && cards[i].id === id) {
      return cards[i];
    }
  }
  return null;
}

/** 收藏 / 取消收藏，返回最新状态 */
function starCard(id) {
  const cards = listCards();
  let starred = false;
  cards.forEach((card) => {
    if (card && card.id === id) {
      card.starred = !card.starred;
      starred = card.starred;
    }
  });
  writeJson(CARDS_KEY, { cards: cards });
  backupSilent();
  return starred;
}

// ---- 云端备份 / 恢复（换机 / 清缓存 / 退出登录后拉回；失败静默）----

/** 备份快照：一次性打包三类本机数据 */
function cloudSnapshot() {
  return { cards: listCards(), used: getUsed(), quota: getQuota() };
}

/** 静默备份（不 await；失败不打扰用户） */
function backupSilent() {
  udata.backupSilent(udata.KIND.DAILY, cloudSnapshot());
}

/** 从云端只取「今天」这张卡片（换机 / 清缓存后首页弹窗秒开；失败静默返回 null） */
function pullTodayCard() {
  return udata.get(udata.KIND.DAILY).then((res) => {
    if (!res.ok || !res.value || !Array.isArray(res.value.cards)) {
      return null;
    }
    const today = dateKey();
    let card = null;
    for (let i = 0; i < res.value.cards.length; i += 1) {
      if (res.value.cards[i] && res.value.cards[i].date === today) {
        card = res.value.cards[i];
        break;
      }
    }
    if (!card) {
      return null;
    }
    if (!getTodayCard()) {
      const cards = listCards().filter((item) => item && item.date !== card.date);
      cards.unshift(card);
      writeJson(CARDS_KEY, { cards: cards.slice(0, HISTORY_MAX) });
    }
    if (res.value.used && typeof res.value.used === 'object' && !usedCount()) {
      writeJson(USED_KEY, res.value.used);
    }
    return card;
  }).catch(() => null);
}

/** 从云端恢复（仅本机无卡片时写入，避免覆盖本机较新数据）→ { ok, restored, count } */
function restoreFromCloud() {
  return udata.get(udata.KIND.DAILY).then((res) => {
    if (!res.ok || !res.value) {
      return { ok: false, code: (res && res.code) || 'empty' };
    }
    const v = res.value;
    if (!v || !Array.isArray(v.cards) || !v.cards.length) {
      return { ok: false, code: 'empty' };
    }
    if (listCards().length) {
      return { ok: true, restored: false, count: 0 };
    }
    writeJson(CARDS_KEY, { cards: v.cards.slice(0, HISTORY_MAX) });
    if (v.used && typeof v.used === 'object') {
      writeJson(USED_KEY, v.used);
    }
    if (v.quota && v.quota.date) {
      writeJson(QUOTA_KEY, v.quota);
    }
    return { ok: true, restored: true, count: v.cards.length };
  });
}

module.exports = {
  HISTORY_MAX,
  REGEN_LIMIT,
  getUsed,
  markUsed,
  usedCount,
  getRecentHashes,
  getRecentMainBookIds,
  getRecentThemes,
  selectionOpts,
  regenLeft,
  bumpRegen,
  listCards,
  saveCard,
  getTodayCard,
  getCardById,
  starCard,
  backupSilent,
  pullTodayCard,
  restoreFromCloud,
};
