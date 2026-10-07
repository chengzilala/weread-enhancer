/**
 * 本机存储（H5 版）
 *
 * 红线：
 *   1. 微信读书 wrk- / DeepSeek sk- Key **不落本机**，只交服务端加密托管（见 H1）；
 *      本机仅保存 deviceId 与「掩码」，用于识别与展示。
 *   2. 本机资料（昵称 / 头像）只存 localStorage，用于分享署名，不上传。
 *   3. localStorage 仅存：deviceId、端点地址、掩码、昵称头像、接口缓存。
 */

import { CONFIG } from './config.js';

const DEVICE_KEY = 'wre_h5_device';
const ENDPOINT_KEY = 'wre_h5_endpoint';
const MASK_KEY = 'wre_h5_masked';          // { masked, hasAiKey, aiMasked }
const PROFILE_KEY = 'wre_h5_profile';      // { nickName, avatarUrl }
const CACHE_PREFIX = 'wre_h5_cache_';

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

/** 设备标识：首次访问生成一次（32 位十六进制），之后长期复用 */
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

/** 更换设备标识（相当于「换一个身份」，会与已托管的 Key 失联） */
export function resetDeviceId() {
  try {
    localStorage.removeItem(DEVICE_KEY);
    localStorage.removeItem(MASK_KEY);
  } catch (e) {
    // 忽略
  }
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

/** 本机资料：{ nickName, avatarUrl } */
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
