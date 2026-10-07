/**
 * H5 应用外壳：路由（五栏 Tab + 二级页面）+ 拦截态（未配 Key）
 *
 * 五栏：首页 / 人格 / 报告 / 书架 / 我的（对齐小程序 tabBar）。
 * 二级页面（每日卡片 / 灵感漫游 / 运营看板）不在底部 Tab，进入后隐藏 TabBar，页面自带返回。
 */

import { CONFIG } from '../src/config.js';
import { getMask, setMask } from '../src/store.js';
import { keyGet, keySave, verifyKey } from '../src/api.js';
import { stateHtml, toast } from '../src/ui.js';
import { setTtsToast } from '../src/tts.js';

import * as home from '../src/views/home.js';
import * as persona from '../src/views/persona.js';
import * as report from '../src/views/report.js';
import * as shelf from '../src/views/shelf.js';
import * as me from '../src/views/me.js';
import * as daily from '../src/views/daily.js';
import * as wander from '../src/views/wander.js';
import * as admin from '../src/views/admin.js';

const TABS = [
  { key: 'home', label: '首页', icon: '🏠', view: home },
  { key: 'persona', label: '人格', icon: '🧬', view: persona },
  { key: 'report', label: '报告', icon: '🪞', view: report },
  { key: 'shelf', label: '书架', icon: '📚', view: shelf },
  { key: 'me', label: '我的', icon: '👤', view: me },
];

// 二级页面：不在底部 Tab，进入后隐藏 TabBar（页面内自带「返回」）
const SECONDARY = [
  { key: 'daily', label: '每日卡片', view: daily },
  { key: 'wander', label: '灵感漫游', view: wander },
  { key: 'admin', label: '运营看板', view: admin },
];

function findTab(key) {
  return TABS.find((t) => t.key === key) || null;
}

function findSecondary(key) {
  return SECONDARY.find((s) => s.key === key) || null;
}

function isKnown(key) {
  return !!findTab(key) || !!findSecondary(key);
}

const viewEl = document.getElementById('view');
const headerTitleEl = document.getElementById('headerTitle');
const tabbarEl = document.getElementById('tabbar');

let current = 'home';

const app = {
  go(key) {
    if (!isKnown(key)) {
      return;
    }
    if (location.hash !== '#/' + key) {
      location.hash = '#/' + key;   // 触发 hashchange → route
      return;
    }
    route();
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

/** 高亮当前底部 Tab（对齐小程序 tabBar 选中态；二级页传 '' 清空） */
function setActiveTab(key) {
  tabbarEl.querySelectorAll('.wre-tab').forEach((el) => {
    el.classList.toggle('is-active', el.getAttribute('data-tab') === key);
  });
}

function setChromeVisible(visible) {
  tabbarEl.style.display = visible ? '' : 'none';
  headerTitleEl.textContent = visible ? ((findTab(current) || {}).title || CONFIG.APP_NAME) : CONFIG.APP_NAME;
}

function renderTab(key) {
  current = key;
  const tab = findTab(key) || TABS[0];
  setChromeVisible(true);
  setActiveTab(tab.key);
  headerTitleEl.textContent = tab.view.title || tab.label;
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);
  tab.view.render(viewEl, app);
}

/** 二级页面：隐藏 TabBar，页面内自带返回 */
function renderSecondary(key) {
  current = key;
  const item = findSecondary(key);
  setChromeVisible(false);
  setActiveTab('');
  headerTitleEl.textContent = item.view.title || item.label;
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);
  item.view.render(viewEl, app);
}

/** 主路由：先判定「中转地址 / Key」是否就绪，再渲染对应页面 */
async function route() {
  const hashKey = (location.hash || '').replace(/^#\/?/, '') || 'home';
  current = isKnown(hashKey) ? hashKey : 'home';

  // 「我的账户」不设 Key 门槛：换设备时，用户正需要先在这里用账户码登录 / 查看自己的账户码
  if (current === 'me') {
    renderTab('me');
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
  if (findSecondary(current)) {
    renderSecondary(current);
  } else {
    renderTab(current);
  }
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

// ---- 拦截态：未配置 Key ----
function renderKeyGate(offline) {
  setChromeVisible(false);
  viewEl.innerHTML =
    '<div class="wre-page">' +
    '<div class="wre-card">' +
    '  <div class="wre-card__title">粘贴你的微信读书 API Key</div>' +
    '  <div class="wre-muted">Key 只提交一次，由你自建的云函数加密托管；之后本机只带随机设备标识，不再保存明文，可随时在「我的账户」里清除。</div>' +
    '  <div class="wre-hint">获取方式：微信读书 App →「我」→「微信读书 Skill」页面 → 复制 wrk- 开头的 API Key。</div>' +
    (offline ? '  <div class="wre-hint">上次连接未成功，若已配置过可点下方「重试」。</div>' : '') +
    '  <input class="wre-input" id="gateKey" type="password" autocomplete="off" placeholder="wrk- 开头" />' +
    '  <button class="wre-btn" id="gateKeySave">保存并校验</button>' +
    '  <button class="wre-btn wre-btn--ghost" id="gateAccount">已有账户码？用它登录</button>' +
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
  viewEl.querySelector('#gateAccount').addEventListener('click', () => {
    location.hash = '#/me';   // 去「我的账户」用账户码登录
  });
}

window.addEventListener('hashchange', () => route());

setTtsToast(toast);   // 语音模块复用统一 toast
renderTabbar();
route();
