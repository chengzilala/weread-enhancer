/**
 * 本地存储
 *
 * 红线：所有密钥（微信读书 wrk- / DeepSeek sk-）不写日志（日志仅掩码）。
 * 本机缓存一份明文 Key 供网关直发；同时云端加密托管一份（换机 / 退出后「恢复账号」时拉回）。
 * 本机资料（头像 / 昵称）只存本地，用于「我的」页与分享图署名。
 */
const KEY = 'wre_api_key';
const DS_KEY = 'wre_deepseek_key';
const PROFILE_KEY = 'wre_profile';
const FONT_KEY = 'wre_font_scale';
const KEY_MASK_KEY = 'wre_key_mask';     // 云端托管 Key 的掩码（本机没存明文时用于展示）
const KEY_HOSTED_KEY = 'wre_key_hosted'; // 云端是否已托管 Key（用于「恢复账号」入口判断）

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

/** 记录「云端托管」元信息：本机没存明文 Key 时，用掩码展示、用标志判断能否「恢复账号」 */
function setCredentialMeta(meta) {
  const m = meta || {};
  if (m.masked) {
    wx.setStorageSync(KEY_MASK_KEY, String(m.masked));
  } else {
    wx.removeStorageSync(KEY_MASK_KEY);
  }
  wx.setStorageSync(KEY_HOSTED_KEY, !!m.hosted);
}

/** 云端托管 Key 的掩码（无则返回空串） */
function getKeyMask() {
  return wx.getStorageSync(KEY_MASK_KEY) || '';
}

/** 云端是否已托管 Key（本机没有明文时用于判断可否「恢复账号」） */
function isKeyHosted() {
  return !!wx.getStorageSync(KEY_HOSTED_KEY);
}

function clearCredentialMeta() {
  wx.removeStorageSync(KEY_MASK_KEY);
  wx.removeStorageSync(KEY_HOSTED_KEY);
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
  setCredentialMeta,
  getKeyMask,
  isKeyHosted,
  clearCredentialMeta,
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
