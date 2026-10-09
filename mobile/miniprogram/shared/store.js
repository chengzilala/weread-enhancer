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
const FONT_KEY = 'wre_font_scale';

/** 文字大小档位：小 / 标准 / 大 / 特大（与 H5 端保持一致） */
const FONT_TIERS = [
  { key: 'sm', label: '小', value: 0.9 },
  { key: 'md', label: '标准', value: 1 },
  { key: 'lg', label: '大', value: 1.15 },
  { key: 'xl', label: '特大', value: 1.3 },
];

function normalizeScale(value) {
  const v = Number(value);
  for (let i = 0; i < FONT_TIERS.length; i += 1) {
    if (FONT_TIERS[i].value === v) {
      return v;
    }
  }
  return 1;
}

/** 读取本机保存的文字缩放系数（默认 1 ＝ 标准） */
function getFontScale() {
  return normalizeScale(wx.getStorageSync(FONT_KEY));
}

/** 保存文字缩放系数；返回实际生效值 */
function setFontScale(value) {
  const v = normalizeScale(value);
  wx.setStorageSync(FONT_KEY, v);
  return v;
}

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
  FONT_TIERS,
  getFontScale,
  setFontScale,
};
