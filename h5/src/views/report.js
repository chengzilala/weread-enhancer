/**
 * H4 阅读行为报告
 *
 * 分章节图文报告，规则化摘要（未接 AI）。复用 report-core 的 buildReportBlocks。
 */

import { fetchReadData, fetchOverview, peekOverview } from '../data.js';
import { buildReportBlocks, modeLabel, fmtDateTime, mainColumnIndex } from '../core/report-core.js';
import { renderReportShare } from '../core/report-share.js';
import { messageOf, isKeyError } from '../core/errors.js';
import { esc, stateHtml } from '../ui.js';
import { cacheGet, cacheSet, getProfile } from '../store.js';
import { presentShareImage } from '../share.js';

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
      return;
    }
    if (e.target.closest('[data-action="share"]')) {
      doShare();
    }
  });

  load(root, app, false);
}

// 分享图需要「当前报告的数据 + 书架/笔记概览」——渲染时留一份
let lastShare = null;

function doShare() {
  if (!lastShare) {
    return;
  }
  const payload = lastShare;
  const label = modeLabel(mode);
  const blocks = buildReportBlocks(payload.data, mode, payload.overview || peekOverview(), {});
  const stats = [];
  const lines = [];
  const chips = [];
  (blocks || []).forEach((b) => {
    if (b.type === 'cards') {
      (b.items || []).forEach((it) => stats.push({ label: it.label, value: it.value }));
    } else if (b.type === 'kv') {
      (b.rows || []).forEach((r) => stats.push({ label: r[0], value: r[1] }));
    } else if (b.type === 'chips') {
      (b.items || []).forEach((it) => chips.push(it.label));
    } else if (b.type === 'paragraph' && b.text) {
      lines.push(b.text);
    }
  });
  const profile = getProfile();
  const spec = {
    kind: 'report',
    badge: '阅读报告',
    title: label + '阅读行为报告',
    subtitle: '生成于 ' + fmtDateTime(Date.now()),
    stats: stats.slice(0, 4),
    lines: lines.slice(0, 3),
    chips: chips.slice(0, 8),
    footer: (profile.nickName ? profile.nickName + ' · ' : '') + '微信悦读 · 本机计算',
    text: label + '阅读行为报告',
  };
  presentShareImage(
    () => renderReportShare({
      data: payload.data,
      overview: payload.overview,
      mode: mode,
      modeLabel: label,
      generatedAt: fmtDateTime(Date.now()),
    }, profile),
    spec,
    'report-share.png'
  );
}

async function load(root, app, force) {
  const body = root.querySelector('#reportBody');
  const cacheKey = 'report_' + mode;
  if (!force) {
    const cached = cacheGet(cacheKey, CACHE_TTL_MS);
    if (cached) {
      lastShare = { data: cached.data, overview: peekOverview() };
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
  lastShare = { data: res.data, overview: overview };
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
  // 页脚免责声明由 report-core 的 note 块统一输出（对齐小程序），此处不再重复追加
  parts.push(blocks.map(renderBlock).join(''));
  // 分享入口（对齐小程序 share-entry 卡片）
  parts.push(
    '<div class="wre-card wre-share-entry">' +
    '<button class="wre-btn" data-action="share">生成报告分享图</button>' +
    '<div class="wre-muted">生成后可保存图片，或用系统分享面板转发</div>' +
    '</div>'
  );
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
      const head = Array.isArray(b.head) ? b.head : [];
      const rows = Array.isArray(b.rows) ? b.rows : [];
      // 主列＝承载文字的那一列（通常第 0 列；若第 0 列只是「排名 / 序号」则取文字最长的一列）。
      // 其余列按「内容长短」分两类定宽：
      //   cell＝短列（「3 本」「20.0%」「1」），auto 收紧 + 右对齐 + 不换行；
      //   text＝长文本列（作者 / 分类等），与主列一起按 fr 比例分宽并允许折行。
      // 旧版把所有非主列都设成 auto：长文本列会按 max-content 抢完全部宽度，
      // 把 minmax(0,1fr) 的主列挤成「一字一行」（书名竖排），故改为按列型分宽。
      const mainIdx = mainColumnIndex(head, rows);
      const kindOf = (i) => {
        if (i === mainIdx) {
          return 'main';
        }
        let maxLen = String(head[i] == null ? '' : head[i]).length;
        for (let r = 0; r < rows.length; r += 1) {
          const value = String(((rows[r] || [])[i] == null) ? '' : (rows[r] || [])[i]);
          if (value.length > maxLen) {
            maxLen = value.length;
          }
        }
        return maxLen <= 6 ? 'cell' : 'text';
      };
      const kinds = head.map((_, i) => kindOf(i));
      const cols = kinds.map((k) => (k === 'cell' ? 'auto' : (k === 'main' ? 'minmax(0, 2.4fr)' : 'minmax(0, 1fr)'))).join(' ');
      const cell = (text, i) => '<span class="wre-table__' + kinds[i] + '">' + esc(text) + '</span>';
      let html = '<div class="wre-table__head">' + head.map(cell).join('') + '</div>';
      html += rows.map((row, i) => {
        const cells = row.map(cell).join('');
        // 占比条：绝对定位在行底部（对齐小程序 .tbl__bar），不参与栅格分列
        const bar = bars ? '<div class="wre-table__bar" style="width:' + bars[i] + '%"></div>' : '';
        return '<div class="wre-table__row">' + cells + bar + '</div>';
      }).join('');
      return '<div class="wre-card wre-table-card"><div class="wre-table" style="--wre-cols:' + cols + '">' + html + '</div></div>';
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
