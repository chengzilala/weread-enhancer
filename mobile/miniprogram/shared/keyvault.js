/**
 * 用户凭证 · Key 加密托管（小程序侧）
 *
 * 为什么要它：微信读书 API Key 过去只存本机，换机 / 重装微信 / 清缓存即丢失。
 * 现在把 Key 加密托管到云端（集合 `wre_users`，AES-256-GCM），按身份取用：
 *   - 已关联网页账户 → 账户码（与 H5 同一份托管 Key，两端互通）；
 *   - 未关联 → 本机 openid。
 *
 * 安全口径：
 *   - 本机仍缓存一份明文供网关直发（与过去一致）；云端只存密文，明文不回传浏览器以外的端；
 *   - `pull()` 会把托管 Key 的明文拉回本机，仅在用户主动「恢复账号」时调用；
 *   - 红线：Key 不写日志（服务端只记掩码）。
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

/** 保存 / 更新托管 Key（传明文，服务端加密后入库；aiKey 可选，M15 后小程序已不用 AI） */
function save(apiKey, aiKey) {
  return call({ action: 'keySave', apiKey: apiKey || '', aiKey: aiKey || '' });
}

/** 查询托管状态：只回「是否已配置 + 掩码 + 昵称」，绝不回明文 */
function info() {
  return call({ action: 'keyGet' });
}

/** 拉回托管 Key 明文到本机（换机 / 恢复账号用；此后网关可直发） */
function pull() {
  return call({ action: 'keyPull' });
}

/** 清除云端托管的 Key（保留昵称；不动本机数据） */
function clear() {
  return call({ action: 'keyClear' });
}

module.exports = { save, info, pull, clear };
