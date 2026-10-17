/**
 * 「如何获取微信读书 Key」图文说明（3 步 + 截图，可折叠）
 *
 * 供引导页（landing）、Key 配置页、以及「我的 → API Key」三处复用同一份内容，
 * 保证口径一致。用原生 <details> 折叠：闭合时内容不参与布局，
 * 里面的 <img loading="lazy"> 也就不会提前加载，避免拖慢首屏。
 */

import { esc } from './ui.js';

function step(no, text, img, alt) {
  return (
    '<div class="wre-guide__step">' +
    '  <div class="wre-guide__row">' +
    '    <span class="wre-guide__no">' + esc(no) + '</span>' +
    '    <span class="wre-guide__text">' + esc(text) + '</span>' +
    '  </div>' +
    '  <img class="wre-guide__img" src="assets/img/' + esc(img) + '" alt="' + esc(alt) + '" loading="lazy" />' +
    '</div>'
  );
}

/**
 * @param {{ summary?: string, open?: boolean }} [options]
 *   summary —— 折叠条上的文字；open —— 是否默认展开（默认收起，图片懒加载）
 */
export function keyGuideHtml(options) {
  const opts = options || {};
  const summary = opts.summary || '还不知道去哪拿 Key？点开看 3 步图文说明';
  return (
    '<details class="wre-guide"' + (opts.open ? ' open' : '') + '>' +
    '  <summary class="wre-guide__summary">' + esc(summary) + '</summary>' +
    '  <div class="wre-guide__body">' +
    step('1', '打开微信读书 App → 底部「我」→ 右上角「设置」，找到并进入「微信读书 Skill」。', 'skill-step1.png', '微信读书 Skill 入口') +
    step('2', '进来后往下拉，看「快速配置」区，第 ② 步就是「获取 API Key」。', 'skill-step2.png', '微信读书 Skill 快速配置') +
    step('3', '点「复制 Key」，就得到一段 wrk- 开头的 Key（默认打码，点右侧「👁」可看明文）。', 'skill-step3.png', '微信读书 Skill 获取 Key') +
    '    <div class="wre-guide__tip">小提示：第 ① 步的安装指令是给 AI 助手用的，这里用不到；只要第 ② 步的 Key 就够了。</div>' +
    '  </div>' +
    '</details>'
  );
}
