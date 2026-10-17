/**
 * H5 AI 通道（DeepSeek）— H10 人格画像 / H11 每日卡片 / H12 灵感漫游共用
 *
 * 来源：mobile/miniprogram/shared/ai.js（提示词逐字一致）。
 * 差异：Key 不再存本机，改为由云函数按 deviceId 取「托管 Key」；前端只调 api.ai(messages)。
 *   - 未配置托管 DeepSeek Key → 云函数返回 { ok:false, code:'ai_nokey' }，由页面引导去「我的」填写。
 *   - 只做「润色 / 串联」，不改变本机已算好的事实。
 */

import { ai as callRemote } from './api.js';

/** H5 保留 AI（与小程序 M15 去 AI 不同） */
export const AI_ENABLED = true;

const SYSTEM_PROMPT = '你是一位克制、有洞察的阅读分析师。' +
  '用户已经在本机用固定规则算出了一套「阅读人格」四维判定（这不是心理测评），请你只做「润色」：' +
  '把这些冷冰冰的判定，写成一段有温度、有代入感的人格化画像。' +
  '要求：1) 用中文、第二人称「你」，真诚、克制，像懂他的朋友在说话，不浮夸、不堆形容词；' +
  '2) 严格基于所给的代码、主称号、四维判定值与证据，不得虚构任何数字，也不得杜撰用户没做过的事；' +
  '3) 结构为两段：第一段用一个生活化的比喻点出这个人格的整体气质（呼应主称号）；第二段结合四维与证据，写出这种气质在真实阅读里的样子；' +
  '4) 只描述、不评判，不使用任何负向词（如懒惰/浅薄/拖延）；' +
  '5) 不要输出标题、序号或任何 Markdown 符号，直接输出两段正文，段与段之间空一行。';

/** 用「视图人格」拼出给 AI 的用户消息（纯客观数据） */
export function buildPersonaPrompt(persona) {
  const dimLines = (persona.dims || []).map((dim) => (dim.available
    ? ('- ' + dim.title + '：' + dim.left.label + ' ' + dim.leftPct + '% ↔ ' + (100 - dim.leftPct) + '% ' + dim.right.label + (dim.basis ? '（依据：' + dim.basis + '）' : ''))
    : ('- ' + dim.title + '：数据不足')));
  const evidence = (persona.evidence && persona.evidence.data) || [];
  const quotes = (persona.evidence && persona.evidence.quotes) || [];

  let prompt = '阅读人格代码：' + persona.code +
    '\n主称号：' + persona.name +
    '\n一句定调：' + persona.tagline;
  if (persona.nicknames && persona.nicknames.length) {
    prompt += '\n三个特质绰号：' + persona.nicknames.join('、');
  }
  prompt += '\n四维判定：\n' + dimLines.join('\n');
  if (evidence.length) {
    prompt += '\n数据证据：' + evidence.join('、');
  }
  if (quotes.length) {
    prompt += '\n原文证据：\n' + quotes.map((q) => '「' + q.text + '」——《' + (q.title || '未命名') + '》').join('\n');
  }
  return prompt;
}

/** 底层：把对话交给云函数转发 DeepSeek。永不 reject，返回 { ok, text } 或 { ok:false, code, error }。 */
export async function callAI(messages) {
  if (!AI_ENABLED) {
    return { ok: false, code: 'disabled', error: '当前版本不提供该能力' };
  }
  if (!Array.isArray(messages) || !messages.length) {
    return { ok: false, code: 'param', error: '缺少对话内容' };
  }
  const res = await callRemote(messages);
  if (res && typeof res.ok === 'boolean') {
    return res;
  }
  return { ok: false, code: 'empty', error: 'AI 返回结果无效' };
}

/** 生成 AI 人格画像：主入口，永不 reject */
export async function generatePersonaPortrait(persona) {
  if (!persona || !persona.code) {
    return { ok: false, code: 'param', error: '缺少人格结果' };
  }
  return await callAI([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildPersonaPrompt(persona) },
  ]);
}
