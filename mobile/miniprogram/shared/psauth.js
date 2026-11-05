/**
 * 统一账户（account-center）
 *
 * 小程序没有浏览器环境、个人主体也不能用 web-view，所以 openid 由云函数 wereadProxy 代持：
 * 前端只调 psLogin / psMe / psLogout，拿到 Token 存本机，业务侧只认 uid。
 * Token 与账户资料仅用于「显示我是谁」，不参与本机 Key / 账户码那套逻辑。
 */
const { PROXY_FUNCTION } = require('../config');
const logger = require('./logger');

const TOKEN_KEY = 'wre_ps_token';
const USER_KEY = 'wre_ps_user';

function call(data) {
  return new Promise((resolve) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      logger.error('psauth', '当前环境不支持云开发');
      resolve({ ok: false, code: 'cloud', error: '当前环境不支持云开发' });
      return;
    }
    logger.log('psauth', '调用云函数 ' + (data && data.action));
    wx.cloud
      .callFunction({ name: PROXY_FUNCTION, data: data })
      .then((res) => {
        const result = res && res.result;
        if (!result || typeof result.ok !== 'boolean') {
          logger.error('psauth', '云函数返回异常', { result: result });
          resolve({ ok: false, code: 'empty', error: '云函数未返回有效结果' });
          return;
        }
        logger.log('psauth', (data && data.action) + ' 返回', {
          ok: result.ok,
          code: result.code || '',
          error: result.error || '',
        });
        resolve(result);
      })
      .catch((err) => {
        logger.error('psauth', '云函数调用失败', err);
        resolve({ ok: false, code: 'cloud', error: (err && err.errMsg) || (err && err.message) || '云函数调用失败' });
      });
  });
}

/** 本机缓存的账户资料（同步读取，用于首屏渲染） */
function currentUser() {
  try {
    const user = wx.getStorageSync(USER_KEY);
    return user && user.uid ? user : null;
  } catch (err) {
    return null;
  }
}

function readToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (err) {
    return '';
  }
}

function save(token, user) {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
    wx.setStorageSync(USER_KEY, user);
  } catch (err) {
    // 存不进去不影响本次登录，只是下次进来要重新登录
  }
}

function clear() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_KEY);
  } catch (err) {
    // 忽略
  }
}

/** 微信一键登录：openid 只在云函数里取，前端拿不到 */
async function login() {
  const res = await call({ action: 'psLogin' });
  if (!res.ok || !res.token) {
    return res;
  }
  const user = {
    uid: res.uid,
    nickname: res.nickname || '',
    avatar: res.avatar || '',
    emailMasked: '',
  };
  save(res.token, user);
  return { ok: true, user: user, isNew: !!res.isNew };
}

/** 绑定已有账户：输入网页端生成的 6 位登录码，把这台微信挂到那个账户上 */
async function bind(code) {
  const res = await call({ action: 'psBind', code: String(code || '') });
  if (!res.ok || !res.token) {
    return res;
  }
  const user = {
    uid: res.uid,
    nickname: res.nickname || '',
    avatar: res.avatar || '',
    emailMasked: '',
  };
  save(res.token, user);
  return { ok: true, user: user, bound: true };
}

/** 用本机 Token 换最新资料（昵称 / 头像可能在别的端改过）；登录失效自动清掉本机缓存 */
async function refresh() {
  const token = readToken();
  if (!token) {
    return null;
  }
  const res = await call({ action: 'psMe', token: token });
  if (!res.ok) {
    if (res.code === 'UNAUTHORIZED' || res.code === 'novauth') {
      clear();
    }
    return null;
  }
  const user = {
    uid: res.uid || '',
    nickname: res.nickname || '',
    avatar: res.avatar || '',
    emailMasked: res.emailMasked || '',
  };
  save(token, user);
  return user;
}

/** 退出统一账户：只撤销这一条会话，本机 Key / 账户码 / 云数据都不动 */
async function logout() {
  const token = readToken();
  clear();
  if (token) {
    await call({ action: 'psLogout', token: token });
  }
  return { ok: true };
}

module.exports = { currentUser, login, bind, refresh, logout };
