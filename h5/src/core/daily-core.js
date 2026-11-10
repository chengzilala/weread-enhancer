/**
 * 每日卡片回顾（H11）· 纯计算核心 — 选材 / 主题召回 / 组卡
 *
 * 来源：mobile/miniprogram/shared/daily-core.js（逐字移植，仅 CommonJS → ESM）。
 * 主题标签复用 persona-core 的 PERSONA_THEMES（规则 + 关键词，首版不做 embedding）。
 * 「关联」的准确性靠两条硬约束：① 主题至少命中 2 个关键词才算数；② 两条文本必须真实共享关键词。
 * 红线：引用一律来自读者自己的划线 / 想法原文，禁止编造。
 */

import { PERSONA_THEMES } from './persona-core.js';

export const MATERIAL_MIN = 8;      // 素材门槛：划线 + 想法 总条数（不够则走引导，不硬生成）
export const RELATED_MAX = 3;       // 关联旧划线最多条数
const THEME_MIN_HITS = 2;    // 认定主题所需的最少关键词命中数（只命中 1 个通用词不算）
export const BOOK_MIN = 2;          // 每日卡片至少来自 2 本书（M17）
export const COOLDOWN_DAYS = 30;    // 同一划线 30 天内不重复进正文（M17）
export const BOOK_DAILY_MAX = 2;    // 同一本书 30 天内最多当 2 次主素材（M17）
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- 基础工具 ----

/** 归一化：去空白与标点，仅留中文 / 字母 / 数字（用于去重与比较） */
export function normText(text) {
  return String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
}

/** 稳定的短哈希（djb2 变体 + 长度），用作「已用素材」索引键 */
export function hashKey(text) {
  const s = normText(text);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return 'h' + h.toString(36) + '_' + s.length;
}

/** 本机日期键：YYYY-MM-DD */
export function dateKey(ts) {
  const d = new Date(ts || Date.now());
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + day;
}

/** 人类可读日期：10月6日 周一 */
export function dayLabel(ts) {
  const d = new Date(ts || Date.now());
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week;
}

/** 该文本命中的全部主题关键词（去重）——用于判断两条划线是否「真的共享词」 */
function themeWordsIn(text) {
  const t = String(text || '');
  const found = [];
  for (let i = 0; i < PERSONA_THEMES.length; i += 1) {
    const words = PERSONA_THEMES[i].words;
    for (let j = 0; j < words.length; j += 1) {
      if (t.indexOf(words[j]) >= 0 && found.indexOf(words[j]) < 0) {
        found.push(words[j]);
      }
    }
  }
  return found;
}

/**
 * 取关键词命中数最多的主题名；命中数不足 THEME_MIN_HITS 时返回 ''（宁可不贴标签，也不误判）。
 */
export function themeOfText(text) {
  const t = String(text || '');
  let best = '';
  let bestHits = 0;
  for (let i = 0; i < PERSONA_THEMES.length; i += 1) {
    const theme = PERSONA_THEMES[i];
    let hits = 0;
    for (let j = 0; j < theme.words.length; j += 1) {
      if (t.indexOf(theme.words[j]) >= 0) {
        hits += 1;
      }
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = theme.name;
    }
  }
  return bestHits >= THEME_MIN_HITS ? best : '';
}

// ---- 选材与主题召回 ----

/** 给素材池打主题标签，并按主题分组（返回 { tagged, groups }） */
export function tagAndGroup(pool) {
  const tagged = [];
  const groups = {};
  (Array.isArray(pool) ? pool : []).forEach((item) => {
    if (!item || typeof item.text !== 'string' || !item.text.trim()) {
      return;
    }
    const theme = item.theme || themeOfText(item.text);
    const next = {
      bookId: item.bookId || '',
      title: item.title || '',
      author: item.author || '',
      kind: item.kind || 'mark',
      text: item.text.trim(),
      at: item.at || 0,
      theme: theme,
      words: themeWordsIn(item.text),
    };
    tagged.push(next);
    if (theme) {
      if (!groups[theme]) {
        groups[theme] = [];
      }
      groups[theme].push(next);
    }
  });
  return { tagged: tagged, groups: groups };
}

/**
 * 抽签选材（纯函数）：随机挑一条「主划线」，并召回真正相关的旧句（同主题 + 共享关键词，跨书优先）。
 * M17 起：30 天冷却、最近 7 天文章 hash 避让、单本 30 天配额、至少跨 2 本书。
 * @param {Array} pool  素材池 [{bookId,title,author,kind,text,at}]
 * @param {object} usedMap 已用素材集合 {hashKey: ts}
 * @param {object} opts { cooldownDays, recentHashes, recentMainBookIds, avoidThemes, bookDailyMax }
 */
export function prepareMaterial(pool, usedMap, opts) {
  const o = opts || {};
  const list = Array.isArray(pool) ? pool : [];
  if (list.length < MATERIAL_MIN) {
    return { ok: false, reason: 'material', count: list.length, need: MATERIAL_MIN };
  }

  const used = usedMap && typeof usedMap === 'object' ? usedMap : {};
  const now = Date.now();
  const cooldownMs = (Number(o.cooldownDays) || COOLDOWN_DAYS) * DAY_MS;
  const recentHashes = o.recentHashes && typeof o.recentHashes === 'object' ? o.recentHashes : {};
  const isFresh = (item) => {
    const key = hashKey(item.text);
    if (recentHashes[key]) {
      return false;
    }
    const at = Number(used[key]) || 0;
    return !at || (now - at) >= cooldownMs;
  };

  const { tagged, groups } = tagAndGroup(list);
  const fresh = tagged.filter(isFresh);
  if (fresh.length < MATERIAL_MIN) {
    return { ok: false, reason: 'material', count: fresh.length, need: MATERIAL_MIN, exhausted: true };
  }
  const freshSet = {};
  fresh.forEach((item) => { freshSet[hashKey(item.text)] = true; });

  const bookCount = {};
  tagged.forEach((item) => {
    if (item.bookId) {
      bookCount[item.bookId] = (bookCount[item.bookId] || 0) + 1;
    }
  });
  const multiBook = Object.keys(bookCount).length >= BOOK_MIN;

  const recentMain = o.recentMainBookIds && typeof o.recentMainBookIds === 'object' ? o.recentMainBookIds : {};
  const maxPerBook = Number(o.bookDailyMax) || BOOK_DAILY_MAX;
  const allowedBook = (bookId) => !bookId || (Number(recentMain[bookId]) || 0) < maxPerBook;
  const avoidThemes = Array.isArray(o.avoidThemes) ? o.avoidThemes : [];

  const sharesWord = (a, b) => {
    for (let i = 0; i < a.words.length; i += 1) {
      if (b.words.indexOf(a.words[i]) >= 0) {
        return true;
      }
    }
    return false;
  };
  const relatedOf = (main, limit, strictCrossBook) => {
    if (!main.theme) {
      return [];
    }
    const max = limit || RELATED_MAX;
    const seen = {};
    seen[normText(main.text)] = true;
    const picked = [];
    const candidates = (groups[main.theme] || [])
      .filter((item) => item !== main && freshSet[hashKey(item.text)] && sharesWord(main, item))
      .filter((item) => !strictCrossBook || !multiBook || (item.bookId && item.bookId !== main.bookId))
      .sort((a, b) => {
        const ca = (a.title && a.title !== main.title) ? 1 : 0;
        const cb = (b.title && b.title !== main.title) ? 1 : 0;
        if (ca !== cb) {
          return cb - ca;
        }
        return (b.at || 0) - (a.at || 0);
      });
    for (let i = 0; i < candidates.length && picked.length < max; i += 1) {
      const item = candidates[i];
      const key = normText(item.text);
      if (!key || seen[key]) {
        continue;
      }
      seen[key] = true;
      picked.push({
        text: item.text,
        at: item.at || 0,
        title: item.title || '',
        author: item.author || '',
        kind: item.kind || 'mark',
        bookId: item.bookId || '',
      });
    }
    return picked;
  };

  // 单本配额：优先选 30 天内没当过主素材的书；全部超额时再放宽，避免直接无卡可出
  const allowed = fresh.filter((item) => allowedBook(item.bookId));
  const base = allowed.length ? allowed : fresh;
  const withoutAvoidedTheme = (arr) => (avoidThemes.length
    ? arr.filter((item) => !item.theme || avoidThemes.indexOf(item.theme) < 0)
    : arr);

  let mains = withoutAvoidedTheme(base.filter((item) => item.kind === 'mark' && item.theme
    && relatedOf(item, 1, true).length > 0));
  if (!mains.length) {
    mains = base.filter((item) => item.kind === 'mark' && item.theme && relatedOf(item, 1, true).length > 0);
  }
  if (!mains.length) {
    mains = base.filter((item) => item.kind === 'review' && item.theme && relatedOf(item, 1, true).length > 0);
  }
  if (!mains.length) {
    mains = withoutAvoidedTheme(base.filter((item) => item.kind === 'mark'));
  }
  if (!mains.length) {
    mains = base;
  }
  if (!mains.length) {
    return { ok: false, reason: 'material', count: fresh.length, need: MATERIAL_MIN, exhausted: true };
  }
  const main = mains[Math.floor(Math.random() * mains.length)];

  let related = relatedOf(main, RELATED_MAX, true);
  if (!related.length && !multiBook) {
    related = relatedOf(main, RELATED_MAX, false);
  }

  const bookIds = [];
  const pushBook = (id) => {
    const key = id || '';
    if (key && bookIds.indexOf(key) < 0) {
      bookIds.push(key);
    }
  };
  pushBook(main.bookId);
  related.forEach((item) => pushBook(item.bookId));

  return {
    ok: true,
    main: {
      bookId: main.bookId || '',
      text: main.text,
      at: main.at || 0,
      title: main.title || '',
      author: main.author || '',
      kind: main.kind || 'mark',
    },
    related: related,
    themes: main.theme ? [main.theme] : [],
    bookIds: bookIds,
    hashes: [hashKey(main.text)].concat(related.map((item) => hashKey(item.text))),
    singleBook: bookIds.length < BOOK_MIN,
    poolSize: tagged.length,
  };
}

// ---- 组卡 ----

/**
 * 本地规则标题（解析失败时的占位；H5 保留 AI，正常走 AI 标题）。
 */
export function localTitle(material) {
  const main = (material && material.main) || {};
  const theme = (material && material.themes && material.themes[0]) || '';
  const isNote = main.kind === 'review';
  if (theme) {
    return '重读一段关于「' + theme + '」的' + (isNote ? '想法' : '划线');
  }
  return '今天，重读一段' + (isNote ? '想法' : '划线');
}

/** 组装卡片对象（不落盘，由调用方 saveCard） */
export function makeCard(material, text) {
  const now = Date.now();
  const t = text || {};
  const main = (material && material.main) || {};
  return {
    id: dateKey(now) + '-' + now,
    date: dateKey(now),
    createdAt: now,
    ai: !!t.ai,
    title: t.title || '今天，重读一段划线',
    note: t.note || '',
    themes: (material && material.themes) || [],
    quote: {
      bookId: main.bookId || '',
      text: main.text || '',
      at: main.at || 0,
      title: main.title || '',
      author: main.author || '',
      kind: main.kind || 'mark',
    },
    related: (material && material.related) || [],
    // M17 文章级记录：本篇用到的全部 hash 与书目，供后续「最近 7 天避让 / 单本配额」统计
    hashes: (material && material.hashes) || [],
    bookIds: (material && material.bookIds) || [],
    starred: false,
  };
}

/** 卡片 → 页面视图（关联项默认收起；可点开展开） */
export function toView(card) {
  if (!card) {
    return null;
  }
  return {
    id: card.id,
    date: card.date,
    dateLabel: dayLabel(card.createdAt),
    ai: !!card.ai,
    title: card.title,
    note: card.note,
    themes: card.themes || [],
    quote: card.quote,
    related: (card.related || []).map((item, index) => ({
      text: item.text,
      title: item.title || '',
      author: item.author || '',
      kind: item.kind || 'mark',
      index: index,
      open: false,
    })),
    starred: !!card.starred,
  };
}
