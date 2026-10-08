/**
 * 微信悦读 · 官网「我的账户」页
 *
 * 与网页版（/app/）共用同一套账户与登录系统：
 *   - 同一存储键（wre_account_*）→ 同一 localStorage → 登录态天然互通，无需同步；
 *   - 直接复用网页版（/app/src/）的 store / api / ui 模块 —— 单一实现，避免两套逻辑漂移。
 *
 * 红线：微信读书 Key 只交服务端加密托管，本机只留掩码；本页不回显明文。
 */

import { esc, copyText, confirmSignOut } from '/app/src/ui.js';
import {
  getDeviceId, setDeviceId, resetDeviceId,
  getMask, setMask, getProfile, setProfile, readAvatarFile,
} from '/app/src/store.js';
import { keyGet, keySave, keyClear, verifyKey, profileSave, bindCreate, bindStatus, bindRemove } from '/app/src/api.js';
import { qrSvg } from '/app/src/qrcode.js';

const root = document.getElementById('acctRoot');

let openForm = '';      // '' | 'wrk' | 'ai'
let showCode = false;

// 关联小程序（跨端打通）状态
let bindCode = '';      // 当前展示的一次性绑定码（6 位）
let bindExpire = 0;     // 绑定码过期时间
let bindLinked = null;  // null=未知 / true=已关联 / false=未关联
let bindTimer = null;   // 关联状态轮询定时器

/** 账户码默认掩码显示（前 4 后 4） */
function maskCode(id) {
  const v = String(id || '');
  return v.length > 8 ? v.slice(0, 4) + '····' + v.slice(-4) : v;
}

/** 头像：有自定义图片则显示图片，否则退回昵称首字（图片仅存本机） */
function avatarInner(profile) {
  const avatarUrl = (profile && profile.avatarUrl) || '';
  if (avatarUrl) {
    return '<img class="acct-avatar__img" src="' + esc(avatarUrl) + '" alt="头像">';
  }
  const chars = Array.from(String((profile && profile.nickName) || '').trim());
  return esc(chars.length ? chars[0] : '微');
}

/** 极简提示条（沿用官网站点样式） */
let toastTimer = null;
function toast(message) {
  let node = document.getElementById('acctToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'acctToast';
    node.className = 'acct-toast';
    document.body.appendChild(node);
  }
  node.textContent = String(message || '');
  node.classList.add('is-show');
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(function () {
    node.classList.remove('is-show');
  }, 2400);
}

function connRow(kind, name, has, masked, actionLabel) {
  const val = has ? ('已连接 · ' + esc(masked || '已配置')) : '未配置';
  return '<div class="acct-row">' +
    '<div class="acct-row__main">' +
    '<div class="acct-row__name">' + esc(name) + '</div>' +
    '<div class="acct-row__val' + (has ? ' is-on' : '') + '">' + val + '</div>' +
    '</div>' +
    '<button class="acct-link" type="button" data-act="toggle-form" data-kind="' + kind + '">' +
    esc(actionLabel) + '</button>' +
    '</div>' + keyForm(kind);
}

function keyForm(kind) {
  const placeholder = kind === 'wrk' ? 'wrk-…' : 'sk-…';
  const hint = kind === 'wrk'
    ? '在微信读书网页版打开任一本书，于开发者工具中找到 wrk- 开头的 Key。'
    : '在 DeepSeek 开放平台创建，供阅读人格 / 报告 / 灵感漫游的 AI 解读使用。';
  return '<div class="acct-form"' + (openForm === kind ? '' : ' hidden') + '>' +
    '<input class="acct-input" id="acctInput-' + kind + '" type="password" autocomplete="off" ' +
    'spellcheck="false" placeholder="' + esc(placeholder) + '">' +
    '<div class="acct-form__actions">' +
    '<button class="acct-btn" type="button" data-act="save-key" data-kind="' + kind + '">保存</button>' +
    '<button class="acct-btn acct-btn--ghost" type="button" data-act="cancel-form">取消</button>' +
    '</div>' +
    '<p class="acct-hint">' + hint + '</p>' +
    '</div>';
}

function render() {
  if (!root) {
    return;
  }
  const id = getDeviceId();
  const profile = getProfile();
  const nickName = profile.nickName || '';
  const hasAvatar = !!profile.avatarUrl;
  const mask = getMask() || {};
  const shownCode = showCode ? id : maskCode(id);

  root.innerHTML =
    '<section class="acct-hero">' +
    '<div class="acct-avatar">' + avatarInner(profile) + '</div>' +
    '<div class="acct-hero__meta">' +
    '<div class="acct-name">' + (nickName ? esc(nickName) : '未设置昵称') + '</div>' +
    '<div class="acct-code">账户码 ' + esc(maskCode(id)) + '</div>' +
    '</div>' +
    '<button class="acct-btn acct-btn--ghost" type="button" data-act="sign-out">退出登录</button>' +
    '</section>' +

    '<section class="acct-card">' +
    '<h2 class="acct-card__title">已连接</h2>' +
    connRow('wrk', '微信读书 Key', !!mask.hasKey, mask.masked, '更换 / 填写') +
    connRow('ai', 'DeepSeek Key（可选）', !!mask.hasAiKey, mask.aiMasked, '更换 / 填写') +
    '</section>' +

    '<section class="acct-card">' +
    '<h2 class="acct-card__title">跨设备登录</h2>' +
    '<p class="acct-hint">账户码就是你的账号 + 登录凭证，请自行妥善保存；' +
    '在别的设备（含手机网页版）填它即可找回 Key 与昵称。若你先在小程序使用，' +
    '可在小程序「关联网页账户 → 获取我的账户码」里取到它，粘贴到下方登录即可统一。</p>' +
    '<div class="acct-codebox">' +
    '<code class="acct-codebox__val">' + esc(shownCode) + '</code>' +
    '<button class="acct-link" type="button" data-act="toggle-code">' + (showCode ? '隐藏' : '显示完整') + '</button>' +
    '<button class="acct-link" type="button" data-act="copy-code">复制</button>' +
    '</div>' +
    '<div class="acct-inline">' +
    '<input class="acct-input" id="acctCodeInput" type="text" autocomplete="off" ' +
    'spellcheck="false" placeholder="粘贴 32 位账户码">' +
    '<button class="acct-btn" type="button" data-act="restore">用账户码登录</button>' +
    '</div>' +
    '</section>' +

    bindSection() +

    '<section class="acct-card">' +
    '<h2 class="acct-card__title">我的资料</h2>' +
    '<div class="acct-profile">' +
    '<div class="acct-profile__avatar">' + avatarInner(profile) + '</div>' +
    '<div class="acct-profile__ops">' +
    '<button class="acct-btn acct-btn--ghost" type="button" data-act="pick-avatar">' + (hasAvatar ? '更换头像' : '上传头像') + '</button>' +
    (hasAvatar ? '<button class="acct-link" type="button" data-act="remove-avatar">移除头像</button>' : '') +
    '</div>' +
    '<input class="acct-file" id="acctAvatarInput" type="file" accept="image/*" hidden>' +
    '</div>' +
    '<div class="acct-inline">' +
    '<input class="acct-input" id="acctNickInput" type="text" maxlength="24" autocomplete="off" ' +
    'placeholder="昵称（用于分享署名）" value="' + esc(nickName) + '">' +
    '<button class="acct-btn" type="button" data-act="save-profile">保存昵称</button>' +
    '</div>' +
    '<p class="acct-hint">头像只在你的浏览器本机显示，不会上传到服务器；昵称随账户同步。</p>' +
    '</section>' +

    '<section class="acct-card acct-card--danger">' +
    '<h2 class="acct-card__title">危险操作</h2>' +
    '<button class="acct-btn acct-btn--danger" type="button" data-act="clear-key">清除托管在云端的 Key</button>' +
    '<p class="acct-hint">只清云端 Key，不影响昵称与阅读数据。</p>' +
    '</section>' +

    '<p class="acct-foot">这是与网页版共用的同一个账户，手机上可打开 ' +
    '<a href="/app/">网页版 →</a></p>';
}

/** 关联小程序区块：已关联 / 展示绑定码 / 未关联 三态 */
function bindSection() {
  let inner;
  if (bindLinked === true) {
    inner = '<div class="acct-row">' +
      '<div class="acct-row__main">' +
      '<div class="acct-row__name">微信小程序</div>' +
      '<div class="acct-row__val is-on">已关联</div>' +
      '</div>' +
      '<button class="acct-link" type="button" data-act="remove-bind">解除</button>' +
      '</div>';
  } else if (bindCode && Date.now() < bindExpire) {
    inner = '<div class="acct-bindcode">' + esc(bindCode) + '</div>' +
      '<div class="acct-qr">' + qrSvg(bindCode) + '</div>' +
      '<p class="acct-hint">打开微信小程序「我的 → 关联网页账户」，点「扫一扫」扫码；也可手动输入上方 6 位数字（10 分钟内有效）。</p>' +
      '<button class="acct-btn acct-btn--ghost" type="button" data-act="gen-bind">重新生成</button>';
  } else {
    const expired = bindCode && Date.now() >= bindExpire;
    inner = (expired ? '<p class="acct-hint">绑定码已过期，请重新生成。</p>' : '') +
      '<button class="acct-btn" type="button" data-act="gen-bind">生成绑定码</button>' +
      '<p class="acct-hint">也可点上方「复制」，把完整账户码粘贴到小程序里关联。</p>';
  }
  return '<section class="acct-card">' +
    '<h2 class="acct-card__title">关联微信小程序</h2>' +
    '<p class="acct-hint">关联后，小程序与网页共用同一份阅读人格与昵称。</p>' +
    inner +
    '</section>';
}

/** 轮询关联状态：用户在小程序里绑定后，本页自动切换为「已关联」 */
function startPoll() {
  stopPoll();
  bindTimer = setInterval(async function () {
    if (!document.getElementById('acctRoot')) {
      stopPoll();
      return;
    }
    if (Date.now() >= bindExpire) {
      stopPoll();
      render();
      return;
    }
    const res = await bindStatus();
    if (res && res.ok && res.linked) {
      bindLinked = true;
      stopPoll();
      render();
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

async function refreshLink() {
  const res = await bindStatus();
  if (!res || !res.ok) {
    return;
  }
  bindLinked = !!res.linked;
  if (bindLinked) {
    stopPoll();
  }
  render();
}

async function genBind() {
  const res = await bindCreate();
  if (!res || !res.ok) {
    toast((res && res.error) || '生成失败，请稍后重试');
    return;
  }
  bindCode = res.code || '';
  bindExpire = res.expireAt || 0;
  render();
  startPoll();
}

async function removeBind() {
  if (!window.confirm('确定解除与微信小程序的关联吗？解除后两端将各自独立，当前账户数据保留。')) {
    return;
  }
  const res = await bindRemove();
  if (!res || !res.ok) {
    toast((res && res.error) || '解除失败，请稍后重试');
    return;
  }
  bindLinked = false;
  bindCode = '';
  stopPoll();
  render();
  toast('已解除关联');
}

/** 从服务端拉取掩码与昵称（账号 = 本机账户码） */
async function syncFromServer() {
  const res = await keyGet();
  if (res && res.ok) {
    setMask({
      masked: res.masked || '',
      hasKey: !!res.hasKey,
      aiMasked: res.aiMasked || '',
      hasAiKey: !!res.hasAiKey,
    });
    if (res.nickName) {
      setProfile({ nickName: res.nickName, avatarUrl: getProfile().avatarUrl });
    }
  }
  render();
}

async function saveKey(kind) {
  const input = document.getElementById('acctInput-' + kind);
  const value = input ? String(input.value || '').trim() : '';
  if (!value) {
    toast('请先填写 Key');
    return;
  }
  if (kind === 'wrk' && value.indexOf('wrk-') !== 0) {
    toast('微信读书 Key 应以 wrk- 开头');
    return;
  }
  if (kind === 'ai' && value.indexOf('sk-') !== 0) {
    toast('DeepSeek Key 应以 sk- 开头');
    return;
  }
  toast('保存中…');
  const res = kind === 'wrk' ? await keySave(value, '') : await keySave('', value);
  if (!res || !res.ok) {
    toast((res && res.error) || '保存失败');
    return;
  }
  if (input) {
    input.value = '';   // 不留明文
  }
  openForm = '';
  if (kind === 'wrk') {
    toast('已保存，正在校验…');
    const v = await verifyKey();
    toast(v && v.ok ? '已连接' : '已保存，但校验未通过：' + ((v && v.error) || '未知原因'));
  } else {
    toast('已保存');
  }
  await syncFromServer();
}

async function restoreCode() {
  const input = document.getElementById('acctCodeInput');
  const code = input ? String(input.value || '').trim().toLowerCase() : '';
  if (!code) {
    toast('请填写账户码');
    return;
  }
  if (!/^[0-9a-f]{32}$/.test(code)) {
    toast('账户码应为 32 位十六进制字符');
    return;
  }
  if (code === getDeviceId()) {
    toast('这就是当前账户码');
    return;
  }
  if (!window.confirm(
    '确定切换到账户 ' + maskCode(code) + ' 吗？\n\n' +
    '当前账户 ' + maskCode(getDeviceId()) + ' 的数据仍保存在云端，之后用它的账户码可再登回。'
  )) {
    return;
  }
  if (!setDeviceId(code)) {
    toast('账户码无效');
    return;
  }
  showCode = false;
  await syncFromServer();
  toast('已切换账户');
}

async function saveProfile() {
  const input = document.getElementById('acctNickInput');
  const name = input ? String(input.value || '').trim().slice(0, 24) : '';
  toast('保存中…');
  const res = await profileSave(name);
  if (!res || !res.ok) {
    toast((res && res.error) || '保存失败');
    return;
  }
  setProfile({ nickName: name, avatarUrl: getProfile().avatarUrl });
  render();
  toast(name ? '昵称已保存' : '昵称已清空');
}

/** 选择头像：读本地图片 → 压缩 → 仅存本机 */
async function pickAvatar(file) {
  try {
    toast('处理图片中…');
    const url = await readAvatarFile(file);
    setProfile({ nickName: getProfile().nickName, avatarUrl: url });
    render();
    toast('头像已更新（仅本机显示）');
  } catch (e) {
    toast((e && e.message) || '头像设置失败');
  }
}

/** 移除头像，退回昵称首字 */
function removeAvatar() {
  setProfile({ nickName: getProfile().nickName, avatarUrl: '' });
  render();
  toast('已移除头像');
}

async function clearKey() {
  if (!window.confirm('确定清除云端托管的 Key 吗？不影响昵称与阅读数据。')) {
    return;
  }
  toast('清除中…');
  const res = await keyClear();
  if (!res || !res.ok) {
    toast((res && res.error) || '清除失败');
    return;
  }
  setMask(null);
  render();
  toast('已清除云端 Key');
}

async function signOut() {
  // 退出前先让用户保存账户码（账户码是找回该账户的唯一凭证，退出后本机不再持有）
  const ok = await confirmSignOut(getDeviceId());
  if (!ok) {
    return;
  }
  resetDeviceId();
  openForm = '';
  showCode = false;
  render();
  syncFromServer();
  toast('已退出，当前为新账户');
}

function onAction(e) {
  const btn = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!btn) {
    return;
  }
  const act = btn.getAttribute('data-act');
  if (act === 'toggle-form') {
    const kind = btn.getAttribute('data-kind');
    openForm = openForm === kind ? '' : kind;
    render();
    const input = document.getElementById('acctInput-' + kind);
    if (input && openForm === kind) {
      input.focus();
    }
    return;
  }
  if (act === 'cancel-form') { openForm = ''; render(); return; }
  if (act === 'toggle-code') { showCode = !showCode; render(); return; }
  if (act === 'copy-code') {
    copyText(getDeviceId()).then(function (ok) {
      toast(ok ? '账户码已复制，请妥善保存' : '复制失败，请手动记录');
    });
    return;
  }
  if (act === 'save-key') { saveKey(btn.getAttribute('data-kind')); return; }
  if (act === 'restore') { restoreCode(); return; }
  if (act === 'save-profile') { saveProfile(); return; }
  if (act === 'pick-avatar') {
    const f = document.getElementById('acctAvatarInput');
    if (f) { f.click(); }
    return;
  }
  if (act === 'remove-avatar') { removeAvatar(); return; }
  if (act === 'clear-key') { clearKey(); return; }
  if (act === 'gen-bind') { genBind(); return; }
  if (act === 'remove-bind') { removeBind(); return; }
  if (act === 'sign-out') { signOut(); return; }
}

function onKeydown(e) {
  if (e.key !== 'Enter') {
    return;
  }
  const t = e.target;
  if (!t || !t.id) {
    return;
  }
  if (t.id === 'acctInput-wrk' || t.id === 'acctInput-ai') {
    saveKey(t.id.indexOf('wrk') >= 0 ? 'wrk' : 'ai');
  } else if (t.id === 'acctCodeInput') {
    restoreCode();
  } else if (t.id === 'acctNickInput') {
    saveProfile();
  }
}

/** 文件选择：选中头像图片后立即处理 */
function onRootChange(e) {
  const t = e.target;
  if (t && t.id === 'acctAvatarInput' && t.files && t.files[0]) {
    pickAvatar(t.files[0]);
    t.value = '';
  }
}

if (root) {
  bindCode = '';
  bindExpire = 0;
  bindLinked = null;
  stopPoll();
  render();
  root.addEventListener('click', onAction);
  root.addEventListener('keydown', onKeydown);
  root.addEventListener('change', onRootChange);
  syncFromServer();
  refreshLink();
}
