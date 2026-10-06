/**
 * 运营统计 / 管理员看板（M13）
 *
 * 全部走云函数 wereadProxy：
 *   - ping()      ：打开小程序时上报一次使用量（云函数按 openid + 天去重，不传任何阅读数据）
 *   - whoami()    ：问服务端「我是不是管理员」（只回布尔，前端据此决定是否显示入口）
 *   - fetchAdmin():取看板数据（非白名单时服务端返回 code=forbidden，前端拿不到任何数字）
 *
 * 说明：看板的「我的阅读数据」（C 块）不走这里，由页面复用本机已有的取数逻辑。
 * 失败一律静默 / 可重试，不阻断小程序使用。
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

/** 打开小程序时上报一次使用量（静默，调用方无需处理结果） */
function ping() {
  return call({ action: 'opsPing' });
}

/** 当前用户是否管理员 */
async function whoami() {
  const res = await call({ action: 'opsWhoami' });
  return !!(res && res.ok && res.admin);
}

/** 取管理员看板数据（A 小程序 / B 插件；C 由页面本地复用） */
function fetchAdmin() {
  return call({ action: 'opsAdmin' });
}

module.exports = { ping, whoami, fetchAdmin };
