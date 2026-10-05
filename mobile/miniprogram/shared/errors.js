/**
 * 错误码 → 用户可读文案 的统一映射（单一来源）
 *
 * 用途：各页面读取数据失败时不再各自拼「Key 无效 / 网络不通」等文案，
 * 统一从这里取；并统一判断「是否属于 Key 问题」（需引导去重新配置）。
 *
 * 口径：云函数已给出可读 error 时优先用它（保留具体原因，如 errcode 详情）；
 *      没给出时按 code 取兜底文案；两者都没有才用调用方传入的兜底。
 */

// 这些 code 表示 Key 缺失或失效，应引导用户去「我的」重新配置
const KEY_CODES = ['nokey', 'auth'];

// 各 code 的兜底文案（云函数未返回 error 时使用），与云函数返回的 code 对齐
const FALLBACK = {
  nokey: '尚未配置 API Key',
  auth: 'API Key 无效或已失效，请重新填写',
  param: '请求参数异常，请稍后重试',
  timeout: '请求超时，请检查网络后重试',
  network: '网络不通，请检查网络后重试',
  http: '官方接口暂时不可用，请稍后重试',
  rate: '请求过于频繁，请稍后再试',
  parse: '官方返回内容无法解析，请稍后重试',
  errcode: '官方接口返回错误，请稍后重试',
  empty: '云端未返回有效结果，请稍后重试',
  cloud: '云服务暂时不可用，请稍后重试',
  check: '校验失败，请稍后重试',
  ai_auth: 'DeepSeek Key 无效或已失效，请重新填写',
  ai_pay: 'DeepSeek 账户余额不足',
  noopenid: '未取到用户标识，无法同步',
  sync: '云同步失败，请稍后重试',
  toobig: '数据过大，未同步',
};

/** 该错误码是否属于「Key 问题」 */
function isKeyError(code) {
  return KEY_CODES.indexOf(code) >= 0;
}

/**
 * 取用户可读文案
 * @param {object} res 网关/云函数返回的 { ok:false, code, error }
 * @param {string} fallback 调用方兜底文案
 */
function messageOf(res, fallback) {
  const r = res || {};
  if (r.error) {
    return r.error;
  }
  if (r.code && FALLBACK[r.code]) {
    return FALLBACK[r.code];
  }
  return fallback || '读取失败，请稍后重试';
}

module.exports = { isKeyError, messageOf };
