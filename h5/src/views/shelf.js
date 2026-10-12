/**
 * H6 书架概览 / H7 笔记概览
 *
 * 数据来自 /shelf/sync 与 /user/notebooks；分区列表 + 数量概览。
 */

import { fetchOverview } from '../data.js';
import { shelfCounts, notebookStats, fmtDateTime } from '../core/report-core.js';
import { renderShelfShare } from '../core/shelf-share.js';
import { messageOf, isKeyError } from '../core/errors.js';
import { esc, stateHtml } from '../ui.js';
import { getProfile } from '../store.js';
import { presentShareImage } from '../share.js';

export const title = '书架';

// 分享图需要「当前书架数据」——渲染时留一份
let lastShelf = null;

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="shelfBody">' + stateHtml('loading', '正在读取书架…') + '</div>';
  const body = root.querySelector('#shelfBody');
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry"]')) {
      load(body, app, true);
      return;
    }
    if (e.target.closest('[data-action="share"]')) {
      doShare();
    }
  });
  load(body, app, false);
}

function doShare() {
  if (!lastShelf) {
    return;
  }
  const counts = shelfCounts(lastShelf) || {};
  const books = (lastShelf.books || []).slice().sort((a, b) => (b.readUpdateTime || 0) - (a.readUpdateTime || 0));
  const profile = getProfile();
  const spec = {
    kind: 'shelf',
    badge: '书架',
    title: '我的书架',
    subtitle: '生成于 ' + fmtDateTime(Date.now()),
    stats: [
      { label: '条目总数', value: (counts.total || 0) + ' 个' },
      { label: '电子书', value: (counts.books || 0) + ' 本' },
      { label: '专辑/有声书', value: (counts.albums || 0) + ' 个' },
      { label: '已读完', value: (counts.finished || 0) + ' 本' },
    ],
    lines: books.slice(0, 3).map((b) => '《' + (b.title || '未命名') + '》' + (b.author ? ' · ' + b.author : '')),
    footer: (profile.nickName ? profile.nickName + ' · ' : '') + '微信悦读 · 本机计算',
    text: '我的书架',
  };
  presentShareImage(
    () => renderShelfShare({ shelf: lastShelf, generatedAt: fmtDateTime(Date.now()) }, profile),
    spec,
    'shelf-share.png'
  );
}

async function load(body, app, force) {
  body.innerHTML = stateHtml('loading', '正在读取书架…');
  const res = await fetchOverview(force);
  if (!res.ok) {
    body.innerHTML = stateHtml('error', messageOf(res, '读取书架失败'), isKeyError(res.code) ? '去配置 Key' : '重试');
    if (isKeyError(res.code)) {
      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="retry"]')) {
          app.go('me');
        }
      }, { once: true });
    }
    return;
  }
  lastShelf = res.shelf || null;
  body.innerHTML = bodyHtml(res.shelf, res.notebooks, res.fromCache);
}

function bodyHtml(shelf, notebooks, fromCache) {
  const parts = [];
  if (fromCache) {
    parts.push('<div class="wre-hint">来自本地缓存（30 分钟内）</div>');
  }

  const counts = shelf ? shelfCounts(shelf) : null;
  if (counts) {
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">书架概览</div>' +
      '<div class="wre-grid">' +
      item('条目总数', counts.total + ' 个') +
      item('电子书', counts.books + ' 本') +
      item('专辑/有声书', counts.albums + ' 个') +
      item('已读完', counts.finished + ' 本') +
      '</div>' +
      '<div class="wre-hint">公开 ' + counts.publicCount + ' · 私密 ' + counts.secret + ' · 置顶 ' + counts.top + '</div>' +
      '</div>'
    );
  }

  // 笔记概览（紧随书架概览，两块数字卡放在一起，避免被下方分组内容压到很下面）
  const stats = notebookStats(notebooks);
  if (stats) {
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">笔记概览</div>' +
      '<div class="wre-grid">' +
      item('笔记总条数', stats.totalNoteCount + ' 条') +
      item('想法/点评', stats.reviewTotal + ' 条') +
      item('划线', stats.noteTotal + ' 条') +
      item('有笔记的书', stats.totalBookCount + ' 本') +
      '</div>' +
      (stats.truncated ? '<div class="wre-hint">笔记书较多，仅统计最近拉取的部分。</div>' : '') +
      '</div>'
    );
  }

  // 按官方分组（只读数据，篇幅较长，放在两块数字概览之后）
  if (shelf) {
    const block = groupsHtml(shelf);
    if (block) {
      parts.push(block);
    }
  }

  // 电子书列表（前 20 本，按最近阅读时间）
  if (shelf && shelf.books && shelf.books.length) {
    const books = shelf.books.slice().sort((a, b) => (b.readUpdateTime || 0) - (a.readUpdateTime || 0)).slice(0, 20);
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">电子书（最近 ' + books.length + ' 本）</div>' +
      books.map((b) =>
        '<div class="wre-book">' +
        (b.cover ? '<img class="wre-book__cover" loading="lazy" src="' + esc(b.cover) + '" alt="">' : '<div class="wre-book__cover wre-book__cover--ph"></div>') +
        '<div class="wre-book__meta"><div class="wre-book__title">' + esc(b.title || '未命名') + '</div>' +
        '<div class="wre-hint">' + esc(b.author || '') + (b.category ? ' · ' + esc(b.category) : '') + '</div></div>' +
        (Number(b.finishReading) === 1 ? '<span class="wre-tag">已读完</span>' : '') +
        '</div>').join('') +
      '</div>'
    );
  }

  // 专辑列表
  if (shelf && shelf.albums && shelf.albums.length) {
    parts.push(
      '<div class="wre-card"><div class="wre-card__title">专辑 / 有声书</div>' +
      shelf.albums.slice(0, 20).map((a) =>
        '<div class="wre-book">' +
        (a.cover ? '<img class="wre-book__cover" loading="lazy" src="' + esc(a.cover) + '" alt="">' : '<div class="wre-book__cover wre-book__cover--ph"></div>') +
        '<div class="wre-book__meta"><div class="wre-book__title">' + esc(a.name || '未命名') + '</div>' +
        '<div class="wre-hint">' + esc(a.authorName || '') + '</div></div>' +
        '</div>').join('') +
      '</div>'
    );
  }

  if (!parts.length) {
    parts.push('<div class="wre-card"><div class="wre-muted">暂无书架数据。</div></div>');
  } else if (shelf) {
    // 分享入口（对齐小程序 share-entry 卡片）
    parts.push(
      '<div class="wre-card wre-share-entry">' +
      '<button class="wre-btn" data-action="share">生成书架分享图</button>' +
      '<div class="wre-muted">生成后可保存图片，或用系统分享面板转发</div>' +
      '</div>'
    );
  }
  return parts.join('');
}

/** 按官方分组（只读）：只列出每组「组名 + 数量」，不展示组内书目 */
function groupsHtml(shelf) {
  const groups = Array.isArray(shelf.groups) ? shelf.groups : [];
  if (!groups.length) {
    return '';
  }
  const rows = [];
  groups.forEach((g) => {
    const count = Number(g.count) || 0;
    if (count > 0) {
      rows.push(groupRowHtml(g.name, count));
    }
  });
  const ungrouped = ungroupedCount(shelf);
  if (ungrouped > 0) {
    rows.push(groupRowHtml('未分组', ungrouped));
  }
  if (!rows.length) {
    return '';
  }
  return '<div class="wre-card"><div class="wre-card__title">按官方分组</div>' +
    '<div class="wre-grouplist">' + rows.join('') + '</div>' +
    '<div class="wre-hint">官方分组为只读数据，来自你的微信读书官方书架。</div>' +
    '</div>';
}

/** 未归入任何官方分组的条目数（书 + 专辑动态计算） */
function ungroupedCount(shelf) {
  const countOf = (list) => (Array.isArray(list) ? list : []).filter((it) => !(Array.isArray(it.groups) && it.groups.length)).length;
  return countOf(shelf.books) + countOf(shelf.albums);
}

function groupRowHtml(name, count) {
  return '<div class="wre-grouprow">' +
    '<span class="wre-grouprow__name">' + esc(name) + '</span>' +
    '<span class="wre-grouprow__count">' + count + ' 本</span></div>';
}

function item(label, value) {
  return '<div class="wre-grid__item"><div class="wre-grid__value">' + esc(value) + '</div><div class="wre-grid__label">' + esc(label) + '</div></div>';
}
