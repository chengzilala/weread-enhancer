/**
 * 微信悦读 · 支持与反馈中心（v0.14.6）
 *
 * 定位：把原「打赏支持 / 用户反馈 / 公众号」三个独立入口合并为一个入口，
 * 弹层内用页签（Tab）切换三个面板，避免菜单项分散。
 *
 * 复用 content.js 的全局 log() 与 #we-read-enhancer-root 容器。
 * 隐私口径：仅展示静态二维码图片，不收集、不上传任何数据。
 */
(function () {
  'use strict';

  const ASSETS = {
    donateWechat: 'assets/donate/wechat.png',
    donateAlipay: 'assets/donate/alipay.png',
    feedbackWechat: 'assets/feedback/wechat.png',
    mpQrcode: 'assets/wechat-mp/qrcode.png',
  };

  function logSupportCenter(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[support-center] ' + message, meta);
    }
  }

  // 内容脚本里的 <img> 相对路径会被解析到 weread.qq.com，必须用 getURL 指向扩展内资源
  function assetUrl(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL(path);
    }
    return path;
  }

  function menuEntryExists(menu) {
    return !!menu.querySelector('[data-wre-support-center-entry]');
  }

  function injectMenuEntry(root) {
    const menu = root.querySelector('#wre-main-menu');
    if (!menu || menuEntryExists(menu)) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'wre-menu-item';
    item.setAttribute('data-action', 'support-center');
    item.setAttribute('data-wre-support-center-entry', '1');
    item.innerHTML = '<span class="wre-menu-icon">💗</span>支持与反馈';
    item.addEventListener('click', () => openPanel());
    // 插在「快捷键说明」之后（与原「打赏支持」位置一致）
    const anchor = menu.querySelector('[data-action="shortcuts"]');
    if (anchor && anchor.nextSibling) {
      menu.insertBefore(item, anchor.nextSibling);
    } else {
      menu.appendChild(item);
    }
    logSupportCenter('info', '已注入「支持与反馈」菜单入口');
  }

  function buildPanel(root) {
    const existing = root.querySelector('#wre-support-center-modal');
    if (existing) {
      return existing;
    }
    const overlay = document.createElement('div');
    overlay.className = 'wre-modal-overlay wre-support-center-overlay';
    overlay.id = 'wre-support-center-modal';
    overlay.innerHTML =
      '<div class="wre-modal wre-support-center-modal">' +
        '<div class="wre-modal-header">' +
          '<span class="wre-modal-title">💗 支持与反馈</span>' +
          '<button class="wre-modal-close" data-wre-support-center-close>&times;</button>' +
        '</div>' +
        '<div class="wre-support-center-tabs">' +
          '<button class="wre-sc-tab wre-sc-tab-active" data-wre-sc-tab="feedback">💬 反馈</button>' +
          '<button class="wre-sc-tab" data-wre-sc-tab="mp">📣 公众号</button>' +
          '<button class="wre-sc-tab" data-wre-sc-tab="donate">💗 打赏</button>' +
        '</div>' +
        '<div class="wre-modal-body wre-support-center-body">' +
          '<div class="wre-sc-panel wre-sc-panel-active" data-wre-sc-panel="feedback">' +
            '<p class="wre-sc-tip">遇到问题或有建议？扫码添加我的微信，直接告诉我。</p>' +
            '<div class="wre-sc-code">' +
              '<img class="wre-sc-qr" src="' + assetUrl(ASSETS.feedbackWechat) + '" alt="微信二维码">' +
              '<span class="wre-sc-label">扫一扫，添加我的微信</span>' +
            '</div>' +
          '</div>' +
          '<div class="wre-sc-panel" data-wre-sc-panel="mp">' +
            '<p class="wre-sc-tip">关注公众号，获取更多阅读技巧与更新动态。</p>' +
            '<div class="wre-sc-code">' +
              '<img class="wre-sc-qr" src="' + assetUrl(ASSETS.mpQrcode) + '" alt="公众号二维码">' +
              '<span class="wre-sc-label">扫一扫，关注公众号</span>' +
            '</div>' +
          '</div>' +
          '<div class="wre-sc-panel" data-wre-sc-panel="donate">' +
            '<p class="wre-sc-tip">如果它帮到了你，欢迎随喜支持一杯咖啡。</p>' +
            '<div class="wre-sc-codes">' +
              '<div class="wre-sc-code">' +
                '<img class="wre-sc-qr" src="' + assetUrl(ASSETS.donateWechat) + '" alt="微信打赏收款码">' +
                '<span class="wre-sc-label">微信</span>' +
              '</div>' +
              '<div class="wre-sc-code">' +
                '<img class="wre-sc-qr" src="' + assetUrl(ASSETS.donateAlipay) + '" alt="支付宝打赏收款码">' +
                '<span class="wre-sc-label">支付宝</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    });
    const closeBtn = overlay.querySelector('[data-wre-support-center-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closePanel());
    }
    const tabs = overlay.querySelectorAll('[data-wre-sc-tab]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => switchTab(overlay, tab.getAttribute('data-wre-sc-tab')));
    });

    root.appendChild(overlay);
    return overlay;
  }

  function switchTab(overlay, key) {
    overlay.querySelectorAll('[data-wre-sc-tab]').forEach((tab) => {
      tab.classList.toggle('wre-sc-tab-active', tab.getAttribute('data-wre-sc-tab') === key);
    });
    overlay.querySelectorAll('[data-wre-sc-panel]').forEach((panel) => {
      panel.classList.toggle('wre-sc-panel-active', panel.getAttribute('data-wre-sc-panel') === key);
    });
  }

  function openPanel() {
    const root = document.getElementById('we-read-enhancer-root');
    if (!root) {
      return;
    }
    const overlay = buildPanel(root);
    overlay.classList.add('wre-visible');
    switchTab(overlay, 'feedback');
    logSupportCenter('info', '打开支持与反馈面板');
  }

  function closePanel() {
    const overlay = document.getElementById('wre-support-center-modal');
    if (overlay) {
      overlay.classList.remove('wre-visible');
    }
  }

  // ---------- 启动 ----------

  function bootstrap() {
    const existing = document.getElementById('we-read-enhancer-root');
    if (existing) {
      injectMenuEntry(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const root = document.getElementById('we-read-enhancer-root');
      if (root) {
        observer.disconnect();
        injectMenuEntry(root);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    logSupportCenter('debug', '等待插件根容器出现后接入支持与反馈中心');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
