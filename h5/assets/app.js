/**
 * H5 应用外壳：路由（五栏 Tab）+ 拦截态（未配中转地址 / 未配 Key）
 *
 * 五栏：首页 / 人格 / 报告 / 书架 / 我的（对齐小程序 tabBar）。
 */

import { CONFIG } from '../src/config.js';
import { getEndpoint, setEndpoint, getMask, setMask } from '../src/store.js';
import { keyGet, keySave, verifyKey } from '../src/api.js';
import { stateHtml, toast } from '../src/ui.js';

import * as home from '../src/views/home.js';
import * as persona from '../src/views/persona.js';
import * as report from '../src/views/report.js';
import * as shelf from '../src/views/shelf.js';
import * as me from '../src/views/me.js';

const TABS = [
  { key: 'home', label: '首页', icon: '🏠', view: home },
  { key: 'persona', label: '人格', icon: '🧬', view: persona },
  { key: 'report', label: '报告', icon: '🪞', view: report },
  { key: 'shelf', label: '书架', icon: '📚', view: shelf },
  { key: 'me', label: '我的', icon: '👤', view: me },
];

const viewEl = document.getElementById('view');
const headerTitleEl = document.getElementById('headerTitle');
const tabbarEl = document.getElementById('tabbar');

let current = 'home';

const app = {
  go(key) {
    if (!TABS.some((t) => t.key === key)) {
      return;
    }
    if (location.hash !== '#/' + key) {
      location.hash = '#/' + key;   // 触发 hashchange → route
      return;
    }
    renderTab(key);
  },
  refreshKeyState() {
    route();
  },
};

function renderTabbar() {
  tabbarEl.innerHTML = TABS.map((t) =>
    '<button class="wre-tab" data-tab="' + t.key + '">' +
    '<span class="wre-tab__icon">' + t.icon + '</span>' +
    '<span class="wre-tab__label">' + t.label + '</span>' +
    '</button>').join('');
  tabbarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) {
      app.go(btn.getAttribute('data-tab'));
    }
  });
}

function setChromeVisible(visible) {
  tabbarEl.style.display = visible ? '' : 'none';
  headerTitleEl.textContent = visible ? (TABS.find((t) => t.key === current) || {}).title || CONFIG.APP_NAME : CONFIG.APP_NAME;
}

function renderTab(key) {
  current = key;
  const tab = TABS.find((t) => t.key === key) || TABS[0];
  setChromeVisible(true);
  headerTitleEl.textContent = tab.view.title || tab.label;
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);
  tab.view.render(viewEl, app);
}

/** 主路由：先判定「中转地址 / Key」是否就绪，再渲染对应 Tab */
async function route() {
  const hashKey = (location.hash || '').replace(/^#\/?/, '') || 'home';
  current = TABS.some((t) => t.key === hashKey) ? hashKey : 'home';

  if (!getEndpoint()) {
    renderEndpointGate();
    return;
  }

  const state = await resolveKeyState();
  if (!state.ok) {
    setChromeVisible(false);
    viewEl.innerHTML = '<div class="wre-page">' + stateHtml('error', state.error || '连接中转服务失败', '重试') + '</div>';
    viewEl.querySelector('[data-action="retry"]').addEventListener('click', () => route());
    return;
  }
  if (!state.hasKey) {
    renderKeyGate(state.offline);
    return;
  }
  renderTab(current);
}

async function resolveKeyState() {
  const res = await keyGet();
  if (res.ok) {
    setMask({ hasKey: res.hasKey, masked: res.masked || '', hasAiKey: res.hasAiKey, aiMasked: res.aiMasked || '' });
    return { ok: true, hasKey: res.hasKey };
  }
  // 中转不可达时：若本机已有掩码，先放行（各页会给出各自的错误提示）
  const mask = getMask();
  if (mask && mask.hasKey) {
    return { ok: true, hasKey: true, offline: true };
  }
  return { ok: false, code: res.code, error: res.error };
}

// ---- 拦截态一：未配置中转地址 ----
function renderEndpointGate() {
  setChromeVisible(false);
  viewEl.innerHTML =
    '<div class="wre-page">' +
    '<div class="wre-card">' +
    '  <div class="wre-card__title">配置中转服务地址</div>' +
    '  <div class="wre-muted">微信悦读 H5 需要经你自己的微信云函数中转官方数据（浏览器无法直连）。请先在云开发控制台把 wereadProxy 绑定到 HTTP 访问服务，再把地址填在这里。</div>' +
    '  <input class="wre-input" id="gateEndpoint" placeholder="https://xxx.service.tcloudbase.com/h5" />' +
    '  <button class="wre-btn" id="gateEndpointSave">保存</button>' +
    '  <div class="wre-hint">部署步骤见 h5/README.md。也可用网址参数 ?endpoint=... 一次性指定。</div>' +
    '</div>' +
    '</div>';
  viewEl.querySelector('#gateEndpointSave').addEventListener('click', () => {
    const input = viewEl.querySelector('#gateEndpoint');
    const url = (input && input.value || '').trim();
    if (!/^https?:\/\//.test(url)) {
      toast('地址需以 http:// 或 https:// 开头');
      return;
    }
    setEndpoint(url);
    toast('已保存，正在重载…');
    setTimeout(() => location.reload(), 600);
  });
}

// ---- 拦截态二：未配置 Key ----
function renderKeyGate(offline) {
  setChromeVisible(false);
  viewEl.innerHTML =
    '<div class="wre-page">' +
    '<div class="wre-card">' +
    '  <div class="wre-card__title">粘贴你的微信读书 API Key</div>' +
    '  <div class="wre-muted">Key 只提交一次，由你自建的云函数加密托管；之后本机只带随机设备标识，不再保存明文，可随时在「我的」里清除。</div>' +
    (offline ? '  <div class="wre-hint">上次连接未成功，若已配置过可点下方「重试」。</div>' : '') +
    '  <input class="wre-input" id="gateKey" type="password" autocomplete="off" placeholder="wrk- 开头" />' +
    '  <button class="wre-btn" id="gateKeySave">保存并校验</button>' +
    '  <button class="wre-btn wre-btn--ghost" id="gateRetry">重试</button>' +
    '</div>' +
    '</div>';
  const saveBtn = viewEl.querySelector('#gateKeySave');
  saveBtn.addEventListener('click', async () => {
    const input = viewEl.querySelector('#gateKey');
    const value = (input && input.value || '').trim();
    if (value.indexOf('wrk-') !== 0) {
      toast('请填写以 wrk- 开头的 Key');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存并校验中…';
    const saved = await keySave(value, '');
    if (!saved.ok) {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存并校验';
      toast(saved.error || '保存失败');
      return;
    }
    input.value = '';
    const check = await verifyKey();
    if (!check.ok) {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存并校验';
      toast('已保存，但校验未通过：' + (check.error || ''));
      return;
    }
    setMask({ hasKey: true, masked: saved.masked || '', hasAiKey: !!saved.hasAiKey, aiMasked: saved.aiMasked || '' });
    toast('配置成功');
    route();
  });
  viewEl.querySelector('#gateRetry').addEventListener('click', () => route());
}

window.addEventListener('hashchange', () => route());

renderTabbar();
route();
