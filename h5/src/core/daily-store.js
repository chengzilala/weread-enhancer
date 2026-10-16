/**
 * 每日卡片回顾（H11）· 本机存储 + 每日限流
 *
 * 来源：mobile/miniprogram/shared/daily-store.js（逐字移植，wx 存储 → localStorage）。
 * 本机为唯一数据源；同时静默备份到云端（集合 `wre_udata` 的 daily 分区，按账户码隔离），
 * 换机 / 清缓存 / 退出登录后可拉回。
 * 存储键：wre_daily_cards（历史）/ wre_daily_used（已用素材）/ wre_daily_quota（当日重生成次数）。
 */

import { localGet, localSet } from '../store.js';
import { hashKey, dateKey } from './daily-core.js';
import * as api from '../api.js';

const CARDS_KEY = 'wre_daily_cards';
const USED_KEY = 'wre_daily_used';
const QUOTA_KEY = 'wre_daily_quota';

export const HISTORY_MAX = 30;   // 本机最多保留卡片数（回看）
export const REGEN_LIMIT = 3;    // 每日「重新生成」上限（限流控成本）

function readJson(key, fallback) {
  return localGet(key, fallback);
}

function writeJson(key, value) {
  localSet(key, value);
}

// ---- 已用素材（连续多日不重复）----
export function getUsed() {
  const value = readJson(USED_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

export function markUsed(text) {
  const used = getUsed();
  used[hashKey(text)] = Date.now();
  writeJson(USED_KEY, used);
  backupSilent();
}

export function resetUsed() {
  writeJson(USED_KEY, {});
  backupSilent();
}

export function usedCount() {
  return Object.keys(getUsed()).length;
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

export function regenLeft() {
  return Math.max(0, REGEN_LIMIT - getQuota().regen);
}

/** 记一次重新生成，返回剩余次数 */
export function bumpRegen() {
  const quota = getQuota();
  quota.regen += 1;
  writeJson(QUOTA_KEY, quota);
  backupSilent();
  return Math.max(0, REGEN_LIMIT - quota.regen);
}

// ---- 卡片历史（回看 / 收藏）----
export function listCards() {
  const value = readJson(CARDS_KEY, { cards: [] });
  return value && Array.isArray(value.cards) ? value.cards : [];
}

/** 保存卡片：同一天只保留最新一张（每天至多 1 篇），历史最多 HISTORY_MAX 张 */
export function saveCard(card) {
  const cards = listCards().filter((item) => item && item.date !== card.date);
  cards.unshift(card);
  writeJson(CARDS_KEY, { cards: cards.slice(0, HISTORY_MAX) });
  backupSilent();
}

export function getTodayCard() {
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
export function getCardById(id) {
  const cards = listCards();
  for (let i = 0; i < cards.length; i += 1) {
    if (cards[i] && cards[i].id === id) {
      return cards[i];
    }
  }
  return null;
}

/** 收藏 / 取消收藏，返回最新状态 */
export function starCard(id) {
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
  try {
    api.udataPut('daily', cloudSnapshot()).catch(() => {});
  } catch (e) {
    // 中转服务不可用等情况忽略
  }
}

/** 从云端恢复（仅本机无卡片时写入，避免覆盖本机较新数据）→ { ok, restored, count } */
function restoreFromCloud() {
  return api.udataGet('daily').then((res) => {
    if (!res || !res.ok || !res.value) {
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

export { backupSilent, restoreFromCloud };
