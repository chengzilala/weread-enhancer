/**
 * 灵感漫游（H12）· 本机存储 + 每周频率限制
 *
 * 来源：mobile/miniprogram/shared/wander-store.js（逐字移植，wx 存储 → localStorage）。
 * 只存本机、不上云；换机 / 清缓存即丢失。
 * 存储键：
 *   - wre_wander_issues：往期归档（每周一期，最多 HISTORY_MAX 期，可回看 / 收藏 / 随机漫游）
 *   - wre_wander_used  ：已用素材集合（{hashKey: ts}，用于跨期不重复）
 *   - wre_wander_quota ：本周已生成次数（用于「每周篇数」限流）
 */

import { localGet, localSet } from '../store.js';
import { hashKey, weekKey } from './wander-core.js';

const ISSUES_KEY = 'wre_wander_issues';
const USED_KEY = 'wre_wander_used';
const QUOTA_KEY = 'wre_wander_quota';
const SEEN_KEY = 'wre_wander_seen';   // 最近一次「看过」的期 id，用于入口「新」标

export const HISTORY_MAX = 52;   // 本机最多保留期数（约一年）

// ---- 本机读写 ----
function readJson(key, fallback) {
  return localGet(key, fallback);
}

function writeJson(key, value) {
  localSet(key, value);
}

// ---- 已用素材（跨期不重复）----
export function getUsed() {
  const value = readJson(USED_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

/** 记一批素材为「已用」；接受 [{text}] 或 ['文本'] */
export function markUsed(list) {
  const used = getUsed();
  const now = Date.now();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const text = item && typeof item === 'object' ? item.text : item;
    if (text) {
      used[hashKey(text)] = now;
    }
  });
  writeJson(USED_KEY, used);
}

export function resetUsed() {
  writeJson(USED_KEY, {});
}

// ---- 每周「生成」限流（周键为周一日期）----
function getQuota() {
  const week = weekKey();
  const quota = readJson(QUOTA_KEY, null);
  if (!quota || quota.week !== week) {
    return { week: week, used: 0 };
  }
  return { week: week, used: Number(quota.used) || 0 };
}

/** 本周还可生成几次（tier.weekly 为本周上限：铜 1 / 银 2 / 金 3） */
export function weekLeft(tier) {
  const limit = (tier && tier.weekly) || 1;
  return Math.max(0, limit - getQuota().used);
}

/** 记一次生成，返回已用次数 */
export function bumpWeek() {
  const quota = getQuota();
  quota.used += 1;
  writeJson(QUOTA_KEY, quota);
  return quota.used;
}

export function usedInWeek() {
  return getQuota().used;
}

// ---- 往期归档（回看 / 收藏 / 随机漫游）----
export function listIssues() {
  const value = readJson(ISSUES_KEY, { issues: [] });
  return value && Array.isArray(value.issues) ? value.issues : [];
}

/** 保存一期：同一周只保留最新一期，历史最多 HISTORY_MAX 期 */
export function saveIssue(issue) {
  const issues = listIssues().filter((item) => item && item.week !== issue.week);
  issues.unshift(issue);
  writeJson(ISSUES_KEY, { issues: issues.slice(0, HISTORY_MAX) });
}

export function getWeekIssue() {
  const week = weekKey();
  const issues = listIssues();
  for (let i = 0; i < issues.length; i += 1) {
    if (issues[i] && issues[i].week === week) {
      return issues[i];
    }
  }
  return null;
}

/** 最近一期的主题（用于「避免连续两期同主题」） */
export function lastTheme() {
  const issues = listIssues();
  return issues.length && issues[0] ? (issues[0].theme || '') : '';
}

export function getIssueById(id) {
  const issues = listIssues();
  for (let i = 0; i < issues.length; i += 1) {
    if (issues[i] && issues[i].id === id) {
      return issues[i];
    }
  }
  return null;
}

export function randomIssue() {
  const issues = listIssues();
  if (!issues.length) {
    return null;
  }
  return issues[Math.floor(Math.random() * issues.length)];
}

/** 收藏 / 取消收藏，返回最新状态 */
export function starIssue(id) {
  const issues = listIssues();
  let starred = false;
  issues.forEach((issue) => {
    if (issue && issue.id === id) {
      issue.starred = !issue.starred;
      starred = issue.starred;
    }
  });
  writeJson(ISSUES_KEY, { issues: issues });
  return starred;
}

// ---- 「新一期」标（入口角标）：本周有本期且尚未看过 ----
export function isNew() {
  const current = getWeekIssue();
  if (!current) {
    return false;
  }
  return readJson(SEEN_KEY, '') !== current.id;
}

export function markSeen() {
  const current = getWeekIssue();
  if (current) {
    writeJson(SEEN_KEY, current.id);
  }
}
