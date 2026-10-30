/**
 * 微信悦读 · 官网「我的账户」页（统一账户中心 account-center）
 *
 * 身份统一走 account-center（productId=wxread）：一个 uid 通用所有作品，
 * 与顶栏账户入口、网页版「我的」是同一个身份，登录态天然互通。
 *
 * 旧的账户码 / 微信读书 Key 托管属于插件自己的账户体系，仍在网页版（/app/）
 * 的「我的」里管理，本页只做统一身份的展示与登录 / 退出。
 */

(function () {
  'use strict';

  var ACCOUNT = {
    apiBase: 'https://account.chesterlee.cn',
    productId: 'wxread'
  };

  var root = document.getElementById('acctRoot');
  if (!root) {
    return;
  }

  var sdk = null;
  var toastTimer = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 极简提示条（沿用官网站点样式） */
  function toast(message) {
    var node = document.getElementById('acctToast');
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

  /** uid 只露前 8 后 4，够认人又不整串外露 */
  function maskUid(uid) {
    var v = String(uid || '');
    return v.length > 14 ? v.slice(0, 8) + '…' + v.slice(-4) : v;
  }

  /** 头像：账户中心头像优先，否则昵称首字 */
  function avatarInner(user) {
    if (user && user.avatar) {
      return '<img class="acct-avatar__img" src="' + esc(user.avatar) + '" alt="">';
    }
    var chars = Array.from(String((user && user.nickname) || '').trim());
    return esc(chars.length ? chars[0] : '微');
  }

  function metaLine(user) {
    if (!user) {
      return '还没有登录 · 一个账户通用微信悦读所有作品';
    }
    var parts = ['统一账户'];
    if (user.emailMasked) {
      parts.push(user.emailMasked);
    }
    if (user.uid) {
      parts.push('uid ' + maskUid(user.uid));
    }
    return parts.join(' · ');
  }

  function render(user, failed) {
    var loggedIn = Boolean(user);
    var name = loggedIn ? (String(user.nickname || '').trim() || '未设昵称') : '未登录';

    root.innerHTML =
      '<section class="acct-hero">' +
      '<div class="acct-avatar">' + avatarInner(user) + '</div>' +
      '<div class="acct-hero__meta">' +
      '<div class="acct-name">' + esc(name) + '</div>' +
      '<div class="acct-code">' + esc(metaLine(user)) + '</div>' +
      '</div>' +
      (loggedIn
        ? '<button class="acct-btn acct-btn--ghost" type="button" data-act="sign-out">退出登录</button>'
        : '<button class="acct-btn" type="button" data-act="sign-in">登录 / 注册</button>') +
      '</section>' +

      (failed
        ? '<section class="acct-card"><p class="acct-hint">账户服务暂时连不上，稍后刷新页面再试。</p></section>'
        : '') +

      '<section class="acct-card">' +
      '<h2 class="acct-card__title">统一账户</h2>' +
      '<p class="acct-hint">一处登录，处处通用：官网、网页版、个人网站等作品共享同一个身份；' +
      '点击下方进入账户中心，可改昵称、头像与登录方式。' +
      '</p>' +
      (loggedIn
        ? '<button class="acct-btn" type="button" data-act="open-center">进入账户中心</button>'
        : '<button class="acct-btn" type="button" data-act="sign-in">登录 / 注册统一账户</button>') +
      '</section>' +

      '<section class="acct-card">' +
      '<h2 class="acct-card__title">微信读书 Key 与账户码</h2>' +
      '<p class="acct-hint">Key 托管、账户码登录与跨设备找回属于插件自己的账户体系，' +
      '仍在网页版「我的」里管理，本页不再重复。</p>' +
      '<a class="acct-btn acct-btn--ghost" href="/app/">打开网页版 →</a>' +
      '</section>' +

      '<p class="acct-foot">统一账户只保存身份（昵称 / 头像 / 登录方式），' +
      '阅读数据与第三方 Key 始终留在各自作品里。</p>';
  }

  function refresh() {
    if (!sdk) {
      return;
    }
    sdk.getUser().then(function (user) {
      render(user, false);
    }).catch(function () {
      render(null, true);
    });
  }

  function onAction(e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn || !sdk) {
      return;
    }
    var act = btn.getAttribute('data-act');
    if (act === 'sign-in') {
      sdk.requireLogin();
      return;
    }
    if (act === 'open-center') {
      location.href = ACCOUNT.apiBase + '/account.html';
      return;
    }
    if (act === 'sign-out') {
      if (!window.confirm('确定退出统一账户吗？退出后官网与网页版都会回到未登录。')) {
        return;
      }
      sdk.logout().then(function () {
        toast('已退出登录');
        refresh();
      });
    }
  }

  /** 等 SDK 就绪（ps-auth.js 是 defer，本脚本是 module，顺序不保证） */
  var tries = 0;
  function boot() {
    if (!window.PSAuth) {
      if (++tries > 60) {
        root.innerHTML = '<p class="acct-loading">账户服务暂时不可用，请稍后刷新页面。</p>';
        return;
      }
      setTimeout(boot, 50);
      return;
    }
    sdk = window.PSAuth;
    sdk.init({ apiBase: ACCOUNT.apiBase, productId: ACCOUNT.productId });
    refresh();
  }

  root.addEventListener('click', onAction);
  boot();
})();
