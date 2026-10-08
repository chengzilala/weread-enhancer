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
 *   4. 账户与多端同步（可选，默认关闭）：账户码即账号，Key 加密托管到云函数以便跨端找回
 *
 * 红线：API Key 只在后台读取使用，不写日志（日志里只允许出现掩码）；
 *      未启用账户同步时 Key 只存本机、不联网；启用后仅经 HTTPS 提交给用户自建云函数加密托管。
 */
'use strict';

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.4';          // 与官方 skill 包 version 对齐，升级只改这一处
const STORAGE_KEY = 'wreOfficialSkill';
const TIMEOUT_MS = 10000;

// DeepSeek（AI 增强，可选项）：数字本地算、人格化文字交给 DeepSeek 生成。
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';
const DEEPSEEK_STORAGE_KEY = 'wreDeepSeekKey';
const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_TIMEOUT_MS = 30000;      // AI 生成较慢，放宽到 30 秒

// 配套网站（帮助中心 / 版本检查）：只读一个公开的静态 JSON，不带任何用户数据。
const SITE_LATEST_URL = 'https://wereadapp-32km31c.maozi.io/api/latest.json';
const HELP_TIMEOUT_MS = 3000;

// 账户与多端同步（可选，默认关闭）：账户码 deviceId 即账号，Key 由云函数加密托管以便跨端找回。
// 未启用时行为与旧版完全一致（Key 只存本机 chrome.storage.local，不联网）。
const CLOUD_ENDPOINT = 'https://cloud1-d4g1dq0sc7f62329d-1500443307.ap-shanghai.app.tcloudbase.com/h5';
const ACCOUNT_KEY = 'wreAccount';        // { id: 32位账户码, sync: 是否启用云端同步 }
const CLOUD_TIMEOUT_MS = 10000;

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

// ---------- 账户与多端同步（可选） ----------

/** 32 位十六进制账户码（等价于 H5 / 官网 store.js 生成的 deviceId） */
function randomHex(nBytes) {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function readAccount() {
  const result = await chrome.storage.local.get([ACCOUNT_KEY]);
  const a = result[ACCOUNT_KEY] || {};
  return { id: typeof a.id === 'string' ? a.id : '', sync: !!a.sync };
}

async function writeAccount(patch) {
  const cur = await readAccount();
  const next = Object.assign({}, cur, patch || {});
  await chrome.storage.local.set({ [ACCOUNT_KEY]: next });
  return next;
}

/** 账户码不存在时生成一个（不改变 sync 开关） */
async function ensureAccountId() {
  const acc = await readAccount();
  if (acc.id) {
    return acc.id;
  }
  const id = randomHex(16);
  await writeAccount({ id: id });
  return id;
}

/**
 * 调用云函数 HTTP 网关（POST + JSON）。
 * 扩展后台 fetch 不受页面 CORS 限制（host_permissions 已含 *.tcloudbase.com），无需预检配合。
 */
async function callCloud(action, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || CLOUD_TIMEOUT_MS);
  try {
    const resp = await fetch(CLOUD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
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
    if (!data || typeof data.ok !== 'boolean') {
      return { ok: false, code: 'empty', error: '云端未返回有效结果（HTTP ' + resp.status + '）' };
    }
    return data;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, code: 'timeout', error: '云端请求超时，请稍后重试' };
    }
    return { ok: false, code: 'network', error: '云端服务不可达（检查网络后重试）' };
  } finally {
    clearTimeout(timer);
  }
}

/** 把本机已配置的 Key 推送到云端托管（仅在启用同步时；best-effort，失败不影响本机使用） */
async function pushKeysToCloud() {
  const acc = await readAccount();
  if (!acc.sync || !acc.id) {
    return { ok: false, code: 'off' };
  }
  const skill = await readSkillState();
  const ai = await readAiState();
  const apiKey = skill && skill.apiKey ? skill.apiKey : '';
  const aiKey = ai && ai.apiKey ? ai.apiKey : '';
  if (!apiKey && !aiKey) {
    return { ok: true, skipped: true };
  }
  return await callCloud('keySave', { deviceId: acc.id, apiKey: apiKey, aiKey: aiKey });
}

/** 从云端把托管 Key 拉回本机（覆盖本机 Key 缓存；供登录 / 启用后对齐） */
async function pullKeysFromCloud() {
  const acc = await readAccount();
  if (!acc.id) {
    return { ok: false, code: 'noid', error: '尚未启用账户' };
  }
  const res = await callCloud('keyPull', { deviceId: acc.id });
  if (!res.ok) {
    return res;
  }
  const now = Date.now();
  if (res.apiKey) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: { apiKey: res.apiKey, savedAt: now, lastVerifiedAt: now, skillVersion: SKILL_VERSION },
    });
    await chrome.storage.local.remove(['wreOfficialReportCache', 'wreOfficialOverviewCache']);
  } else {
    await chrome.storage.local.remove([STORAGE_KEY, 'wreOfficialReportCache', 'wreOfficialOverviewCache']);
  }
  if (res.aiKey) {
    await chrome.storage.local.set({
      [DEEPSEEK_STORAGE_KEY]: { apiKey: res.aiKey, savedAt: now, lastVerifiedAt: now },
    });
  } else {
    await chrome.storage.local.remove([DEEPSEEK_STORAGE_KEY]);
  }
  return { ok: true, hasKey: !!res.apiKey, hasAiKey: !!res.aiKey };
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

/** 校验 DeepSeek Key：调 models 接口确认身份有效（不消耗推理 token） */
async function verifyAiKey(apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(DEEPSEEK_MODELS_URL, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      signal: controller.signal,
    });
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, code: 'auth', error: 'DeepSeek Key 无效或已失效，请重新填写' };
    }
    if (!resp.ok) {
      return { ok: false, code: 'http', error: 'DeepSeek 校验返回异常（HTTP ' + resp.status + '）' };
    }
    logBg('info', 'DeepSeek Key 校验通过', { key: maskKey(apiKey) });
    return { ok: true };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, code: 'timeout', error: '校验超时，请检查网络后重试' };
    }
    return { ok: false, code: 'network', error: '网络不通或 DeepSeek 不可达' };
  } finally {
    clearTimeout(timer);
  }
}

/** 拉取配套网站的版本公告（只读 GET，超时 3s，失败静默由调用方兜底） */
async function fetchSiteLatest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HELP_TIMEOUT_MS);
  try {
    const resp = await fetch(SITE_LATEST_URL, { method: 'GET', signal: controller.signal, cache: 'no-store' });
    const raw = await resp.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (parseErr) {
      data = null;
    }
    if (!resp.ok || !data || typeof data !== 'object') {
      return { ok: false, code: 'http', error: '站点版本接口返回异常' };
    }
    return { ok: true, data: data };
  } catch (err) {
    return {
      ok: false,
      code: err && err.name === 'AbortError' ? 'timeout' : 'network',
      error: '站点版本接口不可达',
    };
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
      apiKey: skill && skill.apiKey ? skill.apiKey : '',
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
    const synced = await pushKeysToCloud();
    logBg('info', '已保存 API Key', { key: maskKey(apiKey) });
    return { ok: true, hasKey: true, savedAt: now, lastVerifiedAt: now, synced: !!(synced && synced.ok) };
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
    return {
      ok: true,
      hasKey: !!(ai && ai.apiKey),
      apiKey: ai && ai.apiKey ? ai.apiKey : '',
      savedAt: ai ? ai.savedAt || 0 : 0,
    };
  }

  if (type === 'wre-ai-save') {
    const apiKey = String(message.apiKey || '').trim();
    if (!apiKey) {
      return { ok: false, code: 'empty', error: '请先粘贴 DeepSeek Key' };
    }
    if (apiKey.indexOf('sk-') !== 0) {
      return { ok: false, code: 'format', error: 'Key 格式不对：应以 sk- 开头' };
    }
    const verified = await verifyAiKey(apiKey);
    if (!verified.ok) {
      return verified;
    }
    const now = Date.now();
    await chrome.storage.local.set({
      [DEEPSEEK_STORAGE_KEY]: { apiKey: apiKey, savedAt: now, lastVerifiedAt: now },
    });
    const synced = await pushKeysToCloud();
    logBg('info', '已保存 DeepSeek Key', { key: maskKey(apiKey) });
    return { ok: true, hasKey: true, savedAt: now, lastVerifiedAt: now, synced: !!(synced && synced.ok) };
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

  if (type === 'wre-help-latest') {
    return await fetchSiteLatest();
  }

  // ---------- 账户与多端同步 ----------

  if (type === 'wre-account-status') {
    const acc = await readAccount();
    let cloud = null;
    if (acc.sync && acc.id) {
      const res = await callCloud('keyGet', { deviceId: acc.id });
      if (res.ok) {
        cloud = {
          hasKey: !!res.hasKey,
          masked: res.masked || '',
          hasAiKey: !!res.hasAiKey,
          aiMasked: res.aiMasked || '',
          nickName: res.nickName || '',
        };
      }
    }
    return { ok: true, sync: acc.sync, deviceId: acc.id, cloud: cloud };
  }

  if (type === 'wre-account-enable') {
    const id = await ensureAccountId();
    await writeAccount({ sync: true });
    const pushed = await pushKeysToCloud();
    logBg('info', '已启用账户与云端同步', { device: id.slice(0, 6) + '…', pushed: !!(pushed && pushed.ok) });
    return { ok: true, deviceId: id, pushed: !!(pushed && pushed.ok) };
  }

  if (type === 'wre-account-disable') {
    await writeAccount({ sync: false });
    logBg('warn', '已关闭云端同步（本机 Key 保留）');
    return { ok: true };
  }

  if (type === 'wre-account-login') {
    const code = String(message.deviceId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(code)) {
      return { ok: false, code: 'format', error: '账户码应为 32 位十六进制字符' };
    }
    await writeAccount({ id: code, sync: true });
    const pulled = await pullKeysFromCloud();
    return {
      ok: true,
      deviceId: code,
      pulled: !!pulled.ok,
      hasKey: !!pulled.hasKey,
      hasAiKey: !!pulled.hasAiKey,
      pullError: pulled.ok ? '' : (pulled.error || '云端 Key 拉取失败'),
    };
  }

  if (type === 'wre-account-redeem') {
    const code = String(message.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return { ok: false, code: 'format', error: '请输入 6 位数字登录码' };
    }
    const res = await callCloud('bindRedeem', { code: code });
    if (!res.ok) {
      return res;
    }
    const deviceId = String(res.deviceId || '').toLowerCase();
    await writeAccount({ id: deviceId, sync: true });
    const pulled = await pullKeysFromCloud();
    return {
      ok: true,
      deviceId: deviceId,
      pulled: !!pulled.ok,
      hasKey: !!pulled.hasKey,
      hasAiKey: !!pulled.hasAiKey,
      pullError: pulled.ok ? '' : (pulled.error || '云端 Key 拉取失败'),
    };
  }

  if (type === 'wre-account-gencode') {
    const acc = await readAccount();
    if (!acc.id) {
      return { ok: false, code: 'noid', error: '请先启用账户' };
    }
    return await callCloud('bindCreate', { deviceId: acc.id });
  }

  if (type === 'wre-account-clearcloud') {
    const acc = await readAccount();
    if (!acc.id) {
      return { ok: false, code: 'noid', error: '请先启用账户' };
    }
    return await callCloud('keyClear', { deviceId: acc.id });
  }

  if (type === 'wre-account-logout') {
    await chrome.storage.local.remove([ACCOUNT_KEY]);
    logBg('warn', '已退出账户（本机 Key 保留，云端 Key 不动）');
    return { ok: true };
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
