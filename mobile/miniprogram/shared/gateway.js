/**
 * 官方网关调用封装：统一走云函数 wereadProxy 中转
 *
 * 为什么必须中转：官方网关 `POST i.weread.qq.com/api/agent/gateway` 的 CORS 预检返回 401，
 * 小程序端直连必失败；云函数出网不受小程序 request 合法域名白名单限制，正好代发。
 * 口径与插件 background.js 保持一致。
 *
 * 身份与 Key：走 `action:'relay'`，云函数按身份取「托管 Key」代发；
 *   本机传了 apiKey（如「校验新 Key」时）则用传入的，否则用云端托管 Key。
 *
 * 返回 { ok:true, data, upgrade } 或 { ok:false, code, error }
 */
const { PROXY_FUNCTION } = require('../config');

function callGateway(apiName, params, apiKey) {
  return new Promise((resolve) => {
    const data = { action: 'relay', apiName: apiName, params: params || {} };
    // 仅「校验新 Key」等场景显式传 Key；日常调用不传，由云端用托管 Key 代发
    if (apiKey) {
      data.apiKey = apiKey;
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
        resolve({
          ok: false,
          code: 'cloud',
          error: '云函数调用失败：' + ((err && err.errMsg) || '未知错误'),
        });
      });
  });
}

/** 校验 Key：先探连通（/_list 不需要身份），再用需要登录的轻量接口确认真实有效 */
async function verifyKey(apiKey) {
  const ping = await callGateway('/_list', {}, apiKey);
  if (!ping.ok) {
    return ping;
  }
  return await callGateway('/readdata/detail', { mode: 'weekly', baseTime: 0 }, apiKey);
}

/**
 * 一次代拉素材池（M17）：云函数内并发拉「划线 + 想法」，客户端只发 1 次调用。
 * @param {string} mode daily / wander（决定取几本书）
 * @param {Array} books [{bookId,title,author}]；传空则由服务端按笔记数选书
 * @returns {object} { ok:true, books:[{bookId,title,author,marks,reviews}], overview } 或 { ok:false, code, error }
 */
function callPool(mode, books) {
  return new Promise((resolve) => {
    wx.cloud
      .callFunction({
        name: PROXY_FUNCTION,
        data: { action: 'pool', mode: mode || 'daily', books: books || [] },
      })
      .then((res) => {
        const result = res && res.result;
        if (!result || typeof result.ok !== 'boolean') {
          resolve({ ok: false, code: 'empty', error: '云函数未返回有效结果' });
          return;
        }
        resolve(result);
      })
      .catch((err) => {
        resolve({
          ok: false,
          code: 'cloud',
          error: '云函数调用失败：' + ((err && err.errMsg) || '未知错误'),
        });
      });
  });
}

module.exports = { callGateway, verifyKey, callPool };
