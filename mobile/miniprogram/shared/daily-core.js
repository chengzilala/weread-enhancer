/**
 * 每日卡片回顾（M11）· 纯计算核心 — 选材 / 主题召回 / 组卡
 *
 * 定位：把「素材池」变成一篇卡片的原料——随机抽一条主划线、按主题召回同主题旧划线、组装卡片对象。
 * 只做纯计算：不联网、不读写本机存储、不写日志。
 *   - 持久化见 daily-store.js（卡片历史 / 已用素材 / 限流）；
 *   - AI 成文见 daily-ai.js；
 *   - 素材池构建见 daily-data.js。
 *
 * 主题标签复用 persona-core 的 PERSONA_THEMES（规则 + 关键词，首版不做 embedding）。
 * 「关联」的准确性靠两条硬约束：① 主题至少命中 2 个关键词才算数；② 两条文本必须真实共享关键词。
 * 红线：引用一律来自读者自己的划线 / 想法原文，禁止编造。
 */
const { PERSONA_THEMES } = require('./persona-core');

const MATERIAL_MIN = 8;      // 素材门槛：划线 + 想法 总条数（不够则走引导，不硬生成）
const RELATED_MAX = 3;       // 关联旧划线最多条数
const THEME_MIN_HITS = 2;    // 认定主题所需的最少关键词命中数（只命中 1 个通用词不算）

// ---- 基础工具 ----

/** 归一化：去空白与标点，仅留中文 / 字母 / 数字（用于去重与比较） */
function normText(text) {
  return String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
}

/** 稳定的短哈希（djb2 变体 + 长度），用作「已用素材」索引键 */
function hashKey(text) {
  const s = normText(text);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return 'h' + h.toString(36) + '_' + s.length;
}

/** 本机日期键：YYYY-MM-DD */
function dateKey(ts) {
  const d = new Date(ts || Date.now());
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + day;
}

/** 人类可读日期：10月6日 周一 */
function dayLabel(ts) {
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
 * 为什么设门槛：只命中一个通用词（如数学段落里的「理解」）就会把它错判成「关系与情感」，
 * 进而召回一批毫不相干的旧划线——这正是「关联错乱」的根源。
 */
function themeOfText(text) {
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
function tagAndGroup(pool) {
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
 * 优先选「能召回关联旧句」的主线，保证能形成「重新关联」；召不到就老实单条深读。
 * @param {Array} pool  素材池 [{bookId,title,author,kind,text,at}]
 * @param {object} usedMap 已用素材集合 {hashKey: ts}（由 daily-store 提供）
 * @returns {object} { ok, reason?, count?, need?, resetUsed?, main?, related?, themes?, poolSize? }
 */
function prepareMaterial(pool, usedMap) {
  const list = Array.isArray(pool) ? pool : [];
  if (list.length < MATERIAL_MIN) {
    return { ok: false, reason: 'material', count: list.length, need: MATERIAL_MIN };
  }

  const used = usedMap && typeof usedMap === 'object' ? usedMap : {};
  const isUsed = (item) => !!used[hashKey(item.text)];
  const { tagged, groups } = tagAndGroup(list);

  // 关联判定：必须「同主题」且「真的共享至少一个主题关键词」，宁缺毋滥。
  const sharesWord = (a, b) => {
    for (let i = 0; i < a.words.length; i += 1) {
      if (b.words.indexOf(a.words[i]) >= 0) {
        return true;
      }
    }
    return false;
  };
  const relatedOf = (main, limit) => {
    if (!main.theme) {
      return [];
    }
    const max = limit || RELATED_MAX;
    const seen = {};
    seen[normText(main.text)] = true;
    const picked = [];
    const candidates = (groups[main.theme] || [])
      .filter((item) => item !== main && sharesWord(main, item))
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
      });
    }
    return picked;
  };

  // 主线优先：有主题、能找到真正相关的旧句、且未被用过（划线优先，其次想法）
  let resetUsed = false;
  const withRelated = (kind) => tagged.filter((item) => item.kind === kind && item.theme
    && !isUsed(item) && relatedOf(item, 1).length > 0);
  let mains = withRelated('mark');
  if (!mains.length) {
    mains = withRelated('review');
  }
  if (!mains.length) {
    mains = tagged.filter((item) => item.kind === 'mark' && !isUsed(item));
  }
  if (!mains.length) {
    // 全部用过 → 请调用方重置「已用集合」（覆盖周期），本轮忽略 used
    resetUsed = true;
    mains = tagged.filter((item) => item.kind === 'mark');
    if (!mains.length) {
      mains = tagged.slice();
    }
  }
  const main = mains[Math.floor(Math.random() * mains.length)];

  // 关联：真正共享关键词的同主题旧句（跨书优先、按时间新→旧、去重）
  const related = relatedOf(main);

  return {
    ok: true,
    resetUsed: resetUsed,
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
    poolSize: tagged.length,
  };
}

// ---- 组卡 ----

/**
 * 本地规则标题（M15 去 AI 后使用）：不生成任何解读 / 共情文案，
 * 只按素材事实给一句中性的「重读」标题（命中主题时点出主题）。
 */
function localTitle(material) {
  const main = (material && material.main) || {};
  const theme = (material && material.themes && material.themes[0]) || '';
  const isNote = main.kind === 'review';
  if (theme) {
    return '重读一段关于「' + theme + '」的' + (isNote ? '想法' : '划线');
  }
  return '今天，重读一段' + (isNote ? '想法' : '划线');
}

/**
 * 组装卡片对象（不落盘，由调用方 saveCard）。
 * @param {object} material prepareMaterial 的结果
 * @param {object} text { ai, title, note }（AI 成文见 daily-ai.js；M15 关闭后由页面传本地规则标题）
 */
function makeCard(material, text) {
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
    starred: false,
  };
}

/** 卡片 → 页面视图（关联项默认收起；可点开展开） */
function toView(card) {
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

module.exports = {
  MATERIAL_MIN,
  RELATED_MAX,
  normText,
  hashKey,
  dateKey,
  dayLabel,
  themeOfText,
  tagAndGroup,
  prepareMaterial,
  makeCard,
  localTitle,
  toView,
};
