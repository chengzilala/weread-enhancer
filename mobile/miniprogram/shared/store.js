/**
 * 本地存储
 *
 * 红线：所有密钥（微信读书 wrk- / DeepSeek sk-）只存手机本机，
 * 不登录、不上传、不落库；云函数只在内存中转，日志仅掩码。
 * 本机资料（头像 / 昵称）同样只存本地，用于「我的」页与分享图署名。
 */
const KEY = 'wre_api_key';
const DS_KEY = 'wre_deepseek_key';
const PROFILE_KEY = 'wre_profile';

function getKey() {
  return wx.getStorageSync(KEY) || '';
}

function setKey(key) {
  wx.setStorageSync(KEY, key);
}

function clearKey() {
  wx.removeStorageSync(KEY);
}

/** DeepSeek Key（可选）：仅本机，用于生成 AI 人格画像 */
function getDeepSeekKey() {
  return wx.getStorageSync(DS_KEY) || '';
}

function setDeepSeekKey(key) {
  wx.setStorageSync(DS_KEY, key);
}

function clearDeepSeekKey() {
  wx.removeStorageSync(DS_KEY);
}

/** 本机资料：{ avatarUrl, nickName } */
function getProfile() {
  const p = wx.getStorageSync(PROFILE_KEY);
  if (p && typeof p === 'object') {
    return { avatarUrl: String(p.avatarUrl || ''), nickName: String(p.nickName || '') };
  }
  return { avatarUrl: '', nickName: '' };
}

function setProfile(profile) {
  const p = profile || {};
  wx.setStorageSync(PROFILE_KEY, {
    avatarUrl: String(p.avatarUrl || ''),
    nickName: String(p.nickName || '').slice(0, 24),
  });
}

function clearProfile() {
  wx.removeStorageSync(PROFILE_KEY);
}

/** 掩码展示，形如 wrk-****(36) */
function maskKey(key) {
  if (typeof key !== 'string' || !key) {
    return '';
  }
  return key.slice(0, 4) + '****(' + key.length + ')';
}

module.exports = {
  getKey,
  setKey,
  clearKey,
  getDeepSeekKey,
  setDeepSeekKey,
  clearDeepSeekKey,
  getProfile,
  setProfile,
  clearProfile,
  maskKey,
};
