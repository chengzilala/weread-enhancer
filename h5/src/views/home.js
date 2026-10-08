/**
 * H2 数据总览（首页）
 *
 * 对齐小程序 M2：Hero 主卡 + 迷你趋势图 + 指标卡 + 偏好分类 / 时段 + 读得最多。
 * A 档（本周期 readdata）即时渲染；书架/笔记概览为 B 档懒加载（此处仅做入口提示）。
 */

import { fetchReadData, peekOverview } from '../data.js';
import { buildHomeView } from '../core/home-core.js';
import { renderHomeShare } from '../core/home-share.js';
import { shelfCounts, notebookStats, modeLabel, fmtDateTime } from '../core/report-core.js';
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

export const title = '阅读数据';

let mode = 'weekly';

export function render(root, app) {
  root.innerHTML =
    '<div class="wre-page">' +
    '  <div class="wre-modes" id="homeModes">' +
    MODES.map((m) =>
      '<button class="wre-mode' + (m.key === mode ? ' is-active' : '') + '" data-mode="' + m.key + '">' + m.label + '</button>'
    ).join('') +
    '  </div>' +
    '  <div id="homeBody">' + stateHtml('loading', '正在读取你的阅读数据…') + '</div>' +
    '</div>';

  const modesEl = root.querySelector('#homeModes');
  modesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) {
      return;
    }
    const next = btn.getAttribute('data-mode');
    if (next === mode) {
      return;
    }
    mode = next;
    modesEl.querySelectorAll('.wre-mode').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-mode') === mode);
    });
    load(root, app, false);
  });

  const body = root.querySelector('#homeBody');
  body.addEventListener('click', (e) => {
    const retry = e.target.closest('[data-action="retry"]');
    if (retry) {
      load(root, app, true);
      return;
    }
    const share = e.target.closest('[data-action="share"]');
    if (share) {
      doShare();
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) {
      app.go(go.getAttribute('data-goto'));
    }
  });

  load(root, app, false);
}

// 分享图需要「当前已拿到的那份原始数据」——页面渲染时留一份
let lastRaw = null;

function doShare() {
  if (!lastRaw) {
    return;
  }
  const raw = lastRaw;
  const label = modeLabel(mode);
  presentShareImage(
    () => renderHomeShare({ data: raw, mode: mode, modeLabel: label, generatedAt: fmtDateTime(Date.now()) }, getProfile()),
    { title: '微信悦读', text: label + '阅读数据总览', link: typeof location !== 'undefined' ? location.href : '' },
    'home-share.png'
  );
}

async function load(root, app, force) {
  const body = root.querySelector('#homeBody');
  const cacheKey = 'home_' + mode;
  if (!force) {
    const cached = cacheGet(cacheKey, CACHE_TTL_MS);
    if (cached) {
      lastRaw = cached;
      body.innerHTML = bodyHtml(cached, true);
      return;
    }
  }
  body.innerHTML = stateHtml('loading', '正在读取你的阅读数据…');
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
  cacheSet(cacheKey, res.data);
  lastRaw = res.data;
  body.innerHTML = bodyHtml(res.data, false);
}

function bodyHtml(raw, fromCache) {
  const view = buildHomeView(raw, mode);
  const parts = [];
  if (view.emptyRecord) {
    parts.push('<div class="wre-card"><div class="wre-muted">' + esc(modeLabel(mode)) + '还没有阅读记录，换个周期看看，或开始读一本书吧。</div></div>');
  }

  // Hero
  const hero = view.hero;
  parts.push(
    '<div class="wre-card wre-hero">' +
    '  <div class="wre-hero__label">' + esc(hero.label) + '</div>' +
    '  <div class="wre-big">' + esc(hero.value) + '</div>' +
    (hero.hasCompare
      ? '  <div class="wre-hero__cmp ' + (hero.dir === 'up' ? 'is-up' : 'is-down') + '">较上期 ' +
        (hero.dir === 'up' ? '↑' : '↓') + ' ' + esc(hero.compareAbs) + '</div>'
      : '') +
    (hero.word ? '  <div class="wre-muted">' + esc(hero.word) + '</div>' : '') +
    (fromCache ? '  <div class="wre-hint">来自本地缓存（30 分钟内）</div>' : '') +
    '</div>'
  );

  // 趋势
  if (view.trend && view.trend.bars.length) {
    const bars = view.trend.bars.map((b) =>
      '<div class="wre-bar' + (b.active ? ' is-peak' : '') + '" style="height:' + Math.max(2, b.h) + '%"></div>').join('');
    parts.push(
      '<div class="wre-card">' +
      '  <div class="wre-card__title">' + esc(view.trend.title) + '</div>' +
      '  <div class="wre-trend">' + bars + '</div>' +
      (view.trend.peak ? '  <div class="wre-muted">峰值 ' + esc(view.trend.peak.label) + ' · ' + esc(view.trend.peak.time) + '</div>' : '') +
      (view.trend.hidden > 0 ? '  <div class="wre-hint">已展示最近 ' + view.trend.bars.length + ' 个周期（另有 ' + view.trend.hidden + ' 个更早）</div>' : '') +
      '</div>'
    );
  }

  // 指标卡
  if (view.metrics.length) {
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">核心指标</div>' +
      '<div class="wre-grid">' +
      view.metrics.map((m) =>
        '<div class="wre-grid__item"><div class="wre-grid__value">' + esc(m.value) + '</div><div class="wre-grid__label">' + esc(m.label) + '</div>' +
        (m.hint ? '<div class="wre-hint">' + esc(m.hint) + '</div>' : '') + '</div>').join('') +
      '</div></div>'
    );
  }

  // 偏好分类
  if (view.categories.length) {
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">偏好分类</div>' +
      view.categories.map((c) =>
        '<div class="wre-row">' +
        '<div class="wre-row__head"><span>' + esc(c.name) + '</span><span class="wre-muted">' + esc(c.time) + ' · ' + esc(c.pct) + '</span></div>' +
        '<div class="wre-track"><div class="wre-track__fill" style="width:' + c.bar + '%"></div></div>' +
        '</div>').join('') +
      '</div>'
    );
  }

  // 时段分布（仅累计周期官方提供）
  if (view.timeBands) {
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">阅读时段</div>' +
      view.timeBands.rows.map((r) =>
        '<div class="wre-row">' +
        '<div class="wre-row__head"><span>' + esc(r.label) + '</span><span class="wre-muted">' + esc(r.time) + ' · ' + esc(r.pct) + '</span></div>' +
        '<div class="wre-track"><div class="wre-track__fill" style="width:' + r.bar + '%"></div></div>' +
        '</div>').join('') +
      (view.timeBands.peak ? '<div class="wre-muted">最集中：' + esc(view.timeBands.peak) + '</div>' : '') +
      '</div>'
    );
  }

  // 读得最多
  if (view.longest.length) {
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">读得最多</div>' +
      view.longest.map((b) =>
        '<div class="wre-line"><span class="wre-line__rank">' + b.rank + '</span>' +
        '<span class="wre-line__main">' + esc(b.title) + (b.author ? '<em>' + esc(b.author) + '</em>' : '') + '</span>' +
        '<span class="wre-muted">' + esc(b.time) + '</span></div>').join('') +
      '</div>'
    );
  }

  // B 档入口（书架 / 笔记 / 人格）
  const overview = peekOverview();
  const counts = overview.ok && overview.shelf ? shelfCounts(overview.shelf) : null;
  const stats = overview.ok ? notebookStats(overview.notebooks) : null;
  parts.push(
    '<div class="wre-card wre-links">' +
    '<button class="wre-link" data-goto="shelf"><span>📚 书架</span><span class="wre-muted">' + esc(counts ? counts.total + ' 个条目' : '去看看') + '</span></button>' +
    '<button class="wre-link" data-goto="shelf"><span>📝 笔记</span><span class="wre-muted">' + esc(stats ? stats.totalNoteCount + ' 条' : '去看看') + '</span></button>' +
    '<button class="wre-link" data-goto="persona"><span>🧬 阅读人格</span><span class="wre-muted">去看看</span></button>' +
    '<button class="wre-link" data-goto="daily"><span>🗂 每日卡片</span><span class="wre-muted">AI 成文</span></button>' +
    '<button class="wre-link" data-goto="wander"><span>🧭 灵感漫游</span><span class="wre-muted">AI 串联</span></button>' +
    '</div>'
  );

  // 分享入口（对齐小程序 share-entry 卡片；有记录才展示）
  if (!view.emptyRecord) {
    parts.push(
      '<div class="wre-card wre-share-entry">' +
      '<button class="wre-btn" data-action="share">生成数据分享图</button>' +
      '<div class="wre-muted">生成后可保存图片，或用系统分享面板转发</div>' +
      '</div>'
    );
  }

  return parts.join('');
}
