/**
 * 我的纸书 — 导出层（M8）
 *
 * 职责：把纸书库渲染成 Markdown 文本 / 写入临时文件供分享，或复制到剪贴板。
 * 定位：只做「导出」，不联网、不读写本机书库（数据由调用方传入）。
 * 红线：导出内容只含纸书档案（书名/作者/ISBN/标签/感想等）+ 关联状态标记，不含 Key、不含微信读书笔记原文。
 */
const STATUS_LABEL = { read: '已读', reading: '在读', want: '想读' };

function statusText(status) {
  return STATUS_LABEL[status] || '未标记';
}

function today() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
}

/** 纸书库 → Markdown 文本 */
function toMarkdown(books) {
  const list = Array.isArray(books) ? books : [];
  const linked = list.filter((b) => !!b.bookId).length;
  const out = [];
  out.push('# 我的纸书（导出 ' + today() + '）');
  out.push('');
  out.push('共 ' + list.length + ' 本，其中已关联微信读书电子版 ' + linked + ' 本。');
  out.push('');
  list.forEach((b, i) => {
    out.push('## ' + (i + 1) + '. ' + (b.title || '未命名纸书'));
    if (b.author) {
      out.push('- 作者：' + b.author);
    }
    if (b.isbn) {
      out.push('- ISBN：' + b.isbn);
    }
    out.push('- 阅读状态：' + statusText(b.status));
    if (b.tags && b.tags.length) {
      out.push('- 标签：' + b.tags.join('、'));
    }
    if (b.location) {
      out.push('- 纸质位置：' + b.location);
    }
    out.push('- 微信读书电子版：' + (b.bookId ? '有（' + (b.linkManual ? '手动关联' : '自动匹配') + '）' : '无'));
    if (b.feeling) {
      out.push('- 我的感想：');
      String(b.feeling)
        .split('\n')
        .forEach((line) => out.push('  > ' + line));
    }
    out.push('');
  });
  return out.join('\n');
}

/** 写入用户目录下的临时文件 → { ok, filePath } */
function writeTempFile(text, filename) {
  return new Promise((resolve) => {
    try {
      const fs = wx.getFileSystemManager();
      const filePath = wx.env.USER_DATA_PATH + '/' + filename;
      fs.writeFile({
        filePath: filePath,
        data: text,
        encoding: 'utf8',
        success: () => resolve({ ok: true, filePath: filePath }),
        fail: () => resolve({ ok: false, error: '写入文件失败' }),
      });
    } catch (err) {
      resolve({ ok: false, error: '写入文件失败' });
    }
  });
}

/** 导出并把 Markdown 文件分享出去（发给自己 / 文件传输助手）→ { ok, error } */
async function exportMarkdown(books) {
  const md = toMarkdown(books);
  const name = 'wode-zhishu-' + today() + '.md';
  const written = await writeTempFile(md, name);
  if (!written.ok) {
    return written;
  }
  return new Promise((resolve) => {
    wx.shareFileMessage({
      filePath: written.filePath,
      fileName: name,
      success: () => resolve({ ok: true }),
      fail: (err) => {
        const msg = String((err && err.errMsg) || '');
        if (msg.indexOf('cancel') >= 0) {
          resolve({ ok: true });
          return;
        }
        resolve({ ok: false, error: '分享失败，可改用「复制到剪贴板」' });
      },
    });
  });
}

module.exports = {
  toMarkdown,
  exportMarkdown,
};
