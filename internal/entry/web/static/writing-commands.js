/* Writing commands and modal workflows. */
(function (global) {
  'use strict';

  const core = global.AINovelCore;
  const $ = (id) => document.getElementById(id);
  const deps = {
    api: null,
    command: null,
    getState: () => ({}),
    notify: () => {},
    refresh: async () => {},
  };
  let reviewDismissed = false;
  let currentAction = '';

  function esc(value) {
    if (core?.esc) return core.esc(value);
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }
  function ui(key, fallback = key) { return global.WritingState?.label?.(key, fallback) || fallback; }
  function configure(options = {}) {
    Object.keys(deps).forEach((key) => {
      if (options[key] !== undefined) deps[key] = options[key];
    });
  }

  function reviewPending(state = deps.getState()) { return Boolean(state?.OutlineReviewPending); }
  function renderReviewPanel(state = deps.getState()) {
    const writingPhase = String(state?.Phase || '') === 'writing';
    const help = $('review-modal')?.querySelector('.field-help');
    if (help) {
      help.textContent = writingPhase
        ? 'AI 已更新本书规划（展开新弧 / 追加新卷或修订大纲）。请过目新增章节后确认，写作将按新规划继续。'
        : 'AI 已完成整本书的规划并通过一致性审查。请过目大纲后再开写；不满意可直接填写反馈让 AI 修订后再次确认。';
    }
    const confirm = $('review-confirm');
    if (confirm) confirm.textContent = writingPhase ? '确认新规划，继续写作' : '确认大纲，开始写作';
    const audit = $('review-audit');
    if (audit) {
      const summary = String(state?.OutlineReviewSummary || '').trim();
      audit.hidden = !summary;
      audit.textContent = summary ? `审查结论：${summary}` : '';
    }
    const wrap = $('review-outline');
    if (!wrap) return;
    const chapters = (state?.Outline || []).map((chapter) => {
      const extras = [];
      if (chapter.Hook) extras.push(`<p class="chapter-hook">${esc(chapter.Hook)}</p>`);
      if (Array.isArray(chapter.Scenes) && chapter.Scenes.length) {
        extras.push(`<ul class="chapter-scenes">${chapter.Scenes.map((scene) => `<li>${esc(scene)}</li>`).join('')}</ul>`);
      }
      return `<div class="review-chapter"><span>${ui('chapter')} ${esc(chapter.Chapter)}</span><strong>${esc(chapter.Title || ui('untitled'))}</strong><small>${esc(chapter.CoreEvent || '')}</small>${extras.join('')}</div>`;
    }).join('');
    wrap.innerHTML = chapters || `<p class="muted">${ui('none')}</p>`;
  }

  function openReview() {
    renderReviewPanel();
    deps.notify('', 'review-message');
    $('review-modal').hidden = false;
  }
  function closeReview() {
    const modal = $('review-modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    reviewDismissed = reviewPending();
  }
  function syncReviewGate(state = deps.getState()) {
    const pending = reviewPending(state);
    const open = $('review-open');
    if (open) open.hidden = !pending;
    if (!pending) {
      reviewDismissed = false;
      closeReview();
      return;
    }
    renderReviewPanel(state);
    if (!reviewDismissed) openReview();
  }

  async function submitReviewConfirm() {
    const button = $('review-confirm');
    button.disabled = true;
    try {
      await deps.api('/api/v2/outline/confirm', { method: 'POST', body: JSON.stringify({}) });
      reviewDismissed = false;
      $('review-modal').hidden = true;
      deps.notify('大纲已确认，开始写作。', 'toast', 'success');
      await deps.refresh();
    } catch (error) {
      deps.notify(`确认失败：${error.message}`, 'review-message', 'error');
    } finally {
      button.disabled = false;
    }
  }
  async function submitReviewFeedback() {
    const text = $('review-feedback').value.trim();
    if (!text) {
      deps.notify('请先填写修订反馈。', 'review-message', 'error');
      $('review-feedback').focus();
      return;
    }
    const button = $('review-feedback-submit');
    button.disabled = true;
    try {
      await deps.api('/api/v2/outline/feedback', { method: 'POST', body: JSON.stringify({ feedback: text }) });
      reviewDismissed = false;
      $('review-modal').hidden = true;
      $('review-feedback').value = '';
      deps.notify('修订反馈已提交，AI 正在重新规划。', 'toast', 'success');
      await deps.refresh();
    } catch (error) {
      deps.notify(`提交失败：${error.message}`, 'review-message', 'error');
    } finally {
      button.disabled = false;
    }
  }

  const ACTION_KINDS = {
    other: { title: '其他指令', help: '输入自由指令。尚未开书时会作为创作需求提交；写作中作为干预；暂停时作为继续说明。', textLabel: '指令', placeholder: '例如：下一章放慢节奏，先写主角回家的日常', submitLabel: '发送', number: false },
    replan: { title: '重新规划', help: '从指定章节起修订后续大纲，不会回改该章之前已写正文。', textLabel: '规划方向', placeholder: '例如：从这里起主角转入暗线，节奏放缓，先补人物关系', submitLabel: '提交规划', number: true, numberLabel: '从第几章起' },
    rewrite: { title: '重写', help: '当前不会自动回改已写正文，只会把要求交给后续规划。完结作品请用「完结后续写」。', textLabel: '重写原因', placeholder: '例如：第 3 章对话过于说明，希望改成更含蓄的冲突', submitLabel: '提交要求', number: true, numberLabel: '章节号' },
  };
  function openAction(kind) {
    const spec = ACTION_KINDS[kind];
    if (!spec) return;
    currentAction = kind;
    $('action-title').textContent = spec.title;
    $('action-help').textContent = spec.help;
    $('action-text-label').textContent = spec.textLabel;
    $('action-text').placeholder = spec.placeholder;
    $('action-text').value = '';
    $('action-submit').textContent = spec.submitLabel;
    deps.notify('', 'action-message');
    const wrap = $('action-number-wrap');
    wrap.hidden = !spec.number;
    if (spec.number) {
      $('action-number-label').textContent = spec.numberLabel;
      const snapshot = deps.getState() || {};
      const completed = Number(snapshot.CompletedCount || 0);
      $('action-number').value = String(kind === 'replan' ? Math.max(1, completed + 1) : (snapshot.CurrentChapter || completed || 1));
    }
    $('action-modal').hidden = false;
    (spec.number ? $('action-number') : $('action-text')).focus();
  }
  function closeAction() {
    $('action-modal').hidden = true;
    deps.notify('', 'action-message');
    currentAction = '';
  }
  function buildActionText(kind, number, text) {
    if (kind === 'replan') return `从第${number}章起重新规划后续大纲，不要回改第${number}章之前已写正文。新的规划方向：${text}`;
    if (kind === 'rewrite') return `请针对第${number}章调整后续规划：${text}。不要自动回改已写正文。`;
    return text;
  }
  async function submitAction() {
    const spec = ACTION_KINDS[currentAction];
    if (!spec) return;
    const text = $('action-text').value.trim();
    if (!text) {
      deps.notify('请填写内容。', 'action-message', 'error');
      $('action-text').focus();
      return;
    }
    let number = 0;
    if (spec.number) {
      number = Number($('action-number').value);
      if (!Number.isInteger(number) || number < 1) {
        deps.notify('请填写有效章节号。', 'action-message', 'error');
        $('action-number').focus();
        return;
      }
    }
    const payload = buildActionText(currentAction, number, text);
    const snapshot = deps.getState() || {};
    const fresh = !snapshot.NovelName && !snapshot.Phase;
    if (currentAction !== 'other' && fresh) {
      deps.notify('请先开始创作。', 'action-message', 'error');
      return;
    }
    const name = fresh ? 'start' : snapshot.IsRunning ? 'steer' : 'continue';
    $('action-submit').disabled = true;
    try {
      const ok = await deps.command(name, fresh ? { prompt: payload } : { text: payload });
      if (ok) {
        closeAction();
        deps.notify(`${spec.title}已提交。`, 'toast', 'success');
      } else {
        deps.notify('提交失败，请查看事件栏。', 'action-message', 'error');
      }
    } finally {
      $('action-submit').disabled = false;
    }
  }

  function closeReopen() {
    $('reopen-modal').hidden = true;
    $('reopen-message').textContent = '';
  }
  async function submitReopen() {
    const direction = $('reopen-direction').value.trim();
    if (!direction) {
      deps.notify('请填写续写方向。', 'reopen-message', 'error');
      $('reopen-direction').focus();
      return;
    }
    $('reopen-submit').disabled = true;
    try {
      await deps.command('reopen', { direction });
      deps.notify('作品已重开，创作正在恢复。', 'toast', 'success');
      closeReopen();
    } catch (error) {
      deps.notify(`重开失败：${error.message}`, 'reopen-message', 'error');
    } finally {
      $('reopen-submit').disabled = false;
    }
  }

  $('pause')?.addEventListener('click', () => {
    const snapshot = deps.getState() || {};
    deps.command(snapshot.IsRunning || snapshot.Exclusive ? 'pause' : 'continue');
  });
  $('action-other')?.addEventListener('click', () => openAction('other'));
  $('action-replan')?.addEventListener('click', () => openAction('replan'));
  $('action-rewrite')?.addEventListener('click', () => openAction('rewrite'));
  document.querySelectorAll('[data-action="close-action"]').forEach((element) => element.addEventListener('click', closeAction));
  $('action-submit')?.addEventListener('click', submitAction);
  $('reopen-open')?.addEventListener('click', () => {
    $('reopen-modal').hidden = false;
    $('reopen-direction').value = '';
    $('reopen-direction').focus();
  });
  document.querySelectorAll('[data-action="close-reopen"]').forEach((element) => element.addEventListener('click', closeReopen));
  $('reopen-submit')?.addEventListener('click', submitReopen);
  $('review-open')?.addEventListener('click', openReview);
  $('review-confirm')?.addEventListener('click', submitReviewConfirm);
  $('review-feedback-submit')?.addEventListener('click', submitReviewFeedback);
  document.querySelectorAll('[data-action="close-review"]').forEach((element) => element.addEventListener('click', closeReview));

  global.WritingCommands = Object.freeze({
    closeAction,
    closeReopen,
    closeReview,
    configure,
    openAction,
    openReview,
    submitAction,
    submitReopen,
    syncReviewGate,
  });
}(window));
