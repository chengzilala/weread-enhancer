/**
 * 本机存储（账户层，官网与网页版共用）
 *
 * 统一存储键：官网（/）与网页版（/app/）同域名同 origin，共用下面这组键，
 *   所以「网站+h5 同一套账户、同一个登录系统」天然成立，无需任何同步机制。
 *   官网「我的账户」页与网页版「我的」页都读写这里，登录态互通。
 *
 * 红线：
 *   1. 微信读书 wrk- / DeepSeek sk- Key **不落本机**，只交服务端加密托管（见 H1）；
 *      本机仅保存账户码与「掩码」，用于识别与展示。
 *   2. 昵称可托管到自建云函数（随账户跨设备同步，非敏感）；头像不上传图片，
 *      用昵称首字在本机渲染。本机 localStorage 只作显示缓存。
 *   3. localStorage 仅存：账户码、端点地址、掩码、昵称、接口缓存。
 */

import { CONFIG } from './config.js';

// 账户码 = 账号 + 登录凭证（一体）；同一浏览器首次访问自动生成并长期复用
const DEVICE_KEY = 'wre_account_id';
const ENDPOINT_KEY = 'wre_account_endpoint';
const MASK_KEY = 'wre_account_mask';       // { masked, hasAiKey, aiMasked }
const PROFILE_KEY = 'wre_account_profile'; // { nickName, avatarUrl }
const CACHE_PREFIX = 'wre_h5_cache_';      // 纯本机临时缓存，无需与官网共享

// 旧版（仅网页版时期）的键名 → 统一键名；首次加载时一次性搬过来，保证登录态不丢
const LEGACY_KEY_MAP = {
  wre_h5_device: DEVICE_KEY,
  wre_h5_endpoint: ENDPOINT_KEY,
  wre_h5_masked: MASK_KEY,
  wre_h5_profile: PROFILE_KEY,
};

(function migrateLegacyKeys() {
  try {
    Object.keys(LEGACY_KEY_MAP).forEach(function (oldKey) {
      const nextKey = LEGACY_KEY_MAP[oldKey];
      if (!localStorage.getItem(nextKey)) {
        const val = localStorage.getItem(oldKey);
        if (val) {
          localStorage.setItem(nextKey, val);
        }
      }
      localStorage.removeItem(oldKey);
    });
  } catch (e) {
    // 隐私模式 / 存储不可用：忽略
  }
})();

/** 生成十六进制随机串（浏览器 CSPRNG，非用户信息） */
function randomHex(bytes) {
  const arr = new Uint8Array(bytes || 16);
  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    cryptoObj.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i += 1) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 账户码：首次访问生成一次（32 位十六进制），之后长期复用；即账号 + 登录凭证 */
export function getDeviceId() {
  let id = '';
  try {
    id = localStorage.getItem(DEVICE_KEY) || '';
  } catch (e) {
    id = '';
  }
  if (!id) {
    id = randomHex(16);
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch (e) {
      // 隐私模式等写入失败：本次会话内用内存值
    }
  }
  return id;
}

/** 退出登录：清空本机账户码、掩码与昵称（下次访问会生成新账户；旧账户可用账户码再登录找回） */
export function resetDeviceId() {
  try {
    localStorage.removeItem(DEVICE_KEY);
    localStorage.removeItem(MASK_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch (e) {
    // 忽略
  }
}

/** 用账户码登录（填入另一台设备的账户码）恢复身份；须为 32 位十六进制。返回是否成功 */
export function setDeviceId(id) {
  const value = String(id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(value)) {
    return false;
  }
  try {
    localStorage.setItem(DEVICE_KEY, value);
    localStorage.removeItem(MASK_KEY);   // 掩码已失效，重新向服务端确认
  } catch (e) {
    return false;
  }
  return true;
}

/** 中转服务地址：网址参数 > 本机保存 > 配置常量 */
export function getEndpoint() {
  let fromQuery = '';
  try {
    fromQuery = new URLSearchParams(location.search).get('endpoint') || '';
  } catch (e) {
    fromQuery = '';
  }
  if (fromQuery) {
    setEndpoint(fromQuery);
    return fromQuery;
  }
  let saved = '';
  try {
    saved = localStorage.getItem(ENDPOINT_KEY) || '';
  } catch (e) {
    saved = '';
  }
  return String(saved || CONFIG.ENDPOINT || '').replace(/\/+$/, '');
}

export function setEndpoint(url) {
  try {
    localStorage.setItem(ENDPOINT_KEY, String(url || '').trim().replace(/\/+$/, ''));
  } catch (e) {
    // 忽略
  }
}

/** 掩码缓存：{ masked, hasKey, aiMasked, hasAiKey } */
export function getMask() {
  try {
    const raw = localStorage.getItem(MASK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setMask(mask) {
  try {
    if (mask) {
      localStorage.setItem(MASK_KEY, JSON.stringify(mask));
    } else {
      localStorage.removeItem(MASK_KEY);
    }
  } catch (e) {
    // 忽略
  }
}

/** 本机资料缓存：{ nickName, avatarUrl }（昵称以服务端为准，这里只作显示与分享署名） */
export function getProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p === 'object') {
      return { nickName: String(p.nickName || ''), avatarUrl: String(p.avatarUrl || '') };
    }
  } catch (e) {
    // 忽略
  }
  return { nickName: '', avatarUrl: '' };
}

export function setProfile(profile) {
  const p = profile || {};
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({
      nickName: String(p.nickName || '').slice(0, 24),
      avatarUrl: String(p.avatarUrl || ''),
    }));
  } catch (e) {
    // 忽略
  }
}

// ---- 通用缓存（带 TTL）----
export function cacheGet(key, ttlMs) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) {
      return null;
    }
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.at !== 'number') {
      return null;
    }
    if (ttlMs && Date.now() - obj.at > ttlMs) {
      return null;
    }
    return obj.value;
  } catch (e) {
    return null;
  }
}

export function cacheSet(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value: value }));
  } catch (e) {
    // 存储满 / 隐私模式：忽略
  }
}

export function cacheClear(key) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch (e) {
    // 忽略
  }
}

// ---- 通用本机键值（供 daily / wander / 卡片存档等使用；值自动 JSON 序列化）----
export function localGet(key, fallback) {
  const def = fallback === undefined ? null : fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null || raw === '' ? def : JSON.parse(raw);
  } catch (e) {
    return def;
  }
}

export function localSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 存储失败不影响主流程
  }
}

export function localRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // 忽略
  }
}
