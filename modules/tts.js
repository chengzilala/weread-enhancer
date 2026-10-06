/**
 * 微信悦读 · 语音复习模块（M14 · v0.24.0）
 *
 * 定位：把「用户自己的」笔记（划线 / 想法）用语音读出来，便于通勤 / 走路 / 闭眼等
 *       「不方便看」的场景复习。独立模块，不改动 content.js / notes.js 既有逻辑，
 *       只在「📝 笔记」面板上就地增加「▶ 听」按钮与一条播放控制条。
 *
 * 技术：浏览器内置 Web Speech API（speechSynthesis + SpeechSynthesisUtterance）——
 *       零依赖 / 零成本 / 不联网 / 不新增任何权限。语音在本机合成，只读文本、不落盘、不出网。
 *
 * 红线：
 *   1. 音频本机合成 / 播放，不上传、不落公网；不提供「书摘音频」分享 / 导出。
 *   2. 文案一律用「朗读 / 听」，不使用「听书 / 电台 / 节目」。
 *   3. 不与官方页面抢全局键盘；只走独立按钮点击。
 *
 * 对外 API（挂在 window.WRETTS）：
 *   supported        —— 当前浏览器是否支持
 *   playOne(text, el)—— 朗读单条（同一时刻只播一条；对同一条再点 = 暂停 / 继续）
 *   playList(list)   —— 队列朗读，list = [{ text, element }]
 *   togglePause()    —— 暂停 / 继续
 *   stop()           —— 停止并清空队列
 *   next() / prev()  —— 下一条 / 上一条
 */
(function () {
  'use strict';

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const SUPPORTED = !!(synth && typeof window.SpeechSynthesisUtterance === 'function');
  const MAX_SEGMENT_LEN = 80; // 单段最大字数：分段朗读可规避 Chrome 长句被截断
  const RESTART_DELAY_MS = 30; // cancel → speak 之间留一点时间，规避竞态

  let voices = [];
  let zhVoice = null;
  let runToken = 0; // 每次开始 / 停止自增，用于作废延迟任务

  const state = {
    queue: [], // [{ text, element }]
    index: -1,
    segments: [],
    segIndex: 0,
    playing: false,
    paused: false,
    currentElement: null,
  };

  function logTts(level, message, meta) {
    if (typeof log === 'function') {
      log(level, '[TTS] ' + message, meta);
    }
  }

  // ---------- 语音选择 ----------

  function refreshVoices() {
    if (!SUPPORTED) {
      return;
    }
    voices = synth.getVoices() || [];
    const zh = voices.filter(function (voice) {
      return /^zh/i.test(voice.lang || '');
    });
    zhVoice =
      zh.filter(function (v) { return /^zh[-_]CN/i.test(v.lang || ''); }).sort(function (a, b) {
        return (b.localService ? 1 : 0) - (a.localService ? 1 : 0);
      })[0] || zh[0] || null;
  }

  // ---------- 文本分段 ----------

  function splitSegments(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) {
      return [];
    }
    const raw = clean.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [clean];
    const pieces = [];
    raw.forEach(function (part) {
      let piece = part.trim();
      while (piece.length > MAX_SEGMENT_LEN) {
        pieces.push(piece.slice(0, MAX_SEGMENT_LEN));
        piece = piece.slice(MAX_SEGMENT_LEN);
      }
      if (piece) {
        pieces.push(piece);
      }
    });
    const segments = [];
    let buf = '';
    pieces.forEach(function (piece) {
      if (buf && buf.length + piece.length > MAX_SEGMENT_LEN) {
        segments.push(buf);
        buf = piece;
      } else {
        buf += piece;
      }
    });
    if (buf) {
      segments.push(buf);
    }
    return segments;
  }

  // ---------- 控制条（挂在笔记弹窗底部，不随列表重绘消失）----------

  function ensureBar() {
    const modal = document.querySelector('#wre-notes-modal .wre-notes-modal');
    if (!modal) {
      return null;
    }
    let bar = modal.querySelector('.wre-tts-bar');
    if (bar) {
      return bar;
    }
    bar = document.createElement('div');
    bar.className = 'wre-tts-bar';
    bar.innerHTML =
      '<button class="wre-tts-btn" data-wre-tts-prev title="上一条">⏮</button>' +
      '<button class="wre-tts-btn wre-tts-toggle" data-wre-tts-toggle>⏸ 暂停</button>' +
      '<button class="wre-tts-btn" data-wre-tts-next title="下一条">⏭</button>' +
      '<span class="wre-tts-count"></span>' +
      '<span class="wre-tts-hint">本机朗读 · 不联网、不上传</span>' +
      '<button class="wre-tts-btn wre-tts-stop" data-wre-tts-stop>⏹ 停止</button>';
    bar.addEventListener('click', function (event) {
      const target = event.target;
      if (!target || !target.closest) {
        return;
      }
      if (target.closest('[data-wre-tts-prev]')) {
        api.prev();
      } else if (target.closest('[data-wre-tts-toggle]')) {
        api.togglePause();
      } else if (target.closest('[data-wre-tts-next]')) {
        api.next();
      } else if (target.closest('[data-wre-tts-stop]')) {
        api.stop();
      }
    });
    modal.appendChild(bar);
    return bar;
  }

  function setItemButton(element, label, active) {
    if (!element) {
      return;
    }
    const btn = element.querySelector ? element.querySelector('[data-wre-notes-listen]') : null;
    if (btn) {
      btn.textContent = label;
    }
    if (active) {
      element.classList.add('is-tts-active');
    } else {
      element.classList.remove('is-tts-active');
    }
  }

  function setCurrentElement(element) {
    const prev = state.currentElement;
    if (prev && prev !== element) {
      setItemButton(prev, '▶', false);
    }
    state.currentElement = element || null;
    if (state.currentElement) {
      setItemButton(state.currentElement, state.paused ? '▶' : '⏸', true);
    }
  }

  function resetCurrentElement() {
    if (state.currentElement) {
      setItemButton(state.currentElement, '▶', false);
    }
    state.currentElement = null;
  }

  function syncUI() {
    const bar = ensureBar();
    if (!bar) {
      return;
    }
    const visible = state.playing || state.paused;
    if (visible) {
      bar.classList.add('wre-visible');
    } else {
      bar.classList.remove('wre-visible');
    }
    const toggleBtn = bar.querySelector('[data-wre-tts-toggle]');
    if (toggleBtn) {
      toggleBtn.textContent = state.paused ? '▶ 继续' : '⏸ 暂停';
    }
    const count = bar.querySelector('.wre-tts-count');
    if (count) {
      count.textContent = state.index >= 0 ? '第 ' + (state.index + 1) + ' / 共 ' + state.queue.length + ' 条' : '';
    }
    if (state.currentElement && document.contains(state.currentElement)) {
      setItemButton(state.currentElement, state.paused ? '▶' : '⏸', true);
    }
  }

  // ---------- 播放核心 ----------

  function speakCurrentSegment() {
    if (!state.playing || state.paused) {
      return;
    }
    if (state.segIndex >= state.segments.length) {
      advance();
      return;
    }
    const utterance = new window.SpeechSynthesisUtterance(state.segments[state.segIndex]);
    if (zhVoice) {
      utterance.voice = zhVoice;
      utterance.lang = zhVoice.lang;
    } else {
      utterance.lang = 'zh-CN';
    }
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = function () {
      if (!state.playing || state.paused) {
        return;
      }
      state.segIndex += 1;
      speakCurrentSegment();
    };
    utterance.onerror = function (event) {
      const reason = event && event.error;
      // interrupted / canceled 属正常「被停止」，不当成错误
      if (reason === 'interrupted' || reason === 'canceled') {
        return;
      }
      logTts('warn', '本段朗读失败，跳过', { error: reason || 'unknown' });
      if (!state.playing || state.paused) {
        return;
      }
      state.segIndex += 1;
      speakCurrentSegment();
    };
    try {
      synth.speak(utterance);
    } catch (err) {
      logTts('warn', '朗读调用失败，跳过本段', { error: String(err && err.message ? err.message : err) });
      state.segIndex += 1;
      speakCurrentSegment();
    }
  }

  function playAt(index) {
    if (!state.playing) {
      return;
    }
    if (index < 0 || index >= state.queue.length) {
      finish();
      return;
    }
    const item = state.queue[index];
    state.index = index;
    state.segments = splitSegments(item.text);
    state.segIndex = 0;
    state.paused = false;
    setCurrentElement(item.element);
    syncUI();
    if (item.element && typeof item.element.scrollIntoView === 'function') {
      try {
        item.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (err) {
        /* 忽略：部分环境不支持 options */
      }
    }
    logTts('info', '开始朗读第 ' + (index + 1) + ' / ' + state.queue.length + ' 条', { segments: state.segments.length });
    speakCurrentSegment();
  }

  function advance() {
    if (!state.playing) {
      return;
    }
    if (state.index + 1 < state.queue.length) {
      playAt(state.index + 1);
      return;
    }
    finish();
  }

  function finish() {
    runToken += 1;
    resetCurrentElement();
    state.playing = false;
    state.paused = false;
    state.queue = [];
    state.index = -1;
    state.segments = [];
    state.segIndex = 0;
    syncUI();
    logTts('info', '朗读完成');
  }

  function start(queue, startIndex) {
    runToken += 1;
    if (synth) {
      try {
        synth.cancel();
      } catch (err) {
        /* 忽略 */
      }
    }
    resetCurrentElement();
    state.queue = queue;
    state.index = -1;
    state.segments = [];
    state.segIndex = 0;
    state.playing = true;
    state.paused = false;
    syncUI();
    const token = runToken;
    setTimeout(function () {
      if (token !== runToken) {
        return;
      }
      playAt(typeof startIndex === 'number' ? startIndex : 0);
    }, RESTART_DELAY_MS);
  }

  function jumpTo(index) {
    if (!state.playing || index < 0 || index >= state.queue.length) {
      return;
    }
    runToken += 1;
    try {
      synth.cancel();
    } catch (err) {
      /* 忽略 */
    }
    const token = runToken;
    setTimeout(function () {
      if (token === runToken) {
        playAt(index);
      }
    }, RESTART_DELAY_MS);
  }

  // ---------- 对外 API ----------

  const api = {
    supported: SUPPORTED,

    playOne: function (text, element) {
      if (!SUPPORTED) {
        return;
      }
      const content = String(text || '').trim();
      if (!content) {
        return;
      }
      // 同一条再点 = 暂停 / 继续
      if (element && state.playing && element === state.currentElement && state.queue.length === 1) {
        api.togglePause();
        return;
      }
      start([{ text: content, element: element || null }], 0);
    },

    playList: function (list) {
      if (!SUPPORTED) {
        return;
      }
      const queue = (list || [])
        .filter(function (item) { return item && String(item.text || '').trim(); })
        .map(function (item) { return { text: String(item.text).trim(), element: item.element || null }; });
      if (!queue.length) {
        return;
      }
      start(queue, 0);
    },

    togglePause: function () {
      if (!state.playing) {
        return;
      }
      if (state.paused) {
        state.paused = false;
        try {
          synth.resume();
        } catch (err) {
          /* 忽略 */
        }
      } else {
        state.paused = true;
        try {
          synth.pause();
        } catch (err) {
          /* 忽略 */
        }
      }
      syncUI();
    },

    next: function () {
      jumpTo(state.index + 1);
    },

    prev: function () {
      jumpTo(state.index - 1);
    },

    stop: function () {
      if (!SUPPORTED) {
        return;
      }
      const wasActive = state.playing || state.paused || state.index >= 0;
      runToken += 1;
      try {
        synth.cancel();
      } catch (err) {
        /* 忽略 */
      }
      resetCurrentElement();
      state.playing = false;
      state.paused = false;
      state.queue = [];
      state.index = -1;
      state.segments = [];
      state.segIndex = 0;
      syncUI();
      if (wasActive) {
        logTts('info', '朗读已停止');
      }
    },

    isActive: function () {
      return state.playing || state.paused;
    },
  };

  window.WRETTS = api;

  // ---------- 初始化 ----------

  if (SUPPORTED) {
    refreshVoices();
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', refreshVoices);
    } else {
      synth.onvoiceschanged = refreshVoices;
    }
    // 切后台 / 关页面 → 立即停止，不在后台偷偷播
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        api.stop();
      }
    });
    window.addEventListener('pagehide', function () {
      api.stop();
    });
    // 延后写日志：content.js 的 log() 在模块之后加载，延后可确保已就绪
    setTimeout(function () {
      logTts('info', '语音朗读已就绪' + (zhVoice ? '（中文语音：' + zhVoice.name + '）' : '（暂未取到中文语音，使用默认语音）'));
    }, 0);
  } else {
    setTimeout(function () {
      logTts('warn', '当前浏览器不支持本机语音朗读，已隐藏「听」相关按钮');
    }, 0);
  }
})();
