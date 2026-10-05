/**
 * 阅读人格 · 云同步（B2）
 *
 * 为什么只存「人格结果」：云端按 openid 隔离，只存本机已算出的人格视图，
 * 不存 API Key、不存官方接口原始数据。未开通云开发 / 取不到 openid 时静默失败，
 * 云同步始终是「增强项」，失败不阻断本机使用。
 *
 * 返回 { ok:true, persona, updatedAt } 或 { ok:false, code, error }
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

/** 读取云端人格；无数据或读取失败一律返回 { ok:true, persona:null }，不打扰用户 */
async function syncGet() {
  const res = await call({ action: 'syncGet' });
  if (!res.ok) {
    return { ok: true, persona: null, updatedAt: 0 };
  }
  return { ok: true, persona: res.data || null, updatedAt: res.updatedAt || 0 };
}

/** 上传人格结果（静默：调用方不必处理失败） */
function syncPut(persona) {
  if (!persona || typeof persona !== 'object') {
    return Promise.resolve({ ok: false, code: 'param' });
  }
  return call({ action: 'syncPut', persona: persona });
}

module.exports = { syncGet, syncPut };
