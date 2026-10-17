/**
 * 灵感漫游（H12）· 纯计算核心 — 素材门槛 / 铜银金分级 / 周键 / 选材 / 组刊
 *
 * 来源：mobile/miniprogram/shared/wander-core.js（逐字移植，仅 CommonJS → ESM）。
 * ⚠️ 算法单一来源：改这里请同步小程序端，避免两端口径漂移。
 * 只做纯计算：不联网、不读写本机存储、不写日志。
 *   - 取数与计数见 wander-data.js；
 *   - 持久化 / 频率限制见 wander-store.js；
 *   - AI 成文见 wander-ai.js。
 */

import { tagAndGroup, normText, hashKey, dateKey, dayLabel } from './daily-core.js';

// ---- 素材门槛与分级（数值为建议值，可调；与 RPD §3 H12 一致）----
export const TIERS = [
  { key: 'gold', name: '金', marks: 1000, thoughts: 600, weekly: 3, sparks: 5, sparksMin: 3, seeds: 3, words: 1000 },
  { key: 'silver', name: '银', marks: 600, thoughts: 300, weekly: 2, sparks: 3, sparksMin: 3, seeds: 3, words: 700 },
  { key: 'copper', name: '铜', marks: 300, thoughts: 100, weekly: 1, sparks: 2, sparksMin: 2, seeds: 2, words: 400 },
];
export const UNLOCK = TIERS[TIERS.length - 1];   // 最低档（铜）即解锁门槛

// 同一主题下至少这么多条素材，才够「编织」出一篇主题综述
export const MATERIAL_MIN = 6;
// 一期最多引用这么多条素材（防正文过长）
export const MATERIAL_MAX = 12;
// 同一本书最多取这么多条（跨书优先，避免整期只讲一本书）
export const PER_BOOK_MAX = 3;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 取某时间戳所在「周」的周一零点 */
export function weekStart(ts) {
  const d = new Date(ts || Date.now());
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // 周一 = 0
  d.setDate(d.getDate() - offset);
  return d;
}

/** 周键：以该周周一日期为键（YYYY-MM-DD），用于「本周是否已生成」判定 */
export function weekKey(ts) {
  const d = weekStart(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 人类可读周标签：10月6日 – 10月12日 */
export function weekLabel(ts) {
  const s = weekStart(ts);
  const e = new Date(s.getTime());
  e.setDate(e.getDate() + 6);
  return (s.getMonth() + 1) + '月' + s.getDate() + '日 – ' + (e.getMonth() + 1) + '月' + e.getDate() + '日';
}

/** 按素材量返回当前档位；未达最低档返回 null */
export function tierOf(marks, thoughts) {
  const m = Number(marks) || 0;
  const t = Number(thoughts) || 0;
  for (let i = 0; i < TIERS.length; i += 1) {
    if (m >= TIERS[i].marks && t >= TIERS[i].thoughts) {
      return TIERS[i];
    }
  }
  return null;
}

/** 按 key 取档位对象 */
export function tierByKey(key) {
  for (let i = 0; i < TIERS.length; i += 1) {
    if (TIERS[i].key === key) {
      return TIERS[i];
    }
  }
  return null;
}

/** 比 current 更高的下一档（current 为空时即最低档） */
export function nextTier(current) {
  if (!current) {
    return UNLOCK;
  }
  const index = TIERS.map((tier) => tier.key).indexOf(current.key);
  return index > 0 ? TIERS[index - 1] : null;
}

/**
 * 门槛进度：解锁状态 + 当前档位 + 距「下一档 / 解锁」还差多少。
 * @returns {object} { unlocked, tier, marks, thoughts, target, needMarks, needThoughts, gapMarks, gapThoughts }
 */
export function tierProgress(marks, thoughts) {
  const m = Number(marks) || 0;
  const t = Number(thoughts) || 0;
  const tier = tierOf(m, t);
  const target = nextTier(tier);
  return {
    unlocked: !!tier,
    tier: tier,
    marks: m,
    thoughts: t,
    target: target,
    needMarks: target ? target.marks : UNLOCK.marks,
    needThoughts: target ? target.thoughts : UNLOCK.thoughts,
    gapMarks: target ? Math.max(0, target.marks - m) : 0,
    gapThoughts: target ? Math.max(0, target.thoughts - t) : 0,
  };
}

// ---- 选材 ----

function toMaterial(item) {
  return {
    bookId: item.bookId || '',
    title: item.title || '',
    author: item.author || '',
    kind: item.kind || 'mark',
    text: item.text || '',
    at: item.at || 0,
  };
}

/**
 * 从候选素材中挑一批：先按「每本上限」跨书铺开，划线 / 想法交替取，不够再放宽每本上限补齐。
 * 同一文本只取一次；优先长句（信息量更大）。
 */
function pickMaterials(items, max, perBookMax) {
  const longest = (a, b) => (b.text.length - a.text.length) || ((b.at || 0) - (a.at || 0));
  const marks = items.filter((item) => item.kind !== 'review').sort(longest);
  const reviews = items.filter((item) => item.kind === 'review').sort(longest);
  const seen = {};
  const perBook = {};

  const takeOne = (arr, capped) => {
    for (let i = 0; i < arr.length; i += 1) {
      const item = arr[i];
      const key = normText(item.text);
      if (!key || seen[key]) {
        continue;
      }
      const bookKey = item.bookId || item.title || '_';
      if (capped && (perBook[bookKey] || 0) >= perBookMax) {
        continue;
      }
      seen[key] = true;
      perBook[bookKey] = (perBook[bookKey] || 0) + 1;
      return toMaterial(item);
    }
    return null;
  };

  const out = [];
  // 第一轮：跨书铺开 + 划线 / 想法交替
  while (out.length < max) {
    const before = out.length;
    const m = takeOne(marks, true);
    if (m) {
      out.push(m);
    }
    if (out.length >= max) {
      break;
    }
    const r = takeOne(reviews, true);
    if (r) {
      out.push(r);
    }
    if (out.length === before) {
      break;
    }
  }
  // 第二轮：放宽每本上限，补齐到上限
  while (out.length < max) {
    const before = out.length;
    const m = takeOne(marks, false);
    if (m) {
      out.push(m);
    }
    if (out.length >= max) {
      break;
    }
    const r = takeOne(reviews, false);
    if (r) {
      out.push(r);
    }
    if (out.length === before) {
      break;
    }
  }
  return out;
}

/**
 * 抽签选材：挑一个「素材足够多」的主题（尽量避开上一期的主题），从中选一批划线 / 想法。
 * 找不到成规模的主题时，退化为「综合」——直接按素材池选，仍能成篇。
 * @param {Array} pool 素材池 [{bookId,title,author,kind,text,at}]
 * @param {object} usedMap 已用素材集合 {hashKey: ts}（由 wander-store 提供）
 * @param {object} opts { avoidTheme }
 * @returns {object} { ok, reason?, count?, need?, resetUsed?, theme, materials[], poolSize }
 */
export function prepareWander(pool, usedMap, opts) {
  const o = opts || {};
  const list = Array.isArray(pool) ? pool : [];
  if (list.length < MATERIAL_MIN) {
    return { ok: false, reason: 'material', count: list.length, need: MATERIAL_MIN };
  }

  const used = usedMap && typeof usedMap === 'object' ? usedMap : {};
  const isUsed = (item) => !!used[hashKey(item.text)];
  const { tagged, groups } = tagAndGroup(list);

  // 候选主题：素材量足够，且尽量不是上一期的主题
  let theme = '';
  let candidates = tagged;
  const themes = Object.keys(groups)
    .map((name) => ({ name: name, items: groups[name] }))
    .filter((t) => t.items.length >= MATERIAL_MIN)
    .filter((t) => (o.avoidTheme ? t.name !== o.avoidTheme : true))
    .sort((a, b) => b.items.length - a.items.length);
  if (themes.length) {
    const top = themes.slice(0, 3);   // 在素材量靠前的主题里随机挑，避免每周都同一个主题
    const chosen = top[Math.floor(Math.random() * top.length)];
    theme = chosen.name;
    candidates = chosen.items;
  }

  // 全部用过 → 请调用方重置「已用集合」（覆盖周期）
  let resetUsed = false;
  let fresh = candidates.filter((item) => !isUsed(item));
  if (fresh.length < MATERIAL_MIN) {
    resetUsed = true;
    fresh = candidates.slice();
  }

  const materials = pickMaterials(fresh, MATERIAL_MAX, PER_BOOK_MAX);
  if (materials.length < MATERIAL_MIN) {
    return { ok: false, reason: 'material', count: materials.length, need: MATERIAL_MIN };
  }

  return {
    ok: true,
    theme: theme,
    materials: materials,
    resetUsed: resetUsed,
    poolSize: tagged.length,
  };
}

// ---- 组刊 ----

// 正文里标记「读者原文」的内联标记：AI 逐字引用读者的划线 / 想法时用 [[ ]] 包住，
// 前端据此加下划线，让读者一眼看到「这句是我自己划的」。
const MINE_OPEN = '[[';
const MINE_CLOSE = ']]';

/**
 * 把带标记的正文切成段：[{i, text, mine}]（mine=true 即读者原文）。
 * 标记本身不进入文本；找不到配对时，把剩余部分整体当作原文。
 */
export function splitMarks(text) {
  const raw = String(text || '');
  const segs = [];
  let rest = raw;
  while (rest) {
    const open = rest.indexOf(MINE_OPEN);
    if (open < 0) {
      segs.push({ text: rest, mine: false });
      break;
    }
    if (open > 0) {
      segs.push({ text: rest.slice(0, open), mine: false });
    }
    const close = rest.indexOf(MINE_CLOSE, open + MINE_OPEN.length);
    if (close < 0) {
      segs.push({ text: rest.slice(open + MINE_OPEN.length), mine: true });
      break;
    }
    segs.push({ text: rest.slice(open + MINE_OPEN.length, close), mine: true });
    rest = rest.slice(close + MINE_CLOSE.length);
  }
  const out = segs.filter((seg) => seg.text);
  out.forEach((seg, index) => { seg.i = index; });
  return out;
}

/** 去掉原文标记后的纯文本（分享图 / 纯文本渲染用） */
export function stripMarks(text) {
  return splitMarks(text).map((seg) => seg.text).join('');
}

/**
 * 组装一期「灵感漫游」（不落盘，由调用方 saveIssue）。
 * @param {object} material prepareWander 的结果
 * @param {object} text wander-ai.generateWanderText 的结果
 * @param {object} tier tierOf 得到的档位
 */
export function makeIssue(material, text, tier) {
  const now = Date.now();
  const t = text || {};
  const srcs = (material && material.materials) || [];
  return {
    id: weekKey(now) + '-' + now,
    week: weekKey(now),
    weekLabel: weekLabel(now),
    createdAt: now,
    tier: (tier && tier.key) || '',
    tierName: (tier && tier.name) || '',
    theme: (material && material.theme) || '',
    ai: !!t.ai,
    title: t.title || '',
    summary: t.summary || '',
    body: String(t.body || ''),
    sources: srcs.map((item) => ({
      bookId: item.bookId || '',
      title: item.title || '',
      author: item.author || '',
      kind: item.kind || 'mark',
      text: item.text || '',
      at: item.at || 0,
    })),
    sparks: (Array.isArray(t.sparks) ? t.sparks : [])
      .map((item) => (typeof item === 'string'
        ? { text: item, source: '' }
        : { text: (item && item.text) || '', source: (item && item.source) || '' }))
      .filter((item) => item.text),
    seeds: Array.isArray(t.seeds) ? t.seeds : [],
    starred: false,
  };
}

/**
 * 本地规则标题（AI 不可用时使用）：只按主题给一句中性的合辑标题，不生成任何综述文案。
 */
export function localTitle(theme) {
  return theme ? ('关于「' + theme + '」的一组笔记') : '这一周，重读几段划线';
}

/**
 * 组装一期「纯本地规则排版」内容（AI 不可用时使用）：
 * 不做 AI 成文、无摘要 / 正文 / 外部火花 / 创作种子，只按主题把素材平铺出来供读者自己串读。
 */
export function makeLocalIssue(material, tier) {
  return makeIssue(material, {
    ai: false,
    title: localTitle((material && material.theme) || ''),
    summary: '',
    body: '',
    sparks: [],
    seeds: [],
  }, tier);
}

/** 一期 → 页面视图（来源可点开；正文按原文标记切段；外部火花带出处） */
export function toView(issue) {
  if (!issue) {
    return null;
  }
  const body = String(issue.body || '');
  const segs = splitMarks(body);
  return {
    id: issue.id,
    week: issue.week,
    weekLabel: issue.weekLabel || '',
    dateLabel: dayLabel(issue.createdAt),
    tier: issue.tier || '',
    tierName: issue.tierName || '',
    theme: issue.theme || '',
    ai: !!issue.ai,
    title: issue.title || '',
    summary: issue.summary || '',
    body: stripMarks(body),
    bodySegs: segs.length ? segs : [{ i: 0, text: body, mine: false }],
    sources: (issue.sources || []).map((item, index) => ({
      index: index,
      text: item.text || '',
      title: item.title || '',
      author: item.author || '',
      kindLabel: item.kind === 'review' ? '我的想法' : '划线',
      open: false,
    })),
    sparks: (issue.sparks || []).map((item, index) => ({
      index: index,
      text: (item && item.text) || (typeof item === 'string' ? item : ''),
      source: (item && item.source) || '',
    })),
    seeds: (issue.seeds || []).map((item, index) => ({
      index: index,
      angle: (item && item.angle) || '切入',
      line: (item && item.line) || '',
    })),
    starred: !!issue.starred,
  };
}

export { dateKey, hashKey };
