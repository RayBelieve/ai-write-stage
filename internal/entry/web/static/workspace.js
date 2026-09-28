/* Library and workspace switching for the writing workbench. */
(function (global) {
  'use strict';

  const core = global.AINovelCore;
  const WELCOME_KEY_PREFIX = 'ainovel.web.welcome.v2.';
  const state = {
    workspaceID: '',
    currentName: '',
    items: [],
    welcomeStateSynced: false,
  };
  const deps = {
    api: null,
    command: null,
    getState: () => ({}),
    notify: () => {},
    renderState: () => {},
    resetViews: () => {},
    replay: async () => {},
  };

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    if (core?.esc) return core.esc(value);
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  async function api(path, options = {}) {
    if (deps.api) return deps.api(path, options);
    if (core?.api) return core.api(path, options);
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      throw new Error(body.msg || body.error || response.statusText || `HTTP ${response.status}`);
    }
    return body.data !== undefined ? body.data : body;
  }

  function configure(options = {}) {
    Object.keys(deps).forEach((key) => {
      if (options[key] !== undefined) deps[key] = options[key];
    });
  }

  function currentName() { return state.currentName; }
  function workspaceBusy(snapshot = deps.getState()) {
    return Boolean(snapshot?.IsRunning || snapshot?.Exclusive);
  }
  function welcomeIsOpen() {
    return document.documentElement.classList.contains('welcome-pending');
  }
  function welcomeStorageKey() {
    return state.workspaceID ? `${WELCOME_KEY_PREFIX}${state.workspaceID}` : '';
  }

  function setMeta(data = {}) {
    if (data.workspace_id || data.dir) state.workspaceID = String(data.workspace_id || data.dir).trim();
    if (data.workspace !== undefined) state.currentName = String(data.workspace || '').trim();
    if (data.current) state.currentName = String(data.current).trim();
    if (data.workspace_id !== undefined) state.welcomeStateSynced = false;
  }

  function syncState(snapshot = {}) {
    if (state.currentName && !state.welcomeStateSynced && welcomeStorageKey()) {
      state.welcomeStateSynced = true;
    }
    if (!welcomeIsOpen()) return;
    const hasWorkspace = Boolean(state.currentName);
    const hasNovel = Boolean(snapshot.NovelName || snapshot.Phase);
    if ($('welcome-new')) $('welcome-new').hidden = !hasWorkspace || hasNovel;
    if ($('welcome-existing')) $('welcome-existing').hidden = !hasWorkspace || !hasNovel;
    if (hasNovel && $('welcome-novel-name')) $('welcome-novel-name').textContent = snapshot.NovelName || '未命名作品';
  }

  function closeWelcome() {
    const key = welcomeStorageKey();
    try { if (key) localStorage.setItem(key, 'seen'); } catch (_) { /* Storage is optional. */ }
    document.documentElement.classList.remove('welcome-pending');
    document.documentElement.classList.add('welcome-seen');
    $('library-open')?.classList.remove('active');
    window.requestAnimationFrame(() => $('pause')?.focus());
  }

  function workspaceMeta(item) {
    const bits = [];
    if (item.novel_name) bits.push(item.novel_name);
    if (item.phase) bits.push(item.phase);
    if (item.completed) bits.push(`已完成 ${item.completed} 章`);
    return bits.join(' · ');
  }

  function renderList(target, items, selected) {
    if (!target) return;
    if (!items.length) {
      target.innerHTML = '<p class="welcome-workspace-empty">还没有工作区。新建一个后即可开始创作。</p>';
      return;
    }
    target.innerHTML = items.map((item) => {
      const name = item.name || '';
      const label = item.display || name;
      const meta = workspaceMeta(item);
      const active = selected && name === selected ? ' active' : '';
      const className = target.id === 'workspace-menu-list' ? 'workspace-menu-item' : 'welcome-workspace-item';
      return `<button type="button" class="${className}${active}" data-workspace="${esc(name)}"><strong>${esc(label)}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}</button>`;
    }).join('');
  }

  async function load() {
    const data = await api('/api/v2/workspaces');
    state.items = Array.isArray(data?.items) ? data.items : [];
    setMeta(data || {});
    return state.items;
  }

  async function renderPickers() {
    try { await load(); }
    catch (error) {
      deps.notify(`读取工作区失败：${error.message}`, 'toast', 'error');
      return;
    }
    renderList($('welcome-workspace-list'), state.items, state.currentName);
    renderList($('workspace-menu-list'), state.items, state.currentName);
    const switcher = $('workspace-current');
    if (switcher) switcher.textContent = state.currentName || '未选择工作区';
  }

  async function open(name, { notifySuccess = true } = {}) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('请先选择工作区');
    if (workspaceBusy()) throw new Error('写作或独占作业进行中，请先暂停再切换工作区');
    const data = await api('/api/v2/workspaces/open', { method: 'POST', body: JSON.stringify({ name: trimmed }) });
    state.currentName = String(data.workspace || trimmed);
    state.workspaceID = String(data.workspace_id || '').trim();
    state.welcomeStateSynced = false;
    deps.resetViews();
    deps.renderState(data.snapshot || {});
    await renderPickers();
    try { await deps.replay(); } catch (_) { /* Replay is optional after a switch. */ }
    if (notifySuccess) deps.notify(`已打开工作区「${state.currentName}」。`, 'toast', 'success');
  }

  async function create(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('请输入工作区名称');
    await api('/api/v2/workspaces', { method: 'POST', body: JSON.stringify({ name: trimmed }) });
    await open(trimmed);
  }

  async function startFromWelcome() {
    if (!state.currentName) {
      if ($('welcome-error')) $('welcome-error').textContent = '请先选择或新建工作区。';
      $('welcome-workspace-name')?.focus();
      return;
    }
    const input = $('welcome-prompt');
    const text = input?.value.trim() || '';
    if (!text) {
      if ($('welcome-error')) $('welcome-error').textContent = '请先输入小说需求。';
      input?.focus();
      return;
    }
    if ($('welcome-error')) $('welcome-error').textContent = '';
    const button = $('welcome-start');
    if (button) {
      button.disabled = true;
      button.textContent = '正在启动...';
    }
    const started = await deps.command('start', { prompt: text });
    if (button) {
      button.disabled = false;
      button.textContent = '开始创作';
    }
    if (started) closeWelcome();
    else if ($('welcome-error')) $('welcome-error').textContent = '启动失败，请检查工作台事件中的错误信息后重试。';
  }

  function closeMenu() {
    const menu = $('workspace-menu');
    const button = $('workspace-current');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    const menu = $('workspace-menu');
    const button = $('workspace-current');
    if (!menu || !button || button.disabled) return;
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  }

  function openLibrary() {
    document.documentElement.classList.add('welcome-pending');
    document.documentElement.classList.remove('welcome-seen');
    $('library-open')?.classList.add('active');
    document.querySelectorAll('.tab[data-view]').forEach((tab) => tab.classList.remove('active'));
    renderPickers();
    syncState(deps.getState());
  }

  $('welcome-enter')?.addEventListener('click', closeWelcome);
  $('welcome-start')?.addEventListener('click', startFromWelcome);
  $('welcome-workspace-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-workspace]');
    if (!button) return;
    try {
      await open(button.dataset.workspace);
      if ($('welcome-error')) $('welcome-error').textContent = '';
    } catch (error) {
      if ($('welcome-error')) $('welcome-error').textContent = error.message;
      deps.notify(error.message, 'toast', 'error');
    }
  });
  $('welcome-workspace-create')?.addEventListener('click', async () => {
    try {
      await create($('welcome-workspace-name')?.value);
      if ($('welcome-workspace-name')) $('welcome-workspace-name').value = '';
      if ($('welcome-error')) $('welcome-error').textContent = '';
    } catch (error) {
      if ($('welcome-error')) $('welcome-error').textContent = error.message;
      deps.notify(error.message, 'toast', 'error');
    }
  });
  $('welcome-workspace-name')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('welcome-workspace-create')?.click(); }
  });
  $('workspace-current')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu();
  });
  $('workspace-menu-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-workspace]');
    if (!button) return;
    closeMenu();
    try { await open(button.dataset.workspace); }
    catch (error) { deps.notify(error.message, 'toast', 'error'); }
  });
  $('workspace-menu-create')?.addEventListener('click', async () => {
    try {
      await create($('workspace-menu-name')?.value);
      if ($('workspace-menu-name')) $('workspace-menu-name').value = '';
      closeMenu();
    } catch (error) { deps.notify(error.message, 'toast', 'error'); }
  });
  $('workspace-menu-name')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('workspace-menu-create')?.click(); }
  });
  $('welcome-prompt')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); startFromWelcome(); }
  });
  document.querySelectorAll('[data-welcome-example]').forEach((button) => {
    button.addEventListener('click', () => {
      $('welcome-prompt').value = button.dataset.welcomeExample || '';
      $('welcome-error').textContent = '';
      $('welcome-prompt').focus();
    });
  });
  $('library-open')?.addEventListener('click', openLibrary);

  global.WritingWorkspace = Object.freeze({
    closeMenu,
    closeWelcome,
    configure,
    create,
    currentName,
    getItems: () => [...state.items],
    isOpen: welcomeIsOpen,
    load,
    open,
    openLibrary,
    renderPickers,
    setMeta,
    startFromWelcome,
    syncState,
    toggleMenu,
  });
}(window));
