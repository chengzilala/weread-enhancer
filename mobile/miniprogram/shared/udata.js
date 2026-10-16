/**
 * 用户数据落库（每日卡片 / 灵感漫游 / 纸书归档）· 云同步封装
 *
 * 为什么要它：这三类数据过去只存本机，换机 / 清缓存 / 退出登录即丢失。
 * 现在按身份（关联网页账户后＝账户码，未关联＝openid）在云函数 `wre_udata` 集合里存一份，
 * 本机仍为唯一数据源，云端只做备份，换机 / 恢复账号时可拉回。
 *
 * 返回 { ok:true, value, updatedAt } 或 { ok:false, code, error }
 * 红线：只同步用户自己的内容，不含任何 Key、不含官方接口原始数据。
 */
const { PROXY_FUNCTION } = require('../config');

const KIND = { DAILY: 'daily', WANDER: 'wander', PAPERBOOK: 'paperbook' };

function cloudAvailable() {
  return !!(wx.cloud && typeof wx.cloud.callFunction === 'function');
}

function call(data) {
  return new Promise((resolve) => {
    if (!cloudAvailable()) {
      resolve({ ok: false, code: 'nocloud', error: '云开发未开通' });
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
      .catch((err) => resolve({ ok: false, code: 'cloud', error: '云函数调用失败：' + ((err && err.errMsg) || '未知错误') }));
  });
}

/** 取回某类数据（云端无数据时 value 为 null） */
function get(kind) {
  return call({ action: 'udataGet', kind: kind });
}

/** 写入某类数据（覆盖该分区，保留其它分区） */
function put(kind, value) {
  return call({ action: 'udataPut', kind: kind, value: value });
}

/** 静默备份（不 await、失败不打扰用户）：本机写完后顺手推一份 */
function backupSilent(kind, value) {
  if (!cloudAvailable()) {
    return;
  }
  try {
    wx.cloud
      .callFunction({ name: PROXY_FUNCTION, data: { action: 'udataPut', kind: kind, value: value } })
      .catch(() => {});
  } catch (err) {
    // 云开发未开通等情况忽略
  }
}

module.exports = { KIND, get, put, backupSilent };
