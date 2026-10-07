/**
 * 微信悦读 · 主页找书入口（v0.26.0）
 *
 * 定位：把「找书」（modules/finder.js，本地标签 + 多维搜书）的入口，
 *   从「左下角悬浮球悬停菜单」搬到微信读书**主页**显眼处——
 *   注入到「继续阅读」栏、官方「我的书架」链接**旁边**，点一下即开面板。
 *
 * 约定：
 *   1. 只在微信读书**主页**（pathname 为 / 或 /index.html）注入；其它页不动。
 *   2. 旧代码不改：本模块只新增文件，manifest.json 仅多一行 css / 一行 js。
 *   3. 打开面板靠**程序化点击** finder 自己的菜单入口
 *      （[data-wre-find-entry]），避免改 finder.js 暴露接口。
 *   4. 找不到「我的书架」入口时不注入，仅记日志（不硬塞、不遮挡官方 UI）。
 *
 * 复用 content.js 的全局 log()；样式见 modules/home-shelf.css。
 */
(function () {
  'use strict';

  const BTN_ID = 'wre-homeshelf-entry';
  const FIND_ENTRY_SELECTOR = '[data-wre-find-entry]';
  const WAIT_ANCHOR_MS = 15000;   // 等主页「我的书架」入口出现的最长时间
  const WAIT_ENTRY_MS = 5000;     // 点按钮后等 finder 菜单入口就绪的最长时间
  const SHELF_TEXT = '我的书架';

  let clickGuardBound = false;    // 捕获阶段点击拦截只绑一次，避免重复触发

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

  // ---------- 定位官方「我的书架」入口 ----------

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

  // ---------- 注入按钮 ----------

  function inject(anchor) {
    if (document.getElementById(BTN_ID)) {
      return;
    }
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'wre-homeshelf-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.title = '打开找书面板：用标签与多维度搜索，快速找到书架里的书';
    btn.innerHTML = '<span class="wre-homeshelf-ico">🔎</span>找书';

    // 捕获阶段拦截：无论按钮挨着谁、被塞进哪个容器，点它都只开面板、绝不跳转
    if (!clickGuardBound) {
      clickGuardBound = true;
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!target || !target.closest) {
          return;
        }
        if (!target.closest('#' + BTN_ID)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openFinder();
      }, true);
    }

    btn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFinder();
      }
    });

    const parent = anchor.parentNode;
    if (!parent) {
      return;
    }
    parent.insertBefore(btn, anchor);
    const rect = btn.getBoundingClientRect();
    logHome('info', '已在主页「我的书架」旁注入找书按钮', {
      w: Math.round(rect.width), h: Math.round(rect.height),
      inLink: !!btn.closest('a')
    });
  }

  function tryInject() {
    if (document.getElementById(BTN_ID)) {
      return true;
    }
    const anchor = findShelfAnchor();
    if (!anchor) {
      return false;
    }
    inject(anchor);
    return true;
  }

  // ---------- 启动 ----------

  function bootstrap() {
    if (!isHomePage()) {
      logHome('debug', '非主页，跳过找书入口注入', { path: window.location.pathname });
      return;
    }
    if (tryInject()) {
      return;
    }
    // 主页内容异步渲染：等「我的书架」入口出现
    const startedAt = Date.now();
    const obs = new MutationObserver(() => {
      if (tryInject()) {
        obs.disconnect();
        return;
      }
      if (Date.now() - startedAt > WAIT_ANCHOR_MS) {
        obs.disconnect();
        logHome('warn', '主页未找到「我的书架」入口，放弃注入');
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
