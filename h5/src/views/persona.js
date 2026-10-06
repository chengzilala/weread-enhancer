/**
 * H3 阅读人格
 *
 * 纯本机计算：4 维代码 + 16 型称号 + 判定依据 + 数据证据（复用 persona-core）。
 * 人格主体不依赖 AI；数据不足时给进度引导，绝不硬出结论。
 */

import { fetchReadData, fetchOverview, fetchCorpus } from '../data.js';
import { getReadingPersona } from '../core/persona-core.js';
import { esc, stateHtml } from '../ui.js';

export const title = '阅读人格';

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
      '<div class="wre-dim is-off">' +
      '<div class="wre-dim__title">' + esc(dim.title) + '<span class="wre-hint">数据不足</span></div>' +
      '<div class="wre-muted">' + esc(dim.basis || '') + '</div>' +
      '</div>'
    );
  }
  const pct = dim.leftPct;
  const leftActive = dim.side === left.letter;
  return (
    '<div class="wre-dim">' +
    '<div class="wre-dim__title">' + esc(dim.title) +
    (dim.centered ? '<span class="wre-hint">居中（接近五五开）</span>' : '') + '</div>' +
    '<div class="wre-dim__scale">' +
    '  <span class="wre-dim__side' + (leftActive ? ' is-on' : '') + '">' + esc(left.label) + ' ' + esc(left.letter) + '</span>' +
    '  <span class="wre-dim__side' + (!leftActive ? ' is-on' : '') + '">' + esc(right.letter) + ' ' + esc(right.label) + '</span>' +
    '</div>' +
    '<div class="wre-track"><div class="wre-track__fill" style="width:' + pct + '%"></div></div>' +
    '<div class="wre-hint">' + esc(dim.basis || '') + '</div>' +
    '</div>'
  );
}

function personaHtml(p) {
  const parts = [];

  // 主卡
  parts.push(
    '<div class="wre-card wre-persona">' +
    '  <div class="wre-persona__code">' + esc(p.code) + '</div>' +
    '  <div class="wre-persona__name">' + esc(p.name) + '</div>' +
    '  <div class="wre-persona__tagline">' + esc(p.tagline) + '</div>' +
    (p.figure ? '  <div class="wre-persona__figure">🖋 ' + esc(p.figure.line) + '</div>' : '') +
    (p.oneLiner ? '  <div class="wre-persona__one">' + esc(p.oneLiner) + '</div>' : '') +
    (p.nicknames && p.nicknames.length
      ? '  <div class="wre-chips">' + p.nicknames.map((n) => '<span class="wre-chip">' + esc(n) + '</span>').join('') + '</div>'
      : '') +
    (!p.full ? '  <div class="wre-hint">部分维度数据不足，代码中显示「–」；补齐后会得出完整的 16 型。</div>' : '') +
    '</div>'
  );

  // 四维
  parts.push('<div class="wre-card"><div class="wre-card__title">四个维度</div>' + p.dims.map(dimRow).join('') + '</div>');

  // 数据证据
  const ev = p.evidence || {};
  if ((ev.data && ev.data.length) || (ev.quotes && ev.quotes.length)) {
    let html = '<div class="wre-card"><div class="wre-card__title">数据证据</div>';
    if (ev.data && ev.data.length) {
      html += '<div class="wre-chips">' + ev.data.map((d) => '<span class="wre-chip">' + esc(d) + '</span>').join('') + '</div>';
    }
    if (ev.quotes && ev.quotes.length) {
      html += ev.quotes.map((q) =>
        '<blockquote class="wre-quote">' + esc(q.text) + (q.title ? '<cite>——《' + esc(q.title) + '》</cite>' : '') + '</blockquote>').join('');
    }
    html += '</div>';
    parts.push(html);
  }

  // 词语分析
  const w = p.words;
  if (w) {
    let html = '<div class="wre-card"><div class="wre-card__title">词语亮点</div>';
    if (w.top && w.top.length) {
      html += '<div class="wre-chips">' + w.top.map((t) =>
        '<span class="wre-chip">' + esc(t.word) + '<em>' + esc(t.count) + '</em></span>').join('') + '</div>';
    }
    if (w.catchphrase) {
      html += '<div class="wre-muted">口头禅：' + esc(w.catchphrase.text) + '</div>';
    }
    if (w.emotion) {
      html += '<div class="wre-muted">情绪比例：正向 ' + esc(w.emotion.posPct) + '% · 负向 ' + esc(w.emotion.negPct) +
        '% · 中性 ' + esc(w.emotion.neuPct) + '%</div>';
    }
    if (w.themes && w.themes.length) {
      html += '<div class="wre-chips">' + w.themes.map((t) =>
        '<span class="wre-chip wre-chip--soft">' + esc(t.name) + '<em>' + esc(t.count) + '</em></span>').join('') + '</div>';
    }
    html += '</div>';
    parts.push(html);
  } else {
    parts.push('<div class="wre-card"><div class="wre-card__title">词语亮点</div><div class="wre-muted">' +
      esc(p.corpusError || '语料不足，暂时做不了词语分析；多写几条想法再回来看看。') + '</div></div>');
  }

  parts.push('<div class="wre-note">本页为趣味参考、非心理测评，全部在你的浏览器本机按固定规则计算，不使用 AI、不上传。</div>');
  return parts.join('');
}
