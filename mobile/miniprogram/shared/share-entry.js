/**
 * 分享入口通用逻辑（小程序端）
 *
 * 6 个分享入口（首页 / 人格 / 报告 / 书架 / 每日卡片 / 灵感漫游）共用：
 *   - copyLink(page)     ：「复制链接」按钮 → 生成只读短链 → 复制到剪贴板 + 弹窗提示；
 *   - prepareCode(page)  ：生成分享图时后台预热短码，供「转发给朋友」的卡片带上 code；
 *   - forwardPath(page)  ：转发卡片的落地路径（有 code 走只读分享页，否则回退到本页）。
 *
 * 页面只需实现 buildShareSpec()，返回通用分享卡对象：
 *   { kind, badge, title, subtitle, stats:[{label,value}], lines:[string], quote:{text,from}, chips:[string], footer }
 */
const shareLink = require('./share-link');

/** 生成只读分享链接并复制到剪贴板 */
async function copyLink(page) {
  if (typeof page.buildShareSpec !== 'function') {
    return;
  }
  const spec = page.buildShareSpec();
  if (!spec) {
    wx.showToast({ title: '暂无可分享内容', icon: 'none' });
    return;
  }
  wx.showLoading({ title: '生成链接中', mask: true });
  const res = await shareLink.putShare(spec.kind, spec);
  wx.hideLoading();
  if (!res.ok) {
    wx.showToast({ title: res.error || '生成失败，请重试', icon: 'none' });
    return;
  }
  page.shareCode = res.code;
  wx.setClipboardData({
    data: res.url,
    success: () => {
      wx.showModal({
        title: '链接已复制',
        content: '已复制只读分享链接，发给好友即可打开查看（微信或浏览器都能打开）。',
        showCancel: false,
      });
    },
  });
}

/** 预热短码：生成分享图时后台调一次，供转发卡片使用（失败静默，不打扰用户） */
async function prepareCode(page) {
  if (page.shareCode || typeof page.buildShareSpec !== 'function') {
    return;
  }
  const spec = page.buildShareSpec();
  if (!spec) {
    return;
  }
  const res = await shareLink.putShare(spec.kind, spec);
  if (res.ok) {
    page.shareCode = res.code;
  }
}

/** 转发卡片落地路径：有短码则落到只读分享页，否则回退到页面自身 */
function forwardPath(page, fallback) {
  return page.shareCode ? ('/pages/share/index?code=' + page.shareCode) : fallback;
}

module.exports = { copyLink, prepareCode, forwardPath };
