/**
 * 分享短链（只读分享）— 小程序端
 *
 * 为什么需要它：原来分享图弹层里的「复制链接」复制的是小程序页面路径，别人在浏览器打不开，
 * 转发卡片也只落到写死的页面，好友看不到分享者的内容。现在改为：
 *   1) 把分享卡上的展示字段存成短码（云函数 wereadProxy 的 sharePut，集合 wre_shares，90 天有效）；
 *   2) 「复制链接」复制的是一条 H5 只读分享链接 `<H5 站点>/app/#/s/<code>`，谁点开都能看到；
 *   3) 小程序内转发卡片指向本端只读分享页 `pages/share/index?code=<code>`，读的是同一份内容。
 *
 * 红线：只上传卡面上的展示字段（白名单，与云函数一致），不发 Key / 官方原始数据。
 */
const { PROXY_FUNCTION, LINKS } = require('../config');

function call(data) {
  return new Promise((resolve) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      resolve({ ok: false, code: 'cloud', error: '当前环境不支持云开发' });
      return;
    }
    wx.cloud
      .callFunction({ name: PROXY_FUNCTION, data: data })
      .then((res) => {
        const result = res && res.result;
        if (!result || typeof result.ok !== 'boolean') {
          resolve({ ok: false, code: 'empty', error: '云函数未返回有效结果' });
          return;
        }
        resolve(result);
      })
      .catch((err) => {
        resolve({ ok: false, code: 'cloud', error: (err && err.errMsg) || '云函数调用失败' });
      });
  });
}

/** 只挑卡面上的展示字段上传（与云函数白名单一致），不发 Key / 原始数据 */
function pickPayload(spec) {
  const s = spec || {};
  const out = {};
  ['badge', 'title', 'subtitle', 'footer'].forEach((k) => {
    if (s[k]) {
      out[k] = String(s[k]);
    }
  });
  if (Array.isArray(s.stats)) {
    out.stats = s.stats.map((it) => ({ label: (it && it.label) || '', value: (it && it.value) || '' }));
  }
  if (Array.isArray(s.lines)) {
    out.lines = s.lines.slice();
  }
  if (s.quote && s.quote.text) {
    out.quote = { text: s.quote.text, from: s.quote.from || '' };
  }
  if (Array.isArray(s.chips)) {
    out.chips = s.chips.slice();
  }
  return out;
}

/** 分享码 → H5 只读分享链接 */
function urlOf(code) {
  return LINKS.h5 + '#/s/' + code;
}

/** 生成短码；返回 { ok, code, url }（url 为 H5 只读分享链接） */
async function putShare(kind, spec) {
  const res = await call({ action: 'sharePut', kind: kind || 'other', payload: pickPayload(spec) });
  if (!res || !res.ok || !res.code) {
    return { ok: false, error: (res && res.error) || '生成分享链接失败' };
  }
  return { ok: true, code: res.code, url: urlOf(res.code) };
}

/** 凭短码取回分享内容；返回 { ok, kind, payload, createdAt } 或 { ok:false, code, error } */
function getShare(code) {
  return call({ action: 'shareGet', code: code || '' });
}

module.exports = { putShare, getShare, urlOf, pickPayload };
