/**
 * 灵感漫游（H12）· 取数
 *
 * 来源：mobile/miniprogram/shared/wander-data.js（逐字移植）。
 * H5 差异：data.js / daily-data.js 的签名不含 apiKey（Key 由服务端托管）→ fetchCounts(force) / fetchPool(force)。
 *
 *   1) fetchCounts —— 只用「书架 + 笔记概览」（30 分钟缓存）估算累计划线 / 想法条数，用于判定门槛与分级；
 *   2) fetchPool   —— 复用每日卡片的素材池（笔记最多的前 N 本书的划线 / 想法原文，10 分钟缓存）。
 */

import { fetchOverview } from '../data.js';
import { notebookStats } from './report-core.js';
import { fetchPool as fetchDailyPool } from './daily-data.js';

/**
 * 估算累计「划线 / 想法」条数（来自 /user/notebooks 各书 noteCount / reviewCount 之和）。
 * @returns {object} { ok:true, marks, thoughts, hasNotebooks } 或 { ok:false, code, error }
 */
export async function fetchCounts(force) {
  const overviewRes = await fetchOverview(force);
  if (!overviewRes.ok) {
    return { ok: false, code: overviewRes.code || 'overview', error: overviewRes.error || '读取笔记数据失败' };
  }
  const stats = notebookStats(overviewRes.notebooks);
  return {
    ok: true,
    marks: stats ? stats.noteTotal : 0,
    thoughts: stats ? stats.reviewTotal : 0,
    hasNotebooks: !!overviewRes.notebooks,
  };
}

/** 素材池（复用每日卡片口径：笔记最多的前 N 本书的划线 / 想法原文） */
export function fetchPool(force) {
  return fetchDailyPool(force);
}
