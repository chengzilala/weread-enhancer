/**
 * H5 全局配置
 *
 * ENDPOINT：微信云函数 wereadProxy 的 HTTP 网关地址（开发者部署时写死在这里，
 *   终端用户无需配置）。部署步骤见 h5/README.md。
 *   本地调试可用网址参数临时覆盖：?endpoint=https://.../h5（写入本机 localStorage）。
 *
 * 注意：这不是「官网地址」，而是云函数的中转网关地址。
 */
export const CONFIG = {
  APP_NAME: '微信悦读',
  APP_VERSION: '0.1.0',
  ENDPOINT: 'https://cloud1-d4g1dq0sc7f62329d-1500443307.ap-shanghai.app.tcloudbase.com/h5',
  // 网关中转 / AI 的客户端等待上限（应 > 云函数自身超时 10s / 30s）
  RELAY_TIMEOUT_MS: 15000,
  AI_TIMEOUT_MS: 35000,
  DEFAULT_TIMEOUT_MS: 12000,
};
