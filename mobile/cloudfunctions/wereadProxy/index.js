/**
 * 微信悦读 · 移动端中转云函数（wereadProxy）
 *
 * 为什么需要它：
 *   官方网关 `POST https://i.weread.qq.com/api/agent/gateway` 的 CORS 预检会返回 401，
 *   浏览器 / 小程序端都无法直连。云函数出网不受小程序 request 合法域名白名单限制，
 *   因此由本函数代发请求（与浏览器插件 background.js 的定位一致）。
 *
 * 红线：
 *   1. 不持久化、不记录用户的 apiKey（日志只允许出现掩码）。
 *   2. 除转发外不做任何事，不落库、不缓存用户数据。
 */
'use strict';

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.4'; // 与官方 skill 包 / 插件 background.js 对齐，升级只改这一处
const TIMEOUT_MS = 10000;

function maskKey(key) {
  if (typeof key !== 'string' || !key) {
    return '(空)';
  }
  return key.slice(0, 4) + '****(' + key.length + ')';
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

exports.main = async (event) => {
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

  const res = await postJson(GATEWAY_URL, { Authorization: 'Bearer ' + apiKey }, body, TIMEOUT_MS);

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
};
