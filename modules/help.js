/**
 * 微信悦读 · 帮助中心（v0.14.6）
 *
 * 定位：把插件与配套网站（https://wereadapp-32km31c.maozi.io）打通。
 *   1. 主菜单「关于」分组注入「📖 帮助中心」入口，点击跳转网站首页。
 *   2. 启动时（结果缓存 24 小时）通过后台拉取网站 /api/latest.json，
 *      检测到新版本时在入口旁显示红点。
 *
 * 复用 content.js 的全局 log() 与 #we-read-enhancer-root 容器。
 * 隐私口径：只发一个不带任何用户数据的 GET；失败一律静默，绝不打扰。
 */
(function () {
  'use strict';

  const SITE_BASE = 'https://wereadapp-32km31c.maozi.io';
  const VERSION_KEY = 'wreHelpVersionCheck';
  const CACHE_MS = 24 * 60 * 60 * 1000;   // 版本检查结果缓存 24 小时

  function logHelp(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[help] ' + message, meta);
    }
  }

  function currentVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等返回 0
  function compareVersion(a, b) {
    const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function sendToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => resolve(resp));
      } catch (e) {
        resolve(null);
      }
    });
  }

  function menuEntryExists(menu) {
    return !!menu.querySelector('[data-wre-help-entry]');
  }

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu || menuEntryExists(menu)) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'help');
    item.setAttribute('data-wre-help-entry', '1');
    item.title = '使用教程与常见问题';
    item.innerHTML = '<span class="wre-menu-icon">📖</span>帮助中心<span class="wre-help-dot"></span>';
    item.addEventListener('click', openHelp);
    // 插在「快捷键说明」之后（关于分组内）
    const anchor = menu.querySelector('[data-action="shortcuts"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else {
      menu.appendChild(item);
    }
    logHelp('info', '已注入「帮助中心」菜单入口');
  }

  function openHelp() {
    const url = SITE_BASE + '/';
    logHelp('info', '打开帮助中心', { url });
    const win = window.open(url, '_blank');
    if (!win) {
      window.location.href = url;
    }
  }

  function showUpdateBadge(latest) {
    const item = document.querySelector('[data-wre-help-entry]');
    if (!item) return;
    const dot = item.querySelector('.wre-help-dot');
    if (dot) dot.classList.add('wre-visible');
    item.title = '发现新版本 v' + latest + '，点我查看更新';
  }

  async function checkForUpdate() {
    try {
      const cached = await chrome.storage.local.get([VERSION_KEY]);
      const entry = cached[VERSION_KEY];
      const now = Date.now();
      let latest = null;
      let fromCache = false;
      if (entry && entry.checkedAt && (now - entry.checkedAt) < CACHE_MS && entry.latestVersion) {
        latest = entry.latestVersion;
        fromCache = true;
      } else {
        const resp = await sendToBackground({ type: 'wre-help-latest' });
        if (resp && resp.ok && resp.data && resp.data.latestVersion) {
          latest = resp.data.latestVersion;
          await chrome.storage.local.set({ [VERSION_KEY]: { checkedAt: now, latestVersion: latest } });
        } else {
          logHelp('debug', '版本检查失败（静默忽略）', { code: resp && resp.code });
          return;
        }
      }
      if (!latest) return;
      const current = currentVersion();
      if (compareVersion(latest, current) > 0) {
        showUpdateBadge(latest);
        logHelp('info', '检测到新版本', { latest, current });
      } else {
        logHelp('debug', '版本检查完成：已是最新', { latest, current, fromCache });
      }
    } catch (e) {
      // 版本检查失败静默，绝不打扰（仅留 debug 日志便于排查）
      logHelp('debug', '版本检查异常（静默忽略）', { message: e && e.message });
    }
  }

  // ---------- 启动 ----------

  function bootstrap() {
    const root = document.getElementById('we-read-enhancer-root');
    if (root) {
      injectMenuEntry(root);
    } else {
      const observer = new MutationObserver(() => {
        const r = document.getElementById('we-read-enhancer-root');
        if (r) {
          observer.disconnect();
          injectMenuEntry(r);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      logHelp('debug', '等待插件根容器出现后接入帮助中心');
    }
    checkForUpdate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
