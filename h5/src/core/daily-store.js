/**
 * 每日卡片回顾（H11）· 本机存储 + 每日限流
 *
 * 来源：mobile/miniprogram/shared/daily-store.js（逐字移植，wx 存储 → localStorage）。
 * 只存本机、不上云；换机 / 清缓存即丢失。
 * 存储键：wre_daily_cards（历史）/ wre_daily_used（已用素材）/ wre_daily_quota（当日重生成次数）。
 */

import { localGet, localSet } from '../store.js';
import { hashKey, dateKey } from './daily-core.js';

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
}

export function resetUsed() {
  writeJson(USED_KEY, {});
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
  return starred;
}
