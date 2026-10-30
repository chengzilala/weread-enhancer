/**
 * 人格依据 · 明细页（H5）
 *
 * 从「人格」主卡点「查看完整依据」进入，颗粒度下沉到：
 * 每个维度 → 具体分类 / 具体书名 / 具体划线原文。
 * 计算全部来自本机（personaFigureEvidenceDetail），本页只负责排版。
 */

import { fetchReadData, fetchOverview, fetchCorpus } from '../data.js';
import { getReadingPersona, personaFigureEvidenceDetail } from '../core/persona-core.js';
import { esc, stateHtml } from '../ui.js';

export const title = '人格依据';

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="evBody">' +
    backHtml() + stateHtml('loading', '正在整理你的完整依据…') + '</div>';
  const body = root.querySelector('#evBody');
  body.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) {
      app.go(go.getAttribute('data-goto'));
      return;
    }
    if (e.target.closest('[data-action="retry"]')) {
      load(body, app);
    }
  });
  load(body, app);
}

function backHtml() {
  return '<div class="wre-back"><button class="wre-back__btn" data-goto="persona">← 返回人格</button></div>';
}

async function load(body, app) {
  body.innerHTML = backHtml() + stateHtml('loading', '正在整理你的完整依据…');

  const overallRes = await fetchReadData('overall');
  if (!overallRes.ok) {
    body.innerHTML = backHtml() + stateHtml('error', overallRes.error || '读取累计数据失败', '重试');
    return;
  }
  const overall = overallRes.data || {};

  const overview = await fetchOverview(false);
  const shelf = overview.ok ? overview.shelf : null;
  const notebooks = overview.ok ? overview.notebooks : null;

  const pre = getReadingPersona({ overall: overall, shelf: shelf, notebooks: notebooks, hasKey: true });
  if (!pre.ok) {
    body.innerHTML = backHtml() +
      '<div class="wre-card">' +
      '  <div class="wre-card__title">还差一点数据</div>' +
      '  <div class="wre-muted">人格依据需要累计阅读 ≥ 10 小时、笔记 ≥ 20 条，多读一会儿再来。</div>' +
      '  <button class="wre-btn" data-goto="persona">回人格页</button>' +
      '</div>';
    return;
  }

  body.innerHTML = backHtml() + stateHtml('loading', '正在拉取笔记语料（首次稍慢，之后有缓存）…');
  const corpusRes = await fetchCorpus(notebooks, false);
  const corpus = corpusRes.ok ? corpusRes.corpus : null;

  const persona = getReadingPersona({
    overall: overall,
    shelf: shelf,
    notebooks: notebooks,
    corpus: corpus,
    hasKey: true,
    corpusState: corpusRes.ok ? 'ok' : 'error',
    corpusError: corpusRes.ok ? '' : (corpusRes.error || ''),
  });
  if (!persona.ok) {
    body.innerHTML = backHtml() +
      '<div class="wre-card"><div class="wre-muted">暂时算不出人格依据，请稍后重试。</div>' +
      '<button class="wre-btn" data-goto="persona">回人格页</button></div>';
    return;
  }

  const detail = personaFigureEvidenceDetail({
    overall: overall,
    shelf: shelf,
    notebooks: notebooks,
    corpus: corpus,
    dims: persona.dims || [],
    code: persona.code || '',
    name: persona.name || '',
    figureName: persona.figure ? persona.figure.name : '',
  });

  body.innerHTML = backHtml() + detailHtml(detail, persona);
}

function statsHtml(stats) {
  const items = (stats || []).map((item) =>
    '<span class="wre-chip">' + esc(item.label) + ' <b>' + esc(item.value) + '</b></span>').join('');
  return items ? '<div class="wre-chips wre-ev__chips">' + items + '</div>' : '';
}

function groupsHtml(groups) {
  const list = (groups || []).filter((group) => group && group.books && group.books.length);
  if (!list.length) {
    return '';
  }
  return list.map((group) =>
    '<div class="wre-ev__group">' +
    '<div class="wre-ev__gname">' + esc(group.name) + '</div>' +
    '<ul class="wre-ev__books">' +
    group.books.map((book) => '<li>' + esc(book) + '</li>').join('') +
    '</ul></div>').join('');
}

function rowsHtml(rows) {
  const list = rows || [];
  if (!list.length) {
    return '';
  }
  return '<div class="wre-ev__rows">' +
    list.map((row) =>
      '<div class="wre-ev__row"><span>' + esc(row.label) + '</span><span class="wre-ev__rowv">' +
      esc(row.value) + '</span></div>').join('') +
    '</div>';
}

function notesHtml(notes) {
  const list = notes || [];
  if (!list.length) {
    return '';
  }
  return '<div class="wre-ev__notes">' + list.map((note) =>
    '<blockquote class="wre-quote wre-ev__note">' + esc(note.text) +
    '<div class="wre-quote-src">—— 《' + esc(note.title || '未命名') + '》' +
    (note.year ? ' · ' + esc(note.year) : '') +
    (note.hits ? ' · ' + esc(note.hits) : '') + '</div></blockquote>').join('') + '</div>';
}

function sectionHtml(section) {
  const head = '<div class="wre-ev__head">' +
    '<span class="wre-ev__dim">' + esc(section.title) + '</span>' +
    (section.available && section.pick
      ? '<span class="wre-ev__pick">' + esc(section.pick) + ' ' + esc(section.pct) + '%</span>'
      : '<span class="wre-ev__pick is-na">数据不足</span>') +
    '</div>';
  return '<div class="wre-card wre-ev__sec">' + head +
    '<div class="wre-ev__lead">' + esc(section.lead) + '</div>' +
    statsHtml(section.stats) +
    groupsHtml(section.groups) +
    rowsHtml(section.rows) +
    notesHtml(section.notes) +
    '</div>';
}

function detailHtml(detail, persona) {
  const head =
    '<div class="wre-card wre-ev__intro">' +
    '  <div class="wre-ev__intro-title">为什么是' + esc(detail.figureName || '这位代表人物') + '</div>' +
    '  <div class="wre-muted">' + esc(detail.name) + (detail.code ? ' · ' + esc(detail.code) : '') +
    '　下面每一节都对应你人格的一个维度，细到你具体的分类、具体的书、具体的划线原文。</div>' +
    (persona.figure && persona.figure.why
      ? '  <div class="wre-ev__why">' + esc(persona.figure.why) + '</div>'
      : '') +
    '</div>';

  const sections = (detail.sections || []).map(sectionHtml).join('');

  const quotes = (detail.quotes || []).length
    ? '<div class="wre-card wre-ev__sec">' +
      '<div class="wre-ev__head"><span class="wre-ev__dim">原文划线</span>' +
      '<span class="wre-ev__pick is-quiet">' + (detail.quotes || []).length + ' 条</span></div>' +
      '<div class="wre-ev__lead">从你的划线里挑出的几条原文（每本最多 2 条），最能代表你留下的痕迹。</div>' +
      (detail.quotes || []).map((quote) =>
        '<blockquote class="wre-quote wre-ev__note">' + esc(quote.text) +
        '<div class="wre-quote-src">—— 《' + esc(quote.title || '未命名') + '》' +
        (quote.year ? ' · ' + esc(quote.year) : '') + '</div></blockquote>').join('') +
      '</div>'
    : '';

  return head + sections + quotes +
    '<div class="wre-note">' + esc(detail.note || '') + '</div>';
}
