/**
 * H14 运营看板
 *
 * 免口令：服务端按「账户码（deviceId）」白名单认人（云函数环境变量 ADMIN_DEVICE_IDS），
 * 前端无需输入任何口令，打开即拉取；数据来自云函数 opsAdmin
 * （小程序 / 插件 / H5 三段匿名用量汇总）。纯只读展示，不发写操作。
 */

import { opsAdmin } from '../api.js';
import { esc, stateHtml } from '../ui.js';
import { CONFIG } from '../config.js';

export const title = '运营看板';

// 三段来源，key 对应 opsAdmin 返回里的字段名
const SECTIONS = [
  { key: 'mp', label: '微信小程序' },
  { key: 'plugin', label: '浏览器插件' },
  { key: 'h5', label: 'H5 网页版' },
];

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="adminBody"></div>';
  const body = root.querySelector('#adminBody');
  body.addEventListener('click', (e) => onAction(e, body, app));
  load(body);
}

// ---- 拉数据 ----
async function load(body) {
  body.innerHTML = stateHtml('loading', '正在拉取运营数据…');

  const res = await opsAdmin();
  if (!res.ok) {
    if (res.code === 'forbidden') {
      body.innerHTML = deniedHtml(res.error || '当前账户码不在管理员白名单。');
      return;
    }
    body.innerHTML = backHtml() + stateHtml('error', res.error || '拉取运营数据失败', '重试');
    return;
  }

  body.innerHTML = dashHtml(res);
}

function backHtml() {
  return '<div class="wre-back"><button class="wre-back__btn" data-goto="me">← 返回我的</button></div>';
}

// ---- 无权限 ----
function deniedHtml(msg) {
  return (
    backHtml() +
    '<div class="wre-card">' +
    '  <div class="wre-card__title">运营看板</div>' +
    '  <div class="wre-muted">该看板仅对管理员账户码开放，无需口令，按账户码自动识别。</div>' +
    '  <div class="wre-status wre-status--off">' + esc(msg) + '</div>' +
    '</div>' +
    '<div class="wre-note">看板仅展示聚合后的匿名计数，不含任何个人数据。</div>'
  );
}

// ---- 看板渲染 ----
function dashHtml(res) {
  const parts = [];
  parts.push(backHtml());
  parts.push(
    '<div class="wre-card">' +
    '  <div class="wre-card__title">运营看板</div>' +
    '  <div class="wre-muted">数据生成时间：' + esc(fmtTime(res.generatedAt) || '—') + '</div>' +
    '</div>'
  );
  SECTIONS.forEach((section) => {
    parts.push(sectionHtml(section, res[section.key]));
  });
  parts.push(
    '<div class="wre-note">以上为各端匿名使用量的聚合汇总，仅作运营参考。当前 H5 客户端版本 ' +
    esc(CONFIG.APP_VERSION) + '。</div>'
  );
  return parts.join('');
}

function sectionHtml(section, data) {
  const s = data || {};
  return (
    '<div class="wre-card">' +
    '  <div class="wre-card__title">' + esc(section.label) + '</div>' +
    '  <div class="wre-muted">数据日期：' + esc(fmtDate(s.date)) + '</div>' +
    metricsGrid(s) +
    '  <div class="wre-h3">版本分布</div>' +
    versionsHtml(s.versions, s.truncated) +
    '</div>'
  );
}

/** 四张指标卡：今日活跃 / 今日打开 / 今日新增 / 累计用户 */
function metricsGrid(s) {
  const items = [
    { label: '今日活跃', value: s.todayUsers },
    { label: '今日打开', value: s.todayOpens },
    { label: '今日新增', value: s.newUsers },
    { label: '累计用户', value: s.totalUsers },
  ];
  return (
    '<div class="wre-grid">' +
    items.map((it) =>
      '<div class="wre-grid__item">' +
      '<div class="wre-grid__value">' + esc(num(it.value)) + '</div>' +
      '<div class="wre-grid__label">' + esc(it.label) + '</div>' +
      '</div>').join('') +
    '</div>'
  );
}

/** 版本分布：按占比画条（复用 wre-row / wre-track） */
function versionsHtml(list, truncated) {
  if (!list || !list.length) {
    return '<div class="wre-muted">暂无版本数据</div>';
  }
  const max = list.reduce((m, v) => Math.max(m, Number(v && v.count) || 0), 0) || 1;
  const rows = list.map((v) => {
    const count = Number(v && v.count) || 0;
    const width = Math.max(2, Math.round((count / max) * 100));
    return (
      '<div class="wre-row">' +
      '<div class="wre-row__head"><span>' + esc((v && v.version) || '未知版本') + '</span>' +
      '<span class="wre-muted">' + esc(count) + '</span></div>' +
      '<div class="wre-track"><div class="wre-track__fill" style="width:' + width + '%"></div></div>' +
      '</div>'
    );
  }).join('');
  return rows + (truncated ? '<div class="wre-hint">数据较多，仅展示前列版本。</div>' : '');
}

// ---- 事件委托 ----
function onAction(e, body, app) {
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

  if (action === 'retry') {
    load(body);
  }
}

// ---- 格式化小工具 ----
function num(value) {
  return value === null || value === undefined || value === '' ? 0 : value;
}

function fmtDate(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

/** generatedAt 可能是毫秒时间戳，也可能是日期字符串 */
function fmtTime(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const n = Number(value);
  const d = isFinite(n) && n > 0 ? new Date(n) : new Date(String(value));
  if (!isNaN(d.getTime())) {
    return d.toLocaleString('zh-CN', { hour12: false });
  }
  return String(value);
}
