/**
 * 本地存储：API Key 只存手机本机（不登录、不上传、不落库）
 */
const KEY = 'wre_api_key';

function getKey() {
  return wx.getStorageSync(KEY) || '';
}

function setKey(key) {
  wx.setStorageSync(KEY, key);
}

function clearKey() {
  wx.removeStorageSync(KEY);
}

/** 掩码展示，形如 wrk-****(36) */
function maskKey(key) {
  if (typeof key !== 'string' || !key) {
    return '';
  }
  return key.slice(0, 4) + '****(' + key.length + ')';
}

module.exports = { getKey, setKey, clearKey, maskKey };
