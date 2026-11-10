/**
 * 灵感漫游（H12）· 取数
 *
 * 来源：mobile/miniprogram/shared/wander-data.js（逐字移植）。
 * H5 差异：data.js / daily-data.js 的签名不含 apiKey（Key 由服务端托管）→ fetchCounts(force) / fetchPool(force)。
 *
 *   1) fetchCounts —— 先用「笔记列表」缓存（24 小时，通常 0 次请求）估算累计划线 / 想法条数；
 *   2) fetchPool   —— 与每日卡片共用本机素材库（漫游一次取 3 本，保证跨书）。
 */

import { fetchOverview, peekNotebooksBrief, fetchNotebooksBrief } from '../data.js';
import { notebookStats } from './report-core.js';
import { fetchPool as fetchDailyPool } from './daily-data.js';

/**
 * 估算累计「划线 / 想法」条数（来自 /user/notebooks 各书 noteCount / reviewCount 之和）。
 * @returns {object} { ok:true, marks, thoughts, hasNotebooks } 或 { ok:false, code, error }
 */
export async function fetchCounts(force) {
  // M17：先用「笔记列表」缓存（24 小时，通常 0 次请求）估门槛；没有再取一次
  let notesRes = force ? { ok: false } : peekNotebooksBrief();
  if (!notesRes.ok) {
    notesRes = await fetchNotebooksBrief(!!force);
  }
  if (notesRes.ok && notesRes.notebooks) {
    const briefStats = notebookStats(notesRes.notebooks);
    return {
      ok: true,
      marks: briefStats ? briefStats.noteTotal : 0,
      thoughts: briefStats ? briefStats.reviewTotal : 0,
      hasNotebooks: !!(notesRes.notebooks.books && notesRes.notebooks.books.length),
    };
  }

  // 兜底：旧的「书架 + 笔记概览」链路（30 分钟缓存，多花 1 次书架调用）
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

/** 素材池（与每日卡片共用本机素材库；漫游模式一次取 3 本，保证跨书） */
export function fetchPool(force) {
  return fetchDailyPool(force, 'wander');
}
