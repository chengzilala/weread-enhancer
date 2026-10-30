/*!
 * ps-auth.js — 作品侧接入统一账户中心的最小 SDK（零依赖，原生 JS）
 *
 * 用法（放任意作品页面，登录态存本域 localStorage）：
 *   PSAuth.init({ apiBase: 'https://account.chesterlee.cn', productId: 'personal-site' })
 *   PSAuth.init({ ..., theme: 'dark' })         // 可选：登录页跟作品配色（dark / light）
 *   PSAuth.init({ ..., accent: '#d6402a' })     // 可选：登录页强调色，跟作品主色一致
 *   const user = await PSAuth.getUser()        // 未登录 → null
 *   await PSAuth.requireLogin()                // 未登录 → 跳账户中心登录，登录后带票据跳回
 *   await PSAuth.logout()
 *   PSAuth.track({ event: 'open', title: '阅读人格', platform: 'h5' })
 *
 * 跨域登录：账户中心跳回本页时带 ?ps_ticket=...，SDK 自动换 Token 并立刻从地址栏抹掉。
 * 静默登录：本域没 Token 时，12 小时内自动去账户中心要一次票据（用户无感），
 *           已登录就直接变成已登录态；没有账户则回跳 ?ps_sso=none，不再重试。
 * 只认 uid；不读、不传任何第三方 Key、业务数据。
 */
(function (global) {
  'use strict';

  var TOKEN_KEY = 'ps_token';
  var TICKET_PARAM = 'ps_ticket';
  var SSO_PARAM = 'ps_sso';
  var SSO_AT_KEY = 'ps_sso_at';
  var SSO_OFF_KEY = 'ps_sso_off';
  var SSO_TTL = 12 * 60 * 60 * 1000;

  var config = {
    apiBase: '',
    productId: '',
    loginPath: '/login.html',
    loginUrl: '',
    theme: '',
    accent: ''
  };

  var ticketReady = null;
  var silentStarted = false;
  var redeeming = false;

  function init(options) {
    options = options || {};
    if (options.apiBase !== undefined) config.apiBase = String(options.apiBase || '').replace(/\/+$/, '');
    if (options.productId) config.productId = String(options.productId);
    if (options.loginPath) config.loginPath = String(options.loginPath);
    if (options.loginUrl !== undefined) config.loginUrl = String(options.loginUrl || '');
    if (options.theme) config.theme = String(options.theme);
    if (options.accent) config.accent = String(options.accent);

    if (!ticketReady) ticketReady = redeemTicketFromUrl();
    maybeSilentLogin();
    return PSAuth;
  }

  function whenReady() {
    return ticketReady || Promise.resolve(null);
  }

  function apiBase() {
    return config.apiBase || location.protocol + '//' + location.host;
  }

  function endpoint() {
    return apiBase() + '/accountCenter';
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(SSO_OFF_KEY);
    }
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function makeError(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  function isLoggedOut(err) {
    return Boolean(err) && (err.code === 'UNAUTHORIZED' || err.code === 'ACCOUNT_DELETED');
  }

  /** 统一请求：成功回 data，失败抛出带 code 的 Error */
  function request(action, payload, token) {
    var headers = { 'Content-Type': 'application/json' };
    var bearer = token === undefined ? getToken() : token;
    if (bearer) headers.Authorization = 'Bearer ' + bearer;

    return fetch(endpoint(), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function (res) {
      return res.json().catch(function () {
        return null;
      }).then(function (body) {
        if (!body) throw makeError('BAD_RESPONSE', '账户服务返回异常');
        if (body.ok !== true) {
          throw makeError(body.code || 'UNKNOWN', body.message || '账户服务暂不可用');
        }
        return body.data;
      });
    }, function () {
      throw makeError('NETWORK', '连不上账户服务');
    });
  }

  /** 跳回带 ps_ticket 时：换 Token、清地址栏；失败当未登录，不阻塞作品 */
  function redeemTicketFromUrl() {
    var url;
    try {
      url = new URL(location.href);
    } catch (err) {
      return Promise.resolve(null);
    }

    var ticket = url.searchParams.get(TICKET_PARAM);
    if (!ticket) return Promise.resolve(null);
    redeeming = true;

    url.searchParams.delete(TICKET_PARAM);
    var query = url.searchParams.toString();
    try {
      history.replaceState(null, '', url.pathname + (query ? '?' + query : '') + url.hash);
    } catch (err) {
      /* 地址栏改不动也不影响换票 */
    }

    return request('auth.ticket.redeem', { ticket: ticket }, '')
      .then(function (data) {
        if (data && data.token) setToken(data.token);
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * 静默登录：本域没有 Token 时，12 小时内自动去账户中心要一次票据。
   * 已登录 → 回跳带 ps_ticket，无感变成已登录；没有账户 → 回跳 ps_sso=none，不再重试。
   * 手动退出后会打上 ps_sso_off 标记，避免被静默登录「拉回来」。
   */
  function maybeSilentLogin() {
    if (silentStarted || redeeming || getToken()) return;
    silentStarted = true;
    if (!config.apiBase || !config.productId) return;

    var url;
    try {
      url = new URL(location.href);
    } catch (err) {
      return;
    }

    // 账户中心回跳的「未登录」标记：抹掉参数并记下本次已查过
    if (url.searchParams.has(SSO_PARAM)) {
      url.searchParams.delete(SSO_PARAM);
      var query = url.searchParams.toString();
      try {
        history.replaceState(null, '', url.pathname + (query ? '?' + query : '') + url.hash);
      } catch (err) { /* 地址栏改不动不影响渲染 */ }
      try { localStorage.setItem(SSO_AT_KEY, String(Date.now())); } catch (err) {}
      return;
    }

    var off = false;
    var last = 0;
    try {
      off = localStorage.getItem(SSO_OFF_KEY) === '1';
      last = Number(localStorage.getItem(SSO_AT_KEY)) || 0;
    } catch (err) {}
    if (off) return;
    if (last && Date.now() - last < SSO_TTL) return;

    try { localStorage.setItem(SSO_AT_KEY, String(Date.now())); } catch (err) {}
    location.replace(apiBase() + '/sso.html'
      + '?productId=' + encodeURIComponent(config.productId)
      + '&returnUrl=' + encodeURIComponent(location.href));
  }

  /** 未登录返回 null；已登录返回 { uid, nickname, avatar, emailMasked } */
  function getUser() {
    return whenReady().then(function () {
      if (!getToken()) return null;
      return request('me').then(function (me) {
        return {
          uid: me.uid,
          nickname: me.nickname || '',
          avatar: me.avatar || '',
          emailMasked: me.emailMasked || ''
        };
      }).catch(function (err) {
        if (isLoggedOut(err)) {
          clearToken();
          return null;
        }
        throw err;
      });
    });
  }

  /** 已登录直接返回 user；未登录跳账户中心登录页（带 productId + returnUrl） */
  function requireLogin(options) {
    options = options || {};
    return getUser().then(function (user) {
      if (user) return user;

      var target = options.returnUrl || location.href;
      var page = config.loginUrl || (apiBase() + config.loginPath);
      var login = page
        + (page.indexOf('?') >= 0 ? '&' : '?')
        + 'productId=' + encodeURIComponent(config.productId)
        + '&returnUrl=' + encodeURIComponent(target)
        + (config.theme ? '&theme=' + encodeURIComponent(config.theme) : '')
        + (config.accent ? '&accent=' + encodeURIComponent(config.accent) : '');
      location.replace(login);
      return null;
    });
  }

  /** 清本机 Token 并让服务端撤销当前会话 */
  function logout() {
    return whenReady().then(function () {
      var token = getToken();
      clearToken();
      try { localStorage.setItem(SSO_OFF_KEY, '1'); } catch (err) {}
      if (!token) return { ok: true };
      return request('auth.logout', {}, token).catch(function () {
        return { ok: true };
      });
    });
  }

  /** 行为上报：失败静默，绝不阻塞作品主流程 */
  function track(event) {
    event = event || {};

    var body = {
      action: 'track',
      productId: config.productId,
      event: event.event,
      title: event.title,
      platform: event.platform,
      meta: event.meta
    };

    return whenReady().then(function () {
      var token = getToken();
      if (!token) return { recorded: false };
      return fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
        keepalive: true
      }).then(function (res) {
        return res.json();
      }).then(function (res) {
        return res && res.ok ? res.data : { recorded: false };
      });
    }).catch(function () {
      return { recorded: false };
    });
  }

  var PSAuth = {
    init: init,
    getUser: getUser,
    requireLogin: requireLogin,
    logout: logout,
    track: track
  };

  global.PSAuth = PSAuth;
})(window);
