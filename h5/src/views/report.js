/**
 * H4 阅读行为报告
 *
 * 分章节图文报告，规则化摘要（未接 AI）。复用 report-core 的 buildReportBlocks。
 */

import { fetchReadData, fetchOverview, peekOverview } from '../data.js';
import { buildReportBlocks, modeLabel } from '../core/report-core.js';
import { messageOf, isKeyError } from '../core/errors.js';
import { esc, stateHtml } from '../ui.js';
import { cacheGet, cacheSet } from '../store.js';

const MODES = [
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月' },
  { key: 'annually', label: '本年' },
  { key: 'overall', label: '累计' },
];
const CACHE_TTL_MS = 30 * 60 * 1000;

export const title = '阅读报告';

let mode = 'overall';

export function render(root, app) {
  root.innerHTML =
    '<div class="wre-page">' +
    '  <div class="wre-modes" id="reportModes">' +
    MODES.map((m) =>
      '<button class="wre-mode' + (m.key === mode ? ' is-active' : '') + '" data-mode="' + m.key + '">' + m.label + '</button>'
    ).join('') +
    '  </div>' +
    '  <div id="reportBody">' + stateHtml('loading', '正在生成本机报告…') + '</div>' +
    '</div>';

  const modesEl = root.querySelector('#reportModes');
  modesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn || btn.getAttribute('data-mode') === mode) {
      return;
    }
    mode = btn.getAttribute('data-mode');
    modesEl.querySelectorAll('.wre-mode').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-mode') === mode);
    });
    load(root, app, false);
  });

  const body = root.querySelector('#reportBody');
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry"]')) {
      load(root, app, true);
    }
  });

  load(root, app, false);
}

async function load(root, app, force) {
  const body = root.querySelector('#reportBody');
  const cacheKey = 'report_' + mode;
  if (!force) {
    const cached = cacheGet(cacheKey, CACHE_TTL_MS);
    if (cached) {
      body.innerHTML = blocksHtml(cached.data, cached.overall, true);
      return;
    }
  }
  body.innerHTML = stateHtml('loading', '正在生成本机报告…');

  const res = await fetchReadData(mode);
  if (!res.ok) {
    body.innerHTML = stateHtml('error', messageOf(res, '读取数据失败'), isKeyError(res.code) ? '去配置 Key' : '重试');
    if (isKeyError(res.code)) {
      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="retry"]')) {
          app.go('me');
        }
      }, { once: true });
    }
    return;
  }

  // 累计数据（执行摘要优先用它）；当前已是累计则不重复请求
  let overall = null;
  if (mode !== 'overall') {
    const oRes = await fetchReadData('overall');
    if (oRes.ok) {
      overall = oRes.data;
    }
  }
  const overview = await fetchOverview(false);

  const payload = { data: res.data, overall: overall };
  cacheSet(cacheKey, payload);
  body.innerHTML = blocksHtml(payload.data, payload.overall, false, overview);
}

function blocksHtml(raw, overall, fromCache, overview) {
  if (!overview) {
    overview = peekOverview();
  }
  const blocks = buildReportBlocks(raw, mode, overview, overall ? { overall: overall } : {});
  const parts = [];
  if (fromCache) {
    parts.push('<div class="wre-hint">来自本地缓存（30 分钟内） · 当前周期：' + esc(modeLabel(mode)) + '</div>');
  }
  parts.push(blocks.map(renderBlock).join(''));
  parts.push('<div class="wre-note">本报告在浏览器本机按固定规则计算生成，仅供参考。</div>');
  return parts.join('');
}

function renderBlock(b) {
  if (!b || !b.type) {
    return '';
  }
  switch (b.type) {
    case 'heading':
      // 对齐小程序 report/index.wxml 的 .sec-title / .sec-title--sub
      return '<div class="wre-sec-title' + (b.level === 3 ? ' wre-sec-title--sub' : '') + '">' + esc(b.text) + '</div>';
    case 'kv':
      return '<div class="wre-card"><div class="wre-kv">' + b.rows.map((r) =>
        '<div class="wre-kv__row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>').join('') + '</div></div>';
    case 'cards':
      return '<div class="wre-cards">' + b.items.map((it) =>
        '<div class="wre-cards__item"><div class="wre-cards__value">' + esc(it.value) + '</div>' +
        '<div class="wre-cards__label">' + esc(it.label) + '</div></div>').join('') + '</div>';
    case 'chips':
      return '<div class="wre-card"><div class="wre-chips">' + b.items.map((it) =>
        '<span class="wre-chip wre-chip--soft">' + esc(it.label) + '<em>' + esc(it.value) + '</em></span>').join('') + '</div></div>';
    case 'table': {
      const bars = Array.isArray(b.bars) ? b.bars : null;
      let html = '<div class="wre-table"><div class="wre-table__head">' +
        b.head.map((h) => '<span>' + esc(h) + '</span>').join('') + '</div>';
      html += b.rows.map((row, i) => {
        const cells = row.map((c, ci) => '<span' + (ci === 0 ? ' class="wre-table__main"' : '') + '>' + esc(c) + '</span>').join('');
        // 占比条：绝对定位在行底部（对齐小程序 .tbl__bar），不参与栅格分列
        const bar = bars ? '<div class="wre-table__bar" style="width:' + bars[i] + '%"></div>' : '';
        return '<div class="wre-table__row">' + cells + bar + '</div>';
      }).join('');
      return '<div class="wre-card wre-table-card">' + html + '</div>';
    }
    case 'paragraph':
      return '<div class="wre-card"><p class="wre-p">' + esc(b.text) + '</p></div>';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return '<div class="wre-card"><' + tag + ' class="wre-list">' + b.items.map((it) => '<li>' + esc(it) + '</li>').join('') + '</' + tag + '></div>';
    }
    case 'note':
      return '<div class="wre-note wre-note--inline">' + esc(b.text) + '</div>';
    case 'empty':
      return '<div class="wre-muted">' + esc(b.text) + '</div>';
    default:
      return '';
  }
}
