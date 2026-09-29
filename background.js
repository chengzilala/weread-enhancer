/**
 * 微信悦读 · 官方数据后台代理（v0.11.0）
 *
 * 定位：MV3 service worker，只做「官方 Agent 网关」这一件事。
 *
 * 为什么必须有它（已实测）：
 *   网关 `POST https://i.weread.qq.com/api/agent/gateway` 的 CORS 预检
 *   （OPTIONS 带 Authorization 时）返回 401，浏览器会判定预检失败，
 *   内容脚本直连会被拦。故所有请求统一由本后台发起 —— 已声明
 *   host_permissions 的扩展发起请求不受页面 CORS 限制。
 *
 * 职责：
 *   1. 保存 / 校验 / 清除用户自己的 `wrk-` API Key（chrome.storage.local）
 *   2. 转发网关调用，统一补 Authorization 与 skill_version
 *   3. 统一处理超时 / HTTP 状态 / errcode / upgrade_info
 *
 * 红线：API Key 只在后台读取使用，不写日志（日志里只允许出现掩码）、不外传。
 */
'use strict';

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.4';          // 与官方 skill 包 version 对齐，升级只改这一处
const STORAGE_KEY = 'wreOfficialSkill';
const TIMEOUT_MS = 10000;

function maskKey(key) {
  if (typeof key !== 'string' || !key) {
    return '(空)';
  }
  return key.slice(0, 4) + '****(' + key.length + ')';
}

function logBg(level, message, meta) {
  const fn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
  fn('[official][bg] ' + message, meta === undefined ? '' : meta);
}

async function readSkillState() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return result[STORAGE_KEY] || null;
}

/**
 * 统一调用网关。apiKey 必传（后台不替调用方兜底，避免误用未配置状态）。
 * 返回 { ok:true, data, upgrade } 或 { ok:false, code, error, errcode? }
 */
async function callGateway(apiName, params, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const body = Object.assign({}, params || {}, {
    api_name: apiName,
    skill_version: SKILL_VERSION,
  });

  try {
    const resp = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await resp.json();
    } catch (parseErr) {
      data = null;
    }

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, code: 'auth', error: 'API Key 无效或已失效，请在「设置」里重新填写' };
    }
    if (!resp.ok) {
      return { ok: false, code: 'http', error: '官方网关返回异常（HTTP ' + resp.status + '）' };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, code: 'parse', error: '官方网关返回内容无法解析' };
    }
    if (typeof data.errcode === 'number' && data.errcode !== 0) {
      return {
        ok: false,
        code: 'errcode',
        errcode: data.errcode,
        error: data.errmsg || data.errmsg_cn || ('官方接口返回错误（errcode ' + data.errcode + '）'),
      };
    }
    return { ok: true, data: data, upgrade: data.upgrade_info || null };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, code: 'timeout', error: '请求超时（超过 ' + (TIMEOUT_MS / 1000) + ' 秒）' };
    }
    return { ok: false, code: 'network', error: '网络不通或官方网关不可达' };
  } finally {
    clearTimeout(timer);
  }
}

/** 校验 Key：先探连通（/_list 不需要身份），再用需要登录的轻量接口确认真实有效 */
async function verifyKey(apiKey) {
  const ping = await callGateway('/_list', {}, apiKey);
  if (!ping.ok) {
    return ping;
  }
  const probe = await callGateway('/readdata/detail', { mode: 'weekly', baseTime: 0 }, apiKey);
  if (!probe.ok) {
    return probe;
  }
  logBg('info', 'Key 校验通过', { key: maskKey(apiKey) });
  return { ok: true, data: probe.data, upgrade: probe.upgrade };
}

async function handleMessage(message) {
  const type = message && message.type;

  if (type === 'wre-official-status') {
    const skill = await readSkillState();
    return {
      ok: true,
      hasKey: !!(skill && skill.apiKey),
      savedAt: skill ? skill.savedAt || 0 : 0,
      lastVerifiedAt: skill ? skill.lastVerifiedAt || 0 : 0,
      skillVersion: SKILL_VERSION,
    };
  }

  if (type === 'wre-official-save') {
    const apiKey = String(message.apiKey || '').trim();
    if (!apiKey) {
      return { ok: false, code: 'empty', error: '请先粘贴 API Key' };
    }
    if (apiKey.indexOf('wrk-') !== 0) {
      return { ok: false, code: 'format', error: 'Key 格式不对：应以 wrk- 开头' };
    }
    const verified = await verifyKey(apiKey);
    if (!verified.ok) {
      return verified;
    }
    const now = Date.now();
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        apiKey: apiKey,
        savedAt: now,
        lastVerifiedAt: now,
        skillVersion: SKILL_VERSION,
      },
    });
    // 换了 Key，旧的报告缓存不能再用
    await chrome.storage.local.remove('wreOfficialReportCache');
    logBg('info', '已保存 API Key', { key: maskKey(apiKey) });
    return { ok: true, hasKey: true, savedAt: now, lastVerifiedAt: now };
  }

  if (type === 'wre-official-clear') {
    await chrome.storage.local.remove([STORAGE_KEY, 'wreOfficialReportCache']);
    logBg('warn', '已清除 API Key 与报告缓存');
    return { ok: true, hasKey: false };
  }

  if (type === 'wre-official-call') {
    const skill = await readSkillState();
    if (!skill || !skill.apiKey) {
      return { ok: false, code: 'nokey', error: '尚未配置 API Key' };
    }
    const result = await callGateway(message.apiName, message.params, skill.apiKey);
    if (result.ok) {
      // 顺手更新「最近使用时间」，但不动 Key 本身
      const now = Date.now();
      await chrome.storage.local.set({
        [STORAGE_KEY]: Object.assign({}, skill, { lastUsedAt: now }),
      });
    } else if (result.code === 'auth') {
      logBg('warn', '网关鉴权失败（Key 可能已失效）', { key: maskKey(skill.apiKey) });
    }
    return result;
  }

  return { ok: false, code: 'unknown', error: '未知的后台请求类型' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      logBg('error', '后台处理异常', { message: err && err.message });
      sendResponse({ ok: false, code: 'bg', error: '后台处理异常：' + (err && err.message ? err.message : '未知错误') });
    });
  return true; // 异步响应
});
