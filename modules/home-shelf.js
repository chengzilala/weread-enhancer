/**
 * 微信悦读 · 主页找书入口（v0.27.3 修复版）
 *
 * 定位：把「找书」（modules/finder.js，本地标签 + 多维搜书）的入口，
 *   从「左下角悬浮球悬停菜单」搬到微信读书**主页**显眼处——
 *   显示在「继续阅读」栏、官方「我的书架」链接**左侧**，点一下即开面板。
 *
 * ⚠ 关键修复（v0.27.3）：
 *   旧实现把按钮 insertBefore 进官方「我的书架」**所在的同一个容器**。
 *   微信读书主页由前端框架（React/Vue）渲染，往它管理的容器里塞节点会破坏
 *   其 DOM 复用，导致官方「我的书架」**点不动、打不开**。
 *   现改为：按钮挂在 document.body 上、position: fixed，用官方链接的
 *   getBoundingClientRect() 把它「贴」到官方链接左侧的视觉位置；
 *   全程**不改动官方 DOM 树**（只读位置），因此不可能影响官方按钮。
 *
 * 约定：
 *   1. 只在微信读书**主页**（pathname 为 / 或 /index.html）显示；离开主页即移除。
 *   2. 旧代码不改：只改本文件与 home-shelf.css；finder.js / content.js 零改动。
 *   3. 打开面板靠**程序化点击** finder 自己的菜单入口
 *      （[data-wre-find-entry]），避免改 finder.js 暴露接口。
 *   4. 找不到「我的书架」入口时不显示，仅记日志（不硬塞、不遮挡官方 UI）。
 *
 * 复用 content.js 的全局 log()；样式见 modules/home-shelf.css。
 */
(function () {
  'use strict';

  const BTN_ID = 'wre-homeshelf-entry';
  const FIND_ENTRY_SELECTOR = '[data-wre-find-entry]';
  const WAIT_ENTRY_MS = 5000;      // 点按钮后等 finder 菜单入口就绪的最长时间
  const SHELF_TEXT = '我的书架';
  const GAP_PX = 10;               // 与官方「我的书架」的水平间距
  const WATCH_MS = 1200;           // 轮询：官网重渲染 / SPA 切页后自动跟上

  let anchorEl = null;             // 官方「我的书架」入口（只读位置用，绝不插入其 DOM）
  let btnEl = null;                // 我们自己的按钮（挂在 body 上）
  let rafId = 0;
  let foundLogged = false;

  function logHome(level, msg, meta) {
    if (typeof log === 'function') {
      log(level, '[home-shelf] ' + msg, meta);
    }
  }

  // ---------- 主页判定 ----------

  function isHomePage() {
    const p = window.location.pathname;
    return p === '' || p === '/' || p === '/index.html';
  }

  // ---------- 定位官方「我的书架」入口（只查找，不改动） ----------

  // 官方主页「继续阅读」栏动作区链接（类名语义化、非哈希，实测：a.wr_index_page_top_section_header_action_link）
  const HOME_ACTION_LINK_SELECTOR = '.wr_index_page_top_section_header_action_link';

  // 只认「真正显示在页面上」的入口，避免命中隐藏模板 / 下拉里的同名链接
  function isVisible(el) {
    if (!el) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findShelfAnchor() {
    // 策略 1：官方主页动作区里文本为「我的书架」的链接（最稳）
    const actionLinks = document.querySelectorAll(HOME_ACTION_LINK_SELECTOR);
    for (let i = 0; i < actionLinks.length; i++) {
      if (actionLinks[i].textContent.trim() === SHELF_TEXT && isVisible(actionLinks[i])) {
        return actionLinks[i];
      }
    }
    // 策略 2：按 href 命中官方书架页（取第一个可见的）
    const byHref = document.querySelectorAll('a[href*="/web/shelf"]');
    for (let i = 0; i < byHref.length; i++) {
      if (isVisible(byHref[i])) {
        return byHref[i];
      }
    }
    // 策略 3：兜底——按可见文本匹配（取最里层、无子元素的那个，并尽量上提到链接本身）
    const cands = document.querySelectorAll('a, span, div, button');
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i];
      if (!el.children.length && el.textContent.trim() === SHELF_TEXT && isVisible(el)) {
        return el.closest('a') || el;
      }
    }
    return null;
  }

  // ---------- 打开「找书」面板 ----------

  function clickFindEntry() {
    const entry = document.querySelector(FIND_ENTRY_SELECTOR);
    if (entry) {
      entry.click();
      return true;
    }
    return false;
  }

  function openFinder() {
    if (clickFindEntry()) {
      logHome('info', '主页按钮 → 打开找书面板');
      return;
    }
    // finder 菜单入口尚未注入：等它出现后自动点开
    logHome('warn', '找书菜单入口未就绪，等待后自动打开');
    const startedAt = Date.now();
    const obs = new MutationObserver(() => {
      if (clickFindEntry()) {
        obs.disconnect();
        return;
      }
      if (Date.now() - startedAt > WAIT_ENTRY_MS) {
        obs.disconnect();
        logHome('error', '找书菜单入口始终未出现，无法打开面板');
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------- 定位：把按钮贴到官方链接左侧 ----------

  function reposition() {
    rafId = 0;
    if (!btnEl) {
      return;
    }
    if (!anchorEl || !anchorEl.isConnected) {
      anchorEl = null;
      btnEl.style.visibility = 'hidden';
      return;
    }
    const a = anchorEl.getBoundingClientRect();
    // 官方入口不在视口内（滚走了）→ 一并把按钮藏起来
    if (a.width === 0 || a.height === 0 || a.bottom < 0 || a.top > window.innerHeight) {
      btnEl.style.visibility = 'hidden';
      return;
    }
    const b = btnEl.getBoundingClientRect();
    btnEl.style.top = Math.round(a.top + (a.height - b.height) / 2) + 'px';
    btnEl.style.left = Math.round(a.left - GAP_PX - b.width) + 'px';
    btnEl.style.visibility = 'visible';
  }

  function scheduleReposition() {
    if (!btnEl || rafId) {
      return;
    }
    rafId = requestAnimationFrame(reposition);
  }

  // ---------- 创建按钮（挂在 body 上，脱离官网 DOM 树） ----------

  function ensureBtn() {
    if (btnEl) {
      return;
    }
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'wre-homeshelf-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.title = '打开找书面板：用标签与多维度搜索，快速找到书架里的书';
    btn.innerHTML = '<span class="wre-homeshelf-ico">🔎</span>找书';

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFinder();
    });
    btn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFinder();
      }
    });

    document.body.appendChild(btn);
    btnEl = btn;
  }

  function removeBtn() {
    if (btnEl) {
      btnEl.remove();
      btnEl = null;
    }
    anchorEl = null;
  }

  function tryPlace() {
    const anchor = findShelfAnchor();
    if (!anchor) {
      return false;
    }
    anchorEl = anchor;
    ensureBtn();
    scheduleReposition();
    if (!foundLogged) {
      foundLogged = true;
      logHome('info', '主页「我的书架」已定位，找书按钮贴在它左侧（未改动官方 DOM）');
    }
    return true;
  }

  // ---------- 轮询：处理官网重渲染 / SPA 切页 ----------

  function watchTick() {
    if (!isHomePage()) {
      if (btnEl) {
        logHome('debug', '离开主页，移除找书按钮');
        removeBtn();
      }
      return;
    }
    if (anchorEl && anchorEl.isConnected) {
      scheduleReposition();
    } else {
      tryPlace();
    }
  }

  // ---------- 启动 ----------

  function bootstrap() {
    if (!isHomePage()) {
      logHome('debug', '非主页，跳过找书入口', { path: window.location.pathname });
      return;
    }
    tryPlace();
    window.addEventListener('scroll', scheduleReposition, true);
    window.addEventListener('resize', scheduleReposition);
    setInterval(watchTick, WATCH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
