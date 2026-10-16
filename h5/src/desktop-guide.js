/**
 * 「装到桌面」图文说明（H5 / PWA）
 *
 * 加到桌面后，从图标打开的是一个独立窗口（没有浏览器地址栏），用起来接近原生 App，
 * 网页本身也不占内存。电脑（Windows / Mac）走浏览器「安装应用 / 添加到程序坞」，
 * 手机走 Safari「添加到主屏幕」或浏览器菜单「安装应用 / 添加到主屏幕」。
 * 全站口径一致：供「我的」页（直接铺开）与首页（折叠）复用。
 */

import { esc } from './ui.js';

function row(no, text) {
  return (
    '<div class="wre-guide__row">' +
    '  <span class="wre-guide__no">' + esc(no) + '</span>' +
    '  <span class="wre-guide__text">' + esc(text) + '</span>' +
    '</div>'
  );
}

function group(title, steps) {
  return (
    '<div class="wre-guide__step">' +
    '  <div class="wre-guide__group-title">' + esc(title) + '</div>' +
    steps.map((s, i) => row(i + 1, s)).join('') +
    '</div>'
  );
}

/** 各平台分步说明（不含外层折叠壳）；供「我的」页直接铺开显示 */
export function desktopGuideBodyHtml() {
  return (
    group('电脑（Windows / Mac）', [
      '用 Chrome 或 Edge 打开本页（网址以 /app/ 结尾）。',
      '看浏览器地址栏最右侧：出现「安装」图标（一个小方块加向下箭头）就点它；没有的话点右上角「⋮」，在菜单里选「安装 微信悦读…」。',
      '在弹出的窗口里点「安装」。桌面 / 开始菜单（Windows）或「启动台 / 应用程序」（Mac）就会多出「微信悦读」图标。',
      'Mac 上用 Safari 打开时：点菜单栏「文件」→「添加到程序坞」（需 macOS 14 及以上）。',
    ]) +
    group('iPhone / iPad（Safari 浏览器）', [
      '用 Safari 打开本页。如果是在微信里点开的，先点右上角「…」→「在浏览器打开」。',
      '点屏幕最下方中间的「分享」按钮（一个方框加向上箭头）。',
      '在弹出的菜单里往下滑，找到「添加到主屏幕」，点它。',
      '右上角点「添加」。回到手机桌面，就会多出一个「微信悦读」图标。',
    ]) +
    group('安卓手机（Chrome 或手机自带浏览器）', [
      '用浏览器打开本页。如果是在微信里点开的，先点右上角「…」→「在浏览器打开」。',
      '点右上角「⋮」（三个点的菜单）。',
      '在菜单里选「添加到主屏幕」或「安装应用」。',
      '确认「添加 / 安装」。手机桌面就会出现图标。',
    ]) +
    '<div class="wre-guide__tip">装到桌面后，点图标打开就是独立窗口，没有浏览器地址栏，和 App 一样；网页本身不占内存。电脑上装好后在开始菜单 / 启动台，手机上在桌面；若找不到图标，用桌面搜索或搜索「微信悦读」。</div>'
  );
}

/**
 * @param {{ summary?: string, open?: boolean }} [options]
 *   summary —— 折叠条上的文字；open —— 是否默认展开（默认收起，减少首页占位）
 */
export function desktopGuideHtml(options) {
  const opts = options || {};
  const summary = opts.summary || '📲 装到桌面，像 App 一样用（电脑 / 手机都能装，点开看步骤）';
  return (
    '<details class="wre-guide"' + (opts.open ? ' open' : '') + '>' +
    '  <summary class="wre-guide__summary">' + esc(summary) + '</summary>' +
    '  <div class="wre-guide__body">' + desktopGuideBodyHtml() + '</div>' +
    '</details>'
  );
}
