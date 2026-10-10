/**
 * H12 灵感漫游（AI 六段式主题综述）
 *
 * 门槛：划线 ≥ 300 且 想法 ≥ 100；铜 / 银 / 金分级；每周 1 篇（银 2 / 金 3）+ 手动重生成限流；
 * 历史归档 + 随机漫游；正文里读者原文用下划线标出；外部火花统一标「AI 联想 · 未核实」。
 */

import * as core from '../core/wander-core.js';
import * as db from '../core/wander-store.js';
import * as wanderData from '../core/wander-data.js';
import { generateWanderText } from '../core/wander-ai.js';
import { messageOf, isKeyError } from '../core/errors.js';
import { esc, stateHtml, toast } from '../ui.js';
import { getMask, getProfile } from '../store.js';
import { presentShareCard } from '../share.js';
import { speakList, ttsSupported } from '../tts.js';

export const title = '灵感漫游';

const S = {
  view: null,
  viewingArchive: false,
  generating: false,
  loading: true,
  error: '',
  needsKey: false,
  progress: null,
  reason: '',
  count: 0,
  need: core.MATERIAL_MIN,
  aiError: '',
  weekLeft: 0,
  showRules: false,
};

export function render(root, app) {
  root.innerHTML = '<div class="wre-page"><div id="wanderBody"></div></div>';
  const body = root.querySelector('#wanderBody');
  body.addEventListener('click', (e) => onClick(e, body, app));
  S.view = null;
  S.viewingArchive = false;
  S.error = '';
  S.reason = '';
  S.aiError = '';
  S.loading = true;
  boost(body, app);
}

/** 进入页面：本周有本期直接展示；没有才生成（本周第一次生成即计入每周篇数） */
async function boost(body, app) {
  const current = db.getWeekIssue();
  if (current) {
    db.markSeen();
    S.view = core.toView(current);
    S.viewingArchive = false;
    S.loading = false;
    S.weekLeft = db.weekLeft(core.tierByKey(current.tier));
    paint(body);
    return;
  }
  await generate(body, app, false);
}

async function generate(body, app, isRegen) {
  if (S.generating) {
    return;
  }
  S.generating = true;
  S.loading = !S.view;
  S.error = '';
  S.reason = '';
  S.aiError = '';
  paint(body);

  try {
    // 1) 计数 → 门槛与分级
    const countsRes = await wanderData.fetchCounts(!!isRegen);
    if (!countsRes.ok) {
      S.generating = false;
      S.loading = false;
      S.error = messageOf(countsRes, '读取数据失败');
      S.needsKey = isKeyError(countsRes.code);
      paint(body);
      return;
    }
    const progress = core.tierProgress(countsRes.marks, countsRes.thoughts);
    S.progress = progress;
    if (!progress.unlocked) {
      S.generating = false;
      S.loading = false;
      paint(body);
      return;
    }

    // 2) 本周次数（重新生成才校验）
    if (isRegen && db.weekLeft(progress.tier) <= 0) {
      S.generating = false;
      paint(body);
      toast('本周生成次数已用完');
      return;
    }

    // 3) 素材池
    const poolRes = await wanderData.fetchPool(!!isRegen);
    if (!poolRes.ok) {
      S.generating = false;
      S.loading = false;
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

    // 4) 选材（尽量避开上一期的主题）
    const material = core.prepareWander(poolRes.pool, db.getUsed(), { avoidTheme: db.lastTheme() });
    if (!material.ok) {
      S.generating = false;
      S.loading = false;
      S.reason = 'material';
      S.count = material.count || 0;
      S.need = material.need || core.MATERIAL_MIN;
      paint(body);
      return;
    }
    if (material.resetUsed) {
      db.resetUsed();
    }

    // 5) AI 综述（读者的书单：供外部火花呼应他自己的书）
    const bookMap = {};
    (poolRes.pool || []).forEach((item) => {
      const t = item && item.title;
      if (t && !bookMap[t]) {
        bookMap[t] = { title: t, author: item.author || '' };
      }
    });
    const text = await generateWanderText(material, progress.tier, {
      bookTitles: Object.keys(bookMap).map((k) => bookMap[k]),
    });
    if (!text.ai) {
      S.generating = false;
      S.loading = false;
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

    const issue = core.makeIssue(material, text, progress.tier);
    db.saveIssue(issue);
    db.markUsed(material.materials);
    db.bumpWeek();
    db.markSeen();

    S.generating = false;
    S.loading = false;
    S.view = core.toView(issue);
    S.viewingArchive = false;
    S.weekLeft = db.weekLeft(progress.tier);
    paint(body);
  } catch (err) {
    S.generating = false;
    S.loading = false;
    S.error = (err && err.message) || '生成失败，请重试';
    paint(body);
  }
}

function isAiKeyCode(code) {
  return code === 'ai_nokey' || code === 'ai_auth' || isKeyError(code);
}

// ---- 渲染 ----
function paint(body) {
  body.innerHTML = backHtml() + bodyHtml() + (S.showRules ? rulesHtml() : '');
}

function backHtml() {
  return '<div class="wre-back"><button class="wre-back__btn" data-goto="home">← 返回首页</button></div>';
}

function bodyHtml() {
  if (S.error) {
    return '<div class="wre-card">' + stateHtml('error', S.error, S.needsKey ? '去配置 Key' : '重试') + '</div>';
  }
  if (S.progress && !S.progress.unlocked) {
    return lockHtml(S.progress);
  }
  if (S.reason === 'material') {
    return materialHtml();
  }
  if (S.view) {
    return archiveBarHtml() + issueHtml(S.view) + actionsHtml(S.view) + historyHtml() + statementHtml();
  }
  return stateHtml('loading', S.generating ? '正在编排本期主题合辑…' : '正在准备…');
}

function lockHtml(p) {
  const mpct = p.needMarks ? Math.min(100, Math.round((p.marks / p.needMarks) * 100)) : 100;
  const tpct = p.needThoughts ? Math.min(100, Math.round((p.thoughts / p.needThoughts) * 100)) : 100;
  let gapText;
  if (p.gapMarks > 0 && p.gapThoughts > 0) {
    gapText = '还差 ' + p.gapMarks + ' 条划线、' + p.gapThoughts + ' 条想法即可解锁。';
  } else if (p.gapMarks > 0) {
    gapText = '再积累 ' + p.gapMarks + ' 条划线即可解锁。';
  } else if (p.gapThoughts > 0) {
    gapText = '再写 ' + p.gapThoughts + ' 条想法即可解锁。';
  } else {
    gapText = '';
  }
  return (
    '<div class="wre-card">' +
    '  <div class="wre-title">再读一点，就能开启灵感漫游</div>' +
    '  <div class="wre-muted">灵感漫游每周一次，从你的划线 / 想法里挑出同一主题的多条素材，编排成一组主题合辑。</div>' +
    '  <div class="wre-row"><div class="wre-row__head"><span>划线</span><span class="wre-muted">' + esc(p.marks) + ' / ' + esc(p.needMarks) + ' 条</span></div>' +
    '  <div class="wre-track"><div class="wre-track__fill" style="width:' + mpct + '%"></div></div></div>' +
    '  <div class="wre-row"><div class="wre-row__head"><span>想法</span><span class="wre-muted">' + esc(p.thoughts) + ' / ' + esc(p.needThoughts) + ' 条</span></div>' +
    '  <div class="wre-track"><div class="wre-track__fill" style="width:' + tpct + '%"></div></div></div>' +
    (gapText ? '<div class="wre-muted">' + esc(gapText) + '</div>' : '') +
    '  <button class="wre-btn" data-action="retry">重新检查</button>' +
    '  <button class="wre-btn wre-btn--ghost" data-action="rules">看懂漫游规则 ›</button>' +
    '</div>'
  );
}

function materialHtml() {
  const pct = Math.min(100, Math.round(((Number(S.count) || 0) / (S.need || core.MATERIAL_MIN)) * 100));
  return (
    '<div class="wre-card">' +
    '  <div class="wre-title">素材还差一点点</div>' +
    '  <div class="wre-muted">灵感漫游需要同一主题下足够多的素材才好成组，当前的素材还不够组成一期合辑。</div>' +
    '  <div class="wre-row"><div class="wre-row__head"><span>成组素材</span><span class="wre-muted">' +
    esc(S.count) + ' / ' + esc(S.need) + ' 条</span></div>' +
    '  <div class="wre-track"><div class="wre-track__fill" style="width:' + pct + '%"></div></div></div>' +
    '  <div class="wre-muted">去微信读书多划几段、写几句想法，再来看看。</div>' +
    '  <button class="wre-btn" data-action="retry">重新检查</button>' +
    '  <button class="wre-btn wre-btn--ghost" data-action="rules">看懂漫游规则 ›</button>' +
    '</div>'
  );
}

function archiveBarHtml() {
  if (!S.viewingArchive) {
    return '';
  }
  return (
    '<div class="wre-archive-bar">' +
    '<span>正在看往期 · ' + esc(S.view.weekLabel) + '</span>' +
    '<button class="wre-back__btn" data-action="back-current">回到本期</button>' +
    '</div>'
  );
}

function issueHtml(v) {
  const parts = [];
  parts.push('<div class="wre-card wre-issue">');
  parts.push('  <div class="wre-dailycard__date">' + esc(v.weekLabel) + ' · 灵感漫游</div>');
  parts.push('  <div class="wre-dailycard__title">' + esc(v.title) + '</div>');
  parts.push(
    '  <div class="wre-chips">' +
    (v.theme ? '<span class="wre-chip">' + esc(v.theme) + '</span>' : '') +
    (v.tierName ? '<span class="wre-chip wre-chip--soft" data-action="rules">' + esc(v.tierName) + ' 档 · 规则说明 ›</span>' : '') +
    '</div>'
  );
  if (v.summary) {
    parts.push('  <div class="wre-summary">' + esc(v.summary) + '</div>');
  }
  if (v.body) {
    parts.push(
      '  <div class="wre-note-body">' +
      v.bodySegs.map((seg) => '<span class="' + (seg.mine ? 'wre-mine' : '') + '" data-tts-index="' + seg.i + '">' + esc(seg.text) + '</span>').join('') +
      '</div>'
    );
  }
  if (v.sources && v.sources.length) {
    parts.push(
      '  <div class="wre-related"><div class="wre-related__title">素材来源（' + v.sources.length + ' 条）</div>' +
      v.sources.map((s) =>
        '<div class="wre-related__item" data-source="' + s.index + '">' +
        '<div class="wre-related__kind">' + esc(s.kindLabel) + '</div>' +
        '<div class="wre-related__text' + (s.open ? '' : ' is-clamp') + '">' + esc(s.text) + '</div>' +
        '<div class="wre-related__from">——《' + esc(s.title) + '》' + (s.author ? ' · ' + esc(s.author) : '') + '</div>' +
        '</div>').join('') +
      '</div>'
    );
  }
  if (v.sparks && v.sparks.length) {
    parts.push(
      '  <div class="wre-block"><div class="wre-block__title">外部火花 <span class="wre-hint">AI 联想 · 未核实</span></div>' +
      v.sparks.map((s) =>
        '<div class="wre-spark"><div class="wre-spark__text">' + esc(s.text) + '</div>' +
        (s.source ? '<div class="wre-spark__source">' + esc(s.source) + '</div>' : '') + '</div>').join('') +
      '</div>'
    );
  }
  if (v.seeds && v.seeds.length) {
    parts.push(
      '  <div class="wre-block"><div class="wre-block__title">创作种子</div>' +
      v.seeds.map((s) =>
        '<div class="wre-seed"><span class="wre-seed__angle">' + esc(s.angle) + '</span>' + esc(s.line) + '</div>').join('') +
      '</div>'
    );
  }
  if (S.aiError) {
    parts.push('  <div class="wre-ai-error">' + esc(S.aiError) + '</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

function actionsHtml(v) {
  const mask = getMask() || {};
  const parts = [];
  parts.push(
    '<div class="wre-card">' +
    '  <button class="wre-btn" data-action="regen"' + (S.generating ? ' disabled' : '') + '>' +
    (S.generating ? '正在重新生成…' : '重新生成') + '</button>' +
    '  <div class="wre-hint">本周还可生成 ' + esc(S.weekLeft) + ' 次 · ' +
    '<span class="wre-link-inline" data-action="rules">漫游规则 ›</span></div>' +
    '  <div class="wre-btn-row">' +
    '    <button class="wre-btn wre-btn--ghost" data-action="star">' + (v.starred ? '取消收藏' : '收藏这一期') + '</button>' +
    '    <button class="wre-btn wre-btn--ghost" data-action="share">生成分享图</button>' +
    '  </div>' +
    (ttsSupported ? '  <button class="wre-btn wre-btn--ghost" data-action="tts">🔊 朗读这一期</button>' : '')
  );
  if (!mask.hasAiKey) {
    parts.push('  <div class="wre-hint">灵感漫游以 AI 综述为核心，需在「我的账户」配置 DeepSeek Key。</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

function historyHtml() {
  const currentWeek = core.weekKey();
  const list = db.listIssues()
    .filter((it) => it && it.week !== currentWeek)
    .map((it) => ({
      id: it.id,
      weekLabel: it.weekLabel || '',
      title: it.title || '',
      theme: it.theme || '',
      tierName: it.tierName || '',
      starred: !!it.starred,
    }));
  if (!list.length) {
    return '';
  }
  return (
    '<div class="wre-card">' +
    '<div class="wre-card__title wre-card__title--row"><span>往期归档</span>' +
    '<button class="wre-link-inline" data-action="roam">随机漫游</button></div>' +
    list.slice(0, 20).map((h) =>
      '<div class="wre-history" data-archive="' + esc(h.id) + '">' +
      '<div class="wre-history__head"><span class="wre-history__date">' + esc(h.weekLabel) + '</span>' +
      (h.starred ? '<span class="wre-history__star">★ 收藏</span>' : '') + '</div>' +
      '<div class="wre-history__title">' + esc(h.title) + '</div>' +
      (h.theme ? '<div class="wre-history__theme">主题：' + esc(h.theme) + (h.tierName ? ' · ' + esc(h.tierName) + ' 档' : '') + '</div>' : '') +
      '</div>').join('') +
    '</div>'
  );
}

function statementHtml() {
  return '<div class="wre-note">每期只按主题把你自己的划线 / 想法编排在一起，全部在本机排版；归档与收藏只存本机，不上云。</div>';
}

function rulesHtml() {
  const myTier = S.progress && S.progress.tier ? S.progress.tier.key : '';
  const rows = core.TIERS.map((t) =>
    '<div class="wre-table__row' + (t.key === myTier ? ' is-on' : '') + '">' +
    '<span class="wre-table__main">' + esc(t.name) + '</span>' +
    '<span>≥' + esc(t.marks) + ' / ≥' + esc(t.thoughts) + '</span>' +
    '<span>' + esc(t.weekly) + ' 篇</span>' +
    '</div>').join('');
  return (
    '<div class="wre-share-mask" data-close-rules="1">' +
    '<div class="wre-share-panel wre-rules-panel">' +
    '  <div class="wre-rules-scroll">' +
    '    <div class="wre-card__title">漫游规则</div>' +
    '    <div class="wre-h3">每周怎么生成</div>' +
    '    <div class="wre-muted">每周按你的档位可生成 1～3 篇；点「重新生成」也计入本周次数，用完就要等下一周。</div>' +
    '    <div class="wre-h3">三档门槛（划线 / 想法条数）</div>' +
    '    <div class="wre-table"><div class="wre-table__head"><span>档位</span><span>划线 / 想法</span><span>每周</span></div>' + rows + '</div>' +
    '    <div class="wre-muted">累积到 ' + esc(core.UNLOCK.marks) + ' 条划线 + ' + esc(core.UNLOCK.thoughts) + ' 条想法即解锁。</div>' +
    '    <div class="wre-h3">素材怎么选</div>' +
    '    <div class="wre-muted">只从你自己的划线 / 想法里挑：优先同一主题、尽量跨书铺开、同一素材尽量不重复出现。</div>' +
    '    <div class="wre-h3">怎么读</div>' +
    '    <div class="wre-muted">每期按主题把你自己的划线 / 想法编织成一篇综述；带下划线的是你自己的原文，点开每条可看全文与出处。</div>' +
    '  </div>' +
    '  <button class="wre-btn" data-action="close-rules">我知道了</button>' +
    '</div>' +
    '</div>'
  );
}

// ---- 交互 ----
function onClick(e, body, app) {
  const go = e.target.closest('[data-goto]');
  if (go) {
    app.go(go.getAttribute('data-goto'));
    return;
  }

  const source = e.target.closest('[data-source]');
  if (source && S.view) {
    const index = Number(source.getAttribute('data-source'));
    const item = S.view.sources[index];
    if (item) {
      item.open = !item.open;
      paint(body);
    }
    return;
  }

  const archive = e.target.closest('[data-archive]');
  if (archive) {
    const issue = db.getIssueById(archive.getAttribute('data-archive'));
    if (issue) {
      S.view = core.toView(issue);
      S.viewingArchive = true;
      S.aiError = '';
      paint(body);
      window.scrollTo(0, 0);
    }
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (btn) {
    handleAction(btn.getAttribute('data-action'), body, app);
    return;
  }

  // 点遮罩关闭规则弹层
  if (e.target.classList && e.target.classList.contains('wre-share-mask')) {
    S.showRules = false;
    paint(body);
  }
}

function handleAction(action, body, app) {
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
    S.view.starred = db.starIssue(S.view.id);
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
  if (action === 'rules') {
    S.showRules = true;
    paint(body);
    return;
  }
  if (action === 'close-rules') {
    S.showRules = false;
    paint(body);
    return;
  }
  if (action === 'back-current') {
    S.viewingArchive = false;
    S.view = null;
    boost(body, app);
    window.scrollTo(0, 0);
    return;
  }
  if (action === 'roam') {
    const issue = db.randomIssue();
    if (issue) {
      S.view = core.toView(issue);
      S.viewingArchive = true;
      S.aiError = '';
      paint(body);
      window.scrollTo(0, 0);
    }
  }
}

function shareSpec(v) {
  const profile = getProfile();
  const first = (v.sources && v.sources[0]) || null;
  return {
    badge: '灵感漫游',
    title: v.title,
    subtitle: v.weekLabel + (v.theme ? ' · ' + v.theme : ''),
    lines: v.summary ? [v.summary] : [],
    quote: first ? { text: first.text, from: '《' + (first.title || '') + '》' + (first.author ? ' · ' + first.author : '') } : null,
    chips: [v.theme, v.tierName ? v.tierName + ' 档' : ''].filter(Boolean),
    footer: (profile.nickName ? profile.nickName + ' · ' : '') + '微信悦读 · 本机计算',
  };
}

async function doShare() {
  if (!S.view) {
    return;
  }
  await presentShareCard(shareSpec(S.view), 'wander.png');
}

function doTts() {
  const v = S.view;
  if (!v) {
    return;
  }
  const items = [];
  if (v.title) {
    items.push({ text: v.title, label: '标题' });
  }
  if (v.summary) {
    items.push({ text: v.summary, label: '摘要' });
  }
  if (v.body) {
    items.push({ text: v.body, label: '正文' });
  }
  (v.sources || []).forEach((s, i) => items.push({ text: s.text, label: '素材 ' + (i + 1) }));
  speakList(items, { start: 0 });
}
