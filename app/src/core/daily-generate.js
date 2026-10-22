/**
 * 每日卡片回顾（H11）· 「确保今天有一张」的复用入口
 *
 * 来源：mobile/miniprogram/shared/daily-generate.js（逻辑一致）。
 * H5 差异：Key 由服务端托管，前端不持有明文 → 去掉本机 Key 检查，只走 AI 成文路径。
 *
 * 本机已有今日卡片则直接返回，否则按「拉素材池 → 抽签选材 → AI 成文 → 排版」生成并落盘。
 * 与每日卡片页同口径：不消耗「重新生成」次数；只读写本机存储，不落库、不上云。
 */

import { AI_ENABLED } from '../ai.js';
import * as core from './daily-core.js';
import * as db from './daily-store.js';
import { fetchPool } from './daily-data.js';
import { generateDailyText } from './daily-ai.js';
import { messageOf } from './errors.js';

/**
 * 确保「今天」有一张卡片。
 * @returns {object}
 *   { ok:true, fromCache, card, view }
 *   或 { ok:false, code, error }（通用失败）
 *   或 { ok:false, code:'material', reason:'material', count, need }（素材不足，走引导）
 */
export async function ensureTodayCard() {
  const existing = db.getTodayCard();
  if (existing) {
    return { ok: true, fromCache: true, card: existing, view: core.toView(existing) };
  }

  const poolRes = await fetchPool(false);
  if (!poolRes.ok) {
    if (poolRes.code === 'nocorpus') {
      return { ok: false, code: 'material', reason: 'material', count: 0, need: core.MATERIAL_MIN };
    }
    return { ok: false, code: poolRes.code, error: messageOf(poolRes, '读取数据失败') };
  }

  const material = core.prepareMaterial(poolRes.pool, db.getUsed());
  if (!material.ok) {
    return {
      ok: false,
      code: 'material',
      reason: 'material',
      count: material.count || 0,
      need: material.need || core.MATERIAL_MIN,
    };
  }
  if (material.resetUsed) {
    db.resetUsed();
  }

  // H5 保留 AI：走 AI 成文；AI 不可用不退回本地模板（页面提示错误 + 重试）
  let text;
  if (AI_ENABLED) {
    text = await generateDailyText(material);
    if (!text.ai) {
      return { ok: false, code: text.code || 'ai', error: messageOf(text, '生成失败，请重试') };
    }
  } else {
    text = { ai: false, title: core.localTitle(material), note: '' };
  }

  const card = core.makeCard(material, text);
  db.saveCard(card);
  db.markUsed(material.main.text);
  return { ok: true, fromCache: false, card: card, view: core.toView(card) };
}
