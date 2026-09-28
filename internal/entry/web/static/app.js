/* Web workbench client. The server remains the source of truth for runtime state. */
const core = window.AINovelCore;
const $ = core.dom;
const qs = core.query;
let currentState = null;
const STATE_REFRESH_DELAY_MS = 150;
let stateRefreshTimer = 0;
let stateRefreshInFlight = false;
let stateRefreshQueued = false;

const esc = core.esc;
const api = core.api;
const commandRoutes = core.commandRoutes;
const notify = core.notify;
// Compatibility bridge: the shared implementation still owns const toast = $('toast')
// and the toast-pop animation used by older static modules.
function ui(key, fallback = key) { return window.WritingState?.label?.(key, fallback) || fallback; }
// Compatibility wrappers: formatting now lives in writing-state.js. Keep these names
// while downstream integrations migrate away from the old app.js surface. The state
// view still owns CachePerModel and ModelContextWindow formatting, while
// writing-state.js owns expandedChapters, data-chapter rows, and the chapter-open
// outline interaction.
function formatContext(state = {}) { return window.WritingState?.formatContext?.(state) || '-'; }
function cacheStatsByModel(state = {}) { return window.WritingState?.cacheStatsByModel?.(state) || []; }
function formatCacheHitRate(state = {}) { return window.WritingState?.formatCacheHitRate?.(state) || { value: '未统计', title: '' }; }

function renderState(state = {}) {
  currentState = state;
  core?.store?.setState({ runtime: state }, { source: 'workbench-snapshot' });
  window.WritingWorkspace?.syncState?.(state);
  $('model').textContent = [state.Provider, state.ModelName, state.Style].filter(Boolean).join(' / ') || ui('modelNotConfigured');
  $('status').textContent = state.StatusLabel || ui('ready');
  $('status').className = `status ${state.IsRunning || state.Exclusive ? 'running' : ''}`;
  const busy = Boolean(state.IsRunning || state.Exclusive);
  const switcher = $('workspace-current');
  if (switcher) {
    switcher.textContent = window.WritingWorkspace?.currentName?.() || '未选择工作区';
    switcher.disabled = busy;
    switcher.title = busy ? '写作或独占作业进行中，请先暂停再切换工作区' : '切换工作区';
  }
  const complete = state.Phase === 'complete';
  const novel = Boolean(state.NovelName || state.Phase);
  const completed = Number(state.CompletedCount || 0);
  $('pause').textContent = busy ? '暂停' : '继续';
  $('pause').disabled = !busy && (!state.Phase || complete);
  $('reopen-open').hidden = !complete || busy;
  $('action-other').disabled = Boolean(state.Exclusive);
  $('action-replan').disabled = !novel || complete || Boolean(state.Exclusive);
  $('action-rewrite').disabled = !novel || complete || completed < 1 || Boolean(state.Exclusive);
  window.WritingState?.render?.(state);
  window.WritingCommands?.syncReviewGate?.(state);
}
async function refresh() {
  try {
    const data = await api('/api/v2/state');
    window.WritingWorkspace?.setMeta?.(data);
    renderState(data.snapshot || data);
    await window.WritingWorkspace?.renderPickers?.();
  } catch (error) { notify(`状态刷新失败：${error.message}`, 'toast', 'error'); }
}
function scheduleRefresh() {
  stateRefreshQueued = true;
  if (stateRefreshTimer || stateRefreshInFlight) return;
  stateRefreshTimer = window.setTimeout(runScheduledRefresh, STATE_REFRESH_DELAY_MS);
}
async function runScheduledRefresh() {
  stateRefreshTimer = 0;
  if (!stateRefreshQueued || stateRefreshInFlight) return;
  stateRefreshQueued = false;
  stateRefreshInFlight = true;
  try { await refresh(); }
  finally {
    stateRefreshInFlight = false;
    if (stateRefreshQueued) scheduleRefresh();
  }
}
async function command(name, body = {}) {
  const path = commandRoutes[name];
  if (!path) throw new Error(`Unknown command: ${name}`);
  try { await api(path, { method: 'POST', body: JSON.stringify(body) }); await refresh(); return true; }
  catch (error) {
    window.WritingRuntime?.appendEvent({ Time: Date.now(), Category: 'ERROR', Level: 'error', Summary: error.message });
    return false;
  }
}
window.addEventListener('beforeunload', () => {
  window.WritingRuntime?.dispose?.();
});
// WorkbenchShell owns closeExportMenu, toggleExportMenu, data-export, image-browser,
// and page-level showView interactions; this file keeps the application bootstrap.
window.WritingCommands?.configure?.({
  api,
  command,
  getState: () => currentState,
  notify,
  refresh,
});
window.WorkbenchShell?.configure?.({ api, notify });
// Workspace module owns openWorkspace and createAndOpenWorkspace; keep the
// orchestration callback here so existing integrations can migrate incrementally.
window.WritingWorkspace?.configure?.({
  api,
  command,
  getState: () => currentState,
  notify,
  renderState,
  resetViews: () => {
    window.WritingRuntime?.reset({ onRefresh: scheduleRefresh });
    window.Galgame?.resetForWorkspace?.();
    window.GalgamePlay?.resetForWorkspace?.();
    if ($('galgame')?.classList.contains('active-view')) window.Galgame?.load();
  },
  replay: () => window.WritingRuntime?.replay?.(),
});
if (window.WritingWorkspace?.isOpen?.()) window.requestAnimationFrame(() => $('welcome-prompt')?.focus());

refresh();
window.WritingRuntime?.replay?.();
window.WritingRuntime?.connect?.({ onRefresh: scheduleRefresh });
