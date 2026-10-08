/**
 * H6 书架概览 / H7 笔记概览
 *
 * 数据来自 /shelf/sync 与 /user/notebooks；分区列表 + 数量概览。
 */

import { fetchOverview } from '../data.js';
import { shelfCounts, notebookStats } from '../core/report-core.js';
import { messageOf, isKeyError } from '../core/errors.js';
import { esc, stateHtml } from '../ui.js';

export const title = '书架';

export function render(root, app) {
  root.innerHTML = '<div class="wre-page" id="shelfBody">' + stateHtml('loading', '正在读取书架…') + '</div>';
  const body = root.querySelector('#shelfBody');
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry"]')) {
      load(body, app, true);
    }
  });
  load(body, app, false);
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
  }
  return parts.join('');
}

/** 合并书 + 专辑为统一条目（供分组渲染） */
function shelfItemList(shelf) {
  const books = (shelf.books || []).map((b) => ({
    title: b.title,
    author: b.author,
    cover: b.cover,
    groups: Array.isArray(b.groups) ? b.groups : [],
  }));
  const albums = (shelf.albums || []).map((a) => ({
    title: a.name,
    author: a.authorName,
    cover: a.cover,
    groups: Array.isArray(a.groups) ? a.groups : [],
  }));
  return books.concat(albums);
}

/** 按官方分组分区：按 archive 原顺序逐组渲染，末尾追加「未分组」 */
function groupsHtml(shelf) {
  const groups = Array.isArray(shelf.groups) ? shelf.groups : [];
  const items = shelfItemList(shelf);
  if (!groups.length) {
    return '';
  }
  const parts = ['<div class="wre-card"><div class="wre-card__title">按官方分组</div>'];
  let rendered = false;
  groups.forEach((g) => {
    const inGroup = items.filter((it) => it.groups.indexOf(g.name) >= 0);
    if (!inGroup.length) {
      return;   // 组内为空则整组不渲染
    }
    rendered = true;
    parts.push(groupSectionHtml(g.name, inGroup));
  });
  const ungrouped = items.filter((it) => !it.groups.length);
  if (ungrouped.length) {
    rendered = true;
    parts.push(groupSectionHtml('未分组', ungrouped));
  }
  if (!rendered) {
    return '';
  }
  parts.push('<div class="wre-hint">官方分组为只读数据，来自你的微信读书官方书架。</div>');
  parts.push('</div>');
  return parts.join('');
}

function groupSectionHtml(name, list) {
  const MAX = 12;
  const shown = list.slice(0, MAX);
  const more = list.length - shown.length;
  return '<div class="wre-group">' +
    '<div class="wre-group__head"><span class="wre-group__name">' + esc(name) + '</span>' +
    '<span class="wre-group__count">' + list.length + ' 本</span></div>' +
    '<div class="wre-covergrid">' +
    shown.map((it) =>
      '<div class="wre-covercell">' +
      (it.cover ? '<img class="wre-covercell__img" loading="lazy" src="' + esc(it.cover) + '" alt="">' : '<div class="wre-covercell__img wre-covercell__img--ph"></div>') +
      '<div class="wre-covercell__title">' + esc(it.title || '未命名') + '</div>' +
      '</div>').join('') +
    '</div>' +
    (more > 0 ? '<div class="wre-hint">还有 ' + more + ' 本未显示</div>' : '') +
    '</div>';
}

function item(label, value) {
  return '<div class="wre-grid__item"><div class="wre-grid__value">' + esc(value) + '</div><div class="wre-grid__label">' + esc(label) + '</div></div>';
}
