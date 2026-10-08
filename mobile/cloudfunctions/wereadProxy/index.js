/**
 * 微信悦读 · 移动端云函数（wereadProxy）
 *
 * 为什么需要它：
 *   官方网关 `POST https://i.weread.qq.com/api/agent/gateway` 的 CORS 预检会返回 401，
 *   浏览器 / 小程序端都无法直连。云函数出网不受小程序 request 合法域名白名单限制，
 *   因此由本函数代发请求（与浏览器插件 background.js 的定位一致）。
 *
 * 职责（按 event.action 分流，无 action 时走默认的网关中转）：
 *   1. 默认（无 action）      —— 微信读书官方网关中转；
 *   2. action: 'ai'           —— 转发 DeepSeek（B3，Key 由用户自填，我方不内置）；
 *                               **M15 已关闭**（小程序内彻底去 AI），仅 H5 侧保留；
 *   3. action: 'syncGet/Put'  —— 阅读人格结果云同步（B2，按 openid 隔离）；
 *   4. action: 'opsPing'      —— 小程序使用量上报（M13，按天去重 openid）；
 *   5. action: 'opsReport'    —— 插件匿名统计上报（M13，HTTP 访问服务，无 openid）；
 *   6. action: 'opsWhoami'    —— 判断当前调用者是否管理员，并回传自己的 openid（M13，用于自助配置白名单）；
 *   7. action: 'opsAdmin'     —— 管理员看板数据（M13，非白名单一律不下发）。
 *   8. action: 'pbGet/pbPut'  —— 我的纸书云端备份（按 openid 隔离，只存纸书档案，不含 Key）。
 *   9. action: 'imgScan'      —— 我的纸书拍照识码（M2，云调用 img.scanQRCode 识别图片里的条码）。
 *  10. action: 'bindClaim'    —— 小程序端认领绑定（6 位绑定码 / 直接粘贴账户码），建立 openid ↔ deviceId 映射。
 *  11. action: 'bindInfo'     —— 查询小程序当前是否已关联网页账户（含账户昵称）。
 *  12. action: 'bindUnbind'   —— 小程序端解除关联（把账户侧最新数据回搬本机，保留本机数据）。
 *  13. action: 'profilePut'   —— 小程序端把昵称写入已绑定账户（随账户在网页端可见）。
 *
 * H5（纯网页 App）走 HTTP 访问服务，`handleHttp` 额外支持：
 *   - action: 'relay'         —— 用托管 Key 走官方网关中转（{deviceId, apiName, params}）；
 *   - action: 'ai'            —— 用托管 DeepSeek Key 转发（{deviceId, messages}）；
 *   - action: 'keySave'       —— Key 加密托管（{deviceId, apiKey?, aiKey?}，集合 wre_users）；
 *   - action: 'keyGet'        —— 只回「是否已配置 + 掩码 + 昵称」（{deviceId}）；
 *   - action: 'keyPull'       —— 回传托管 Key 的**明文**（{deviceId}，仅供浏览器插件拉回本机直发）；
 *   - action: 'keyClear'      —— 清除托管 Key（{deviceId}）；
 *   - action: 'profileSave'   —— 保存昵称（{deviceId, nickName}，非敏感，随账户走）；
 *   - action: 'syncGet/Put'   —— 人格结果按 deviceId 云同步；
 *   - action: 'bindCreate'    —— 网页端生成一次性绑定码（{deviceId} → {code, expireAt}）；
 *   - action: 'bindStatus'    —— 网页端查询本账户是否已被小程序绑定（{deviceId} → {linked}）；
 *   - action: 'bindRemove'    —— 网页端解除绑定（{deviceId}）；
 *   - action: 'bindRedeem'    —— 另一台网页端凭 6 位码换回账户码（{code} → {deviceId}，H5↔H5 跨设备登录）；
 *   - action: 'opsPing'       —— H5 匿名使用量（{deviceId, version}，按 deviceId + 天去重）；
 *   - action: 'opsAdmin'      —— H5 运营看板（{deviceId}，账户码白名单内才下发）。
 *
 * 红线：
 *   1. 不持久化、不记录任何用户的 Key（日志只允许出现掩码）；
 *      H5 的 Key 托管为**用户明示同意**后的加密存储（集合 wre_users，应用层 AES-256-GCM），可一键清除。
 *   2. 云同步只存「本机算出的人格结果」，按 openid / deviceId 隔离；不存 Key、不存官方接口原始数据。
 *   3. 运营统计（M13）只存「聚合计数 + 随机匿名标识 / openid 去重键」，绝不存阅读数据 / Key / 书目 / 笔记 / IP。
 *
 * 部署提醒（重要）：
 *   ① 上传部署后，请在「云开发控制台 → 云函数 → wereadProxy → 配置」把「超时时间」
 *      改为 30 秒（默认只有 3 秒；AI 转发最长用 30 秒，网关中转用 10 秒）。
 *   ② 首次使用云同步（B2）前，请在「云开发控制台 → 数据库」新建集合 `wre_sync`，
 *      权限选「仅创建者可读写」。（函数也会尝试自动创建，但手动建更稳妥。）
 *      「我的纸书」云端备份同理，用集合 `wre_paperbooks`（权限同样选「仅创建者可读写」，
 *      函数也会尝试自动创建，但手动建更稳妥）。
 *   ③ M13 运营看板：在「云开发控制台 → 数据库」新建集合 `wre_ops_daily`
 *      （权限选「仅管理端可读写」）；在「云函数 → wereadProxy → 配置 → 环境变量」新增
 *      `ADMIN_OPENIDS`（值＝你自己的 openid，多个用英文逗号分隔），否则看板对任何人都不下发；
 *      自己的 openid 可在小程序「设置 → 参数详情」里点「复制 openid」获取；
 *      插件匿名统计走「云开发控制台 → HTTP 访问服务」，为 `/report` 路径绑定本函数
 *      （前端以 text/plain 简单请求上报，无需预检）。
 *   ④ H5：新建集合 `wre_users`（权限选「仅管理端可读写」，用于 Key 加密托管）；在环境变量新增
 *      `KEY_SECRET`（任意足够长的随机串，用于应用层加密，**一旦设置不要更改**，否则已托管 Key 无法解密）
 *      与 `H5_ORIGINS`（允许跨域的 H5 站点地址，多个用英文逗号分隔；不配则退回 `*`）；
 *      可选：`ADMIN_DEVICE_IDS`（H5 运营看板的管理员账户码白名单，英文逗号分隔；不配则 H5 看板关闭）；
 *      在「HTTP 网关 → 域名及路由」为 H5 添加路由（路径如 `/h5`，关联本函数；跨域设置保持关闭由本函数处理），
 *      把该地址填进 `h5/src/config.js`。
 *   ⑥ 跨端打通（网页账户码 ↔ 小程序 openid）：新建集合 `wre_links`（权限选「仅管理端可读写」，
 *      只存两端身份映射与一次性绑定码，不含 Key）。函数也会尝试自动创建，但手动建更稳妥。
 *   ⑤ 「我的纸书 → 拍照识码」（M2）走云调用 `img.scanQRCode`，权限已在同目录 `config.json` 声明（随函数一起上传）；
 *      真机使用需在小程序后台《用户隐私保护指引》勾选「摄像头」「相册（仅写入）」。
 */
'use strict';

const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

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
// 输出上限：人格画像（短）+ 每日卡片（短）+ 灵感漫游（金档正文约 1000 字，
// 加摘要 / 外部火花 / 创作种子的 JSON 结构，留足余量防截断导致 JSON 解析失败）
const AI_MAX_TOKENS = 2000;

// 云同步（B2）：按 openid 隔离，只存人格结果，不存 Key、不存原始接口数据
const SYNC_COLLECTION = 'wre_sync';
const SYNC_MAX_BYTES = 400 * 1024;

// 我的纸书：按 openid 隔离的云端备份（只存纸书档案：isbn/title/关联 bookId 等，不含任何 Key）
const PB_COLLECTION = 'wre_paperbooks';

// 运营统计（M13）：只存「聚合计数 + 去重键」，保留 90 天，到期只留计数
const OPS_COLLECTION = 'wre_ops_daily';
const OPS_RETENTION_DAYS = 90;
const OPS_SCAN_LIMIT = 1000; // 单次聚合最多扫描的文档数（个人量级足够）
// 管理员 openid 白名单：在云函数「配置 → 环境变量」里设置 ADMIN_OPENIDS（英文逗号分隔）；
// 未配置时任何人都拿不到看板数据（不是前端隐藏，是服务端不下发）。
const ADMIN_OPENIDS = String(process.env.ADMIN_OPENIDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// H5（纯网页 App）：Key 加密托管 + 无登录匿名身份
//   - wre_users：按 deviceId 托管用户 Key，权限＝仅管理端可读写；
//   - KEY_SECRET：应用层加密密钥（云函数「配置 → 环境变量」设置），未配置则托管功能不可用；
//   - H5_ORIGINS：允许跨域访问本站的域名白名单（英文逗号分隔）；未配置时退回 `*`（便于本地开发）。
const USERS_COLLECTION = 'wre_users';
const KEY_SECRET = String(process.env.KEY_SECRET || '');
// H5 运营看板管理员账户码白名单（H14）：H5 无 openid，改用「账户码（deviceId）白名单」认人，
// 免输入任何口令。在云函数「配置 → 环境变量」新增 ADMIN_DEVICE_IDS（英文逗号分隔，
// 值即你在 H5「我的账户」页复制的账户码）；未配置则 H5 看板一律关闭。
const ADMIN_DEVICE_IDS = String(process.env.ADMIN_DEVICE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const H5_ORIGINS = String(process.env.H5_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DEVICE_MIN_LEN = 16;   // 前端生成的随机 deviceId 至少 16 位（建议 32 位十六进制）

// 跨端打通：网页（账户码 deviceId）↔ 小程序（微信 openid）绑定映射
//   - wre_links：同集合存三类文档（用 kind 区分，避免多建集合）
//       l_<openid>  { kind:'link', openid, deviceId }   正向：openid → 账户码
//       d_<deviceId>{ kind:'link', openid, deviceId }   反向：账户码 → openid（供网页端解绑 O(1) 定位）
//       b_<deviceId>{ kind:'bind', code, status, ... }  一次性绑定码会话（网页生成，小程序认领）
//   - 绑定后：小程序侧 syncGet/syncPut 统一按 deviceId 存取，与网页端同一份 wre_sync 文档。
//   - 红线：只存映射关系，不存 Key、不存官方原始数据；解绑即删除映射。
const LINK_COLLECTION = 'wre_links';
const BIND_TTL_MS = 10 * 60 * 1000;   // 绑定码有效期 10 分钟

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

  // 已关联网页账户 → 统一按账户码（deviceId）存取，与网页端读写同一份文档；未关联则退回 openid
  const uid = (await resolveLinkDeviceId(openid)) || openid;
  const db = cloud.database();
  const coll = db.collection(SYNC_COLLECTION);

  if (action === 'syncGet') {
    try {
      const r = await coll.doc(uid).get();
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
    await coll.doc(uid).set({ data: payload });
  } catch (err) {
    // 集合不存在时尝试建集合后重试一次
    try {
      await db.createCollection(SYNC_COLLECTION);
      await coll.doc(uid).set({ data: payload });
    } catch (err2) {
      return { ok: false, code: 'sync', error: '同步写入失败：' + ((err2 && err2.errMsg) || '未知错误') };
    }
  }
  return { ok: true, updatedAt: payload.updatedAt };
}

// ---------- 我的纸书：云端备份（按 openid 隔离） ----------

/**
 * pbGet / pbPut：把整份纸书库备份到云端（按 openid 一个文档），用于换机拉回。
 * 红线：只存纸书档案（isbn / 书名 / 关联 bookId 等），不含任何 Key、不含微信读书原始数据。
 */
async function handlePaperbook(event) {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }
  const db = cloud.database();
  const coll = db.collection(PB_COLLECTION);

  if (event && event.action === 'pbGet') {
    try {
      const r = await coll.doc(openid).get();
      return { ok: true, books: (r.data && r.data.books) || [] };
    } catch (err) {
      // 文档不存在（或集合还没建）都按「云端暂无备份」处理
      return { ok: true, books: [] };
    }
  }

  const books = event && Array.isArray(event.books) ? event.books : null;
  if (!books) {
    return { ok: false, code: 'param', error: '缺少待备份的纸书数据' };
  }
  const payload = { books: books, updatedAt: Date.now() };
  if (JSON.stringify(payload).length > SYNC_MAX_BYTES) {
    return { ok: false, code: 'toobig', error: '纸书过多、数据过大，未备份' };
  }
  try {
    await coll.doc(openid).set({ data: payload });
  } catch (err) {
    try {
      await db.createCollection(PB_COLLECTION);
      await coll.doc(openid).set({ data: payload });
    } catch (err2) {
      return { ok: false, code: 'sync', error: '备份写入失败：' + ((err2 && err2.errMsg) || '未知错误') };
    }
  }
  return { ok: true, updatedAt: payload.updatedAt, count: books.length };
}

// ---------- 我的纸书：拍照识码（M2，云调用 img.scanQRCode） ----------

const IMG_SCAN_MAX_BYTES = 2 * 1024 * 1024; // 官方限制：图片须小于 2M

/** 按扩展名猜 contentType（云调用媒体参数需要） */
function imgContentType(fileID) {
  const ext = String(fileID || '').split('.').pop().toLowerCase();
  if (ext === 'png') {
    return 'image/png';
  }
  if (ext === 'webp') {
    return 'image/webp';
  }
  if (ext === 'gif') {
    return 'image/gif';
  }
  return 'image/jpeg';
}

/** 兼容不同字段命名，抽出识别到的码列表 */
function pickCodeResults(res) {
  const list = (res && (res.code_results || res.codeResults || res.resultList || res.result_list)) || [];
  return Array.isArray(list) ? list : [];
}

/**
 * imgScan：把云存储里的图片交给官方云调用识别条码 → 回传识别到的码。
 * 红线：只做「识别条码」，不做 OCR 正文、不落库；图片识别后由前端删除。
 */
async function handleImgScan(event) {
  const fileID = String((event && event.fileID) || '').trim();
  if (!fileID) {
    return { ok: false, code: 'param', error: '缺少图片' };
  }

  let buffer = null;
  try {
    const file = await cloud.downloadFile({ fileID: fileID });
    buffer = file && file.fileContent;
  } catch (err) {
    return { ok: false, code: 'download', error: '图片下载失败，请重试' };
  }
  if (!buffer || !buffer.length) {
    return { ok: false, code: 'download', error: '图片内容为空' };
  }
  if (buffer.length > IMG_SCAN_MAX_BYTES) {
    return { ok: false, code: 'toobig', error: '图片超过 2M，请靠近些重拍或压缩后再试' };
  }

  let res = null;
  try {
    res = await cloud.openapi.img.scanQRCode({
      img: { contentType: imgContentType(fileID), value: buffer },
    });
  } catch (err) {
    const msg = (err && (err.errMsg || err.message)) || '未知错误';
    return { ok: false, code: 'scan', error: '识别失败：' + msg };
  }

  const rawCode = res && res.errCode !== undefined ? res.errCode : res && res.errcode;
  if (Number(rawCode)) {
    return { ok: false, code: 'scan', error: (res && (res.errMsg || res.errmsg)) || '识别失败' };
  }

  const codes = pickCodeResults(res)
    .map((c) => ({
      type: String((c && (c.type_name || c.typeName || c.type)) || ''),
      data: String((c && c.data) || ''),
    }))
    .filter((c) => !!c.data);
  const isbn = (codes.filter((c) => /^97[89]\d{10}$/.test(c.data))[0] || {}).data || '';

  console.log('[wereadProxy] imgScan', { codes: codes.length, isbn: isbn ? 'hit' : 'none' });
  return { ok: true, isbn: isbn, codes: codes };
}

// ---------- M13：运营统计（小程序使用量 / 插件匿名使用量 / 管理员看板） ----------

/** 中国时区（UTC+8）的 YYYY-MM-DD */
function cstDate(ts) {
  return new Date((ts || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 只保留白名单字符，避免任何内容穿透进库 */
function cleanToken(value, maxLen) {
  return String(value || '').replace(/[^0-9a-zA-Z._-]/g, '').slice(0, maxLen || 64);
}

/** 某类统计当天 +1：文档不存在则创建（首次记为 firstDate） */
async function bumpDaily(kind, uid, extra) {
  const db = cloud.database();
  const coll = db.collection(OPS_COLLECTION);
  const _ = db.command;
  const now = Date.now();
  const date = cstDate(now);
  const docId = kind + '_' + date + '_' + uid;
  const patch = Object.assign({ kind: kind, date: date, uid: uid, lastAt: now }, extra || {});
  try {
    await coll.doc(docId).update({ data: Object.assign({}, patch, { opens: _.inc(1) }) });
    return true;
  } catch (err) {
    const fresh = Object.assign({}, patch, { opens: 1, firstDate: date, firstAt: now });
    try {
      await coll.doc(docId).set({ data: fresh });
      return true;
    } catch (err2) {
      try {
        await db.createCollection(OPS_COLLECTION);
        await coll.doc(docId).set({ data: fresh });
        return true;
      } catch (err3) {
        return false;
      }
    }
  }
}

/** 聚合某类统计：今日去重人数 / 今日次数 / 今日新增 / 累计人数 / 版本分布 */
async function aggregate(kind, today) {
  const db = cloud.database();
  const coll = db.collection(OPS_COLLECTION);

  const todayRes = await coll.where({ kind: kind, date: today }).limit(OPS_SCAN_LIMIT).get().catch(() => null);
  const todayDocs = (todayRes && todayRes.data) || [];
  const todayUsers = todayDocs.length; // 每天每 uid 至多一条文档 → 条数即去重人数
  const todayOpens = todayDocs.reduce((acc, d) => acc + (Number(d.opens) || 0), 0);

  const allRes = await coll.where({ kind: kind }).limit(OPS_SCAN_LIMIT).get().catch(() => null);
  const allDocs = (allRes && allRes.data) || [];
  const users = {};
  allDocs.forEach((d) => {
    if (!d || !d.uid) {
      return;
    }
    const cur = users[d.uid] || { firstDate: d.date, lastDate: d.date, version: d.version || '' };
    if (d.date < cur.firstDate) {
      cur.firstDate = d.date;
    }
    if (d.date >= cur.lastDate) {
      cur.lastDate = d.date;
      if (d.version) {
        cur.version = d.version;
      }
    }
    users[d.uid] = cur;
  });

  const uids = Object.keys(users);
  const newUsers = uids.filter((u) => users[u].firstDate === today).length;
  const versionMap = {};
  uids.forEach((u) => {
    const v = users[u].version || '未知';
    versionMap[v] = (versionMap[v] || 0) + 1;
  });
  const versions = Object.keys(versionMap)
    .map((v) => ({ version: v, count: versionMap[v] }))
    .sort((a, b) => b.count - a.count);

  return {
    date: today,
    todayUsers: todayUsers,
    todayOpens: todayOpens,
    newUsers: newUsers,
    totalUsers: uids.length,
    versions: versions,
    truncated: allDocs.length >= OPS_SCAN_LIMIT,
  };
}

/** 清理超期数据（保留 90 天）；由看板顺手触发，失败不阻断 */
function cleanupOld() {
  const db = cloud.database();
  const _ = db.command;
  const cutoff = cstDate(Date.now() - OPS_RETENTION_DAYS * 24 * 3600 * 1000);
  return db.collection(OPS_COLLECTION).where({ date: _.lt(cutoff) }).remove().catch(() => null);
}

/** 小程序使用量：每次打开记一次（按 openid + 天去重） */
async function handleOpsPing() {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }
  const ok = await bumpDaily('mp', cleanToken(openid, 64), null);
  return ok ? { ok: true } : { ok: false, code: 'ops', error: '统计写入失败' };
}

/** 判断当前调用者是否管理员（只回布尔），并回传其「自己的 openid」以便自助配置白名单（只回自己，不泄露他人） */
async function handleOpsWhoami() {
  const ctx = cloud.getWXContext();
  const openid = (ctx && ctx.OPENID) || '';
  const admin = !!openid && ADMIN_OPENIDS.indexOf(openid) >= 0;
  return { ok: true, admin: admin, openid: openid };
}

/** 管理员看板：非白名单一律 code=forbidden，服务端不下发任何数据 */
async function handleOpsAdmin() {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid || ADMIN_OPENIDS.indexOf(openid) < 0) {
    return { ok: false, code: 'forbidden', error: '无权限' };
  }
  const today = cstDate(Date.now());
  const mp = await aggregate('mp', today);
  const plugin = await aggregate('plugin', today);
  cleanupOld(); // 不 await：清理是顺手动作，不阻塞看板返回
  return { ok: true, generatedAt: Date.now(), mp: mp, plugin: plugin };
}

/** 插件匿名统计：仅白名单字段入库，写失败静默（不影响插件使用） */
async function handleOpsReport(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const anonId = cleanToken(body.anonId, 64);
  if (anonId.length < 8) {
    return { ok: false, code: 'param', error: '缺少匿名标识' };
  }
  const version = cleanToken(body.version, 24);
  const event = cleanToken(body.event, 24) || 'active';
  const ok = await bumpDaily('plugin', anonId, { version: version, event: event });
  return ok ? { ok: true } : { ok: false, code: 'ops', error: '统计写入失败' };
}

// ---------- H5：Key 加密托管（按 deviceId）+ 云同步 ----------

/** deviceId：只保留白名单字符并限制长度（非用户信息，浏览器随机生成） */
function cleanDeviceId(value) {
  return String(value || '').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 64);
}

function validDeviceId(id) {
  return typeof id === 'string' && id.length >= DEVICE_MIN_LEN;
}

/** 32 字节派生密钥（对 KEY_SECRET 做 SHA-256；secret 本身不入库、不写日志） */
function deriveSecret() {
  return crypto.createHash('sha256').update(KEY_SECRET, 'utf8').digest();
}

/** 应用层加密：v1:<iv b64>:<tag b64>:<密文 b64>（AES-256-GCM） */
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveSecret(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** 解密（失败一律返回空串，绝不抛错穿透） */
function decryptSecret(enc) {
  const parts = String(enc || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return '';
  }
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveSecret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    return '';
  }
}

/** 读取某 deviceId 的托管文档（不存在按「未配置」处理） */
async function readUserDoc(deviceId) {
  const db = cloud.database();
  try {
    const r = await db.collection(USERS_COLLECTION).doc(deviceId).get();
    return r && r.data ? r.data : null;
  } catch (err) {
    return null;
  }
}

/** 取托管 Key（明文，仅在内存中使用，绝不回传浏览器 / 写日志） */
async function getHostedKey(deviceId, field) {
  if (!KEY_SECRET) {
    return { ok: false, code: 'nosecret', error: '服务端未配置密钥托管环境变量，暂不可用' };
  }
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  const doc = await readUserDoc(deviceId);
  const enc = doc && doc[field];
  if (!enc) {
    return { ok: false, code: 'nokey', error: '尚未配置 API Key，请先在「我的」里填写' };
  }
  const plain = decryptSecret(enc);
  if (!plain) {
    return { ok: false, code: 'nokey', error: '托管 Key 读取失败，请重新填写' };
  }
  return { ok: true, key: plain };
}

/** keySave：写入 / 更新托管 Key（wrk- 微信读书 Key、sk- DeepSeek Key 可单独更新） */
async function handleKeySave(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  if (!KEY_SECRET) {
    return { ok: false, code: 'nosecret', error: '服务端未配置密钥托管环境变量，暂不可用' };
  }
  const apiKey = String((body && body.apiKey) || '').trim();
  const aiKey = String((body && body.aiKey) || '').trim();
  if (!apiKey && !aiKey) {
    return { ok: false, code: 'param', error: '缺少要保存的 Key' };
  }
  if (apiKey && apiKey.indexOf('wrk-') !== 0) {
    return { ok: false, code: 'param', error: '微信读书 Key 格式不对（应以 wrk- 开头）' };
  }
  if (aiKey && aiKey.indexOf('sk-') !== 0) {
    return { ok: false, code: 'param', error: 'DeepSeek Key 格式不对（应以 sk- 开头）' };
  }

  const db = cloud.database();
  const coll = db.collection(USERS_COLLECTION);
  const doc = (await readUserDoc(deviceId)) || {};
  // 云开发文档自带 _id，回写时必须剔除，否则报 -501007「不能更新_id的值」
  const base = Object.assign({}, doc);
  delete base._id;
  const now = Date.now();
  const patch = {
    updatedAt: now,
    createdAt: doc.createdAt || now,
  };
  if (apiKey) {
    patch.enc = encryptSecret(apiKey);
    patch.masked = maskKey(apiKey);
  }
  if (aiKey) {
    patch.aiEnc = encryptSecret(aiKey);
    patch.aiMasked = maskKey(aiKey);
  }

  try {
    await coll.doc(deviceId).set({ data: Object.assign({}, base, patch) });
  } catch (err) {
    try {
      await db.createCollection(USERS_COLLECTION);
      await coll.doc(deviceId).set({ data: Object.assign({}, base, patch) });
    } catch (err2) {
      return { ok: false, code: 'save', error: 'Key 保存失败：' + ((err2 && err.errMsg) || '未知错误') };
    }
  }
  console.log('[wereadProxy] keySave', { device: deviceId.slice(0, 6) + '…', key: patch.masked || patch.aiMasked || '(空)' });
  return { ok: true, hasKey: !!patch.enc || !!doc.enc, masked: patch.masked || doc.masked || '', hasAiKey: !!patch.aiEnc || !!doc.aiEnc, aiMasked: patch.aiMasked || doc.aiMasked || '' };
}

/** keyGet：只回「是否已配置 + 掩码」 + 昵称，绝不回明文 */
async function handleKeyGet(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  const doc = await readUserDoc(deviceId);
  return {
    ok: true,
    hasKey: !!(doc && doc.enc),
    masked: (doc && doc.masked) || '',
    hasAiKey: !!(doc && doc.aiEnc),
    aiMasked: (doc && doc.aiMasked) || '',
    nickName: (doc && doc.nickName) || '',
  };
}

/**
 * keyPull：把托管 Key 的**明文**回传给持账户码的端（供浏览器插件「拉回本机 + 后台直发」用）
 *
 * 与 keyGet 的区别（安全口径，务必分清）：
 *   - keyGet 只回掩码，任何持账户码者都拿不到明文；H5 / 官网走 relay，无需明文；
 *   - keyPull 回明文，供插件把 Key 拉回本机后**直连**网关 / DeepSeek（不依赖服务端中转）。
 * 代价：持账户码即等同「可抄走 Key」（原本只能「用」Key）。仅插件启用云端同步时调用。
 */
async function handleKeyPull(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  if (!KEY_SECRET) {
    return { ok: false, code: 'nosecret', error: '服务端未配置密钥托管环境变量，暂不可用' };
  }
  const doc = await readUserDoc(deviceId);
  if (!doc) {
    return { ok: true, apiKey: '', aiKey: '', masked: '', aiMasked: '', nickName: '' };
  }
  const apiKey = doc.enc ? decryptSecret(doc.enc) : '';
  const aiKey = doc.aiEnc ? decryptSecret(doc.aiEnc) : '';
  console.log('[wereadProxy] keyPull', { device: deviceId.slice(0, 6) + '…', hasKey: !!apiKey, hasAiKey: !!aiKey });
  return {
    ok: true,
    apiKey: apiKey,
    aiKey: aiKey,
    masked: doc.masked || '',
    aiMasked: doc.aiMasked || '',
    nickName: doc.nickName || '',
  };
}

/**
 * profileSave：保存昵称（非敏感展示名，随账户走，换设备可同步）
 *
 * 与 Key 分开：不需要 KEY_SECRET，未托管 Key 的账户也能只存昵称。
 * 红线：仍不接收 / 不存储任何 Key 明文，也不存头像图片。
 */
async function handleProfileSave(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  const nickName = String((body && body.nickName) || '').trim().slice(0, 24);

  const db = cloud.database();
  const coll = db.collection(USERS_COLLECTION);
  const doc = (await readUserDoc(deviceId)) || {};
  const base = Object.assign({}, doc);
  delete base._id;   // 云开发文档自带 _id，回写时必须剔除，否则报 -501007
  const now = Date.now();
  const patch = { nickName: nickName, updatedAt: now, createdAt: doc.createdAt || now };

  try {
    await coll.doc(deviceId).set({ data: Object.assign({}, base, patch) });
  } catch (err) {
    try {
      await db.createCollection(USERS_COLLECTION);
      await coll.doc(deviceId).set({ data: Object.assign({}, base, patch) });
    } catch (err2) {
      return { ok: false, code: 'save', error: '昵称保存失败：' + ((err2 && err2.errMsg) || '未知错误') };
    }
  }
  return { ok: true, nickName: nickName };
}

/**
 * keyClear：只清除托管在云端的 Key（保留昵称等账户资料）
 *
 * 与「退出登录」区分：退出登录只清本机账户码；本接口清的是云端 Key。
 * 文档不存在 / 字段本就为空都算成功。
 */
async function handleKeyClear(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  try {
    const db = cloud.database();
    const _ = db.command;
    await db.collection(USERS_COLLECTION).doc(deviceId).update({
      data: {
        enc: _.remove(),
        masked: _.remove(),
        aiEnc: _.remove(),
        aiMasked: _.remove(),
        updatedAt: Date.now(),
      },
    });
  } catch (err) {
    // 文档本来就不存在也算成功
  }
  return { ok: true };
}

/** H5 relay：用托管 Key 走官方网关中转（响应不含明文 Key） */
async function handleH5Relay(body) {
  const got = await getHostedKey(body && body.deviceId, 'enc');
  if (!got.ok) {
    return got;
  }
  return await relayGateway({ apiName: body && body.apiName, params: (body && body.params) || {}, apiKey: got.key });
}

/** H5 ai：用托管 DeepSeek Key 转发 */
async function handleH5Ai(body) {
  const got = await getHostedKey(body && body.deviceId, 'aiEnc');
  if (!got.ok) {
    return { ok: false, code: got.code === 'nokey' ? 'ai_nokey' : got.code, error: got.error };
  }
  return await handleAi({ apiKey: got.key, messages: body && body.messages });
}

/** H5 云同步：按 deviceId 隔离，只存人格结果（与小程序 wre_sync 同一集合） */
async function handleH5Sync(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  const action = body && body.action;
  const db = cloud.database();
  const coll = db.collection(SYNC_COLLECTION);

  if (action === 'syncGet') {
    try {
      const r = await coll.doc(deviceId).get();
      return { ok: true, data: (r.data && r.data.persona) || null, updatedAt: (r.data && r.data.updatedAt) || 0 };
    } catch (err) {
      return { ok: true, data: null, updatedAt: 0 };
    }
  }

  const persona = body && body.persona;
  if (!persona || typeof persona !== 'object') {
    return { ok: false, code: 'param', error: '缺少待同步数据' };
  }
  const payload = { persona: persona, updatedAt: Date.now() };
  if (JSON.stringify(payload).length > SYNC_MAX_BYTES) {
    return { ok: false, code: 'toobig', error: '数据过大，未同步' };
  }
  try {
    await coll.doc(deviceId).set({ data: payload });
  } catch (err) {
    try {
      await db.createCollection(SYNC_COLLECTION);
      await coll.doc(deviceId).set({ data: payload });
    } catch (err2) {
      return { ok: false, code: 'sync', error: '同步写入失败：' + ((err2 && err2.errMsg) || '未知错误') };
    }
  }
  return { ok: true, updatedAt: payload.updatedAt };
}

/** H5 匿名使用量：按 deviceId + 天去重（不存阅读数据 / Key / 书目 / 笔记 / IP） */
async function handleH5OpsPing(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的设备标识' };
  }
  const version = cleanToken(body && body.version, 24);
  const ok = await bumpDaily('h5', deviceId, { version: version });
  return ok ? { ok: true } : { ok: false, code: 'ops', error: '统计写入失败' };
}

/** H5 运营看板（H14）：账户码（deviceId）在白名单内才下发；未配 ADMIN_DEVICE_IDS 一律关闭 */
async function handleH5OpsAdmin(body) {
  if (!ADMIN_DEVICE_IDS.length) {
    return { ok: false, code: 'forbidden', error: '看板未开启（缺少 ADMIN_DEVICE_IDS）' };
  }
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId) || ADMIN_DEVICE_IDS.indexOf(deviceId) < 0) {
    return { ok: false, code: 'forbidden', error: '当前账户码不在管理员白名单' };
  }
  const today = cstDate(Date.now());
  const mp = await aggregate('mp', today);
  const plugin = await aggregate('plugin', today);
  const h5 = await aggregate('h5', today);
  cleanupOld(); // 不 await：清理是顺手动作
  return { ok: true, generatedAt: Date.now(), mp: mp, plugin: plugin, h5: h5 };
}

// ---------- 跨端打通：网页账户码 ↔ 小程序 openid 绑定 ----------
//
// 身份来源不同（浏览器拿不到 openid，小程序用不到账户码），故用「用户主动绑定」建立映射：
//   ① 扫码：网页端展示二维码（内容＝绑定码），小程序扫码后凭码认领；
//   ② 短码：网页端展示 6 位数字，小程序内手输；
//   ③ 粘贴：网页端复制 32 位账户码，小程序内粘贴。
// 三种入口最终都走 bindClaim 建立映射，结果一致。红线：只存映射，不存 Key、不存官方原始数据。
//   ④ 反向（用户从小程序先开始用）：小程序调 accountEnsure 为自己分配账户码，网页端「用账户码登录」粘贴即统一。

/** 6 位数字绑定码（一次性、10 分钟过期） */
function genBindCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** 32 位十六进制账户码（服务端随机，等价于网页端 CSPRNG 生成的 deviceId） */
function genDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

/** 云开发集合不存在时建集合（幂等；已存在会抛错，忽略即可） */
async function ensureCollection(db, name) {
  try {
    await db.createCollection(name);
  } catch (err) {
    // 已存在：忽略
  }
}

/** 读文档（不存在 / 集合未建都返回 null，绝不抛错穿透） */
async function readDoc(collName, id) {
  try {
    const r = await cloud.database().collection(collName).doc(id).get();
    return r && r.data ? r.data : null;
  } catch (err) {
    return null;
  }
}

/** 写文档（覆盖式 set；集合不存在时先建再写一次） */
async function writeDoc(collName, id, data) {
  const db = cloud.database();
  try {
    await db.collection(collName).doc(id).set({ data: data });
  } catch (err) {
    await ensureCollection(db, collName);
    await db.collection(collName).doc(id).set({ data: data });
  }
}

/** 删除文档（不存在也算成功） */
async function removeDoc(collName, id) {
  try {
    await cloud.database().collection(collName).doc(id).remove();
  } catch (err) {
    // 忽略
  }
}

/** 小程序侧：当前 openid 已绑定的账户码（未绑定返回空串） */
async function resolveLinkDeviceId(openid) {
  const doc = await readDoc(LINK_COLLECTION, 'l_' + openid);
  const deviceId = doc && doc.deviceId;
  return typeof deviceId === 'string' && validDeviceId(deviceId) ? deviceId : '';
}

/** 按绑定码找「待认领且未过期」的会话（取最新一条） */
async function findBindSession(code) {
  const db = cloud.database();
  const _ = db.command;
  try {
    const r = await db
      .collection(LINK_COLLECTION)
      .where({ kind: 'bind', code: code, status: 'pending', expireAt: _.gt(Date.now()) })
      .limit(1)
      .get();
    return (r && r.data && r.data[0]) || null;
  } catch (err) {
    return null;
  }
}

/** 首次绑定：账户侧还没有人格时，把本机（openid）已算好的人格搬过去（绝不覆盖账户已有数据） */
async function migratePersonaOnBind(openid, deviceId) {
  if (openid === deviceId) {
    return;
  }
  const target = await readDoc(SYNC_COLLECTION, deviceId);
  if (target && target.persona) {
    return;
  }
  const local = await readDoc(SYNC_COLLECTION, openid);
  if (local && local.persona) {
    await writeDoc(SYNC_COLLECTION, deviceId, { persona: local.persona, updatedAt: local.updatedAt || Date.now() });
  }
}

/** 解绑：把账户侧最新人格回搬本机（openid）侧，避免解绑后本机数据回退 */
async function migratePersonaOnUnbind(openid, deviceId) {
  if (openid === deviceId) {
    return;
  }
  const acc = await readDoc(SYNC_COLLECTION, deviceId);
  if (acc && acc.persona) {
    await writeDoc(SYNC_COLLECTION, openid, { persona: acc.persona, updatedAt: acc.updatedAt || Date.now() });
  }
}

/**（H5）bindCreate：网页端生成一次性绑定码，小程序侧凭它认领本账户 */
async function handleBindCreate(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的账户码' };
  }
  const now = Date.now();
  const doc = {
    kind: 'bind',
    code: genBindCode(),
    deviceId: deviceId,
    status: 'pending',
    createdAt: now,
    expireAt: now + BIND_TTL_MS,
    openid: '',
  };
  try {
    await writeDoc(LINK_COLLECTION, 'b_' + deviceId, doc);
  } catch (err) {
    return { ok: false, code: 'save', error: '绑定码生成失败，请稍后重试' };
  }
  return { ok: true, code: doc.code, expireAt: doc.expireAt };
}

/**（H5）bindStatus：本账户是否已被小程序绑定 */
async function handleBindStatus(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的账户码' };
  }
  const session = await readDoc(LINK_COLLECTION, 'b_' + deviceId);
  if (session && session.status === 'claimed') {
    return { ok: true, linked: true };
  }
  const own = await readDoc(LINK_COLLECTION, 'd_' + deviceId);
  return { ok: true, linked: !!(own && own.openid) };
}

/**（H5）bindRemove：网页端解除绑定（删除映射，网页侧不再与小程序共享数据） */
async function handleBindRemove(body) {
  const deviceId = cleanDeviceId(body && body.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'nodevice', error: '缺少或非法的账户码' };
  }
  const own = await readDoc(LINK_COLLECTION, 'd_' + deviceId);
  const openid = (own && own.openid) || '';
  if (openid) {
    await removeDoc(LINK_COLLECTION, 'l_' + openid);
    await removeDoc(LINK_COLLECTION, 'd_' + deviceId);
  }
  await removeDoc(LINK_COLLECTION, 'b_' + deviceId);
  return { ok: true };
}

/**
 * （H5）bindRedeem：另一台网页端凭 6 位码换回账户码，实现 H5↔H5 跨设备登录
 *
 * 与 bindCreate 共用同一套一次性 6 位码会话（存 b_<deviceId>，10 分钟有效）：
 * 电脑端 bindCreate 生成、手机端 bindRedeem 换回同一 deviceId，手机本地改存该账户码即登录同一账户。
 * 用后把会话标记为 redeemed（一次性），且不改 status 为 claimed —— 不影响「已关联小程序」的判定。
 */
async function handleBindRedeem(body) {
  const raw = String((body && body.code) || '').trim();
  if (!/^\d{6}$/.test(raw)) {
    return { ok: false, code: 'param', error: '请输入 6 位数字登录码' };
  }
  const session = await findBindSession(raw);
  if (!session) {
    return { ok: false, code: 'nocode', error: '登录码无效或已过期，请在原设备重新生成' };
  }
  const deviceId = cleanDeviceId(session.deviceId);
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'param', error: '账户码格式不正确' };
  }
  const doc = Object.assign({}, session);
  delete doc._id;   // 云开发文档自带 _id，回写时必须剔除，否则报 -501007
  doc.status = 'redeemed';
  doc.redeemedAt = Date.now();
  try {
    await writeDoc(LINK_COLLECTION, 'b_' + deviceId, doc);
  } catch (err) {
    // 一次性标记失败不阻断登录
  }
  return { ok: true, deviceId: deviceId };
}

/**
 * （小程序）accountEnsure：小程序端「我的账户码」
 *
 * 让账户码也能由小程序侧产生（原有流程只能网页端先生成账户码）。
 * 未分配则新建一个账户码并建立 openid ↔ deviceId 映射，把本机已算好的人格搬到该账户码名下；
 * 已分配则直接返回（幂等），用户可在网页端「跨设备登录」粘贴此码完成统一。
 */
async function handleAccountEnsure() {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }
  const existing = await resolveLinkDeviceId(openid);
  if (existing) {
    return { ok: true, deviceId: existing, created: false };
  }
  const deviceId = genDeviceId();
  const now = Date.now();
  try {
    const link = { kind: 'link', openid: openid, deviceId: deviceId, createdAt: now, updatedAt: now, source: 'mp' };
    await writeDoc(LINK_COLLECTION, 'l_' + openid, link);
    await writeDoc(LINK_COLLECTION, 'd_' + deviceId, link);
  } catch (err) {
    return { ok: false, code: 'save', error: '账户码生成失败，请稍后重试' };
  }
  await migratePersonaOnBind(openid, deviceId);
  return { ok: true, deviceId: deviceId, created: true };
}

/** （小程序）bindClaim：认领绑定（6 位绑定码 或 直接粘贴的账户码），建立 openid ↔ deviceId 映射 */
async function handleBindClaim(event) {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }
  const raw = String((event && event.code) || '').trim();
  let deviceId = '';
  let session = null;
  if (/^\d{6}$/.test(raw)) {
    session = await findBindSession(raw);
    if (!session) {
      return { ok: false, code: 'nocode', error: '绑定码无效或已过期，请在网页端重新生成' };
    }
    deviceId = cleanDeviceId(session.deviceId);
  } else if (/^[0-9a-fA-F]{16,64}$/.test(raw)) {
    deviceId = raw.toLowerCase();
  } else {
    return { ok: false, code: 'param', error: '请输入 6 位绑定码，或粘贴完整账户码' };
  }
  if (!validDeviceId(deviceId)) {
    return { ok: false, code: 'param', error: '账户码格式不正确（应为 32 位十六进制）' };
  }

  const now = Date.now();
  try {
    const link = { kind: 'link', openid: openid, deviceId: deviceId, createdAt: now, updatedAt: now };
    await writeDoc(LINK_COLLECTION, 'l_' + openid, link);
    await writeDoc(LINK_COLLECTION, 'd_' + deviceId, link);
    if (session) {
      await writeDoc(LINK_COLLECTION, session._id, {
        kind: 'bind',
        code: session.code,
        deviceId: deviceId,
        status: 'claimed',
        createdAt: session.createdAt || now,
        expireAt: session.expireAt || now,
        openid: openid,
        claimedAt: now,
      });
    }
  } catch (err) {
    return { ok: false, code: 'save', error: '绑定失败：' + ((err && err.errMsg) || '未知错误') };
  }
  await migratePersonaOnBind(openid, deviceId);
  return { ok: true, deviceId: deviceId };
}

/**（小程序）bindInfo：当前是否已关联网页账户（含账户昵称） */
async function handleBindInfo() {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }
  const deviceId = await resolveLinkDeviceId(openid);
  if (!deviceId) {
    return { ok: true, linked: false };
  }
  const user = await readDoc(USERS_COLLECTION, deviceId);
  return { ok: true, linked: true, deviceId: deviceId, nickName: (user && user.nickName) || '' };
}

/**（小程序）bindUnbind：解除关联（先回搬数据，再删映射；本机数据保留） */
async function handleBindUnbind() {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }
  const deviceId = await resolveLinkDeviceId(openid);
  if (deviceId) {
    await migratePersonaOnUnbind(openid, deviceId);
    await removeDoc(LINK_COLLECTION, 'l_' + openid);
    await removeDoc(LINK_COLLECTION, 'd_' + deviceId);
    await removeDoc(LINK_COLLECTION, 'b_' + deviceId);
  }
  return { ok: true };
}

/**（小程序）profilePut：把本机昵称写入已绑定账户（网页端「我的账户」即可看到） */
async function handleProfilePut(event) {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, code: 'noopenid', error: '未取到用户标识（需已开通云开发）' };
  }
  const deviceId = await resolveLinkDeviceId(openid);
  if (!deviceId) {
    return { ok: false, code: 'nolink', error: '尚未关联网页账户' };
  }
  const nickName = String((event && event.nickName) || '').trim().slice(0, 24);
  const doc = (await readDoc(USERS_COLLECTION, deviceId)) || {};
  const base = Object.assign({}, doc);
  delete base._id;   // 云开发文档自带 _id，回写时必须剔除，否则报 -501007
  const now = Date.now();
  try {
    await writeDoc(USERS_COLLECTION, deviceId, Object.assign({}, base, {
      nickName: nickName,
      updatedAt: now,
      createdAt: doc.createdAt || now,
    }));
  } catch (err) {
    return { ok: false, code: 'save', error: '昵称同步失败：' + ((err && err.errMsg) || '未知错误') };
  }
  return { ok: true, nickName: nickName };
}

// HTTP 访问服务响应头（插件以 text/plain 简单请求上报，无需预检；H5 以 application/json + 预检）
function buildCorsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
  if (H5_ORIGINS.length) {
    // 配了白名单：只回显被允许的来源（未命中则不下发 ACAO，浏览器会拦截）
    if (origin && H5_ORIGINS.indexOf(origin) >= 0) {
      headers['Access-Control-Allow-Origin'] = origin;
    }
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  return headers;
}

function httpReply(statusCode, obj, origin) {
  return { statusCode: statusCode, headers: buildCorsHeaders(origin), body: JSON.stringify(obj) };
}

/**
 * HTTP 入口：
 *   - opsReport：插件匿名统计（简单请求，兼容原有行为）；
 *   - relay / ai / keySave / keyGet / keyClear / syncGet / syncPut：H5 使用（JSON + 预检）。
 */
async function handleHttp(event) {
  const method = String((event && event.httpMethod) || 'POST').toUpperCase();
  const rawHeaders = (event && event.headers) || {};
  const origin = String(rawHeaders.origin || rawHeaders.Origin || '');
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: buildCorsHeaders(origin), body: '' };
  }
  let body = event && event.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch (err) {
      body = {};
    }
  }
  const action = (body && body.action) || 'opsReport';

  if (action === 'opsReport') {
    const result = await handleOpsReport(body);
    return httpReply(result.ok ? 200 : 400, result, origin);
  }
  if (action === 'keySave') {
    return httpReply(200, await handleKeySave(body), origin);
  }
  if (action === 'keyGet') {
    return httpReply(200, await handleKeyGet(body), origin);
  }
  if (action === 'keyPull') {
    return httpReply(200, await handleKeyPull(body), origin);
  }
  if (action === 'keyClear') {
    return httpReply(200, await handleKeyClear(body), origin);
  }
  if (action === 'profileSave') {
    return httpReply(200, await handleProfileSave(body), origin);
  }
  if (action === 'relay') {
    return httpReply(200, await handleH5Relay(body), origin);
  }
  if (action === 'ai') {
    return httpReply(200, await handleH5Ai(body), origin);
  }
  if (action === 'syncGet' || action === 'syncPut') {
    return httpReply(200, await handleH5Sync(body), origin);
  }
  if (action === 'bindCreate') {
    return httpReply(200, await handleBindCreate(body), origin);
  }
  if (action === 'bindStatus') {
    return httpReply(200, await handleBindStatus(body), origin);
  }
  if (action === 'bindRemove') {
    return httpReply(200, await handleBindRemove(body), origin);
  }
  if (action === 'bindRedeem') {
    return httpReply(200, await handleBindRedeem(body), origin);
  }
  if (action === 'opsPing') {
    return httpReply(200, await handleH5OpsPing(body), origin);
  }
  if (action === 'opsAdmin') {
    return httpReply(200, await handleH5OpsAdmin(body), origin);
  }
  return httpReply(400, { ok: false, code: 'action', error: '未知的 HTTP 操作' }, origin);
}

exports.main = async (event) => {
  // HTTP 访问服务（插件匿名上报）：event 形如 { httpMethod, body, ... }
  if (event && (event.httpMethod || event.requestContext)) {
    return await handleHttp(event);
  }
  const action = event && event.action;
  if (action === 'ai') {
    // M15 合规整改：小程序内彻底去 AI（个人主体不可含深度合成技术类目），
    // 此处硬阻断 AI 通道；handleAi 函数体保留不删，日后转企业主体可重新放开。
    return { ok: false, code: 'disabled', error: '当前版本不提供该能力' };
  }
  if (action === 'syncGet' || action === 'syncPut') {
    return await handleSync(event);
  }
  if (action === 'bindClaim') {
    return await handleBindClaim(event);
  }
  if (action === 'bindInfo') {
    return await handleBindInfo();
  }
  if (action === 'accountEnsure') {
    return await handleAccountEnsure();
  }
  if (action === 'bindUnbind') {
    return await handleBindUnbind();
  }
  if (action === 'profilePut') {
    return await handleProfilePut(event);
  }
  if (action === 'pbGet' || action === 'pbPut') {
    return await handlePaperbook(event);
  }
  if (action === 'imgScan') {
    return await handleImgScan(event);
  }
  if (action === 'opsPing') {
    return await handleOpsPing();
  }
  if (action === 'opsWhoami') {
    return await handleOpsWhoami();
  }
  if (action === 'opsAdmin') {
    return await handleOpsAdmin();
  }
  if (action === 'opsReport') {
    return await handleOpsReport(event);
  }
  return await relayGateway(event);
};
