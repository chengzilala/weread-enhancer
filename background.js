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

// DeepSeek（AI 增强，可选项）：数字本地算、人格化文字交给 DeepSeek 生成。
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_STORAGE_KEY = 'wreDeepSeekKey';
const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_TIMEOUT_MS = 30000;      // AI 生成较慢，放宽到 30 秒

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

async function readAiState() {
  const result = await chrome.storage.local.get([DEEPSEEK_STORAGE_KEY]);
  return result[DEEPSEEK_STORAGE_KEY] || null;
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

    let raw = '';
    let data = null;
    try {
      raw = await resp.text();
      data = raw ? JSON.parse(raw) : null;
    } catch (parseErr) {
      data = null;
    }
    const snippet = String(raw || '').slice(0, 300);

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, code: 'auth', error: 'API Key 无效或已失效，请在「设置」里重新填写', snippet };
    }
    if (!resp.ok) {
      return { ok: false, code: 'http', error: '官方网关返回异常（HTTP ' + resp.status + '）', snippet };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, code: 'parse', error: '官方网关返回内容无法解析', snippet };
    }
    if (typeof data.errcode === 'number' && data.errcode !== 0) {
      return {
        ok: false,
        code: 'errcode',
        errcode: data.errcode,
        error: data.errmsg || data.errmsg_cn || ('官方接口返回错误（errcode ' + data.errcode + '）'),
        snippet,
      };
    }
    return { ok: true, data: data, upgrade: data.upgrade_info || null, snippet };
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

/**
 * 调用 DeepSeek chat/completions（OpenAI 兼容格式）。
 * 返回 { ok:true, text } 或 { ok:false, code, error, snippet? }
 */
async function callDeepSeek(messages, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
      }),
      signal: controller.signal,
    });

    let raw = '';
    let data = null;
    try {
      raw = await resp.text();
      data = raw ? JSON.parse(raw) : null;
    } catch (parseErr) {
      data = null;
    }
    const snippet = String(raw || '').slice(0, 300);

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, code: 'auth', error: 'DeepSeek Key 无效或已失效，请在「设置」里重新填写', snippet };
    }
    if (!resp.ok) {
      return { ok: false, code: 'http', error: 'DeepSeek 返回异常（HTTP ' + resp.status + '）', snippet };
    }
    const content = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      return { ok: false, code: 'parse', error: 'DeepSeek 返回内容无法解析', snippet };
    }
    return { ok: true, text: content, snippet };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, code: 'timeout', error: 'AI 生成超时（超过 ' + (DEEPSEEK_TIMEOUT_MS / 1000) + ' 秒）' };
    }
    return { ok: false, code: 'network', error: '网络不通或 DeepSeek 不可达' };
  } finally {
    clearTimeout(timer);
  }
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
    // 换了 Key，旧的报告与书架/笔记缓存都不能再用
    await chrome.storage.local.remove(['wreOfficialReportCache', 'wreOfficialOverviewCache']);
    logBg('info', '已保存 API Key', { key: maskKey(apiKey) });
    return { ok: true, hasKey: true, savedAt: now, lastVerifiedAt: now };
  }

  if (type === 'wre-official-clear') {
    await chrome.storage.local.remove([STORAGE_KEY, 'wreOfficialReportCache', 'wreOfficialOverviewCache']);
    logBg('warn', '已清除 API Key 与报告/书架笔记缓存');
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

  if (type === 'wre-ai-status') {
    const ai = await readAiState();
    return { ok: true, hasKey: !!(ai && ai.apiKey), savedAt: ai ? ai.savedAt || 0 : 0 };
  }

  if (type === 'wre-ai-save') {
    const apiKey = String(message.apiKey || '').trim();
    if (!apiKey) {
      return { ok: false, code: 'empty', error: '请先粘贴 DeepSeek Key' };
    }
    if (apiKey.indexOf('sk-') !== 0) {
      return { ok: false, code: 'format', error: 'Key 格式不对：应以 sk- 开头' };
    }
    const now = Date.now();
    await chrome.storage.local.set({
      [DEEPSEEK_STORAGE_KEY]: { apiKey: apiKey, savedAt: now },
    });
    logBg('info', '已保存 DeepSeek Key', { key: maskKey(apiKey) });
    return { ok: true, hasKey: true, savedAt: now };
  }

  if (type === 'wre-ai-clear') {
    await chrome.storage.local.remove([DEEPSEEK_STORAGE_KEY]);
    logBg('warn', '已清除 DeepSeek Key');
    return { ok: true, hasKey: false };
  }

  if (type === 'wre-ai-chat') {
    const ai = await readAiState();
    if (!ai || !ai.apiKey) {
      return { ok: false, code: 'nokey', error: '尚未配置 DeepSeek Key' };
    }
    const messages = Array.isArray(message.messages) ? message.messages : [];
    if (!messages.length) {
      return { ok: false, code: 'empty', error: '缺少对话内容' };
    }
    return await callDeepSeek(messages, ai.apiKey);
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
