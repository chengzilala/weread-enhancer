/**
 * Edge 神经语音合成（云函数内部模块）
 *
 * 用微软 Edge「大声朗读」所用的在线神经语音（zh-CN-XiaoxiaoNeural 等），把文本合成为 mp3。
 * 免费、无需 Key；但属**非官方接口**（Edge 阅读器的私有通道），微软可能随时限流 / 改签名，
 * 故上层（handleTts）失败时直接回错误码，由 H5 回退到系统语音。
 *
 * 实现要点（与社区 edge-tts 一致，务必保持）：
 *   1. WSS 地址带 TrustedClientToken + Sec-MS-GEC（时间签名）+ Sec-MS-GEC-Version；
 *      Sec-MS-GEC = SHA256( 取整到 5 分钟的 Windows 时间戳(100ns) + Token ) 的大写十六进制。
 *      时间戳要按 IEEE754 双精度算（与 Python 端一致），不能改用 BigInt，否则签名对不上。
 *   2. 连上后先发 json 配置帧，再发 ssml 帧；服务端回二进制帧（前 2 字节 = 头长度）。
 *   3. 收齐 Path:audio 的负载，遇到文本帧 Path:turn.end 即结束。
 *
 * 红线：只做「文本 → 音频」，不落盘、不记录文本内容。
 */
'use strict';

const crypto = require('crypto');
const dns = require('dns');
const WebSocket = require('ws');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const CHROMIUM_VERSION = '130.0.2849.68'; // 随 Edge 版本走的签名版本号，失效时可上调
const SEC_MS_GEC_VERSION = '1-' + CHROMIUM_VERSION;
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const WIN_EPOCH = 11644473600; // 1601→1970 的秒数差
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_CHUNK_CHARS = 400;   // 单次 WSS 请求的文本上限（中文按字切，避免超长）

/** 与 Python edge-tts 等价的请求时间戳格式 */
function dateStr() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return (
    days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + p(d.getUTCDate()) + ' ' + d.getUTCFullYear() +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' GMT+0000 (Coordinated Universal Time)'
  );
}

/** Sec-MS-GEC 时间签名（必须用 IEEE754 双精度乘 1e7，与官方校验端保持一致） */
function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300; // 取整到 5 分钟
  const str = (ticks * 1e7).toFixed(0) + TRUSTED_CLIENT_TOKEN;
  return crypto.createHash('sha256').update(str, 'ascii').digest('hex').toUpperCase();
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 按句切成不超过 max 字的片段（不切断 UTF-8） */
function splitText(text, max) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return [];
  }
  const parts = raw.split(/(?<=[。！？!?；;\n])/);
  const out = [];
  let buf = '';
  parts.forEach((part) => {
    if ((buf + part).length > max && buf) {
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

/**
 * 强制走 IPv4 解析。
 * 微软语音域名同时有 A / AAAA 记录，而云函数出网多为纯 IPv4；
 * Node 17+ 默认按 DNS 原序（可能优先 AAAA）建连，会以 ENETUNREACH / 连接失败告终，
 * 上层只看到笼统的「network」。这里锁定 family=4，规避 IPv6 出网缺失。
 */
function ipv4Lookup(hostname, options, callback) {
  let opts = options;
  let cb = callback;
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  const wantAll = !!(opts && opts.all);
  return dns.lookup(hostname, { family: 4, all: wantAll }, (err, address, family) => {
    if (err) {
      return cb(err);
    }
    if (wantAll) {
      return cb(null, address); // address 为 [{ address, family }]
    }
    return cb(null, address, family);
  });
}

/** 合成单段：返回 { audio: Buffer } 或 { error } */
function speakChunk(text, voice, timeoutMs) {
  return new Promise((resolve) => {
    const url =
      WSS_BASE +
      '?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN +
      '&Sec-MS-GEC=' + secMsGec() +
      '&Sec-MS-GEC-Version=' + SEC_MS_GEC_VERSION;

    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        ws.close();
      } catch (e) {
        // 忽略
      }
      resolve(value);
    };

    const ws = new WebSocket(url, {
      lookup: ipv4Lookup, // 锁定 IPv4（云函数多为纯 IPv4 出网）
      headers: {
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/' + CHROMIUM_VERSION + ' Safari/537.36 Edg/' + CHROMIUM_VERSION,
      },
    });

    timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs || DEFAULT_TIMEOUT_MS);

    const requestId = crypto.randomBytes(16).toString('hex');
    const chunks = [];

    ws.on('open', () => {
      const date = dateStr();
      const config = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
              outputFormat: OUTPUT_FORMAT,
            },
          },
        },
      });
      ws.send(
        'X-Timestamp:' + date + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:ssml\r\n\r\n' + config
      );
      const ssml =
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
        "<voice name='" + voice + "'>" +
        "<prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + escapeXml(text) + '</prosody>' +
        '</voice></speak>';
      ws.send(
        'X-Timestamp:' + date + '\r\nContent-Type:application/ssml+xml\r\nX-RequestId:' + requestId +
        '\r\nPath:ssml\r\n\r\n' + ssml
      );
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 2) {
          return;
        }
        const headerLen = buf.readUInt16BE(0);
        const header = buf.slice(2, 2 + headerLen).toString('utf8');
        if (header.indexOf('Path:audio') >= 0) {
          chunks.push(buf.slice(2 + headerLen));
        }
        return;
      }
      const msg = data.toString('utf8');
      if (msg.indexOf('Path:turn.end') >= 0) {
        finish(chunks.length ? { audio: Buffer.concat(chunks) } : { error: 'empty' });
      }
    });

    ws.on('error', (err) => finish({ error: 'network', detail: String((err && err.message) || err) }));
    ws.on('close', (code) => finish({ error: 'closed', detail: 'close ' + code }));
  });
}

/**
 * 合成整段文本 → mp3 Buffer。长文按句分段后依次合成并拼接（同为 24kHz/48kbps CBR mp3）。
 * 返回 { ok:true, audio:Buffer } 或 { ok:false, code, error }。
 */
async function synthesize(text, voice, timeoutMs) {
  const segs = splitText(text, MAX_CHUNK_CHARS);
  if (!segs.length) {
    return { ok: false, code: 'empty', error: '没有可朗读的文本' };
  }
  const buffers = [];
  for (let i = 0; i < segs.length; i += 1) {
    const res = await speakChunk(segs[i], voice, timeoutMs);
    if (res.error) {
      return { ok: false, code: res.error, error: '语音合成失败（' + res.error + '）', detail: res.detail || '' };
    }
    buffers.push(res.audio);
  }
  return { ok: true, audio: Buffer.concat(buffers) };
}

module.exports = { synthesize, DEFAULT_VOICE: 'zh-CN-XiaoxiaoNeural' };
