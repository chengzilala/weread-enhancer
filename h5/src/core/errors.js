/**
 * 错误码 → 用户可读文案 的统一映射（H5 版）
 *
 * 来源：mobile/miniprogram/shared/errors.js，另补 H5 新增的错误码
 * （noendpoint / nodevice / nosecret / ai_nokey / save）。
 */

// 这些 code 表示 Key 缺失或失效，应引导用户去「我的」重新配置
const KEY_CODES = ['nokey', 'auth', 'nodevice', 'nosecret'];

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
  ai_nokey: '尚未配置 DeepSeek Key（AI 功能需要）',
  ai_pay: 'DeepSeek 账户余额不足',
  disabled: '当前版本不提供该能力',
  noopenid: '未取到用户标识，无法同步',
  sync: '云同步失败，请稍后重试',
  toobig: '数据过大，未同步',
  // H5 新增
  noendpoint: '尚未配置中转服务地址，请在「我的」里填写',
  nodevice: '设备标识缺失或非法，请清缓存后重试',
  nosecret: '服务端未配置密钥托管，暂不可用',
  save: 'Key 保存失败，请稍后重试',
  action: '中转服务不支持该操作',
};

/** 该错误码是否属于「Key 问题」 */
export function isKeyError(code) {
  return KEY_CODES.indexOf(code) >= 0;
}

/**
 * 取用户可读文案
 * @param {object} res 网关/云函数返回的 { ok:false, code, error }
 * @param {string} fallback 调用方兜底文案
 */
export function messageOf(res, fallback) {
  const r = res || {};
  if (r.error) {
    return r.error;
  }
  if (r.code && FALLBACK[r.code]) {
    return FALLBACK[r.code];
  }
  return fallback || '读取失败，请稍后重试';
}
