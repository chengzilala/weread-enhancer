/**
 * 全局配置
 *
 * CLOUD_ENV：云开发环境 ID。在「微信开发者工具 → 云开发控制台 → 设置 → 环境 ID」可以看到，
 *            形如 `cloud1-1a2b3c4d`。留空则使用账号下的默认环境（建议填写，避免选错环境）。
 *
 * AI_ENABLED（M15 合规上线开关）：小程序内是否允许「AI 生成」能力。
 *   - 个人主体小程序审核不允许涉及「深度合成技术」（AI 生成内容），故**上线版必须为 false**；
 *   - 关闭后：人格画像入口隐藏、每日卡片与灵感漫游改纯本地规则排版、设置页无 AI Key 区块、
 *     云函数 action:'ai' 通道关闭 → 小程序内零 AI 出口；
 *   - 日后转企业主体并完成相应资质后，只需把这里改为 true（并同步放开云函数开关）即可恢复。
 */
module.exports = {
  CLOUD_ENV: 'cloud1-d4g1dq0sc7f62329d',
  PROXY_FUNCTION: 'wereadProxy',
  AI_ENABLED: false,

  /* 四端互联（四端 = 浏览器插件官网 / H5 网页版 / 微信小程序 / 作者个人网站）
   * 小程序内不能直接打开网页，点这些入口的做法是「复制链接 + 弹窗提示」，
   * 用户再到浏览器 / 微信里粘贴打开。地址若有变动，只改这一处。 */
  SITE_NAME: '微信悦读',
  MINIAPP_NAME: '悦读且住',
  LINKS: {
    site: 'https://wereadapp-32km31c.maozi.io',              // 官网（插件下载与教程）
    h5: 'https://wereadapp-32km31c.maozi.io/app/',           // H5 网页版（满血版，带 AI）
    personal: 'https://personalsite-32km31c.maozi.io/',      // 作者个人网站
  },
};
