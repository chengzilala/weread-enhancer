/**
 * 微信悦读 · 移动端云函数（wereadProxy）
 *
 * 为什么需要它：
 *   官方网关 `POST https://i.weread.qq.com/api/agent/gateway` 的 CORS 预检会返回 401，
 *   浏览器 / 小程序端都无法直连。云函数出网不受小程序 request 合法域名白名单限制，
 *   因此由本函数代发请求（与浏览器插件 background.js 的定位一致）。
 *
 * 三个职责（按 event.action 分流，无 action 时走默认的网关中转）：
 *   1. 默认（无 action）      —— 微信读书官方网关中转；
 *   2. action: 'ai'           —— 转发 DeepSeek（B3，Key 由用户自填，我方不内置）；
 *   3. action: 'syncGet/Put'  —— 阅读人格结果云同步（B2，按 openid 隔离）。
 *
 * 红线：
 *   1. 不持久化、不记录任何用户的 Key（日志只允许出现掩码）。
 *   2. 云同步只存「本机算出的人格结果」，按 openid 隔离；不存 Key、不存官方接口原始数据。
 *
 * 部署提醒（重要）：
 *   ① 上传部署后，请在「云开发控制台 → 云函数 → wereadProxy → 配置」把「超时时间」
 *      改为 30 秒（默认只有 3 秒；AI 转发最长用 30 秒，网关中转用 10 秒）。
 *   ② 首次使用云同步（B2）前，请在「云开发控制台 → 数据库」新建集合 `wre_sync`，
 *      权限选「仅创建者可读写」。（函数也会尝试自动创建，但手动建更稳妥。）
 */
'use strict';

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.4'; // 与官方 skill 包 / 插件 background.js 对齐，升级只改这一处
const TIMEOUT_MS = 10000;
const RETRY_BACKOFF_MS = 300; // 瞬时故障重试前的等待

// DeepSeek（B3）：仅转发，Key 由用户自填，不内置我方 Key
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const AI_TIMEOUT_MS = 30000;
const AI_MAX_MESSAGES = 8;
const AI_MAX_TOKENS = 900;

// 云同步（B2）：按 openid 隔离，只存人格结果，不存 Key、不存原始接口数据
const SYNC_COLLECTION = 'wre_sync';
const SYNC_MAX_BYTES = 400 * 1024;

function maskKey(key) {
  if (typeof key !== 'string' || !key) {
    return '(空)';
  }
  return key.slice(0, 4) + '****(' + key.length + ')';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 只对「瞬时故障」重试：连接类失败或网关 5xx；超时不重试（已耗掉时间预算），鉴权/限流也不重试 */
function isRetryable(res) {
  if (!res) {
    return false;
  }
  if (res.error === 'network') {
    return true;
  }
  return typeof res.statusCode === 'number' && res.statusCode >= 500;
}

/** 用 Node 内置 https 发 POST（不引入第三方依赖） */
function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    let target;
    try {
      target = new URL(url);
    } catch (err) {
      done({ error: 'url' });
      return;
    }

    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          headers
        ),
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => done({ statusCode: res.statusCode, raw: raw }));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      done({ error: 'timeout' });
    });
    req.on('error', () => done({ error: 'network' }));
    req.write(payload);
    req.end();
  });
}

/** 带一次瞬时故障重试的发送（日志只出现掩码，不含明文 Key） */
async function postJsonWithRetry(url, headers, body, timeoutMs, apiName, apiKey) {
  const first = await postJson(url, headers, body, timeoutMs);
  if (!isRetryable(first)) {
    return first;
  }
  console.log('[wereadProxy] retry', apiName, { key: maskKey(apiKey) });
  await sleep(RETRY_BACKOFF_MS);
  return await postJson(url, headers, body, timeoutMs);
}

/** 原有职责：微信读书官方网关中转（无 action 时的默认路径，向后兼容） */
async function relayGateway(event) {
  const apiName = event && event.apiName;
  const params = (event && event.params) || {};
  const apiKey = String((event && event.apiKey) || '').trim();

  if (!apiName) {
    return { ok: false, code: 'param', error: '缺少 apiName' };
  }
  if (!apiKey || apiKey.indexOf('wrk-') !== 0) {
    return { ok: false, code: 'param', error: 'API Key 缺失或格式不对（应以 wrk- 开头）' };
  }

  const body = Object.assign({}, params, {
    api_name: apiName,
    skill_version: SKILL_VERSION,
  });

  const res = await postJsonWithRetry(GATEWAY_URL, { Authorization: 'Bearer ' + apiKey }, body, TIMEOUT_MS, apiName, apiKey);

  if (res.error === 'timeout') {
    return { ok: false, code: 'timeout', error: '请求超时（超过 ' + TIMEOUT_MS / 1000 + ' 秒）' };
  }
  if (res.error) {
    return { ok: false, code: 'network', error: '网络不通或官方网关不可达' };
  }

  let data = null;
  try {
    data = res.raw ? JSON.parse(res.raw) : null;
  } catch (err) {
    data = null;
  }
  const snippet = String(res.raw || '').slice(0, 300);

  if (res.statusCode === 401 || res.statusCode === 403) {
    return { ok: false, code: 'auth', error: 'API Key 无效或已失效，请重新填写', snippet: snippet };
  }
  if (res.statusCode === 429) {
    return { ok: false, code: 'rate', error: '请求过于频繁，请稍后再试', snippet: snippet };
  }
  if (res.statusCode >= 500) {
    return { ok: false, code: 'http', error: '官方网关暂时不可用（HTTP ' + res.statusCode + '），请稍后重试', snippet: snippet };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    return { ok: false, code: 'http', error: '官方网关返回异常（HTTP ' + res.statusCode + '）', snippet: snippet };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, code: 'parse', error: '官方网关返回内容无法解析', snippet: snippet };
  }
  if (typeof data.errcode === 'number' && data.errcode !== 0) {
    return {
      ok: false,
      code: 'errcode',
      errcode: data.errcode,
      error: data.errmsg || data.errmsg_cn || '官方接口返回错误（errcode ' + data.errcode + '）',
      snippet: snippet,
    };
  }

  console.log('[wereadProxy] ok', apiName, { key: maskKey(apiKey) });
  return { ok: true, data: data, upgrade: data.upgrade_info || null };
}

// ---------- B3：DeepSeek 转发（Key 由用户自填，我方不内置） ----------

async function handleAi(event) {
  const apiKey = String((event && event.apiKey) || '').trim();
  const messages = event && Array.isArray(event.messages) ? event.messages : null;

  if (apiKey.indexOf('sk-') !== 0) {
    return { ok: false, code: 'param', error: 'DeepSeek Key 缺失或格式不对（应以 sk- 开头）' };
  }
  if (!messages || !messages.length) {
    return { ok: false, code: 'param', error: '缺少对话内容' };
  }
  if (messages.length > AI_MAX_MESSAGES) {
    return { ok: false, code: 'param', error: '对话内容过长' };
  }

  const res = await postJson(
    DEEPSEEK_URL,
    { Authorization: 'Bearer ' + apiKey },
    { model: DEEPSEEK_MODEL, messages: messages, temperature: 0.7, stream: false, max_tokens: AI_MAX_TOKENS },
    AI_TIMEOUT_MS
  );

  if (res.error === 'timeout') {
    return { ok: false, code: 'timeout', error: 'AI 生成超时（超过 ' + AI_TIMEOUT_MS / 1000 + ' 秒），请重试' };
  }
  if (res.error) {
    return { ok: false, code: 'network', error: '网络不通或 AI 服务不可达' };
  }

  let data = null;
  try {
    data = res.raw ? JSON.parse(res.raw) : null;
  } catch (err) {
    data = null;
  }
  const snippet = String(res.raw || '').slice(0, 300);

  if (res.statusCode === 401 || res.statusCode === 403) {
    return { ok: false, code: 'ai_auth', error: 'DeepSeek Key 无效或已失效，请重新填写', snippet: snippet };
  }
  if (res.statusCode === 402) {
    return { ok: false, code: 'ai_pay', error: 'DeepSeek 账户余额不足', snippet: snippet };
  }
  if (res.statusCode === 429) {
    return { ok: false, code: 'rate', error: 'AI 请求过于频繁，请稍后再试', snippet: snippet };
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    return { ok: false, code: 'http', error: 'AI 服务返回异常（HTTP ' + res.statusCode + '）', snippet: snippet };
  }

  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) {
    return { ok: false, code: 'parse', error: 'AI 返回内容无法解析', snippet: snippet };
  }

  console.log('[wereadProxy] ai ok', { key: maskKey(apiKey) });
  return { ok: true, text: String(text).trim() };
}

// ---------- B2：云同步（按 openid 隔离，只存人格结果） ----------

async function handleSync(event) {
  const action = event && event.action;
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }

  const db = cloud.database();
  const coll = db.collection(SYNC_COLLECTION);

  if (action === 'syncGet') {
    try {
      const r = await coll.doc(openid).get();
      return { ok: true, data: (r.data && r.data.persona) || null, updatedAt: (r.data && r.data.updatedAt) || 0 };
    } catch (err) {
      // 文档不存在（或集合还没建）都按「无云端数据」处理
      return { ok: true, data: null, updatedAt: 0 };
    }
  }

  const persona = event && event.persona;
  if (!persona || typeof persona !== 'object') {
    return { ok: false, code: 'param', error: '缺少待同步数据' };
  }
  const payload = { persona: persona, updatedAt: Date.now() };
  if (JSON.stringify(payload).length > SYNC_MAX_BYTES) {
    return { ok: false, code: 'toobig', error: '数据过大，未同步' };
  }

  try {
    await coll.doc(openid).set({ data: payload });
  } catch (err) {
    // 集合不存在时尝试建集合后重试一次
    try {
      await db.createCollection(SYNC_COLLECTION);
      await coll.doc(openid).set({ data: payload });
    } catch (err2) {
      return { ok: false, code: 'sync', error: '同步写入失败：' + ((err2 && err2.errMsg) || '未知错误') };
    }
  }
  return { ok: true, updatedAt: payload.updatedAt };
}

exports.main = async (event) => {
  const action = event && event.action;
  if (action === 'ai') {
    return await handleAi(event);
  }
  if (action === 'syncGet' || action === 'syncPut') {
    return await handleSync(event);
  }
  return await relayGateway(event);
};
