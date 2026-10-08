/**
 * H3 阅读人格（+ H10 AI 润色画像 / H5 分享 / H13 朗读）
 *
 * 纯本机计算：4 维代码 + 16 型称号 + 判定依据 + 数据证据（复用 persona-core）。
 * 人格主体不依赖 AI；AI 只做润色（走服务端托管 Key），失败不改变本机判定。
 * 数据不足时给进度引导，绝不硬出结论。
 */

import { fetchReadData, fetchOverview, fetchCorpus } from '../data.js';
import { getReadingPersona, personaYear } from '../core/persona-core.js';
import { personaFigureSvg } from '../core/persona-figure.js';
import { generatePersonaPortrait } from '../ai.js';
import { messageOf } from '../core/errors.js';
import { esc, stateHtml, toast } from '../ui.js';
import { getMask, getProfile } from '../store.js';
import { presentShareImage } from '../share.js';
import { renderPersonaShare } from '../core/persona-share.js';
import { speakList, ttsSupported } from '../tts.js';

export const title = '阅读人格';

let lastPersona = null;   // 最近一次算出的（视图）人格
let aiText = '';          // AI 润色画像文本
let aiBusy = false;

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="personaBody">' + stateHtml('loading', '正在本机计算你的阅读人格…') + '</div>';
  const body = root.querySelector('#personaBody');
  body.addEventListener('click', (e) => {
    const retry = e.target.closest('[data-action="retry"]');
    if (retry) {
      load(body, app);
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) {
      app.go(go.getAttribute('data-goto'));
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      return;
    }
    const action = btn.getAttribute('data-action');
    if (action === 'ai') {
      onAi(body, app);
    } else if (action === 'share') {
      doShare();
    } else if (action === 'tts') {
      doTts();
    }
  });
  load(body, app);
}

async function load(body, app) {
  body.innerHTML = stateHtml('loading', '正在本机计算你的阅读人格…');

  const overallRes = await fetchReadData('overall');
  if (!overallRes.ok) {
    body.innerHTML = stateHtml('error', overallRes.error || '读取累计数据失败', '重试');
    return;
  }
  const overall = overallRes.data || {};

  const overview = await fetchOverview(false);
  const shelf = overview.ok ? overview.shelf : null;
  const notebooks = overview.ok ? overview.notebooks : null;

  // 先看数据门槛（不打语料请求，省时间）
  const pre = getReadingPersona({ overall: overall, shelf: shelf, notebooks: notebooks, hasKey: true });
  if (!pre.ok) {
    body.innerHTML = gateHtml(pre);
    return;
  }

  body.innerHTML = stateHtml('loading', '正在拉取笔记语料（首次稍慢，之后有缓存）…');
  const corpusRes = await fetchCorpus(notebooks, false);
  const corpus = corpusRes.ok ? corpusRes.corpus : null;

  const persona = getReadingPersona({
    overall: overall,
    shelf: shelf,
    notebooks: notebooks,
    corpus: corpus,
    hasKey: true,
    readerName: '',
    corpusState: corpusRes.ok ? 'ok' : 'error',
    corpusError: corpusRes.ok ? '' : (corpusRes.error || ''),
  });
  if (!persona.ok) {
    body.innerHTML = gateHtml(persona);
    return;
  }
  lastPersona = persona;
  aiText = '';
  body.innerHTML = personaHtml(persona);
}

/** 数据不足 / 未配置 的引导 */
function gateHtml(res) {
  const p = (res && res.progress) || {};
  const rows =
    '<div class="wre-row"><div class="wre-row__head"><span>累计阅读时长</span><span class="wre-muted">' +
    esc(p.hours || '0') + ' / ' + esc(p.needHours || 10) + ' 小时</span></div>' +
    '<div class="wre-track"><div class="wre-track__fill" style="width:' +
    Math.min(100, Math.round(((Number(p.hours) || 0) / (p.needHours || 10)) * 100)) + '%"></div></div></div>' +
    '<div class="wre-row"><div class="wre-row__head"><span>笔记条数</span><span class="wre-muted">' +
    esc(p.notes || 0) + ' / ' + esc(p.needNotes || 20) + ' 条</span></div>' +
    '<div class="wre-track"><div class="wre-track__fill" style="width:' +
    Math.min(100, Math.round(((Number(p.notes) || 0) / (p.needNotes || 20)) * 100)) + '%"></div></div></div>';
  return (
    '<div class="wre-card">' +
    '  <div class="wre-card__title">还差一点数据</div>' +
    '  <div class="wre-muted">阅读人格基于你自己的官方数据在本机计算，需要累计阅读 ≥ 10 小时、笔记 ≥ 20 条。多读一会儿、多划几条线，就能算出来了。</div>' +
    rows +
    '  <button class="wre-btn" data-goto="home">回首页</button>' +
    '</div>'
  );
}

function dimRow(dim) {
  const left = dim.left || {};
  const right = dim.right || {};
  if (!dim.available) {
    return (
      '<div class="wre-dim is-na">' +
      '<div class="wre-dim__top"><span>' + esc(left.label) + '</span>' +
      '<span class="wre-dim__pct">—</span>' +
      '<span>' + esc(right.label) + '</span></div>' +
      '<div class="wre-dim__track is-na"><i style="width:0%"></i></div>' +
      '<div class="wre-dim__basis">' + esc(dim.basis || '数据还不够') + '</div>' +
      '</div>'
    );
  }
  const leftPick = !dim.centered && dim.side === left.letter;
  const rightPick = !dim.centered && dim.side === right.letter;
  return (
    '<div class="wre-dim' + (dim.centered ? ' is-center' : '') + '">' +
    '<div class="wre-dim__top">' +
    '  <span class="' + (leftPick ? 'is-pick' : '') + '">' + esc(left.label) + ' ' + dim.leftPct + '%</span>' +
    '  <span class="' + (rightPick ? 'is-pick' : '') + '">' + (100 - dim.leftPct) + '% ' + esc(right.label) + '</span>' +
    '</div>' +
    '<div class="wre-dim__track"><i style="width:' + dim.leftPct + '%"></i></div>' +
    '<div class="wre-dim__basis">依据：' + esc(dim.basis || '') + (dim.centered ? '（居中）' : '') + '</div>' +
    '</div>'
  );
}

/** 词语分析（对齐插件 buildPersonaWordsHtml） */
function wordsHtml(w) {
  if (!w || !w.top || !w.top.length) {
    return '';
  }
  const max = w.top.reduce((acc, item) => Math.max(acc, item.count), 0) || 1;
  const topRows = w.top.map((item, index) =>
    '<li class="wre-word-row">' +
    '<span class="wre-word-rank">' + (index + 1) + '</span>' +
    '<span class="wre-word">' + esc(item.word) + '</span>' +
    '<span class="wre-word-bar"><i style="width:' + Math.max(4, Math.round((item.count / max) * 100)) + '%"></i></span>' +
    '<span class="wre-word-count">' + item.count + '</span>' +
    '</li>').join('');
  const emo = w.emotion || { posPct: 0, neuPct: 0, negPct: 0 };
  const themes = (w.themes || []).map((item) =>
    '<span class="wre-chip">' + esc(item.name) + ' <b>' + item.count + '</b></span>').join('');
  const cloudList = w.cloud || [];
  const cloudMax = cloudList.reduce((acc, item) => Math.max(acc, item.count), 0) || 1;
  const cloudMin = cloudList.reduce((acc, item) => Math.min(acc, item.count), cloudMax);
  const cloud = cloudList.map((item) => {
    const size = 12 + Math.round(((item.count - cloudMin) / ((cloudMax - cloudMin) || 1)) * 14);
    return '<span class="wre-cloud__word" style="font-size:' + size + 'px">' + esc(item.word) + '</span>';
  }).join('');
  const catchHtml = w.catchphrase
    ? '<div class="wre-words-catch">你的口头禅：<em>' + esc(w.catchphrase.text) + '</em>' +
      (w.catchphrase.title ? '<span class="wre-quote-src">—— 《' + esc(w.catchphrase.title) + '》</span>' : '') + '</div>'
    : '';
  return (
    '<div class="wre-words">' +
    '<div class="wre-persona__subtitle">词语分析</div>' +
    '<div class="wre-words__label">高频词 TOP' + w.top.length + '</div>' +
    '<ul class="wre-word-list">' + topRows + '</ul>' +
    '<div class="wre-words__label">情绪比例</div>' +
    '<div class="wre-emotion-bar">' +
    '<i class="is-pos" style="width:' + emo.posPct + '%"></i>' +
    '<i class="is-neu" style="width:' + emo.neuPct + '%"></i>' +
    '<i class="is-neg" style="width:' + emo.negPct + '%"></i>' +
    '</div>' +
    '<div class="wre-emotion-legend">正向 ' + emo.posPct + '% · 中性 ' + emo.neuPct + '% · 负向 ' + emo.negPct + '%</div>' +
    (themes ? '<div class="wre-words__label">主题词</div><div class="wre-chips">' + themes + '</div>' : '') +
    (cloud ? '<div class="wre-words__label">词云</div><div class="wre-cloud">' + cloud + '</div>' : '') +
    catchHtml +
    '</div>'
  );
}

function personaHtml(p) {
  const nicks = (p.nicknames || []).map((n) =>
    '<span class="wre-persona__nick">' + esc(n) + '</span>').join('');
  const dims = (p.dims || []).map(dimRow).join('');
  const ev = p.evidence || {};
  const dataChips = (ev.data || []).map((d) =>
    '<span class="wre-chip">' + esc(d) + '</span>').join('');
  const quotes = (ev.quotes || []).map((q) =>
    '<blockquote class="wre-quote">' + esc(q.text) +
    '<div class="wre-quote-src">—— 《' + esc(q.title || '未命名') + '》' + (q.at ? (' · ' + personaYear(q.at)) : '') + '</div></blockquote>').join('');
  const corpusNote = p.corpusState === 'loading'
    ? '<div class="wre-note wre-note--inline">🧬 正在读取你的划线/想法语料，「表达方式」与「词语分析」稍后补全…</div>'
    : (p.corpusState === 'error' && p.corpusError ? '<div class="wre-note wre-note--inline">⚠️ ' + esc(p.corpusError) + '（不影响其余维度）</div>' : '');
  const aiBlock = aiText ? '<div class="wre-persona__ai">' + esc(aiText) + '</div>' : '';
  const figure = p.figure
    ? '<div class="wre-persona__figurewrap">' +
      '<div class="wre-persona__figure">' + personaFigureSvg(p.code) + '</div>' +
      '<div class="wre-persona__figurename">' + esc(p.figure.name) + '</div>' +
      '</div>'
    : '';
  const acts = ['<button class="wre-btn wre-btn--ghost" data-action="share">生成分享图</button>'];
  if (ttsSupported) {
    acts.push('<button class="wre-btn wre-btn--ghost" data-action="tts">🔊 朗读人格</button>');
  }

  // 主卡：严格对齐插件「人格卡」结构
  const main =
    '<div class="wre-card wre-persona">' +
    '  <div class="wre-persona__head">' +
    '    <div class="wre-persona__code">' + esc(p.code) + '</div>' +
    '    <div class="wre-persona__titlewrap">' +
    '      <div class="wre-persona__name">' + esc(p.name) + '</div>' +
    '      <div class="wre-persona__tagline">' + esc(p.tagline) + '</div>' +
    '    </div>' +
    figure +
    '  </div>' +
    '  <div class="wre-persona__share">' + acts.join('') + '</div>' +
    (nicks ? '  <div class="wre-persona__nicks">' + nicks + '</div>' : '') +
    (p.oneLiner ? '  <div class="wre-persona__one">' + esc(p.oneLiner) + '</div>' : '') +
    aiBlock +
    '  <div class="wre-persona__dims">' + dims + '</div>' +
    (dataChips
      ? '  <div class="wre-persona__evidence"><div class="wre-persona__subtitle">数据证据</div><div class="wre-chips">' + dataChips + '</div></div>'
      : '') +
    (quotes
      ? '  <div class="wre-persona__evidence"><div class="wre-persona__subtitle">原文证据</div>' + quotes + '</div>'
      : '') +
    '  ' + corpusNote +
    '  ' + wordsHtml(p.words) +
    '  <div class="wre-persona__boundary">基于你的阅读行为数据生成的趣味性参考画像，参考了 MBTI 的四维结构，不是心理测评，也不构成专业性格鉴定。</div>' +
    '</div>';

  return main + aiCardHtml() +
    '<div class="wre-note">本页为趣味参考、非心理测评，全部在你的浏览器本机按固定规则计算，不上传。</div>';
}

// ---- H10 AI 润色画像（人格主体不依赖 AI；AI 只做润色）----
function aiCardHtml() {
  const mask = getMask() || {};
  const parts = ['<div class="wre-card wre-aicard"><div class="wre-card__title">AI 润色画像</div>'];
  if (aiBusy) {
    parts.push('<div class="wre-muted">正在把你的判定写成一段有温度的话…</div>');
  } else if (!aiText) {
    parts.push('<div class="wre-muted">AI 只做「润色」：严格基于上面本机算出的判定与证据，写一段有温度的人格画像，不会虚构数字、也不会改变结论。</div>');
  }
  parts.push('<button class="wre-btn" data-action="ai"' + (aiBusy ? ' disabled' : '') + '>' +
    (aiBusy ? '正在生成…' : (aiText ? '重新润色' : 'AI 润色画像')) + '</button>');
  if (!mask.hasAiKey) {
    parts.push('<div class="wre-hint">需要 DeepSeek Key，可在「我的账户」里配置。</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

async function onAi(body, app) {
  if (aiBusy || !lastPersona) {
    return;
  }
  const mask = getMask() || {};
  if (!mask.hasAiKey) {
    toast('请先在「我的账户」里配置 DeepSeek Key');
    app.go('me');
    return;
  }
  aiBusy = true;
  body.innerHTML = personaHtml(lastPersona);
  const res = await generatePersonaPortrait(lastPersona);
  aiBusy = false;
  if (res.ok && res.text) {
    aiText = res.text;
    toast('已生成 AI 润色画像');
  } else {
    toast(messageOf(res, 'AI 润色失败，请稍后重试'));
  }
  body.innerHTML = personaHtml(lastPersona);
}

// ---- H5 分享 ----
function doShare() {
  const p = lastPersona;
  if (!p) {
    return;
  }
  presentShareImage(
    () => renderPersonaShare(p, getProfile()),
    { title: '微信悦读', text: '我的阅读人格 ' + (p.name || '') + ' · ' + (p.code || ''), link: typeof location !== 'undefined' ? location.href : '' },
    'persona.png'
  );
}

// ---- H13 朗读 ----
function doTts() {
  const p = lastPersona;
  if (!p) {
    return;
  }
  const items = [];
  items.push({ text: '你的阅读人格是 ' + p.name + '，代码 ' + p.code + '。' + (p.tagline || ''), label: '人格' });
  if (p.oneLiner) {
    items.push({ text: p.oneLiner, label: '定调' });
  }
  if (aiText) {
    items.push({ text: aiText, label: 'AI 画像' });
  }
  (p.dims || []).filter((d) => d.available).forEach((d) => {
    items.push({ text: d.title + '：' + d.left.label + ' ' + d.leftPct + '%。' + (d.basis || ''), label: d.title });
  });
  speakList(items, { start: 0 });
}
