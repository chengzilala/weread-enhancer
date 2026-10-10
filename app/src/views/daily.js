/**
 * H11 每日卡片回顾（AI 成文）
 *
 * 本机存档、可回看 / 收藏 / 分享 / 朗读；素材与文案来自读者自己的划线 / 想法。
 * AI 成文经服务端托管 Key；未配置 / 失效时明确引导，不退回本地模板冒充。
 */

import { ensureTodayCard } from '../core/daily-generate.js';
import * as core from '../core/daily-core.js';
import * as db from '../core/daily-store.js';
import { fetchPool } from '../core/daily-data.js';
import { generateDailyText } from '../core/daily-ai.js';
import { messageOf, isKeyError } from '../core/errors.js';
import { esc, stateHtml, toast } from '../ui.js';
import { getMask, getProfile } from '../store.js';
import { presentShareCard } from '../share.js';
import { speakList, ttsSupported } from '../tts.js';

export const title = '每日卡片';

// 页面状态（模块级，切 Tab 后保留）
const S = {
  view: null,
  viewingArchive: false,
  generating: false,
  error: '',
  needsKey: false,
  reason: '',
  count: 0,
  need: core.MATERIAL_MIN,
  aiError: '',
};

export function render(root, app) {
  root.innerHTML = '<div class="wre-page"><div id="dailyBody"></div></div>';
  const body = root.querySelector('#dailyBody');
  body.addEventListener('click', (e) => onClick(e, body, app));
  S.view = null;
  S.viewingArchive = false;
  S.error = '';
  S.reason = '';
  S.aiError = '';
  boost(body, app);
}

/** 进入页面：今天有卡片直接展示；没有才生成（不消耗当日次数） */
async function boost(body, app) {
  const existing = db.getTodayCard();
  if (existing) {
    S.view = core.toView(existing);
    paint(body);
    return;
  }
  S.generating = true;
  paint(body);
  const res = await ensureTodayCard();
  S.generating = false;
  if (res.ok) {
    S.view = res.view;
  } else if (res.reason === 'material') {
    S.reason = 'material';
    S.count = res.count || 0;
    S.need = res.need || core.MATERIAL_MIN;
  } else {
    S.error = res.error || messageOf(res, '生成失败，请重试');
    S.needsKey = isAiKeyCode(res.code);
  }
  paint(body);
}

/** 重新生成（消耗当日次数）或首次重试（不消耗） */
async function generate(body, app, isRegen) {
  if (S.generating) {
    return;
  }
  if (isRegen && db.regenLeft() <= 0) {
    toast('今日重新生成次数已用完');
    return;
  }
  S.generating = true;
  S.error = '';
  S.reason = '';
  S.aiError = '';
  paint(body);

  const poolRes = await fetchPool(!!isRegen);
  if (!poolRes.ok) {
    S.generating = false;
    if (poolRes.code === 'nocorpus') {
      S.reason = 'material';
      S.count = 0;
      S.need = core.MATERIAL_MIN;
    } else {
      S.error = messageOf(poolRes, '读取数据失败');
      S.needsKey = isKeyError(poolRes.code);
    }
    paint(body);
    return;
  }

  const material = core.prepareMaterial(poolRes.pool, db.getUsed());
  if (!material.ok) {
    S.generating = false;
    S.reason = 'material';
    S.count = material.count || 0;
    S.need = material.need || core.MATERIAL_MIN;
    paint(body);
    return;
  }
  if (material.resetUsed) {
    db.resetUsed();
  }

  const text = await generateDailyText(material);
  S.generating = false;
  if (!text.ai) {
    const msg = messageOf(text, '生成失败，请重试');
    if (S.view) {
      S.aiError = msg;
    } else {
      S.error = msg;
      S.needsKey = isAiKeyCode(text.code);
    }
    paint(body);
    return;
  }

  const card = core.makeCard(material, text);
  db.saveCard(card);
  db.markUsed(material.main.text);
  if (isRegen) {
    db.bumpRegen();
  }
  S.view = core.toView(card);
  S.aiError = '';
  paint(body);
}

/** AI 相关 Key 错误：需要去「我的」配置 DeepSeek Key */
function isAiKeyCode(code) {
  return code === 'ai_nokey' || code === 'ai_auth' || isKeyError(code);
}

// ---- 渲染 ----
function paint(body) {
  body.innerHTML = backHtml() + bodyHtml();
}

function backHtml() {
  return '<div class="wre-back"><button class="wre-back__btn" data-goto="home">← 返回首页</button></div>';
}

function bodyHtml() {
  if (S.error) {
    return '<div class="wre-card">' + stateHtml('error', S.error, S.needsKey ? '去配置 Key' : '重试') + '</div>';
  }
  if (S.reason === 'material') {
    return materialHtml();
  }
  if (S.view) {
    return archiveBarHtml() + cardHtml(S.view) + actionsHtml(S.view) + historyHtml() + statementHtml();
  }
  return stateHtml('loading', '正在挑选今天的划线…');
}

function archiveBarHtml() {
  if (!S.viewingArchive) {
    return '';
  }
  return (
    '<div class="wre-archive-bar">' +
    '<span>正在看往期 · ' + esc(S.view.dateLabel) + '</span>' +
    '<button class="wre-back__btn" data-action="back-today">回到今天</button>' +
    '</div>'
  );
}

function materialHtml() {
  const pct = Math.min(100, Math.round(((Number(S.count) || 0) / (S.need || core.MATERIAL_MIN)) * 100));
  return (
    '<div class="wre-card">' +
    '  <div class="wre-title">素材还差一点点</div>' +
    '  <div class="wre-muted">每日卡片只从你自己的历史划线 / 想法里取材，暂时还不够。</div>' +
    '  <div class="wre-row"><div class="wre-row__head"><span>可用素材</span><span class="wre-muted">' +
    esc(S.count) + ' / ' + esc(S.need) + ' 条</span></div>' +
    '  <div class="wre-track"><div class="wre-track__fill" style="width:' + pct + '%"></div></div></div>' +
    '  <div class="wre-muted">去微信读书多划几段、写几句想法，再来看看。</div>' +
    '  <button class="wre-btn" data-action="retry">重新检查</button>' +
    '</div>'
  );
}

function cardHtml(view) {
  const parts = [];
  parts.push(
    '<div class="wre-card wre-dailycard">' +
    '  <div class="wre-dailycard__date">' + esc(view.dateLabel) + ' · 每日卡片</div>' +
    '  <div class="wre-dailycard__title">' + esc(view.title) + '</div>' +
    (view.themes && view.themes.length
      ? '<div class="wre-chips">' + view.themes.map((t) => '<span class="wre-chip">' + esc(t) + '</span>').join('') + '</div>'
      : '') +
    '  <blockquote class="wre-quote wre-quote--main">' + esc(view.quote.text) +
    '    <cite>——《' + esc(view.quote.title) + '》' + (view.quote.author ? ' · ' + esc(view.quote.author) : '') + '</cite></blockquote>'
  );
  if (view.note) {
    parts.push('<div class="wre-note-body">' + esc(view.note) + '</div>');
  }
  if (view.related && view.related.length) {
    parts.push(
      '<div class="wre-related"><div class="wre-related__title">关联的旧划线</div>' +
      view.related.map((it) =>
        '<div class="wre-related__item" data-related="' + it.index + '">' +
        '<div class="wre-related__text' + (it.open ? '' : ' is-clamp') + '" data-tts-index="' + it.index + '">' + esc(it.text) + '</div>' +
        '<div class="wre-related__from">——《' + esc(it.title) + '》' + (it.author ? ' · ' + esc(it.author) : '') + '</div>' +
        '</div>').join('') +
      '</div>'
    );
  }
  if (S.aiError) {
    parts.push('<div class="wre-ai-error">' + esc(S.aiError) + '</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

function actionsHtml(view) {
  const mask = getMask() || {};
  const parts = [];
  parts.push(
    '<div class="wre-card">' +
    (S.viewingArchive ? '' :
      '  <button class="wre-btn" data-action="regen"' + (S.generating ? ' disabled' : '') + '>' +
      (S.generating ? '正在重新生成…' : '重新生成') + '</button>' +
      '  <div class="wre-hint">今日还可重新生成 ' + esc(db.regenLeft()) + ' 次</div>') +
    '  <div class="wre-btn-row">' +
    '    <button class="wre-btn wre-btn--ghost" data-action="star">' + (view.starred ? '取消收藏' : '收藏这张卡片') + '</button>' +
    '    <button class="wre-btn wre-btn--ghost" data-action="share">生成分享图</button>' +
    '  </div>' +
    (ttsSupported ? '  <button class="wre-btn wre-btn--ghost" data-action="tts">🔊 朗读这张卡片</button>' : '')
  );
  if (!mask.hasAiKey) {
    parts.push('  <div class="wre-hint">AI 成文需要 DeepSeek Key，可在「我的账户」里配置。</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

function historyHtml() {
  const today = core.dateKey();
  const list = db.listCards()
    .filter((c) => c && c.date !== today)
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      dateLabel: core.dayLabel(c.createdAt),
      title: c.title || '',
      quote: (c.quote && c.quote.text) || '',
      starred: !!c.starred,
    }));
  if (!list.length) {
    return '';
  }
  return (
    '<div class="wre-card">' +
    '<div class="wre-card__title wre-card__title--row"><span>往期回顾</span>' +
    '<span class="wre-hint">点开可看整张</span></div>' +
    list.map((h) =>
      '<div class="wre-history" data-archive="' + esc(h.id) + '">' +
      '<div class="wre-history__head"><span class="wre-history__date">' + esc(h.dateLabel) + '</span>' +
      (h.starred ? '<span class="wre-history__star">★ 收藏</span>' : '') + '</div>' +
      '<div class="wre-history__title">' + esc(h.title) + '</div>' +
      '<div class="wre-history__quote">' + esc(h.quote) + '</div>' +
      '</div>').join('') +
    '</div>'
  );
}

function statementHtml() {
  return '<div class="wre-note">卡片只排布你自己的划线原文、出处，以及按主题规则召回的同主题旧划线；全部在本机排版，只存本机、不上云。</div>';
}

// ---- 交互 ----
function onClick(e, body, app) {
  const go = e.target.closest('[data-goto]');
  if (go) {
    app.go(go.getAttribute('data-goto'));
    return;
  }

  const related = e.target.closest('[data-related]');
  if (related && S.view) {
    const index = Number(related.getAttribute('data-related'));
    const item = S.view.related[index];
    if (item) {
      item.open = !item.open;
      paint(body);
    }
    return;
  }

  // 往期回顾：点开某张往期卡片，看整张
  const archive = e.target.closest('[data-archive]');
  if (archive) {
    const card = db.getCardById(archive.getAttribute('data-archive'));
    if (card) {
      S.view = core.toView(card);
      S.viewingArchive = true;
      S.aiError = '';
      paint(body);
      window.scrollTo(0, 0);
    }
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) {
    return;
  }
  const action = btn.getAttribute('data-action');

  if (action === 'retry') {
    if (S.needsKey) {
      app.go('me');
    } else {
      S.error = '';
      S.needsKey = false;
      generate(body, app, false);
    }
    return;
  }
  if (action === 'regen') {
    generate(body, app, true);
    return;
  }
  if (action === 'star' && S.view) {
    S.view.starred = db.starCard(S.view.id);
    paint(body);
    return;
  }
  if (action === 'share') {
    doShare();
    return;
  }
  if (action === 'tts') {
    doTts();
    return;
  }
  if (action === 'back-today') {
    S.viewingArchive = false;
    S.view = null;
    boost(body, app);
    window.scrollTo(0, 0);
  }
}

function shareSpec(view) {
  const profile = getProfile();
  return {
    badge: '每日卡片',
    title: view.title,
    subtitle: view.dateLabel,
    quote: {
      text: view.quote.text,
      from: '《' + (view.quote.title || '') + '》' + (view.quote.author ? ' · ' + view.quote.author : ''),
    },
    lines: view.note ? [view.note] : [],
    chips: view.themes || [],
    footer: (profile.nickName ? profile.nickName + ' · ' : '') + '微信悦读 · 本机计算',
  };
}

async function doShare() {
  if (!S.view) {
    return;
  }
  await presentShareCard(shareSpec(S.view), 'daily-card.png');
}

function doTts() {
  const view = S.view;
  if (!view) {
    return;
  }
  const items = [];
  if (view.title) {
    items.push({ text: view.title, label: '标题' });
  }
  if (view.note) {
    items.push({ text: view.note, label: '回顾' });
  }
  items.push({ text: view.quote.text + '——《' + (view.quote.title || '') + '》', label: '今日划线' });
  (view.related || []).forEach((it, i) => items.push({ text: it.text, label: '关联 ' + (i + 1) }));
  speakList(items, { start: 0 });
}
