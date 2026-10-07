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
 *
 * 朗读声音可自选：面板底部常驻「🔊 朗读声音」下拉 + 「▶ 试听」，
 * 默认「自动」（挑本机 zh-CN 语音），选择结果记忆在 chrome.storage.local（key = wreTtsVoice）。
 */
(function () {
  'use strict';

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const SUPPORTED = !!(synth && typeof window.SpeechSynthesisUtterance === 'function');
  const MAX_SEGMENT_LEN = 80; // 单段最大字数：分段朗读可规避 Chrome 长句被截断
  const RESTART_DELAY_MS = 30; // cancel → speak 之间留一点时间，规避竞态
  const VOICE_KEY = 'wreTtsVoice'; // 用户自选朗读声音（chrome.storage.local）

  let voices = [];
  let zhVoice = null;      // 自动挑出的中文语音（zh-CN 优先），未自选时使用
  let pickedVoice = null;  // 用户自选声音（null = 自动）
  let savedVoice = null;   // 从存储读到的自选声音（等 voices 就绪后再匹配）
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
    // 用户自选的声音：优先沿用；声音列表异步就绪后，用存储里记的名字再匹配一次
    if (pickedVoice) {
      pickedVoice = matchVoice(pickedVoice.name, pickedVoice.lang);
    }
    if (!pickedVoice && savedVoice) {
      pickedVoice = matchVoice(savedVoice.name, savedVoice.lang);
    }
    syncVoiceSelect();
  }

  function matchVoice(name, lang) {
    if (!name) {
      return null;
    }
    return voices.find(function (v) {
      return v.name === name && (!lang || v.lang === lang);
    }) || null;
  }

  function voiceKeyOf(voice) {
    return voice ? voice.name + '||' + (voice.lang || '') : '';
  }

  /** 排序：本机 zh-CN → 其它中文 → 英文 → 其余，便于中文用户优先看到能用的声音 */
  function sortedVoices() {
    const rank = function (voice) {
      const lang = voice.lang || '';
      if (/^zh[-_]CN/i.test(lang)) { return 0; }
      if (/^zh/i.test(lang)) { return 1; }
      if (/^en/i.test(lang)) { return 2; }
      return 3;
    };
    return voices.slice().sort(function (a, b) {
      const diff = rank(a) - rank(b);
      return diff !== 0 ? diff : String(a.name).localeCompare(String(b.name));
    });
  }

  /** 把当前可用声音灌进下拉；选中项 = 用户自选，否则「自动」 */
  function populateVoiceSelect(select) {
    if (!select) {
      return;
    }
    select.innerHTML = '';
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = '自动（推荐）' + (zhVoice ? '：' + zhVoice.name : '');
    select.appendChild(autoOpt);
    sortedVoices().forEach(function (voice) {
      const opt = document.createElement('option');
      opt.value = voiceKeyOf(voice);
      opt.textContent = voice.name + '（' + voice.lang + '）';
      select.appendChild(opt);
    });
    select.value = pickedVoice ? voiceKeyOf(pickedVoice) : '';
  }

  function syncVoiceSelect() {
    const select = document.querySelector('#wre-notes-modal .wre-notes-modal .wre-tts-voice-select');
    if (select) {
      populateVoiceSelect(select);
    }
  }

  function applyVoice(utterance) {
    const voice = pickedVoice || zhVoice;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || 'zh-CN';
    } else {
      utterance.lang = 'zh-CN';
    }
  }

  function loadVoicePref() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }
    try {
      chrome.storage.local.get([VOICE_KEY], function (res) {
        const saved = res && res[VOICE_KEY];
        if (saved && saved.name) {
          savedVoice = { name: saved.name, lang: saved.lang || '' };
          pickedVoice = matchVoice(savedVoice.name, savedVoice.lang);
        }
        syncVoiceSelect();
      });
    } catch (err) {
      /* 忽略：拿不到偏好就用默认 */
    }
  }

  function saveVoicePref() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }
    try {
      const payload = {};
      payload[VOICE_KEY] = pickedVoice ? { name: pickedVoice.name, lang: pickedVoice.lang } : null;
      chrome.storage.local.set(payload);
    } catch (err) {
      /* 忽略 */
    }
  }

  function previewVoice() {
    if (!SUPPORTED) {
      return;
    }
    if (state.playing || state.paused) {
      api.stop(); // 试听前先停掉正在进行的朗读，避免两段声音打架
    }
    const utterance = new window.SpeechSynthesisUtterance('你好，这是微信悦读的朗读试听。');
    applyVoice(utterance);
    try {
      synth.cancel();
      synth.speak(utterance);
    } catch (err) {
      logTts('warn', '试听失败', { error: String(err && err.message ? err.message : err) });
    }
  }

  /** 底部常驻「声音选择条」，不随笔记列表重绘消失 */
  function ensureVoiceBar() {
    const modal = document.querySelector('#wre-notes-modal .wre-notes-modal');
    if (!modal) {
      return null;
    }
    let row = modal.querySelector('.wre-tts-voicebar');
    if (row) {
      return row;
    }
    row = document.createElement('div');
    row.className = 'wre-tts-voicebar';
    row.innerHTML =
      '<span class="wre-tts-voice-label">🔊 朗读声音</span>' +
      '<select class="wre-tts-voice-select" title="选择朗读使用的声音"></select>' +
      '<button class="wre-tts-btn" data-wre-tts-preview title="用当前声音试听一句">▶ 试听</button>' +
      '<span class="wre-tts-hint">本机朗读 · 不联网、不上传</span>';
    const select = row.querySelector('.wre-tts-voice-select');
    if (select) {
      select.addEventListener('change', function () {
        pickedVoice = select.value ? (matchVoiceByKey(select.value)) : null;
        savedVoice = pickedVoice ? { name: pickedVoice.name, lang: pickedVoice.lang } : null;
        saveVoicePref();
        logTts('info', '切换朗读声音', { voice: pickedVoice ? pickedVoice.name + '（' + pickedVoice.lang + '）' : '自动' });
      });
    }
    row.addEventListener('click', function (event) {
      const target = event.target;
      if (target && target.closest && target.closest('[data-wre-tts-preview]')) {
        previewVoice();
      }
    });
    modal.appendChild(row);
    populateVoiceSelect(select);
    return row;
  }

  function matchVoiceByKey(key) {
    return voices.find(function (v) { return voiceKeyOf(v) === key; }) || null;
  }

  /** 笔记面板是懒创建的，用观察器在它出现时把声音选择条挂上去（挂上即停止观察） */
  function watchNotesPanel() {
    let scheduled = false;
    const observer = new MutationObserver(function () {
      if (scheduled) {
        return;
      }
      scheduled = true;
      setTimeout(function () {
        scheduled = false;
        if (ensureVoiceBar()) {
          observer.disconnect();
        }
      }, 0);
    });
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (err) {
      /* 忽略 */
    }
    if (ensureVoiceBar()) {
      observer.disconnect();
    }
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
    applyVoice(utterance);
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
    // 声音选择条：笔记面板懒创建，等它出现时挂上；同时恢复上次选择的声音
    watchNotesPanel();
    loadVoicePref();
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
