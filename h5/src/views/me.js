/**
 * 「我的」页：Key 托管（H1）+ 中转地址配置 + 本机署名（H9）
 *
 * 红线：Key 明文只提交一次给服务端加密托管，本机只保存掩码；
 *      提交后不再持有明文（输入框提交即清空）。
 */

import { keySave, keyGet, keyClear, verifyKey } from '../api.js';
import { getEndpoint, setEndpoint, getMask, setMask, getProfile, setProfile, getDeviceId } from '../store.js';
import { esc, toast, copyText } from '../ui.js';

export const title = '我的';

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="meBody"></div>';
  const body = root.querySelector('#meBody');
  body.addEventListener('click', (e) => onAction(e, body, app));
  paint(body);
}

function paint(body) {
  const mask = getMask();
  const profile = getProfile();
  const endpoint = getEndpoint();
  const deviceId = getDeviceId();

  body.innerHTML =
    '<div class="wre-card">' +
    '  <div class="wre-card__title">微信读书 Key</div>' +
    '  <div class="wre-muted">Key 只提交一次给你自己的云函数加密托管，之后本机只带 deviceId，不再下发明文；可随时清除。</div>' +
    (mask && mask.hasKey
      ? '  <div class="wre-status">已配置 · ' + esc(mask.masked || 'wrk-****') + '</div>'
      : '  <div class="wre-status wre-status--off">未配置</div>') +
    '  <input class="wre-input" id="meWrk" type="password" autocomplete="off" placeholder="粘贴 wrk- 开头的微信读书 Key" />' +
    '  <button class="wre-btn" data-action="save-wrk">' + (mask && mask.hasKey ? '更新微信读书 Key' : '保存并校验') + '</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">DeepSeek Key（可选）</div>' +
    '  <div class="wre-muted">用于 H10 人格画像 / H11 每日卡片 / H12 灵感漫游等 AI 功能；留空不影响数据与人格展示。</div>' +
    (mask && mask.hasAiKey
      ? '  <div class="wre-status">已配置 · ' + esc(mask.aiMasked || 'sk-****') + '</div>'
      : '  <div class="wre-status wre-status--off">未配置</div>') +
    '  <input class="wre-input" id="meAi" type="password" autocomplete="off" placeholder="粘贴 sk- 开头的 DeepSeek Key（可选）" />' +
    '  <button class="wre-btn wre-btn--ghost" data-action="save-ai">保存 DeepSeek Key</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">署名（仅本机）</div>' +
    '  <div class="wre-muted">仅保存在这台设备，用于以后分享图署名，不会上传。</div>' +
    '  <input class="wre-input" id="meNick" maxlength="24" placeholder="昵称" value="' + esc(profile.nickName) + '" />' +
    '  <button class="wre-btn wre-btn--ghost" data-action="save-profile">保存昵称</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">中转服务地址</div>' +
    '  <div class="wre-muted">云函数 wereadProxy 的「HTTP 访问服务」地址（形如 https://xxx.service.tcloudbase.com/h5）。部署步骤见 h5/README.md。</div>' +
    '  <input class="wre-input" id="meEndpoint" placeholder="https://.../h5" value="' + esc(endpoint) + '" />' +
    '  <button class="wre-btn wre-btn--ghost" data-action="save-endpoint">保存地址并重载</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">本机标识（deviceId）</div>' +
    '  <div class="wre-muted">随机生成、非个人信息，用于让服务端记住你的 Key。换设备时复制它即可找回（P2 同步码）。</div>' +
    '  <div class="wre-code">' + esc(deviceId) + '</div>' +
    '  <button class="wre-btn wre-btn--ghost" data-action="copy-device">复制 deviceId</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">危险操作</div>' +
    '  <button class="wre-btn wre-btn--danger" data-action="clear-key">清除托管 Key</button>' +
    '</div>' +

    '<div class="wre-card">' +
    '  <div class="wre-card__title">关于版本</div>' +
    '  <div class="wre-muted">本页是「微信悦读 · 满血版」，完整提供 AI 深度解析：AI 人格画像、每日卡片、灵感漫游主题综述。微信小程序版为合规精简版，只在手机本机按规则展示你的阅读数据，不涉及任何 AI 深度解析。你的阅读数据始终在本机计算，两版互不影响。</div>' +
    '</div>' +

    '<div class="wre-note">微信悦读 H5 · 数据与人格全部在你的浏览器本机计算；Key 由你自建的云函数加密托管，可一键清除。</div>';
}

async function onAction(e, body, app) {
  const btn = e.target.closest('[data-action]');
  if (!btn) {
    return;
  }
  const action = btn.getAttribute('data-action');

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
    if (!check.ok) {
      toast('已保存，但校验未通过：' + (check.error || '请确认 Key 有效'));
    } else {
      toast('已保存并校验通过');
    }
    btn.disabled = false;
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
    paint(body);
    return;
  }

  if (action === 'save-profile') {
    const input = body.querySelector('#meNick');
    setProfile({ nickName: (input && input.value || '').trim(), avatarUrl: getProfile().avatarUrl });
    toast('已保存到本机');
    return;
  }

  if (action === 'save-endpoint') {
    const input = body.querySelector('#meEndpoint');
    const url = (input && input.value || '').trim();
    if (url && !/^https?:\/\//.test(url)) {
      toast('地址需以 http:// 或 https:// 开头');
      return;
    }
    setEndpoint(url);
    toast('已保存，正在重载…');
    setTimeout(() => location.reload(), 600);
    return;
  }

  if (action === 'copy-device') {
    const ok = await copyText(getDeviceId());
    toast(ok ? '已复制' : '复制失败，请手动选择');
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
