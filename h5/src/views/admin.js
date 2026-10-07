/**
 * H14 运营看板
 *
 * 口令门：本机保存运营口令（wre_h5_admin_token），没有则先输入；
 * 数据来自云函数 opsAdmin（小程序 / 插件 / H5 三段匿名用量汇总）。
 * 纯只读展示，不发写操作；口令只存本机，可随时「退出看板」清除。
 */

import { opsAdmin } from '../api.js';
import { localGet, localSet, localRemove } from '../store.js';
import { esc, stateHtml, toast } from '../ui.js';
import { CONFIG } from '../config.js';

export const title = '运营看板';

const TOKEN_KEY = 'wre_h5_admin_token';

// 三段来源，key 对应 opsAdmin 返回里的字段名
const SECTIONS = [
  { key: 'mp', label: '微信小程序' },
  { key: 'plugin', label: '浏览器插件' },
  { key: 'h5', label: 'H5 网页版' },
];

// 本次会话内已输入的口令（未落盘时供「重试」复用）
let activeToken = '';

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="adminBody"></div>';
  const body = root.querySelector('#adminBody');
  body.addEventListener('click', (e) => onAction(e, body, app));

  const token = readToken();
  if (!token) {
    body.innerHTML = gateHtml('');
    return;
  }
  load(body, app, token);
}

/** 本机保存 > 本次会话输入 */
function readToken() {
  return String(localGet(TOKEN_KEY, '') || activeToken || '').trim();
}

// ---- 口令门 ----
function gateHtml(errorMsg) {
  return (
    '<div class="wre-card">' +
    '  <div class="wre-card__title">运营看板</div>' +
    '  <div class="wre-muted">凭运营口令查看小程序 / 插件 / H5 的匿名使用量汇总。口令只保存在这台设备，可随时退出清除。</div>' +
    (errorMsg ? '  <div class="wre-status wre-status--off">' + esc(errorMsg) + '</div>' : '') +
    '  <input class="wre-input" id="adminToken" type="password" autocomplete="off" placeholder="运营口令" />' +
    '  <button class="wre-btn" data-action="enter">进入看板</button>' +
    '</div>' +
    '<div class="wre-note">看板仅展示聚合后的匿名计数，不含任何个人数据。</div>'
  );
}

// ---- 拉数据 ----
async function load(body, app, token) {
  body.innerHTML = stateHtml('loading', '正在拉取运营数据…');

  const res = await opsAdmin(token);
  if (!res.ok) {
    if (res.code === 'forbidden') {
      activeToken = '';
      localRemove(TOKEN_KEY);
      body.innerHTML = gateHtml('口令不正确或已失效，请重新输入。');
      return;
    }
    body.innerHTML = stateHtml('error', res.error || '拉取运营数据失败', '重试');
    return;
  }

  activeToken = token;
  localSet(TOKEN_KEY, token);
  body.innerHTML = dashHtml(res);
}

// ---- 看板渲染 ----
function dashHtml(res) {
  const parts = [];
  parts.push(
    '<div class="wre-card">' +
    '  <div class="wre-card__title">运营看板</div>' +
    '  <div class="wre-muted">数据生成时间：' + esc(fmtTime(res.generatedAt) || '—') + '</div>' +
    '  <button class="wre-btn wre-btn--ghost" data-action="exit">退出看板</button>' +
    '</div>'
  );
  SECTIONS.forEach((section) => {
    parts.push(sectionHtml(section, res[section.key]));
  });
  parts.push(
    '<div class="wre-note">以上为各端匿名使用量的聚合汇总，仅作运营参考；口令只存本机。当前 H5 客户端版本 ' +
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
  const btn = e.target.closest('[data-action]');
  if (!btn) {
    return;
  }
  const action = btn.getAttribute('data-action');

  if (action === 'enter') {
    const input = body.querySelector('#adminToken');
    const token = (input && input.value || '').trim();
    if (!token) {
      toast('请输入运营口令');
      return;
    }
    activeToken = token;
    load(body, app, token);
    return;
  }

  if (action === 'retry') {
    const token = readToken();
    if (!token) {
      body.innerHTML = gateHtml('');
      return;
    }
    load(body, app, token);
    return;
  }

  if (action === 'exit') {
    activeToken = '';
    localRemove(TOKEN_KEY);
    toast('已退出看板');
    body.innerHTML = gateHtml('');
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
