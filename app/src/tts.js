/**
 * H13 语音复习（TTS）— 浏览器内置 Web Speech API
 *
 * 零成本 / 零依赖 / 不联网：音频在本机合成、本机播放，不上传、不提供导出。
 * 用途：把「想法 / 划线 / 每日卡片 / 灵感漫游 / 人格画像」用语音读出来。
 * 文案一律用「朗读 / 听」，不用「听书 / 电台 / 节目」。
 *
 * 约定：
 *   - 列表内的条目元素可加 `data-tts-index="N"`，朗读到该条时自动加 `.is-tts-active`。
 *   - 文本按句切段（≤80 字）逐段朗读，规避 Chrome 长句被截断。
 *   - 切后台 / 关闭页面立即停止。
 */

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
export const ttsSupported = !!(synth && typeof window.SpeechSynthesisUtterance === 'function');

let queue = [];            // [{ text, label }]
let index = 0;             // 当前条
let segs = [];             // 当前条的切句
let segIndex = 0;
let runToken = 0;          // 规避 cancel → speak 竞态
let paused = false;
let active = false;        // 是否有进行中的朗读会话

const MAX_SEG = 80;

function splitSegments(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return [];
  }
  const parts = raw.split(/(?<=[。！？!?；;\n])/);
  const out = [];
  let buf = '';
  parts.forEach((part) => {
    if ((buf + part).length > MAX_SEG && buf) {
      out.push(buf);
      buf = part;
    } else {
      buf += part;
    }
  });
  if (buf) {
    out.push(buf);
  }
  return out;
}

function pickVoice() {
  if (!synth || typeof synth.getVoices !== 'function') {
    return null;
  }
  const voices = synth.getVoices() || [];
  for (let i = 0; i < voices.length; i += 1) {
    const lang = String(voices[i].lang || '').toLowerCase();
    if (lang.indexOf('zh') === 0) {
      return voices[i];
    }
  }
  return null;
}

// ---- 底部控制条 ----
let barEl = null;
let barTextEl = null;
let barBtnEl = null;
let toastFn = null;

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
    '<span class="wre-tts-bar__pos" id="wreTtsPos"></span>' +
    '<span class="wre-tts-bar__label" id="wreTtsLabel"></span>' +
    '<button class="wre-tts-bar__btn" data-tts="stop" aria-label="停止">✕</button>';
  document.body.appendChild(barEl);
  barTextEl = barEl.querySelector('#wreTtsLabel');
  barBtnEl = barEl.querySelector('[data-tts="toggle"]');
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
  const posEl = barEl.querySelector('#wreTtsPos');
  if (posEl) {
    posEl.textContent = active && queue.length > 1 ? (index + 1) + ' / ' + queue.length : '';
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

// ---- 朗读引擎 ----
function speakSegment(token) {
  if (token !== runToken || segIndex >= segs.length) {
    if (token === runToken && segIndex >= segs.length) {
      playCurrentDone(token);
    }
    return;
  }
  const u = new SpeechSynthesisUtterance(segs[segIndex]);
  const voice = pickVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = 'zh-CN';
  }
  u.onend = () => {
    if (token !== runToken || paused) {
      return;
    }
    segIndex += 1;
    speakSegment(token);
  };
  u.onerror = () => {
    if (token !== runToken) {
      return;
    }
    segIndex += 1;
    speakSegment(token);
  };
  synth.speak(u);
}

function playCurrentDone(token) {
  if (token !== runToken) {
    return;
  }
  if (index + 1 < queue.length) {
    index += 1;
    startCurrent();
  } else {
    stop();
  }
}

function startCurrent() {
  const item = queue[index] || {};
  segs = splitSegments(item.text);
  segIndex = 0;
  paused = false;
  const token = runToken;
  highlight();
  paintBar();
  if (!segs.length) {
    // 空文本直接跳过
    if (index + 1 < queue.length) {
      index += 1;
      startCurrent();
    } else {
      stop();
    }
    return;
  }
  // 稍等一拍，规避 cancel 竞态
  setTimeout(() => {
    if (token === runToken) {
      speakSegment(token);
    }
  }, 30);
}

function begin() {
  active = true;
  ensureBar();
  paintBar();
}

/** 朗读一个列表；items = [{ text, label }] */
export function speakList(items, opts) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && String(it.text || '').trim());
  if (!ttsSupported) {
    notify('当前浏览器不支持语音朗读');
    return;
  }
  if (!list.length) {
    notify('没有可朗读的内容');
    return;
  }
  const start = Math.max(0, Math.min((opts && opts.start) || 0, list.length - 1));
  queue = list.map((it) => ({ text: String(it.text || ''), label: String(it.label || '') }));
  index = start;
  runToken += 1;
  try {
    synth.cancel();
  } catch (e) {
    // 忽略
  }
  begin();
  startCurrent();
}

/** 朗读单条文本 */
export function speakText(text, label) {
  speakList([{ text: text, label: label || '' }], { start: 0 });
}

export function togglePause() {
  if (!active) {
    return;
  }
  if (paused) {
    paused = false;
    try {
      synth.resume();
    } catch (e) {
      // 忽略
    }
  } else {
    paused = true;
    try {
      synth.pause();
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
  try {
    synth.cancel();
  } catch (e) {
    // 忽略
  }
  startCurrent();
}

export function prev() {
  if (!active) {
    return;
  }
  index = Math.max(0, index - 1);
  runToken += 1;
  try {
    synth.cancel();
  } catch (e) {
    // 忽略
  }
  startCurrent();
}

export function stop() {
  runToken += 1;
  active = false;
  paused = false;
  queue = [];
  segs = [];
  try {
    if (synth) {
      synth.cancel();
    }
  } catch (e) {
    // 忽略
  }
  highlight();
  paintBar();
}

export function isActive() {
  return active;
}

function notify(message) {
  if (typeof toastFn === 'function') {
    toastFn(message);
  }
}

/** 注入一个 toast 函数（避免 tts 直接依赖 ui.js） */
export function setTtsToast(fn) {
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
