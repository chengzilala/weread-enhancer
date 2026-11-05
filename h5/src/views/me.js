/**
 * 「我的账户」页：Key 托管（H1）+ 登录与同步（统一账户 / 跨设备 H8 / 关联小程序）+ 更多入口
 *
 * 账户模型：deviceId 即账户（32 位随机码，浏览器本机生成，服务端按它认人）；
 *   「账户码」就是它，换设备输入即可登录同一账户（收在「登录与同步 → 跨设备登录」里）。
 *
 * 红线：Key 明文只提交一次给服务端加密托管，本机只保存掩码；提交后不再持有明文。
 *      完整账户码等同一把钥匙，默认只显示掩码，点「显示」才展开。
 */

import { keySave, keyClear, verifyKey, keyGet, bindCreate, bindStatus, bindRemove, bindRedeem } from '../api.js';
import { getMask, setMask, getDeviceId, setDeviceId, resetDeviceId, getFontScale, applyFontScale, FONT_TIERS, getTheme, applyTheme, THEME_TIERS } from '../store.js';
import { esc, toast, copyText, confirmSignOut } from '../ui.js';
import { keyGuideHtml } from '../key-guide.js';
import { qrSvg } from '../qrcode.js';
import { desktopGuideBodyHtml } from '../desktop-guide.js';
import { CONFIG } from '../config.js';
import { openArchive as openDailyArchive } from './daily.js';
import { openArchive as openWanderArchive } from './wander.js';

export const title = '我的';

let openForm = '';    // '' | 'wrk'：当前展开的 Key 输入区
let showCode = false; // 是否展开完整账户码
let openSec = '';     // 当前展开的折叠区（同一时间只展开一个）

// 统一账户（account-center）状态：与本机账户码并存，互不影响
let acUser = null;    // null=未登录 / { uid, nickname, emailMasked }
let acReady = false;  // 是否已向账户中心查询过一次

// 关联小程序（跨端打通）状态
let bindCode = '';      // 当前展示的一次性绑定码（6 位）
let bindExpire = 0;     // 绑定码过期时间
let bindLinked = null;  // null=未知 / true=已关联 / false=未关联
let bindTimer = null;   // 关联状态轮询定时器

// 跨设备登录（H5↔H5）：本设备生成的 6 位登录码
let syncCode = '';      // 当前展示的 6 位登录码
let syncExpire = 0;     // 登录码过期时间

export function render(root, app) {
  root.innerHTML = '<div class="wre-page wre-me" id="meBody"></div>';
  const body = root.querySelector('#meBody');
  body.addEventListener('click', (e) => onAction(e, body, app));
  bindCode = '';
  bindExpire = 0;
  bindLinked = null;
  syncCode = '';
  syncExpire = 0;
  acUser = null;
  acReady = false;
  openSec = '';
  openForm = '';
  stopPoll();
  paint(body);
  syncFromServer(body);   // 静默与服务端对齐昵称 / 掩码
  refreshLink(body);      // 静默查询是否已关联小程序
  syncAccount(body);      // 静默查询统一账户登录态
}

/** 账户码掩码：前 4 后 4，中间打点 */
function maskCode(id) {
  const v = String(id || '');
  return v.length > 8 ? v.slice(0, 4) + '····' + v.slice(-4) : v;
}

/* ---------- 统一账户（account-center）：只做登录态展示与上报 ---------- */

/** SDK 与配置是否就绪（未就绪时整张卡不出现，不影响原有功能） */
function acEnabled() {
  const cfg = CONFIG.ACCOUNT || {};
  return !!(window.PSAuth && cfg.apiBase && cfg.productId);
}

function acSdk() {
  const cfg = CONFIG.ACCOUNT || {};
  const sdk = window.PSAuth;
  sdk.init({ apiBase: cfg.apiBase, productId: cfg.productId });
  return sdk;
}

/** uid 掩码：前 6 后 4，中间打点 */
function maskUid(uid) {
  const v = String(uid || '');
  return v.length > 12 ? v.slice(0, 6) + '····' + v.slice(-4) : v;
}

function unifiedInner() {
  if (!acReady) {
    return '<div class="wre-muted">正在查询登录状态…</div>';
  }
  if (acUser) {
    return '<div class="wre-muted">已登录。一个 uid 管所有作品（官网 / 算经小课 / 微信悦读），账户码与托管 Key 都不受影响。</div>' +
      '<div class="wre-code">' + esc(maskUid(acUser.uid)) + (acUser.emailMasked ? ' · ' + esc(acUser.emailMasked) : '') + '</div>' +
      '<button class="wre-btn wre-btn--ghost" data-action="ac-logout">退出统一账户</button>';
  }
  return '<div class="wre-muted">用邮箱登录统一账户后，同一个身份可走遍官网、算经小课与微信悦读；本机账户码与已托管 Key 不变。</div>' +
    '<button class="wre-btn wre-btn--ghost" data-action="ac-login">登录统一账户</button>' +
    '<div class="wre-hint">登录后可看到「我的足迹」，个人网站上也会显示为已登录。</div>';
}

/** 统一账户状态变化后重绘页面（折叠区展开状态保持不变） */
function paintUnified(body) {
  paint(body);
}

function syncAccount(body) {
  if (!acEnabled()) {
    return;
  }
  const sdk = acSdk();
  sdk.getUser().then((user) => {
    acUser = user || null;
    acReady = true;
    paintUnified(body);
  }).catch(() => {
    acReady = true;
    paintUnified(body);
  });
}

function paint(body) {
  const mask = getMask() || {};

  body.innerHTML =
    syncCard() +
    keyCard(mask) +
    moreCard() +
    '<div class="wre-foot">' +
    '  <button class="wre-foot__btn" data-action="sign-out">退出登录</button>' +
    '</div>';
}

/** 核心卡：微信读书 Key（全页唯一主操作，已配置时自动收缩成一行） */
function keyCard(mask) {
  const on = !!mask.hasKey;
  const editing = openForm === 'wrk';
  let body;
  if (on && !editing) {
    body =
      '<div class="wre-code-row">' +
      '  <span class="wre-code-row__label">已加密托管</span>' +
      '  <span class="wre-code-row__val">' + esc(mask.masked || '已连接') + '</span>' +
      '</div>' +
      '<div class="wre-btn-row">' +
      '  <button class="wre-btn wre-btn--ghost" data-action="toggle-form" data-kind="wrk">更换</button>' +
      '  <button class="wre-btn wre-btn--ghost" data-action="clear-key">清除</button>' +
      '</div>';
  } else {
    body =
      '<div class="wre-muted">' + (on ? '粘贴新的 Key 覆盖旧的。' : 'AI 解析需要它；只提交一次给云函数加密托管，本机不保存明文。') + '</div>' +
      '<input class="wre-input" id="meWrk" type="password" autocomplete="off" placeholder="粘贴 wrk- 开头的微信读书 Key" />' +
      '<button class="wre-btn" data-action="save-wrk">保存并校验</button>' +
      (on ? '<div class="wre-btn-row"><button class="wre-btn wre-btn--ghost" data-action="toggle-form" data-kind="wrk">取消更换</button></div>' : '');
  }
  return (
    '<div class="wre-card' + (on ? '' : ' wre-card--hero') + '">' +
    '  <div class="wre-card__title wre-card__title--row">' +
    '    <span>微信读书 Key</span>' +
    '    <span class="wre-chip' + (on ? ' is-on' : '') + '">' + (on ? '已连接' : '未连接') + '</span>' +
    '  </div>' +
    body +
    keyGuideHtml() +
    accRow('DeepSeek Key（可选）', mask.hasAiKey ? '已配置' : '未配置', 'ai') +
    (openSec === 'ai' ? '<div class="wre-acc">' + aiInner() + '</div>' : '') +
    '</div>'
  );
}

/** DeepSeek Key（可选）：默认收起，不影响主流程 */
function aiInner() {
  return (
    '<div class="wre-muted">用于 AI 深度解析；不填也能用基础功能。</div>' +
    '<input class="wre-input" id="meAi" type="password" autocomplete="off" placeholder="粘贴 sk- 开头的 DeepSeek Key" />' +
    '<button class="wre-btn wre-btn--ghost" data-action="save-ai">保存 DeepSeek Key</button>'
  );
}

/** 登录与同步：统一账户 / 跨设备 / 关联小程序 合成一张卡，逐行展开 */
function syncCard() {
  const rows = [];
  if (acEnabled()) {
    const state = !acReady ? '查询中…' : (acUser ? '已登录' : '未登录');
    // 统一账户不再折叠，直接展开
    rows.push(
      '<div class="wre-row wre-row--static">' +
      '  <span class="wre-row__label">统一账户</span>' +
      '  <span class="wre-row__val">' + state + '</span>' +
      '</div>' +
      '<div class="wre-acc">' + unifiedInner() + '</div>'
    );
  }
  rows.push(accRow('跨设备登录', '账户码 / 6 位码', 'sync'));
  if (openSec === 'sync') {
    rows.push('<div class="wre-acc">' + syncInner() + '</div>');
  }
  rows.push(accRow('关联微信小程序', bindLinked ? '已关联' : '未关联', 'bind'));
  if (openSec === 'bind') {
    rows.push('<div class="wre-acc">' + bindInner() + '</div>');
  }
  return (
    '<div class="wre-card">' +
    '  <div class="wre-card__title">登录与同步</div>' +
    '  <div class="wre-muted">换手机或换浏览器，用这里的任一方式找回同一个账号。</div>' +
    rows.join('') +
    '</div>'
  );
}

/** 更多：设置 / 装到桌面 / 相关入口 / 打赏 全部收成一行入口 */
function moreCard() {
  const fsTier = FONT_TIERS.find((t) => t.value === getFontScale());
  const thTier = THEME_TIERS.find((t) => t.key === getTheme());
  return (
    '<div class="wre-card">' +
    '  <div class="wre-card__title">更多</div>' +
    accRow('设置', (fsTier ? fsTier.label : '标准') + ' · ' + (thTier ? thTier.label : '跟随系统'), 'prefs') +
    (openSec === 'prefs' ? '<div class="wre-acc">' + prefsInner() + '</div>' : '') +
    accRow('装到桌面', '电脑 / 手机', 'desktop') +
    (openSec === 'desktop' ? '<div class="wre-acc">' + desktopGuideBodyHtml() + '</div>' : '') +
    accRow('相关入口', '官网 / 个人网站', 'links') +
    (openSec === 'links' ? '<div class="wre-acc">' + linksInner() + '</div>' : '') +
    linkRow('🗂 每日卡片 · 往期回顾', 'open-daily') +
    linkRow('🧭 灵感漫游 · 往期归档', 'open-wander') +
    linkRow('📊 运营看板', 'open-admin') +
    accRow('💗 打赏支持', '', 'donate') +
    (openSec === 'donate' ? '<div class="wre-acc">' + donateInner() + '</div>' : '') +
    accRow('关于与说明', 'v' + CONFIG.APP_VERSION, 'about') +
    (openSec === 'about' ? '<div class="wre-acc">' + aboutInner() + '</div>' : '') +
    '</div>'
  );
}

/** 设置面板：文字大小 + 外观 */
function prefsInner() {
  return (
    '<div class="wre-acc__label">文字大小</div>' +
    fsModes() +
    '<div class="wre-acc__label">外观</div>' +
    themeModes() +
    '<div class="wre-hint">只存本机，换设备需重设。</div>'
  );
}

/** 相关入口面板 */
function linksInner() {
  return (
    extRow('🌐 官网 · 插件下载与教程', '电脑端插件的安装、使用教程都在这', CONFIG.SITE_URL) +
    extRow('👤 我的个人网站', '作者的其他作品与文章', CONFIG.PERSONAL_URL) +
    miniappBlock()
  );
}

/** 关于与说明面板 */
function aboutInner() {
  return (
    '<div class="wre-muted">本页是「微信悦读 · 满血版」，完整提供 AI 深度解析：AI 人格画像、每日卡片、灵感漫游主题综述。微信小程序版为合规精简版，只在手机本机按规则展示你的阅读数据，不涉及任何 AI 深度解析。你的阅读数据始终在本机计算，两版互不影响。</div>' +
    '<div class="wre-hint">数据与人格全部在你的浏览器本机计算；Key 由你自建的云函数加密托管，昵称托管后可跨设备同步，两者都能一键清除。</div>'
  );
}

/** 统一折叠行：左标签 + 右侧当前值 + 展开箭头 */
function accRow(label, value, sec) {
  const open = openSec === sec;
  return (
    '<button class="wre-row' + (open ? ' is-open' : '') + '" data-action="toggle-sec" data-sec="' + sec + '">' +
    '  <span class="wre-row__label">' + esc(label) + '</span>' +
    (value ? '  <span class="wre-row__val">' + esc(value) + '</span>' : '') +
    '  <span class="wre-row__arrow">' + (open ? '▴' : '▾') + '</span>' +
    '</button>'
  );
}

/** 「更多」列表行（对齐小程序 .settings-link） */
function linkRow(label, action) {
  return (
    '<button class="wre-link" data-action="' + action + '">' +
    '  <span>' + esc(label) + '</span>' +
    '  <span class="wre-link__arrow">›</span>' +
    '</button>'
  );
}

/** 外链行（H5 在浏览器里可自由跳转；新标签打开，避免打断当前页） */
function extRow(label, desc, href) {
  return (
    '<a class="wre-link" href="' + esc(href) + '" target="_blank" rel="noopener">' +
    '  <span class="wre-link__main">' +
    '    <span class="wre-link__label">' + esc(label) + '</span>' +
    (desc ? '    <span class="wre-link__desc">' + esc(desc) + '</span>' : '') +
    '  </span>' +
    '  <span class="wre-link__arrow">›</span>' +
    '</a>'
  );
}

/** 小程序入口：网页无法直接唤起小程序，给「小程序码 + 搜名字」提示 */
function miniappBlock() {
  const name = CONFIG.MINIAPP_NAME;
  return (
    '<div class="wre-qr-block">' +
    '  <div class="wre-qr-block__title">📱 微信小程序「' + esc(name) + '」</div>' +
    '  <img class="wre-qr-block__img" src="assets/img/miniapp-qr.png"' +
    ' alt="微信小程序 ' + esc(name) + ' 小程序码" loading="lazy" />' +
    '  <div class="wre-hint">小程序只能在微信里打开，网页无法直接跳转。请用微信扫上方小程序码，' +
    '或在微信「搜一搜」里搜「' + esc(name) + '」，即可进入。</div>' +
    '</div>'
  );
}

/** 「打赏支持」面板：两条收款码 + 跳转公开打赏名单（对齐插件支持中心 / 小程序设置页） */
function donateInner() {
  return (
    '<div class="wre-muted">如果它帮到了你，欢迎随喜支持一杯咖啡。每一笔打赏都会公开登记在名单里，欢迎监督。</div>' +
    '<div class="wre-donate">' +
    '  <div class="wre-donate__code">' +
    '    <img class="wre-donate__qr" src="assets/img/donate/wechat.png" alt="微信打赏收款码" loading="lazy" />' +
    '    <span class="wre-donate__label">微信</span>' +
    '  </div>' +
    '  <div class="wre-donate__code">' +
    '    <img class="wre-donate__qr" src="assets/img/donate/alipay.png" alt="支付宝打赏收款码" loading="lazy" />' +
    '    <span class="wre-donate__label">支付宝</span>' +
    '  </div>' +
    '</div>' +
    '<a class="wre-btn wre-btn--ghost wre-donate__list" href="' + esc(CONFIG.DONATE_URL) + '" target="_blank" rel="noopener">查看打赏名单 →</a>'
  );
}

/** 「文字大小」四档切换（小 / 标准 / 大 / 特大；对齐小程序设置页） */
function fsModes() {
  const cur = getFontScale();
  return '<div class="wre-modes">' + FONT_TIERS.map((t) =>
    '<button class="wre-mode' + (t.value === cur ? ' is-active' : '') + '"' +
    ' data-action="set-fs" data-value="' + t.value + '">' + esc(t.label) + '</button>'
  ).join('') + '</div>';
}

/** 「外观」三档切换（跟随系统 / 浅色 / 深色；对齐小程序设置页） */
function themeModes() {
  const cur = getTheme();
  return '<div class="wre-modes">' + THEME_TIERS.map((t) =>
    '<button class="wre-mode' + (t.key === cur ? ' is-active' : '') + '"' +
    ' data-action="set-theme" data-value="' + t.key + '">' + esc(t.label) + '</button>'
  ).join('') + '</div>';
}

/** 跨设备登录面板：账户码 / 生成 6 位码 / 用别机的账户码或 6 位码登录 */
function syncInner() {
  const deviceId = getDeviceId();
  return (
    '<div class="wre-code-row">' +
    '  <span class="wre-code-row__label">我的账户码</span>' +
    '  <span class="wre-code-row__val">' + esc(showCode ? deviceId : maskCode(deviceId)) + '</span>' +
    '  <button class="wre-row__link" data-action="toggle-code">' + (showCode ? '隐藏' : '显示') + '</button>' +
    '  <button class="wre-row__link" data-action="copy-device">复制</button>' +
    '</div>' +
    '<div class="wre-acc__label">生成 6 位登录码，在另一台设备输入</div>' +
    syncCodeBox() +
    '<div class="wre-acc__label">把另一台设备的账号登录到本机</div>' +
    '<input class="wre-input" id="meSync" placeholder="粘贴另一台设备的账户码（32 位）" />' +
    '<button class="wre-btn wre-btn--ghost" data-action="restore-device">用账户码登录</button>' +
    '<input class="wre-input" id="meLoginCode" inputmode="numeric" maxlength="6" placeholder="或输入另一台设备的 6 位登录码" />' +
    '<button class="wre-btn wre-btn--ghost" data-action="redeem-login">用 6 位码登录</button>' +
    '<div class="wre-hint">账户码就是你的账户身份，不含任何个人信息；若你先在小程序使用，可在小程序「关联网页账户 → 获取我的账户码」里取到它。</div>'
  );
}

/** 跨设备登录（H5↔H5）：本设备「6 位登录码」区（已生成 / 未生成 两态） */
function syncCodeBox() {
  if (syncCode && Date.now() < syncExpire) {
    return (
      '  <div class="wre-code wre-code--bind">' + esc(syncCode) + '</div>' +
      '  <div class="wre-hint">在另一台设备（网页版）输入这 6 位数字即可登录同一账户（10 分钟内有效）。</div>' +
      '  <div class="wre-btn-row">' +
      '    <button class="wre-btn wre-btn--ghost" data-action="gen-sync-code">重新生成</button>' +
      '  </div>'
    );
  }
  const expired = syncCode && Date.now() >= syncExpire;
  return (
    (expired ? '  <div class="wre-hint">登录码已过期，请重新生成。</div>' : '') +
    '  <button class="wre-btn wre-btn--ghost" data-action="gen-sync-code">生成 6 位登录码</button>' +
    '  <div class="wre-hint">在本设备生成后，到另一台设备输入这 6 位即可登录同一账户。</div>'
  );
}

/** 关联小程序面板：已关联 / 展示绑定码 / 未关联 三态 */
function bindInner() {
  let inner;
  if (bindLinked === true) {
    inner =
      '  <div class="wre-conn">' +
      '    <div class="wre-conn__main">' +
      '      <div class="wre-conn__name">微信小程序</div>' +
      '      <div class="wre-conn__val is-on">已关联</div>' +
      '    </div>' +
      '    <button class="wre-conn__btn" data-action="remove-bind">解除</button>' +
      '  </div>';
  } else if (bindCode && Date.now() < bindExpire) {
    inner =
      '  <div class="wre-code wre-code--bind">' + esc(bindCode) + '</div>' +
      '  <div class="wre-qr">' + qrSvg(bindCode) + '</div>' +
      '  <div class="wre-hint">打开微信小程序「我的 → 关联网页账户」，点「扫一扫」扫码；也可手动输入上方 6 位数字（10 分钟内有效）。</div>' +
      '  <div class="wre-btn-row">' +
      '    <button class="wre-btn wre-btn--ghost" data-action="gen-bind">重新生成</button>' +
      '  </div>';
  } else {
    const expired = bindCode && Date.now() >= bindExpire;
    inner =
      (expired ? '  <div class="wre-hint">绑定码已过期，请重新生成。</div>' : '') +
      '  <button class="wre-btn" data-action="gen-bind">生成绑定码</button>' +
      '  <div class="wre-hint">也可点上方「复制」，把完整账户码粘贴到小程序里关联。</div>';
  }
  return (
    '<div class="wre-muted">关联后，小程序与网页共用同一份阅读人格与昵称。</div>' +
    inner
  );
}

/** 轮询关联状态：用户在小程序里绑定后，本页自动切换为「已关联」 */
function startPoll() {
  stopPoll();
  bindTimer = setInterval(async () => {
    const body = document.getElementById('meBody');
    if (!body) {
      stopPoll();
      return;
    }
    if (Date.now() >= bindExpire) {
      stopPoll();
      paint(body);
      return;
    }
    const res = await bindStatus();
    if (res.ok && res.linked) {
      bindLinked = true;
      stopPoll();
      paint(body);
      toast('已关联微信小程序');
    }
  }, 3000);
}

function stopPoll() {
  if (bindTimer) {
    clearInterval(bindTimer);
    bindTimer = null;
  }
}

/** 进入页面时查询一次关联状态 */
async function refreshLink(body) {
  const res = await bindStatus();
  if (!res.ok) {
    return;
  }
  bindLinked = !!res.linked;
  if (bindLinked) {
    stopPoll();
  }
  paint(body);
}

/** 静默对齐服务端：刷新 Key 掩码 */
async function syncFromServer(body) {
  const res = await keyGet();
  if (!res.ok) {
    return;
  }
  setMask({
    hasKey: !!res.hasKey,
    masked: res.masked || '',
    hasAiKey: !!res.hasAiKey,
    aiMasked: res.aiMasked || '',
  });
  paint(body);
}

async function onAction(e, body, app) {
  const btn = e.target.closest('[data-action]');
  if (!btn) {
    return;
  }
  const action = btn.getAttribute('data-action');

  if (action === 'ac-login') {
    if (!acEnabled()) {
      toast('统一账户暂不可用');
      return;
    }
    btn.disabled = true;
    acSdk().requireLogin();   // 未登录会跳账户中心，登录后带票据回到本页
    return;
  }

  if (action === 'ac-logout') {
    if (!acEnabled()) {
      return;
    }
    btn.disabled = true;
    await acSdk().logout();
    acUser = null;
    paintUnified(body);
    toast('已退出统一账户');
    return;
  }

  if (action === 'toggle-form') {
    openForm = openForm === 'wrk' ? '' : 'wrk';
    paint(body);
    const input = body.querySelector('#meWrk');
    if (input) {
      input.focus();
    }
    return;
  }

  if (action === 'toggle-sec') {
    const sec = btn.getAttribute('data-sec');
    openSec = openSec === sec ? '' : sec;
    paint(body);
    return;
  }

  if (action === 'toggle-code') {
    showCode = !showCode;
    paint(body);
    return;
  }

  if (action === 'set-fs') {
    const value = applyFontScale(Number(btn.getAttribute('data-value')));
    paint(body);
    const tier = FONT_TIERS.find((t) => t.value === value);
    toast('文字大小：' + ((tier && tier.label) || '标准'));
    return;
  }

  if (action === 'set-theme') {
    const pref = applyTheme(btn.getAttribute('data-value'));
    paint(body);
    const tier = THEME_TIERS.find((t) => t.key === pref);
    toast('外观：' + ((tier && tier.label) || '跟随系统'));
    return;
  }

  if (action === 'save-wrk') {
    const input = body.querySelector('#meWrk');
    const value = (input && input.value || '').trim();
    if (value.indexOf('wrk-') !== 0) {
      toast('请填写以 wrk- 开头的微信读书 Key');
      return;
    }
    btn.disabled = true;
    btn.textContent = '保存并校验中…';
    const saved = await keySave(value, '');
    if (!saved.ok) {
      btn.disabled = false;
      btn.textContent = '保存并校验';
      toast(saved.error || '保存失败');
      return;
    }
    if (input) {
      input.value = '';   // 提交后不再持有明文
    }
    // 校验：用托管 Key 试拉一次轻量接口
    const check = await verifyKey();
    const mask = getMask() || {};
    setMask(Object.assign({}, mask, { hasKey: true, masked: saved.masked || mask.masked || '' }));
    toast(check.ok ? '已保存并校验通过' : ('已保存，但校验未通过：' + (check.error || '请确认 Key 有效')));
    openForm = '';
    paint(body);
    app.refreshKeyState();
    return;
  }

  if (action === 'save-ai') {
    const input = body.querySelector('#meAi');
    const value = (input && input.value || '').trim();
    if (value.indexOf('sk-') !== 0) {
      toast('请填写以 sk- 开头的 DeepSeek Key');
      return;
    }
    const saved = await keySave('', value);
    if (!saved.ok) {
      toast(saved.error || '保存失败');
      return;
    }
    if (input) {
      input.value = '';
    }
    const mask = getMask() || {};
    setMask(Object.assign({}, mask, { hasAiKey: true, aiMasked: saved.aiMasked || mask.aiMasked || '' }));
    toast('DeepSeek Key 已保存');
    openForm = '';
    paint(body);
    return;
  }

  if (action === 'copy-device') {
    const ok = await copyText(getDeviceId());
    toast(ok ? '账户码已复制' : '复制失败，请手动选择');
    return;
  }

  if (action === 'gen-bind') {
    const res = await bindCreate();
    if (!res.ok) {
      toast(res.error || '生成失败，请稍后重试');
      return;
    }
    bindCode = res.code || '';
    bindExpire = res.expireAt || 0;
    paint(body);
    startPoll();
    return;
  }

  if (action === 'remove-bind') {
    if (!window.confirm('确定解除与微信小程序的关联吗？解除后两端将各自独立，Web 端仍保留现有数据。')) {
      return;
    }
    const res = await bindRemove();
    if (!res.ok) {
      toast(res.error || '解除失败，请稍后重试');
      return;
    }
    bindLinked = false;
    bindCode = '';
    stopPoll();
    paint(body);
    toast('已解除关联');
    return;
  }

  if (action === 'gen-sync-code') {
    const res = await bindCreate();
    if (!res.ok) {
      toast(res.error || '生成失败，请稍后重试');
      return;
    }
    syncCode = res.code || '';
    syncExpire = res.expireAt || 0;
    paint(body);
    return;
  }

  if (action === 'redeem-login') {
    const input = body.querySelector('#meLoginCode');
    const code = (input && input.value || '').trim();
    if (!/^\d{6}$/.test(code)) {
      toast('请输入 6 位数字登录码');
      return;
    }
    btn.disabled = true;
    btn.textContent = '登录中…';
    const res = await bindRedeem(code);
    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = '用 6 位码登录';
      toast(res.error || '登录失败，请稍后重试');
      return;
    }
    const target = res.deviceId || '';
    if (target === getDeviceId()) {
      btn.disabled = false;
      btn.textContent = '用 6 位码登录';
      toast('这就是当前账户，无需登录');
      return;
    }
    if (!window.confirm(
      '确定切换到账户 ' + maskCode(target) + ' 吗？\n\n' +
      '当前账户 ' + maskCode(getDeviceId()) + ' 的数据仍保存在云端，之后用它的账户码可再登回。'
    )) {
      btn.disabled = false;
      btn.textContent = '用 6 位码登录';
      return;
    }
    setDeviceId(target);
    toast('已登录，正在重载…');
    setTimeout(() => location.reload(), 600);
    return;
  }

  if (action === 'restore-device') {
    const input = body.querySelector('#meSync');
    const code = (input && input.value || '').trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(code)) {
      toast('账户码格式不正确（应为 32 位十六进制）');
      return;
    }
    if (code === getDeviceId()) {
      toast('这就是当前账户，无需登录');
      return;
    }
    if (!window.confirm(
      '确定切换到账户 ' + maskCode(code) + ' 吗？\n\n' +
      '当前账户 ' + maskCode(getDeviceId()) + ' 的数据仍保存在云端，之后用它的账户码可再登回。'
    )) {
      return;
    }
    setDeviceId(code);
    toast('已登录，正在重载…');
    setTimeout(() => location.reload(), 600);
    return;
  }

  if (action === 'sign-out') {
    // 退出前先让用户保存账户码（账户码是找回该账户的唯一凭证，退出后本机不再持有）
    const ok = await confirmSignOut(getDeviceId());
    if (!ok) {
      return;
    }
    resetDeviceId();
    toast('已退出，正在重载…');
    setTimeout(() => location.reload(), 600);
    return;
  }

  if (action === 'open-daily') {
    openDailyArchive();   // 直达「往期回顾」列表
    app.go('daily');
    return;
  }

  if (action === 'open-wander') {
    openWanderArchive();   // 直达「往期归档」列表
    app.go('wander');
    return;
  }

  if (action === 'open-admin') {
    app.go('admin');
    return;
  }

  if (action === 'clear-key') {
    if (!window.confirm('确定清除服务端托管的 Key 吗？清除后需重新填写。')) {
      return;
    }
    const res = await keyClear();
    if (!res.ok) {
      toast(res.error || '清除失败');
      return;
    }
    setMask(null);
    toast('已清除');
    paint(body);
    app.refreshKeyState();
  }
}
