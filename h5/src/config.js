/**
 * H5 全局配置
 *
 * ENDPOINT：微信云函数 wereadProxy 的「HTTP 访问服务」地址（形如
 *   https://<envId>.service.tcloudbase.com/h5 ）。
 *   部署步骤见 h5/README.md；也可临时用网址参数覆盖：?endpoint=https://.../h5
 *   （覆盖值会写入本机 localStorage，便于本地开发调试）。
 *
 * 注意：这不是「官网地址」，而是云函数的中转网关地址；留空则 App 会提示去「我的」里填写。
 */
export const CONFIG = {
  APP_NAME: '微信悦读',
  APP_VERSION: '0.1.0',
  ENDPOINT: '',
  // 网关中转 / AI 的客户端等待上限（应 > 云函数自身超时 10s / 30s）
  RELAY_TIMEOUT_MS: 15000,
  AI_TIMEOUT_MS: 35000,
  DEFAULT_TIMEOUT_MS: 12000,
};
