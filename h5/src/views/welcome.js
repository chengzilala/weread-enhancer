/**
 * 引导页（landing）：未配置 Key 时打开网页看到的第一屏
 *
 * 面向「第一次打开、没有计算机经验」的用户：先用大白话讲清「这是什么、能做什么」，
 * 再给出「三步开始」，最后引导去配置 Key。视觉沿用现有主题变量（浅色品牌蓝为主，
 * 深色模式自动适配），与 H5 其它页 / 明暗主题保持一致。
 */

import { CONFIG } from '../config.js';
import { applyTheme } from '../store.js';
import { keyGuideHtml } from '../key-guide.js';

export const title = CONFIG.APP_NAME;

/** 当前实际生效的主题（light / dark） */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** 明暗切换按钮图标：显示当前主题（深色 → 🌙，浅色 → ☀️） */
function themeIcon(theme) {
  return theme === 'dark' ? '🌙' : '☀️';
}

export function render(root, app) {
  root.innerHTML = '<div class="wre-landing" id="welcomeBody">' + html() + '</div>';
  const body = root.querySelector('#welcomeBody');
  const themeBtn = body.querySelector('[data-action="theme"]');
  if (themeBtn) {
    themeBtn.textContent = themeIcon(currentTheme());
  }
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      return;
    }
    const action = btn.getAttribute('data-action');
    if (action === 'start') {
      app.go('setup');   // 进入 Key 配置页
    } else if (action === 'features') {
      const el = body.querySelector('#wreLandingFeatures');
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (action === 'theme') {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      btn.textContent = themeIcon(next);
    }
  });
}

/** 顶部导航条：logo + 名称 + 明暗切换 + 开始使用（替代全局蓝色顶栏） */
function nav() {
  return (
    '<header class="wre-landing__nav">' +
    '  <div class="wre-landing__brand">' +
    '    <span class="wre-landing__logo">📖</span>' +
    '    <div class="wre-landing__brand-text">' +
    '      <div class="wre-landing__brand-name">' + CONFIG.APP_NAME + '</div>' +
    '      <div class="wre-landing__brand-sub">阅读数据 · 人格 · 报告</div>' +
    '    </div>' +
    '  </div>' +
    '  <div class="wre-landing__nav-actions">' +
    '    <button class="wre-landing__theme" data-action="theme" aria-label="切换深色 / 浅色">☀️</button>' +
    '    <button class="wre-landing__login" data-action="start">开始使用</button>' +
    '  </div>' +
    '</header>'
  );
}

/** 预览卡里的单个指标格 */
function previewCell(value, label) {
  return (
    '<div class="wre-grid__item">' +
    '  <div class="wre-grid__value">' + value + '</div>' +
    '  <div class="wre-grid__label">' + label + '</div>' +
    '</div>'
  );
}

/** 「界面示意」预览卡：让没经验的用户一眼看到用了之后是什么样 */
function preview() {
  const bars = [42, 68, 55, 80, 62, 100, 74];   // 近 7 天阅读时长示意
  return (
    '<section class="wre-landing__preview">' +
    '  <div class="wre-landing__preview-head">' +
    '    <span class="wre-landing__preview-status"><i class="wre-landing__dot"></i>本月阅读状态不错</span>' +
    '    <span class="wre-landing__preview-tag">界面示意</span>' +
    '  </div>' +
    '  <div class="wre-grid">' +
    previewCell('28.5<span class="wre-landing__unit">小时</span>', '本月阅读时长') +
    previewCell('3<span class="wre-landing__unit">本</span>', '本月读完') +
    previewCell('12<span class="wre-landing__unit">天</span>', '连续阅读') +
    previewCell('沉思型', '阅读人格') +
    '  </div>' +
    '  <div class="wre-trend">' +
    bars.map((h) => '<span class="wre-bar' + (h >= 100 ? ' is-peak' : '') + '" style="height:' + h + '%"></span>').join('') +
    '  </div>' +
    '</section>'
  );
}

function feat(icon, name, desc) {
  return (
    '<div class="wre-landing__card">' +
    '  <div class="wre-landing__card-icon">' + icon + '</div>' +
    '  <div class="wre-landing__card-title">' + name + '</div>' +
    '  <div class="wre-landing__card-desc">' + desc + '</div>' +
    '</div>'
  );
}

function stepRow(no, name, desc) {
  return (
    '<li class="wre-landing__step">' +
    '  <span class="wre-landing__step-no">' + no + '</span>' +
    '  <div class="wre-landing__step-body">' +
    '    <div class="wre-landing__step-title">' + name + '</div>' +
    '    <div class="wre-landing__step-desc">' + desc + '</div>' +
    '  </div>' +
    '</li>'
  );
}

function html() {
  return (
    nav() +

    '<section class="wre-landing__hero">' +
    '  <h1 class="wre-landing__title">把你自己的微信读书数据，<br>变成看得懂的阅读报告</h1>' +
    '  <p class="wre-landing__lead">不用注册、不用装软件，用手机浏览器打开就能用。它会读懂你读过什么、怎么读的，' +
    '生成你的「阅读人格」和一份阅读报告。</p>' +
    '  <button class="wre-btn" data-action="start">三步开始使用</button>' +
    '  <button class="wre-btn wre-btn--ghost" data-action="features">先看看能做什么</button>' +
    '  <p class="wre-landing__hint">只读你自己的数据 · 全程免费 · 随时可清除</p>' +
    '</section>' +

    preview() +

    '<section class="wre-landing__sec">' +
    '  <h2 class="wre-landing__sec-title" id="wreLandingFeatures">能做什么</h2>' +
    '  <div class="wre-landing__grid">' +
    feat('📊', '阅读数据总览', '读了多久、多少本、连续多少天，一屏看清这段时间的阅读状态。') +
    feat('🧬', '阅读人格画像', '从你的阅读偏好里提炼出一个「人格」，用一个词概括你是个怎样的读者。') +
    feat('🪞', '阅读行为报告', '阅读时段、偏好主题、阅读集中度，自动整理成一份报告。') +
    feat('📅', '每日卡片', '每天一张卡片，配一句和你阅读有关的话。') +
    feat('🧭', '灵感漫游', '把你的笔记与划线发散成一张主题网，偶尔给你一点新灵感。') +
    feat('📚', '书架与笔记', '在手机上直接看你的书架、搜书评、翻自己的划线与想法。') +
    '  </div>' +
    '</section>' +

    '<section class="wre-landing__sec">' +
    '  <h2 class="wre-landing__sec-title">三步开始</h2>' +
    '  <ol class="wre-landing__steps">' +
    stepRow(1, '拿到微信读书 Key', '在微信读书 App 里复制一段 wrk- 开头的 Key，下面有图文教程。') +
    stepRow(2, '粘贴到这里', '第一次打开会让你粘贴 Key，点「保存并校验」，通过后就能用。') +
    stepRow(3, '开始看你的数据', '首页、人格、报告、书架随点随看，数据都在你手机里算。') +
    '  </ol>' +
    '</section>' +

    '<section class="wre-landing__sec">' +
    '  <h2 class="wre-landing__sec-title">怎么拿到 Key（图文）</h2>' +
    keyGuideHtml() +
    '</section>' +

    '<section class="wre-landing__sec">' +
    '  <h2 class="wre-landing__sec-title">你的数据，只属于你</h2>' +
    '  <div class="wre-landing__grid">' +
    feat('🔒', '只读不写', '只用你给的 Key 读取你自己的阅读数据，不会修改你的账号。') +
    feat('🗝️', 'Key 加密托管', 'Key 只提交一次，由你自己的云函数加密保存，本机不再留明文。') +
    feat('🧹', '随时可清', '在「我的」里一键清除托管的 Key，想撤就撤。') +
    feat('📱', '本机计算', '数据与人格都在你的浏览器里算，不上传到别处。') +
    '  </div>' +
    '</section>' +

    '<section class="wre-landing__cta">' +
    '  <button class="wre-btn" data-action="start">开始使用</button>' +
    '  <p class="wre-landing__hint">已经有账户码？进入后在「我的」里用账户码登录，就能找回之前的配置。</p>' +
    '</section>'
  );
}
