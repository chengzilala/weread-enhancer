/**
 * 跨端关联：网页账户码（deviceId）↔ 微信小程序（openid）
 *
 * 身份来源不同（浏览器拿不到 openid，小程序用不到账户码），故用「用户主动绑定」建立映射：
 *   小程序端把网页给的 6 位绑定码（或完整账户码）交给云函数，云函数写入 openid ↔ deviceId 映射。
 * 绑定后：阅读人格（wre_sync）与昵称两端共用，换设备才需重新关联。
 * 红线：只建立映射，不存 Key、不存官方原始数据。
 *
 * 返回 { ok:true, ... } 或 { ok:false, code, error }
 */
const { PROXY_FUNCTION } = require('../config');

function call(data) {
  return new Promise((resolve) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      resolve({ ok: false, code: 'cloud', error: '当前环境不支持云开发' });
      return;
    }
    wx.cloud
      .callFunction({ name: PROXY_FUNCTION, data: data })
      .then((res) => {
        const result = res && res.result;
        if (!result || typeof result.ok !== 'boolean') {
          resolve({ ok: false, code: 'empty', error: '云函数未返回有效结果' });
          return;
        }
        resolve(result);
      })
      .catch((err) => {
        resolve({ ok: false, code: 'cloud', error: (err && err.errMsg) || '云函数调用失败' });
      });
  });
}

/** 认领关联：code 为 6 位绑定码，或完整 32 位账户码 */
function bindClaim(code) {
  return call({ action: 'bindClaim', code: code || '' });
}

/** 查询当前是否已关联网页账户（含账户昵称） */
function bindInfo() {
  return call({ action: 'bindInfo' });
}

/**
 * 获取本端账户码（小程序侧发起统一）：
 * 未分配时由云函数新建账户码并把本机数据迁到该账户码名下，已分配则原样返回（幂等）。
 * 拿到后可在网页端「跨设备登录」粘贴登录，实现「小程序先、网页后」的统一。
 */
function accountEnsure() {
  return call({ action: 'accountEnsure' });
}

/** 解除关联（本机数据保留） */
function bindUnbind() {
  return call({ action: 'bindUnbind' });
}

/** 把本机昵称写入已绑定账户（未关联时云函数返回 nolink，可静默忽略） */
function profilePut(nickName) {
  return call({ action: 'profilePut', nickName: nickName || '' });
}

module.exports = { bindClaim, bindInfo, bindUnbind, profilePut, accountEnsure };
