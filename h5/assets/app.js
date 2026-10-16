/**
 * H5 应用外壳：路由（五栏 Tab + 二级页面）+ 拦截态（未配 Key）
 *
 * 五栏：首页 / 人格 / 报告 / 书架 / 我的（对齐小程序 tabBar）。
 * 二级页面（每日卡片 / 灵感漫游 / 运营看板）不在底部 Tab，进入后隐藏 TabBar，页面自带返回。
 */

import { CONFIG } from '../src/config.js';
import { getMask, setMask, applyFontScale, applyTheme, watchSystemTheme } from '../src/store.js';
import { keyGet, keySave, verifyKey } from '../src/api.js';
import { stateHtml, toast } from '../src/ui.js';
import { keyGuideHtml } from '../src/key-guide.js';
import { setTtsToast } from '../src/tts.js';

import * as welcome from '../src/views/welcome.js';
import * as home from '../src/views/home.js';
import * as persona from '../src/views/persona.js';
import * as report from '../src/views/report.js';
import * as shelf from '../src/views/shelf.js';
import * as me from '../src/views/me.js';
import * as daily from '../src/views/daily.js';
import * as wander from '../src/views/wander.js';
import * as admin from '../src/views/admin.js';
import * as shareView from '../src/views/share.js';

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

// Key 配置页（未配 Key 时，从引导页「开始使用」进入；配好后再访问则回首页）
const SETUP_KEY = 'setup';

function findTab(key) {
  return TABS.find((t) => t.key === key) || null;
}

function findSecondary(key) {
  return SECONDARY.find((s) => s.key === key) || null;
}

function isKnown(key) {
  return !!findTab(key) || !!findSecondary(key) || key === SETUP_KEY;
}

const viewEl = document.getElementById('view');
const headerEl = document.querySelector('.wre-header');
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
  tabbarEl.innerHTML =
    '<div class="wre-sidebar__brand">' +
    '  <span class="wre-sidebar__logo">📖</span>' +
    '  <span class="wre-sidebar__name">' + CONFIG.APP_NAME + '</span>' +
    '</div>' +
    TABS.map((t) =>
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

/** 引导页自带顶部导航条，需隐藏全局蓝色顶栏；其余页面恢复显示 */
function setHeaderVisible(visible) {
  if (headerEl) {
    headerEl.style.display = visible ? '' : 'none';
  }
}

/**
 * 标记「是否处于应用内」（五栏 Tab / 二级页）。
 * 桌面两栏布局（≥720px，见 app.css）据此决定是否显示左侧导航栏：
 * 应用内 → 显示；引导页 / 配置页 / 分享页 → 保持居中单列。
 * 移动端此标记不产生任何视觉影响（媒体查询不命中）。
 */
function setAppChrome(on) {
  document.body.classList.toggle('wre-app', !!on);
}

function renderTab(key) {
  current = key;
  const tab = findTab(key) || TABS[0];
  setAppChrome(true);
  setHeaderVisible(true);
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
  setAppChrome(true);
  setHeaderVisible(true);
  setChromeVisible(false);
  setActiveTab('');
  headerTitleEl.textContent = item.view.title || item.label;
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);
  item.view.render(viewEl, app);
}

/** 只读分享页：隐藏 TabBar，由分享视图自行渲染（免 Key 门槛） */
function renderShare(code) {
  current = 'share';
  setAppChrome(false);
  setHeaderVisible(true);
  setChromeVisible(false);
  setActiveTab('');
  headerTitleEl.textContent = shareView.title || '分享';
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);
  shareView.render(viewEl, app, code);
}

/** 主路由：先判定「中转地址 / Key」是否就绪，再渲染对应页面 */
async function route() {
  const hashKey = (location.hash || '').replace(/^#\/?/, '') || 'home';
  current = isKnown(hashKey) ? hashKey : 'home';

  // 只读分享页（#/s/<code>）：别人点开分享链接即进入本页，不设 Key 门槛
  if (hashKey.indexOf('s/') === 0) {
    renderShare(hashKey.slice(2));
    return;
  }

  // 「我的账户」不设 Key 门槛：换设备时，用户正需要先在这里用账户码登录 / 查看自己的账户码
  if (current === 'me') {
    renderTab('me');
    return;
  }

  const state = await resolveKeyState();
  if (!state.ok) {
    setAppChrome(false);
    setHeaderVisible(true);
    setChromeVisible(false);
    viewEl.innerHTML = '<div class="wre-page">' + stateHtml('error', state.error || '连接中转服务失败', '重试') + '</div>';
    viewEl.querySelector('[data-action="retry"]').addEventListener('click', () => route());
    return;
  }
  if (!state.hasKey) {
    // 未配 Key：默认展示引导页（讲清楚这是什么、怎么开始）；
    // 点「开始使用」后进入 #/setup 配置页填 Key。
    setAppChrome(false);
    if (current === SETUP_KEY) {
      renderKeySetup(state.offline);
    } else {
      renderWelcome();
    }
    return;
  }
  if (current === SETUP_KEY) {
    // 已配好 Key 就不该停在配置页，回首页
    renderTab('home');
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

// ---- 未配置 Key：引导页（landing）----
function renderWelcome() {
  setHeaderVisible(false);   // 引导页自带顶部导航条
  setChromeVisible(false);
  welcome.render(viewEl, app);   // 引导页内部用 app.go('setup') 进入配置页
}

// ---- 未配置 Key：Key 配置页（含「如何获取 Key」图文说明）----
function renderKeySetup(offline) {
  setHeaderVisible(true);
  setChromeVisible(false);
  viewEl.innerHTML =
    '<div class="wre-page">' +
    '<div class="wre-card">' +
    '  <button class="wre-back__btn" data-action="back">‹ 返回引导页</button>' +
    '  <div class="wre-card__title">粘贴你的微信读书 API Key</div>' +
    '  <div class="wre-muted">Key 只提交一次，由你自己的云函数加密托管；之后本机只带设备标识，不再保存明文，可随时在「我的」里清除。</div>' +
    '  <input class="wre-input" id="gateKey" type="password" autocomplete="off" placeholder="wrk- 开头" />' +
    '  <button class="wre-btn" id="gateKeySave">保存并校验</button>' +
    '  <button class="wre-btn wre-btn--ghost" id="gateAccount">已有账户码？用它登录</button>' +
    (offline ? '  <div class="wre-hint">上次连接未成功，若已配置过可点下方「重试」。</div>' : '') +
    '  <button class="wre-btn wre-btn--ghost" id="gateRetry">重试</button>' +
    keyGuideHtml() +
    '</div>' +
    '</div>';
  viewEl.querySelector('[data-action="back"]').addEventListener('click', () => {
    location.hash = '#/home';   // 回引导页
  });
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
applyFontScale();     // 套用本机「文字大小」偏好（index.html 已提前设过，这里兜底）
applyTheme();         // 套用本机「外观」偏好（index.html 已提前设过，这里兜底）
watchSystemTheme();   // 「跟随系统」时，随系统明暗实时切换
renderTabbar();
route();
