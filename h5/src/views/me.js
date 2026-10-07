/**
 * 「我的账户」页：账户总览 + Key 托管（H1）+ 昵称托管 + 跨设备登录（H8）+ 运营入口
 *
 * 账户模型：deviceId 即账户（32 位随机码，浏览器本机生成，服务端按它认人）；
 *   「账户码」就是它，换设备输入即可登录同一账户（未来可在此挂 openid 做微信登录）。
 *
 * 红线：Key 明文只提交一次给服务端加密托管，本机只保存掩码；提交后不再持有明文。
 *      昵称非敏感、可托管；头像不上传图片，用昵称首字渲染。
 *      完整账户码等同一把钥匙，默认只显示掩码，点「显示完整」才展开。
 */

import { keySave, keyClear, verifyKey, keyGet, profileSave } from '../api.js';
import { getMask, setMask, getProfile, setProfile, getDeviceId, setDeviceId, resetDeviceId } from '../store.js';
import { esc, toast, copyText } from '../ui.js';

export const title = '我的账户';

let openForm = '';    // '' | 'wrk' | 'ai'：当前展开的 Key 输入区
let showCode = false; // 是否展开完整账户码

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="meBody"></div>';
  const body = root.querySelector('#meBody');
  body.addEventListener('click', (e) => onAction(e, body, app));
  paint(body);
  syncFromServer(body);   // 静默与服务端对齐昵称 / 掩码
}

/** 账户码掩码：前 4 后 4，中间打点 */
function maskCode(id) {
  const v = String(id || '');
  return v.length > 8 ? v.slice(0, 4) + '····' + v.slice(-4) : v;
}

/** 头像用昵称首字（不上传图片） */
function avatarChar(nickName) {
  const chars = Array.from(String(nickName || '').trim());
  return chars.length ? chars[0] : '微';
}

function paint(body) {
  const mask = getMask() || {};
  const profile = getProfile();
  const deviceId = getDeviceId();

  body.innerHTML =
    '<div class="wre-card">' +
    '  <div class="wre-account">' +
    '    <div class="wre-avatar">' + esc(avatarChar(profile.nickName)) + '</div>' +
    '    <div class="wre-account__meta">' +
    '      <div class="wre-account__name">' + esc(profile.nickName || '未命名用户') + '</div>' +
    '      <div class="wre-account__id">账户码 ' + esc(maskCode(deviceId)) + '</div>' +
    '    </div>' +
    '    <button class="wre-account__out" data-action="sign-out">退出登录</button>' +
    '  </div>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">已连接</div>' +
    connRow('wrk', '微信读书 Key', mask.hasKey, mask.masked) +
    connRow('ai', 'DeepSeek Key（可选）', mask.hasAiKey, mask.aiMasked) +
    (openForm ? keyForm(openForm) : '') +
    '  <div class="wre-hint">Key 只提交一次给你自己的云函数加密托管，之后本机只带账户码，不再下发明文；可随时清除。</div>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">跨设备登录</div>' +
    '  <div class="wre-muted">账户码就是你的账户身份，不含任何个人信息。换手机时，在新设备输入它即可找回同一份托管 Key 与昵称。</div>' +
    '  <div class="wre-code">' + esc(showCode ? deviceId : maskCode(deviceId)) + '</div>' +
    '  <div class="wre-btn-row">' +
    '    <button class="wre-btn wre-btn--ghost" data-action="toggle-code">' + (showCode ? '隐藏' : '显示完整') + '</button>' +
    '    <button class="wre-btn wre-btn--ghost" data-action="copy-device">复制</button>' +
    '  </div>' +
    '  <input class="wre-input" id="meSync" placeholder="粘贴另一台设备的账户码" />' +
    '  <button class="wre-btn" data-action="restore-device">用账户码登录</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">我的资料</div>' +
    '  <div class="wre-muted">昵称会随账户同步，换设备不用重填；头像用昵称首字显示，不上传图片。</div>' +
    '  <input class="wre-input" id="meNick" maxlength="24" placeholder="昵称" value="' + esc(profile.nickName) + '" />' +
    '  <button class="wre-btn wre-btn--ghost" data-action="save-profile">保存昵称</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">危险操作</div>' +
    '  <button class="wre-btn wre-btn--danger" data-action="clear-key">清除托管 Key</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">运营看板</div>' +
    '  <div class="wre-muted">查看小程序 / 插件 / H5 的匿名使用量汇总。已按账户码自动识别管理员，无需口令；仅运营人员需要。</div>' +
    '  <button class="wre-btn wre-btn--ghost" data-action="open-admin">打开运营看板</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">关于版本</div>' +
    '  <div class="wre-muted">本页是「微信悦读 · 满血版」，完整提供 AI 深度解析：AI 人格画像、每日卡片、灵感漫游主题综述。微信小程序版为合规精简版，只在手机本机按规则展示你的阅读数据，不涉及任何 AI 深度解析。你的阅读数据始终在本机计算，两版互不影响。</div>' +
    '</div>' +

    '<div class="wre-note">微信悦读 H5 · 数据与人格全部在你的浏览器本机计算；Key 由你自建的云函数加密托管，昵称托管后可跨设备同步，两者都能一键清除。</div>';
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
    '  <button class="wre-btn" data-action="save-ai">保存 DeepSeek Key</button>' +
    '</div>'
  );
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

  if (action === 'copy-device') {
    const ok = await copyText(getDeviceId());
    toast(ok ? '账户码已复制' : '复制失败，请手动选择');
    return;
  }

  if (action === 'restore-device') {
    const input = body.querySelector('#meSync');
    const code = (input && input.value || '').trim();
    if (code === getDeviceId()) {
      toast('这就是当前账户，无需登录');
      return;
    }
    if (!setDeviceId(code)) {
      toast('账户码格式不正确（应为 32 位十六进制）');
      return;
    }
    toast('已登录，正在重载…');
    setTimeout(() => location.reload(), 600);
    return;
  }

  if (action === 'sign-out') {
    if (!window.confirm('退出登录后，本机将切换为一个全新的空账户；原账户与托管 Key 仍在服务端，可用账户码再次登录。确定退出吗？')) {
      return;
    }
    resetDeviceId();
    toast('已退出，正在重载…');
    setTimeout(() => location.reload(), 600);
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
