/**
 * 中转服务客户端（H5）
 *
 * 所有请求都 POST 到云函数 wereadProxy 的 HTTP 网关地址（控制台「HTTP 网关」绑定的路由），body 为 JSON；
 * 统一带上本机 deviceId，Key 由服务端按 deviceId 取（前端不持有明文 Key）。
 * 返回结构与云函数一致：{ ok:true, ... } 或 { ok:false, code, error }。
 */

import { CONFIG } from './config.js';
import { getEndpoint, getDeviceId } from './store.js';

/** 底层调用：POST + JSON，失败一律归一为 { ok:false, code, error } */
async function call(body, timeoutMs) {
  const url = getEndpoint();
  if (!url) {
    return { ok: false, code: 'noendpoint', error: '尚未配置中转服务地址（开发者需在 h5/src/config.js 填写 ENDPOINT）' };
  }
  const payload = Object.assign({ deviceId: getDeviceId() }, body || {});
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || CONFIG.DEFAULT_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (err) {
    if (timer) {
      clearTimeout(timer);
    }
    if (err && err.name === 'AbortError') {
      return { ok: false, code: 'timeout', error: '请求超时，请检查网络后重试' };
    }
    return { ok: false, code: 'network', error: '网络不通或中转服务不可达' };
  }
  if (timer) {
    clearTimeout(timer);
  }

  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, code: 'network', error: '读取中转服务响应失败' };
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = null;
  }
  if (!data || typeof data.ok !== 'boolean') {
    return { ok: false, code: 'empty', error: '中转服务未返回有效结果（HTTP ' + res.status + '）' };
  }
  return data;
}

// ---- 官方网关中转 ----
export function relay(apiName, params) {
  return call({ action: 'relay', apiName: apiName, params: params || {} }, CONFIG.RELAY_TIMEOUT_MS);
}

/** 校验 Key：先探连通（/_list 不需要身份），再用需要登录的轻量接口确认真实有效 */
export async function verifyKey() {
  const ping = await relay('/_list', {});
  if (!ping.ok) {
    return ping;
  }
  return await relay('/readdata/detail', { mode: 'weekly', baseTime: 0 });
}

// ---- AI 转发 ----
export function ai(messages) {
  return call({ action: 'ai', messages: messages }, CONFIG.AI_TIMEOUT_MS);
}

// ---- Key 托管 ----
export function keySave(apiKey, aiKey) {
  return call({ action: 'keySave', apiKey: apiKey || '', aiKey: aiKey || '' });
}

export function keyGet() {
  return call({ action: 'keyGet' });
}

export function keyClear() {
  return call({ action: 'keyClear' });
}

/** 保存昵称（非敏感，托管到自建云函数，随账户跨设备同步） */
export function profileSave(nickName) {
  return call({ action: 'profileSave', nickName: nickName || '' });
}

// ---- 人格结果云同步 ----
export function syncGet() {
  return call({ action: 'syncGet' });
}

export function syncPut(persona) {
  return call({ action: 'syncPut', persona: persona });
}

// ---- H5 匿名使用量 / 运营看板 ----
export function opsPing(version) {
  return call({ action: 'opsPing', version: version || '' });
}

export function opsAdmin(token) {
  return call({ action: 'opsAdmin', token: token || '' });
}
