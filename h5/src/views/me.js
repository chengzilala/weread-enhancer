/**
 * 「我的账户」页：账户总览 + Key 托管（H1）+ 昵称托管 + 跨设备登录（H8）+ 运营入口
 *
 * 账户模型：deviceId 即账户（32 位随机码，浏览器本机生成，服务端按它认人）；
 *   「账户码」就是它，换设备输入即可登录同一账户（未来可在此挂 openid 做微信登录）。
 *
 * 红线：Key 明文只提交一次给服务端加密托管，本机只保存掩码；提交后不再持有明文。
 *      昵称非敏感、可托管；头像可本机上传，仅存本机、不上传服务器。
 *      完整账户码等同一把钥匙，默认只显示掩码，点「显示完整」才展开。
 */

import { keySave, keyClear, verifyKey, keyGet, profileSave, bindCreate, bindStatus, bindRemove, bindRedeem } from '../api.js';
import { getMask, setMask, getProfile, setProfile, getDeviceId, setDeviceId, resetDeviceId, readAvatarFile, getFontScale, applyFontScale, FONT_TIERS, getTheme, applyTheme, THEME_TIERS } from '../store.js';
import { esc, toast, copyText, confirmSignOut } from '../ui.js';
import { qrSvg } from '../qrcode.js';

export const title = '我的账户';

let openForm = '';    // '' | 'wrk' | 'ai'：当前展开的 Key 输入区
let showCode = false; // 是否展开完整账户码

// 关联小程序（跨端打通）状态
let bindCode = '';      // 当前展示的一次性绑定码（6 位）
let bindExpire = 0;     // 绑定码过期时间
let bindLinked = null;  // null=未知 / true=已关联 / false=未关联
let bindTimer = null;   // 关联状态轮询定时器

// 跨设备登录（H5↔H5）：本设备生成的 6 位登录码
let syncCode = '';      // 当前展示的 6 位登录码
let syncExpire = 0;     // 登录码过期时间

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="meBody"></div>';
  const body = root.querySelector('#meBody');
  body.addEventListener('click', (e) => onAction(e, body, app));
  body.addEventListener('change', (e) => onAvatarChange(e, body));
  bindCode = '';
  bindExpire = 0;
  bindLinked = null;
  syncCode = '';
  syncExpire = 0;
  stopPoll();
  paint(body);
  syncFromServer(body);   // 静默与服务端对齐昵称 / 掩码
  refreshLink(body);      // 静默查询是否已关联小程序
}

/** 文件选择：选中头像图片后压缩并仅存本机 */
async function onAvatarChange(e, body) {
  const t = e.target;
  if (!t || t.id !== 'meAvatar' || !t.files || !t.files[0]) {
    return;
  }
  try {
    toast('处理图片中…');
    const url = await readAvatarFile(t.files[0]);
    setProfile({ nickName: getProfile().nickName, avatarUrl: url });
    paint(body);
    toast('头像已更新（仅本机显示）');
  } catch (err) {
    toast((err && err.message) || '头像设置失败');
  }
  t.value = '';
}

/** 账户码掩码：前 4 后 4，中间打点 */
function maskCode(id) {
  const v = String(id || '');
  return v.length > 8 ? v.slice(0, 4) + '····' + v.slice(-4) : v;
}

/** 头像：有本机上传的图片则显示图片，否则退回昵称首字（图片仅存本机、不上传） */
function avatarInner(profile) {
  const avatarUrl = (profile && profile.avatarUrl) || '';
  if (avatarUrl) {
    return '<img class="wre-avatar__img" src="' + esc(avatarUrl) + '" alt="头像" />';
  }
  const chars = Array.from(String((profile && profile.nickName) || '').trim());
  return esc(chars.length ? chars[0] : '微');
}

function paint(body) {
  const mask = getMask() || {};
  const profile = getProfile();
  const deviceId = getDeviceId();
  const hasAvatar = !!profile.avatarUrl;

  body.innerHTML =
    '<div class="wre-card">' +
    '  <div class="wre-account">' +
    '    <div class="wre-avatar">' + avatarInner(profile) + '</div>' +
    '    <div class="wre-account__meta">' +
    '      <div class="wre-account__name">' + esc(profile.nickName || '未命名用户') + '</div>' +
    '      <div class="wre-account__id">账户码 ' + esc(maskCode(deviceId)) + '</div>' +
    '    </div>' +
    '    <button class="wre-account__out" data-action="sign-out">退出登录</button>' +
    '  </div>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">API Key</div>' +
    '  <div class="wre-muted">Key 只提交一次给你自己的云函数加密托管，之后本机只带账户码，不再下发明文；可随时清除。</div>' +
    connRow('wrk', '微信读书 Key', mask.hasKey, mask.masked) +
    connRow('ai', 'DeepSeek Key（可选）', mask.hasAiKey, mask.aiMasked) +
    '  <div class="wre-hint">不知道去哪找 Key？用豆包等 AI 工具搜一句「怎么获取微信读书 / DeepSeek 的 API Key」，跟着做就行，不难。</div>' +
    (openForm ? keyForm(openForm) : '') +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">跨设备登录</div>' +
    '  <div class="wre-muted">账户码就是你的账户身份，不含任何个人信息。换设备时输入它即可找回同一份托管 Key 与昵称；若你先在小程序使用，可在小程序「关联网页账户 → 获取我的账户码」里取到它，粘贴到这里登录即可统一。</div>' +
    '  <div class="wre-code">' + esc(showCode ? deviceId : maskCode(deviceId)) + '</div>' +
    '  <div class="wre-btn-row">' +
    '    <button class="wre-btn wre-btn--ghost" data-action="toggle-code">' + (showCode ? '隐藏' : '显示完整') + '</button>' +
    '    <button class="wre-btn wre-btn--ghost" data-action="copy-device">复制</button>' +
    '  </div>' +
    '  <input class="wre-input" id="meSync" placeholder="粘贴另一台设备的账户码" />' +
    '  <button class="wre-btn" data-action="restore-device">用账户码登录</button>' +
    '  <div class="wre-hint">或者用更短的 6 位登录码（同一 WiFi / 两台设备更方便）</div>' +
    syncCodeBox() +
    '  <input class="wre-input" id="meLoginCode" inputmode="numeric" maxlength="6" placeholder="输入另一台设备的 6 位登录码" />' +
    '  <button class="wre-btn" data-action="redeem-login">用 6 位码登录</button>' +
    '</div>' +

    bindCard() +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">我的资料（可选）</div>' +
    '  <div class="wre-muted">昵称随账户同步，换设备不用重填；头像只存本机、不上传服务器。</div>' +
    '  <div class="wre-profile">' +
    '    <div class="wre-profile__avatar">' + avatarInner(profile) + '</div>' +
    '    <input class="wre-profile__nick" id="meNick" maxlength="24" placeholder="点击填写昵称" value="' + esc(profile.nickName) + '" />' +
    '  </div>' +
    '  <div class="wre-btn-row">' +
    '    <button class="wre-btn wre-btn--ghost" data-action="save-profile">保存昵称</button>' +
    '    <button class="wre-btn wre-btn--ghost" data-action="pick-avatar">' + (hasAvatar ? '更换头像' : '上传头像') + '</button>' +
    (hasAvatar ? '    <button class="wre-btn wre-btn--ghost" data-action="remove-avatar">移除头像</button>' : '') +
    '  </div>' +
    '  <input type="file" id="meAvatar" accept="image/*" hidden />' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">文字大小</div>' +
    '  <div class="wre-muted">调大后全站文字一起放大，方便在手机上看清；只存本机。</div>' +
    fsModes() +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">外观</div>' +
    '  <div class="wre-muted">默认跟随系统明暗；也可手动固定为浅色或深色。只存本机。</div>' +
    themeModes() +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">更多</div>' +
    linkRow('🗂 每日卡片 · 往期回顾', 'open-daily') +
    linkRow('🧭 灵感漫游 · 往期归档', 'open-wander') +
    linkRow('📊 运营看板', 'open-admin') +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">危险操作</div>' +
    '  <div class="wre-muted">仅清除云端托管的 Key，昵称与账户保留；清除后需重新填写。</div>' +
    '  <button class="wre-btn wre-btn--danger" data-action="clear-key">清除托管 Key</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">关于版本</div>' +
    '  <div class="wre-muted">本页是「微信悦读 · 满血版」，完整提供 AI 深度解析：AI 人格画像、每日卡片、灵感漫游主题综述。微信小程序版为合规精简版，只在手机本机按规则展示你的阅读数据，不涉及任何 AI 深度解析。你的阅读数据始终在本机计算，两版互不影响。</div>' +
    '</div>' +

    '<div class="wre-note">微信悦读 H5 · 数据与人格全部在你的浏览器本机计算；Key 由你自建的云函数加密托管，昵称托管后可跨设备同步，两者都能一键清除。</div>';
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

/** 「已连接」列表行 */
function connRow(kind, name, on, masked) {
  return (
    '<div class="wre-conn">' +
    '  <div class="wre-conn__main">' +
    '    <div class="wre-conn__name">' + esc(name) + '</div>' +
    '    <div class="wre-conn__val' + (on ? ' is-on' : '') + '">' + esc(on ? (masked || '已连接') : '未连接') + '</div>' +
    '  </div>' +
    '  <button class="wre-conn__btn" data-action="toggle-form" data-kind="' + kind + '">' +
    (on ? '更换' : '配置') + '</button>' +
    '</div>'
  );
}

/** 展开的 Key 输入区 */
function keyForm(kind) {
  if (kind === 'wrk') {
    return (
      '<div class="wre-form">' +
      '  <input class="wre-input" id="meWrk" type="password" autocomplete="off" placeholder="粘贴 wrk- 开头的微信读书 Key" />' +
      '  <div class="wre-hint">获取方式：微信读书 App →「我」→「微信读书 Skill」页面 → 复制 wrk- 开头的 API Key。</div>' +
      '  <button class="wre-btn" data-action="save-wrk">保存并校验</button>' +
      '</div>'
    );
  }
  return (
    '<div class="wre-form">' +
    '  <input class="wre-input" id="meAi" type="password" autocomplete="off" placeholder="粘贴 sk- 开头的 DeepSeek Key" />' +
    '  <div class="wre-hint">获取方式：登录 DeepSeek 开放平台 platform.deepseek.com → API Keys → 新建并复制 sk- 开头的 Key（用于 AI 阅读画像）。</div>' +
    '  <button class="wre-btn" data-action="save-ai">保存 DeepSeek Key</button>' +
    '</div>'
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

/** 关联小程序卡片：已关联 / 展示绑定码 / 未关联 三态 */
function bindCard() {
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
    '<div class="wre-card">' +
    '  <div class="wre-card__title">关联微信小程序</div>' +
    '  <div class="wre-muted">关联后，小程序与网页共用同一份阅读人格与昵称。</div>' +
    inner +
    '</div>'
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

/** 静默对齐服务端：昵称以服务端为准，掩码刷新 */
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
  if (res.nickName && res.nickName !== getProfile().nickName) {
    setProfile({ nickName: res.nickName, avatarUrl: getProfile().avatarUrl });
  }
  paint(body);
}

async function onAction(e, body, app) {
  const btn = e.target.closest('[data-action]');
  if (!btn) {
    return;
  }
  const action = btn.getAttribute('data-action');

  if (action === 'toggle-form') {
    const kind = btn.getAttribute('data-kind');
    openForm = openForm === kind ? '' : kind;
    paint(body);
    const input = body.querySelector(openForm === 'wrk' ? '#meWrk' : '#meAi');
    if (input) {
      input.focus();
    }
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

  if (action === 'save-profile') {
    const input = body.querySelector('#meNick');
    const nickName = (input && input.value || '').trim();
    setProfile({ nickName: nickName, avatarUrl: getProfile().avatarUrl });
    const res = await profileSave(nickName);
    toast(res.ok ? '昵称已保存并同步' : ('已存本机，云端同步失败：' + (res.error || '请稍后重试')));
    paint(body);
    return;
  }

  if (action === 'pick-avatar') {
    const f = body.querySelector('#meAvatar');
    if (f) { f.click(); }
    return;
  }

  if (action === 'remove-avatar') {
    setProfile({ nickName: getProfile().nickName, avatarUrl: '' });
    paint(body);
    toast('已移除头像');
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
    app.go('daily');
    return;
  }

  if (action === 'open-wander') {
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
