/* Runtime state and outline rendering for the writing workspace. */
(function (global) {
  'use strict';

  const core = global.AINovelCore;
  const esc = (value) => core?.esc
    ? core.esc(value)
    : String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  const expandedChapters = new Set();
  const UI_TEXT = {
    modelNotConfigured: '模型未配置', ready: '就绪', chapter: '章节', untitled: '未命名',
    none: '暂无', work: '作品', outline: '大纲', premise: '故事前提',
    characters: '角色',
  };

  function label(key, fallback = key) { return UI_TEXT[key] || fallback; }

  function renderInline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  }

  function renderMarkdown(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let listType = '';
    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = '';
    };
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        return;
      }
      const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
      const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (bullet || ordered) {
        flushParagraph();
        const type = bullet ? 'ul' : 'ol';
        if (listType !== type) {
          flushList();
          html.push(`<${type}>`);
          listType = type;
        }
        html.push(`<li>${renderInline((bullet || ordered)[1])}</li>`);
        return;
      }
      flushList();
      paragraph.push(trimmed);
    });
    flushParagraph();
    flushList();
    return html.join('');
  }

  function formatContext(state = {}) {
    const windowSize = Number(state.ContextWindow || state.ModelContextWindow || 0);
    const tokens = Number(state.ContextTokens || 0);
    if (!windowSize && !tokens) return '-';
    const percent = windowSize > 0
      ? Math.round(Number(state.ContextPercent) || (tokens / windowSize * 100))
      : 0;
    return windowSize ? `${tokens}/${windowSize}（${percent}%）` : String(tokens);
  }

  function cacheStatsByModel(state = {}) {
    return (Array.isArray(state.CachePerModel) ? state.CachePerModel : [])
      .filter((item) => item && item.Model && (Number(item.RecentInput || 0) || Number(item.Input || 0)))
      .map((item) => {
        const input = Number(item.RecentInput || 0) || Number(item.Input || 0);
        const read = Number(item.RecentInput || 0)
          ? Number(item.RecentCacheRead || 0)
          : Number(item.CacheRead || 0);
        return {
          model: String(item.Model), input, read,
          capable: Boolean(item.CacheCapable), samples: Number(item.RecentSamples || 0),
        };
      });
  }

  function describeCacheStat(item, includeModel = true) {
    const prefix = includeModel ? `${item.model}：` : '';
    if (!item.capable && !item.read) return `${prefix}未提供缓存数据`;
    const rate = Math.max(0, Math.min(100, item.read / item.input * 100));
    return `${prefix}${rate.toFixed(rate >= 10 ? 0 : 1)}%`;
  }

  function formatCacheHitRate(state = {}) {
    const stats = cacheStatsByModel(state);
    const currentKey = [state.Provider, state.ModelName].filter(Boolean).join('/');
    const current = stats.find((item) => item.model === currentKey)
      || stats.find((item) => state.ModelName
        && (item.model === state.ModelName || item.model.endsWith(`/${state.ModelName}`)));
    if (!current) {
      return {
        value: '未统计',
        title: stats.length
          ? `当前模型 ${currentKey || '未配置'} 暂无缓存数据\n${stats.map(describeCacheStat).join('\n')}`
          : '暂无按 provider/model 分组的缓存数据',
      };
    }
    return {
      value: describeCacheStat(current, false),
      title: [
        `当前模型：${describeCacheStat(current)}`,
        ...stats.filter((item) => item !== current).map(describeCacheStat),
      ].join('\n'),
    };
  }

  function renderStatus(state = {}) {
    const target = document.getElementById('state');
    if (!target) return;
    const cacheRate = formatCacheHitRate(state);
    const rows = [
      ['运行状态', state.RuntimeState],
      ['阶段', state.Phase],
      ['流程', state.Flow],
      [label('chapter'), state.CurrentChapter],
      ['完成进度', `${state.CompletedCount ?? 0}/${state.TotalChapters ?? 0}`],
      ['字数', state.TotalWordCount],
      ['上下文', formatContext(state)],
      ['缓存命中率', cacheRate.value, cacheRate.title],
    ];
    if (state.OutlineReviewPending) rows.splice(2, 0, ['大纲', '待确认']);
    target.innerHTML = rows
      .map(([key, value, title]) => `<dt>${esc(key)}</dt><dd${title ? ` title="${esc(title)}"` : ''}>${esc(value || '-')}</dd>`)
      .join('');
  }

  function renderChapter(chapter, currentChapter) {
    const number = Number(chapter.Chapter);
    const open = expandedChapters.has(number);
    const extras = [];
    if (chapter.Hook) extras.push(`<p class="chapter-hook">${esc(chapter.Hook)}</p>`);
    if (Array.isArray(chapter.Scenes) && chapter.Scenes.length) {
      extras.push(`<ul class="chapter-scenes">${chapter.Scenes.map((scene) => `<li>${esc(scene)}</li>`).join('')}</ul>`);
    }
    return `<button type="button" class="chapter-row${chapter.Chapter === currentChapter ? ' chapter-current' : ''}${open ? ' chapter-open' : ''}" data-chapter="${esc(number)}" aria-expanded="${open ? 'true' : 'false'}"><span>${label('chapter')} ${esc(number)}</span><strong>${esc(chapter.Title || label('untitled'))}</strong><small>${esc(chapter.CoreEvent || '')}</small>${extras.join('')}</button>`;
  }

  function renderDetails(state = {}) {
    const target = document.getElementById('detail');
    if (!target) return;
    const chapters = (state.Outline || []).map((chapter) => renderChapter(chapter, state.CurrentChapter)).join('');
    const premise = String(state.Premise || '').trim();
    const premiseHTML = premise ? `<div class="premise">${renderMarkdown(premise)}</div>` : `<p>${label('none')}</p>`;
    target.innerHTML = `<h3>${label('work')}</h3><p>${esc(state.NovelName || label('untitled'))}</p><h3>${label('outline')}</h3><div class="chapters">${chapters || `<p>${label('none')}</p>`}</div><h3>${label('premise')}</h3>${premiseHTML}<h3>${label('characters')}</h3><p>${esc((state.Characters || []).join(', ') || label('none'))}</p>`;
  }

  function render(state = {}) {
    renderStatus(state);
    renderDetails(state);
  }

  document.getElementById('detail')?.addEventListener('click', (event) => {
    const row = event.target.closest('.chapter-row');
    const detail = document.getElementById('detail');
    if (!row || !detail?.contains(row)) return;
    const number = Number(row.dataset.chapter);
    if (!Number.isInteger(number) || number < 1) return;
    if (expandedChapters.has(number)) expandedChapters.delete(number);
    else expandedChapters.add(number);
    const open = expandedChapters.has(number);
    row.classList.toggle('chapter-open', open);
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  global.WritingState = Object.freeze({
    render,
    renderStatus,
    renderDetails,
    label,
    formatContext,
    cacheStatsByModel,
    formatCacheHitRate,
  });
}(window));
