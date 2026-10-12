/**
 * H5 云端语音朗读（Edge 神经语音，经云函数合成 mp3）
 *
 * 定位：给「朗读」换上更好听的音色——不在本机合成，改由云函数调用微软 Edge 神经语音，
 *       返回 mp3 后用 <audio> 播放。合成失败 / 未部署时返回 false，
 *       由 tts.js 回退到系统语音（Web Speech API），用户基本无感。
 *
 * 与 tts.js 同一套对外语义：列表朗读 / 暂停·继续 / 上一条 / 下一条 / 停止 / 当前条高亮。
 * 与系统语音的差别：音频按「条」整条合成（而非按句），故可在一整条内自由暂停、续播。
 *
 * 红线：音频只在内存里生成 Blob URL 播放，不落盘、不上传；音频不提供导出。
 */

import { tts as apiTts } from './api.js';
import { CONFIG } from './config.js';
import { localGet } from './store.js';

let queue = [];        // [{ text, label }]
let index = 0;
let active = false;
let paused = false;
let runToken = 0;      // 每次开始 / 切条 / 停止自增，作废旧回调
let toastFn = null;
let fallbackFn = null; // 云语音失败时回退调用（由 tts.js 注入：跑系统语音）
let failed = false;    // 本会话内一旦失败即停用云语音，避免反复等待

let audioEl = null;
const urlCache = new Map(); // text -> blobURL（同一条重复朗读不再请求）
const CACHE_MAX = 40;

let barEl = null;
let barBtnEl = null;
let barTextEl = null;
let barPosEl = null;

function notify(message) {
  if (typeof toastFn === 'function') {
    toastFn(message);
  }
}

// ---- 是否启用 ----
function isCloudEnabled() {
  if (localGet('wre_tts_engine') === 'system') {
    return false; // 本机显式要求用系统语音
  }
  const cfg = CONFIG.TTS || {};
  if (cfg.CLOUD === false) {
    return false;
  }
  return !!CONFIG.ENDPOINT; // 未配中转地址则不可用
}

/** 云语音当前是否可用（未失败 / 已启用 / 浏览器支持 <audio>） */
export function available() {
  if (failed) {
    return false;
  }
  if (!isCloudEnabled()) {
    return false;
  }
  return typeof window !== 'undefined' && typeof window.Audio === 'function';
}

// ---- 底部控制条（复用 tts.js 的 .wre-tts-bar 样式）----
function ensureBar() {
  if (barEl) {
    return barEl;
  }
  barEl = document.createElement('div');
  barEl.className = 'wre-tts-bar';
  barEl.innerHTML =
    '<button class="wre-tts-bar__btn" data-tts="prev" aria-label="上一条">⏮</button>' +
    '<button class="wre-tts-bar__btn wre-tts-bar__btn--main" data-tts="toggle" aria-label="暂停或继续">⏸</button>' +
    '<button class="wre-tts-bar__btn" data-tts="next" aria-label="下一条">⏭</button>' +
    '<span class="wre-tts-bar__pos"></span>' +
    '<span class="wre-tts-bar__label"></span>' +
    '<button class="wre-tts-bar__btn" data-tts="stop" aria-label="停止">✕</button>';
  document.body.appendChild(barEl);
  barBtnEl = barEl.querySelector('[data-tts="toggle"]');
  barTextEl = barEl.querySelector('.wre-tts-bar__label');
  barPosEl = barEl.querySelector('.wre-tts-bar__pos');
  barEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tts]');
    if (!btn) {
      return;
    }
    const act = btn.getAttribute('data-tts');
    if (act === 'toggle') {
      togglePause();
    } else if (act === 'next') {
      next();
    } else if (act === 'prev') {
      prev();
    } else if (act === 'stop') {
      stop();
    }
  });
  return barEl;
}

function paintBar() {
  if (!barEl) {
    return;
  }
  barEl.classList.toggle('is-show', active);
  if (barPosEl) {
    barPosEl.textContent = active && queue.length > 1 ? (index + 1) + ' / ' + queue.length : '';
  }
  if (barTextEl) {
    const item = queue[index];
    barTextEl.textContent = active && item ? (item.label || '') : '';
  }
  if (barBtnEl) {
    barBtnEl.textContent = paused ? '▶' : '⏸';
  }
}

function highlight() {
  document.querySelectorAll('.is-tts-active').forEach((el) => el.classList.remove('is-tts-active'));
  if (!active) {
    return;
  }
  const el = document.querySelector('[data-tts-index="' + index + '"]');
  if (el) {
    el.classList.add('is-tts-active');
  }
}

// ---- 音频获取与缓存 ----
function ensureAudio() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
  }
  return audioEl;
}

function base64ToUrl(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
}

function cachePut(text, url) {
  if (urlCache.size >= CACHE_MAX) {
    const oldestKey = urlCache.keys().next().value;
    const oldestUrl = urlCache.get(oldestKey);
    urlCache.delete(oldestKey);
    try {
      URL.revokeObjectURL(oldestUrl);
    } catch (e) {
      // 忽略
    }
  }
  urlCache.set(text, url);
}

async function fetchAudio(text) {
  const hit = urlCache.get(text);
  if (hit) {
    return hit;
  }
  const res = await apiTts(text, { voice: (CONFIG.TTS || {}).VOICE });
  if (!res || !res.ok || !res.audio) {
    throw new Error((res && res.error) || '语音合成失败');
  }
  const url = base64ToUrl(res.audio);
  cachePut(text, url);
  return url;
}

/** 预取某条音频（静默失败，只为播放更顺） */
function prefetch(i) {
  if (i < 0 || i >= queue.length) {
    return;
  }
  const text = String((queue[i] || {}).text || '');
  if (!text || urlCache.has(text)) {
    return;
  }
  fetchAudio(text).catch(() => {});
}

// ---- 播放引擎 ----
function failAndFallback(message) {
  failed = true;
  const fn = fallbackFn;
  stop();
  notify(message || '云语音暂不可用，已改用系统语音');
  if (typeof fn === 'function') {
    fn(); // 由 tts.js 跑系统语音
  }
}

function advance() {
  if (index + 1 < queue.length) {
    index += 1;
    runToken += 1;
    playCurrent();
  } else {
    stop();
  }
}

function playCurrent() {
  const token = runToken;
  const item = queue[index] || {};
  const text = String(item.text || '');
  if (!text) {
    advance();
    return;
  }
  prefetch(index + 1);
  fetchAudio(text)
    .then((url) => {
      if (token !== runToken) {
        return;
      }
      const a = ensureAudio();
      a.onended = () => {
        if (token === runToken) {
          advance();
        }
      };
      a.src = url;
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => failAndFallback('音频播放被浏览器拦截或无法解码，已改用系统语音'));
      }
      paintBar();
      highlight();
    })
    .catch((err) => {
      if (token !== runToken) {
        return;
      }
      failAndFallback((err && err.message) || '云语音暂不可用，已改用系统语音');
    });
}

/**
 * 列表朗读。返回 true 表示由云语音接管；false 表示不可用（调用方走系统语音）。
 * onFallback：云语音中途失败时调用，用于无缝切换系统语音。
 */
export function speakList(items, opts, onFallback) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && String(it.text || '').trim());
  if (!list.length || !available()) {
    return false;
  }
  const start = Math.max(0, Math.min((opts && opts.start) || 0, list.length - 1));
  queue = list.map((it) => ({ text: String(it.text || ''), label: String(it.label || '') }));
  index = start;
  runToken += 1;
  active = true;
  paused = false;
  fallbackFn = typeof onFallback === 'function' ? onFallback : null;

  ensureBar();
  paintBar();
  highlight();
  // 用户点击已解锁音频；先空播一次拿到播放许可，再异步加载真实音频
  try {
    const a = ensureAudio();
    const p = a.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  } catch (e) {
    // 忽略
  }
  playCurrent();
  return true;
}

export function togglePause() {
  if (!active) {
    return;
  }
  if (paused) {
    paused = false;
    try {
      audioEl.play();
    } catch (e) {
      // 忽略
    }
  } else {
    paused = true;
    try {
      audioEl.pause();
    } catch (e) {
      // 忽略
    }
  }
  paintBar();
}

export function next() {
  if (!active) {
    return;
  }
  if (index + 1 >= queue.length) {
    stop();
    return;
  }
  index += 1;
  runToken += 1;
  playCurrent();
}

export function prev() {
  if (!active) {
    return;
  }
  index = Math.max(0, index - 1);
  runToken += 1;
  playCurrent();
}

export function stop() {
  runToken += 1;
  active = false;
  paused = false;
  queue = [];
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.onended = null;
      audioEl.removeAttribute('src');
    } catch (e) {
      // 忽略
    }
  }
  highlight();
  paintBar();
}

export function isActive() {
  return active;
}

export function setCloudToast(fn) {
  toastFn = typeof fn === 'function' ? fn : null;
}

// 切后台 / 关页面即停（不做后台常驻播放）
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
    }
  });
  window.addEventListener('pagehide', () => stop());
}
