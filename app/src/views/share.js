/**
 * 只读分享页（H5）— 对应短链 `#/s/<code>`
 *
 * 别人点开分享链接时进入本页：无需配置 Key，直接向云函数凭短码取回分享内容，
 * 只读展示同一张卡片的文字（徽标 / 标题 / 数据 / 原文 / 标签 / 署名）。
 * 页面底部提供「打开微信悦读」入口，引导到首页。
 *
 * 红线：只展示分享者主动上传的展示字段；不读任何本机数据、不请求官方接口、不带 Key。
 */

import { shareGet } from '../api.js';
import { CONFIG } from '../config.js';
import { esc, stateHtml } from '../ui.js';

export const title = '分享';

export function render(root, app, code) {
  root.innerHTML = '<div class="wre-page" id="shareBody"></div>';
  const body = root.querySelector('#shareBody');
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry"]')) {
      load(body, app, code);
      return;
    }
    if (e.target.closest('[data-action="open-app"]')) {
      app.go('home');
    }
  });
  load(body, app, code);
}

async function load(body, app, code) {
  body.innerHTML = stateHtml('loading', '正在打开分享…');
  const res = await shareGet(code);
  if (!res || !res.ok || !res.payload) {
    const msg = (res && res.code === 'expired') ? '这条分享已过期（分享链接保留 90 天）' : '分享不存在或已失效';
    body.innerHTML =
      '<div class="wre-card">' + stateHtml('empty', msg) +
      '<button class="wre-btn" data-action="open-app">打开 ' + esc(CONFIG.APP_NAME) + '</button>' +
      '</div>';
    return;
  }
  body.innerHTML = cardHtml(res.payload) + openCardHtml();
}

function cardHtml(payload) {
  const p = payload || {};
  const parts = [];
  parts.push(
    '<div class="wre-card wre-share-detail">' +
    '  <div class="wre-share-detail__top">' +
    '    <span class="wre-share-detail__brand">' + esc(CONFIG.APP_NAME) + '</span>' +
    (p.badge ? '    <span class="wre-share-detail__badge">' + esc(p.badge) + '</span>' : '') +
    '  </div>'
  );
  if (p.title) {
    parts.push('<div class="wre-share-detail__title">' + esc(p.title) + '</div>');
  }
  if (p.subtitle) {
    parts.push('<div class="wre-muted">' + esc(p.subtitle) + '</div>');
  }
  if (Array.isArray(p.stats) && p.stats.length) {
    parts.push(
      '<div class="wre-grid">' +
      p.stats.map((it) =>
        '<div class="wre-grid__item"><div class="wre-grid__value">' + esc(it && it.value) + '</div>' +
        '<div class="wre-grid__label">' + esc(it && it.label) + '</div></div>').join('') +
      '</div>'
    );
  }
  if (Array.isArray(p.lines) && p.lines.length) {
    parts.push(p.lines.map((t) => '<p class="wre-p">' + esc(t) + '</p>').join(''));
  }
  if (p.quote && p.quote.text) {
    parts.push(
      '<blockquote class="wre-quote">' + esc(p.quote.text) +
      (p.quote.from ? '<cite>——' + esc(p.quote.from) + '</cite>' : '') +
      '</blockquote>'
    );
  }
  if (Array.isArray(p.chips) && p.chips.length) {
    parts.push('<div class="wre-chips">' + p.chips.map((t) => '<span class="wre-chip">' + esc(t) + '</span>').join('') + '</div>');
  }
  if (p.footer) {
    parts.push('<div class="wre-share-detail__footer">' + esc(p.footer) + '</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

function openCardHtml() {
  return (
    '<div class="wre-card wre-share-entry">' +
    '<button class="wre-btn" data-action="open-app">打开 ' + esc(CONFIG.APP_NAME) + '</button>' +
    '<div class="wre-muted">这是好友主动分享的卡片 · 只读展示 · 不含 TA 的账号信息</div>' +
    '</div>'
  );
}
