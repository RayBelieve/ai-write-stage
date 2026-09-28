/* ComfyUI provider canvas and workflow controls. */
(() => {
  const { workflowAPI, inferCanvasField, normalizeFieldSource, validateCanvasFieldIDs } = window.ComfyUIModel;
  let workflows = [];
  let selectedWorkflow = null;
  let instances = [];
  const jobs = window.ComfyUIJobs.create({ api, notify, esc, ui });
  const canvas = window.ComfyUICanvas.create({
    api, notify, esc,
    getWorkflow: () => selectedWorkflow,
    canvasFields: () => canvasFields(),
    openNodePopup: (id) => openNodePopup(id),
  });
  const prompter = window.ComfyUIPrompter.create({
    api, notify, esc,
    getWorkflow: () => selectedWorkflow,
    canvasFields: () => canvasFields(),
    persistCanvas: () => canvas.persist(),
    saveWorkflowDefinition: (silent) => saveWorkflowDefinition(silent),
    showInspector: (tab) => showInspector(tab),
  });
  async function testConnection() {
    const draft = { enabled: $('comfy-enabled').checked, base_url: $('comfy-url').value.trim(), timeout_ms: Number($('comfy-timeout').value), poll_interval_ms: Number($('comfy-poll').value), client_id: $('comfy-client-id').value.trim(), max_response_bytes: Number($('comfy-max-bytes').value), strict: $('comfy-strict').checked};
    try {
      await api('/api/v2/image-generation/providers/comfyui/test-connection', { method: 'POST', body: JSON.stringify(draft) });
      notify('连接成功，配置尚未保存', 'comfy-msg', 'success');
    } catch (error) {
      const details = error.body?.data || {};
      const suffix = [details.phase && `phase: ${details.phase}`, details.retryable !== undefined && `retryable: ${details.retryable}`].filter(Boolean).join('; ');
      notify(`连接失败：${error.message}${suffix ? `（${suffix}）` : ''}`, 'comfy-msg', 'error');
    }
  }
  async function loadInstances() {
    try {
      const data = await api('/api/v2/image-generation/providers/comfyui/instances');
      const settings = data.settings || data;
      instances = data.instances || settings.instances || [];
      if (!Array.isArray(instances)) instances = [];
      const defaultID = settings.default_instance_id || data.default_instance_id;
      $('instances-list').innerHTML = instances.length ? instances.map((item) => `<div class="instance-card ${item.health === 'healthy' ? 'healthy' : item.health === 'unhealthy' ? 'unhealthy' : ''}" data-instance-id="${esc(item.id)}"><label><input type="radio" name="default-instance" value="${esc(item.id)}" ${item.id === defaultID ? 'checked' : ''}><strong>${esc(item.name || item.id)}</strong></label><span>${esc(item.base_url || '')}</span><small>${esc(item.health || 'unknown')} · priority ${esc(item.priority ?? 0)} · queue ${esc(item.queue_length ?? '-')}</small></div>`).join('') : '<span class="muted">No instances loaded; the legacy Base URL is still available below.</span>';
    } catch (error) { notify(`Instance list unavailable: ${error.message}`, 'instances-msg', 'error'); }
  }
  function exportWorkflow(event) {
    const workflow = workflowAPI(selectedWorkflow);
    if (!Object.keys(workflow).length) {
      event.preventDefault();
      return notify('请先导入或选择工作流', 'workflow-msg', 'error');
    }
    const filename = String(selectedWorkflow.name || selectedWorkflow.id || 'workflow').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'workflow';
    const blob = new Blob([`${JSON.stringify(workflow, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    event.currentTarget.href = url;
    event.currentTarget.download = `${filename}.api.json`;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notify('API JSON 已导出', 'workflow-msg', 'success');
  }

  let nodeEditorID = '';
  let canvasLoaded = false;
  function formConfig(config = {}) { const map = { 'comfy-url': 'base_url', 'comfy-timeout': 'timeout_ms', 'comfy-poll': 'poll_interval_ms', 'comfy-client-id': 'client_id', 'comfy-max-bytes': 'max_response_bytes' }; Object.entries(map).forEach(([id, key]) => { if ($(id)) $(id).value = config[key] ?? ''; }); if ($('comfy-enabled')) $('comfy-enabled').checked = !!config.enabled; if ($('comfy-strict')) $('comfy-strict').checked = config.strict !== false; }
  async function loadComfyUI() { if (canvasLoaded) return; canvasLoaded = true; try { formConfig(await api('/api/v2/image-generation/providers/comfyui/config')); await loadInstances(); await loadWorkflows(); } catch (error) { canvasLoaded = false; notify(`ComfyUI 配置加载失败：${error.message}`, 'comfy-msg', 'error'); } }
  async function saveComfyUI() { const c = { enabled: $('comfy-enabled')?.checked ?? true, base_url: $('comfy-url')?.value.trim() || '', timeout_ms: Number($('comfy-timeout')?.value || 600000), poll_interval_ms: Number($('comfy-poll')?.value || 1000), client_id: $('comfy-client-id')?.value.trim() || 'ainovel-web', max_response_bytes: Number($('comfy-max-bytes')?.value || 52428800), strict: $('comfy-strict')?.checked !== false}; try { formConfig(await api('/api/v2/image-generation/providers/comfyui/config', { method: 'PUT', body: JSON.stringify(c) })); notify('Connection settings saved', 'comfy-msg', 'success'); } catch (error) { notify(`Save failed: ${error.message}`, 'comfy-msg', 'error'); } }
  function workflowFieldCount(w) {
    if (selectedWorkflow?.id && w?.id === selectedWorkflow.id) return canvasFields(selectedWorkflow).length;
    const configFields = w?.config?.fields || w?.schema?.fields || w?.fields;
    if (Array.isArray(configFields)) return configFields.length;
    return Number.isFinite(Number(w?.field_count)) && Number(w.field_count) > 0 ? Number(w.field_count) : 0;
  }
  function renderWorkflowList() { const host = $('workflow-list'); if (!host) return; const query = ($('workflow-search')?.value || '').toLowerCase(); host.innerHTML = workflows.filter((w) => !query || String(w.name || w.id).toLowerCase().includes(query)).map((w) => `<button class="workflow-item ${selectedWorkflow?.id === w.id ? 'active' : ''}" data-workflow-id="${esc(w.id)}"><strong>${esc(w.name || w.id)}</strong><small>${workflowFieldCount(w)} 个可配置字段</small></button>`).join('') || '<span class="muted">暂无工作流</span>'; }
  async function loadWorkflows(preferredID = '') { try { const data = await api('/api/v2/image-generation/providers/comfyui/workflows') || []; workflows = data.workflows || data || []; if (!Array.isArray(workflows)) workflows = []; renderWorkflowList(); const target = preferredID && workflows.some((w) => w.id === preferredID) ? preferredID : (selectedWorkflow?.id && workflows.some((w) => w.id === selectedWorkflow.id) ? selectedWorkflow.id : workflows[0]?.id); if (target) await selectWorkflow(target); } catch (error) { notify(`工作流加载失败：${error.message}`, 'workflow-msg', 'error'); } }
  function normalizeWorkflowResponse(data) { if (data?.workflow && data.workflow.id) return { ...data.workflow, config: data.config || data.workflow.config, canvas: data.canvas }; return data || {}; }
    function renderNodeEditor(nodeID) { const node = workflowAPI(selectedWorkflow)[nodeID] || {}; const fields = canvasFields(); const existing = new Map(fields.filter((f) => String(f.node_id) === String(nodeID)).map((f) => [f.input, f])); const controls = { text: '文本', textarea: '多行文本', number: '数字', slider: '滑块', dropdown: '下拉框', boolean: '开关', image: '图片' }; const sourceLabels = { prompter: '由提示词模型生成', default: '使用工作流默认值', runtime: '仅运行时输入' }; const rows = Object.entries(node.inputs || {}).filter(([, value]) => !Array.isArray(value)).map(([input, value]) => { const f = existing.get(input) || inferCanvasField(nodeID, input, value); const opts = Object.keys(controls).map((x) => `<option value="${x}" ${f.control === x ? 'selected' : ''}>${controls[x]}</option>`).join(''); const source = normalizeFieldSource(f); const sourceOptions = Object.entries(sourceLabels).map(([key, label]) => `<option value="${key}" ${source === key ? 'selected' : ''}>${label}</option>`).join(''); return `<div class="node-field-row ${existing.has(input) ? 'exposed' : ''}" data-field-input="${esc(input)}" data-field-value-type="${esc(f.value_type || typeof value)}"><div class="node-field-head"><input type="checkbox" data-field-expose ${existing.has(input) ? 'checked' : ''}><code>${esc(input)}</code></div><label class="field-config-label">JSON 字段键<input data-field-id placeholder="例如 text" value="${esc(f.id)}"></label><label class="field-config-label">字段来源<select data-field-source>${sourceOptions}</select></label><input data-field-label placeholder="字段名称" value="${esc(f.label || input)}"><select data-field-control>${opts}</select><input data-field-default placeholder="默认值" value="${esc(f.default ?? value)}"><div class="node-field-extra"><label>最小值<input data-field-min value="${esc(f.min ?? '')}"></label><label>最大值<input data-field-max value="${esc(f.max ?? '')}"></label><label>步长<input data-field-step value="${esc(f.step ?? '')}"></label></div></div>`; }).join(''); const host = $('node-field-editor'); const modal = $('modal-field-editor'); if (host) host.innerHTML = '<span class="muted">字段配置已移至弹窗</span>'; if (modal) modal.innerHTML = rows || '<span class="muted">此节点没有可编辑输入</span>'; }
  function openNodePopup(nodeID) { nodeEditorID = String(nodeID); const node = workflowAPI(selectedWorkflow)[nodeID] || {}; $('inspector-node-title').textContent = `${node.class_type || 'Node'} #${nodeID}`; $('node-inspector-empty').hidden = true; $('node-inspector-body').hidden = false; $('modal-node-title').textContent = `${node.class_type || 'Node'} #${nodeID}`; $('modal-node-subtitle').textContent = '选择要在运行面板中编辑的字段'; renderNodeEditor(nodeID); $('node-modal').hidden = false; }
  function closeNodePopup() { $('node-modal').hidden = true; nodeEditorID = ''; }
    function readFieldEditor(host, nodeID = nodeEditorID) { return [...(host || document).querySelectorAll('.node-field-row')].filter((row) => row.querySelector('[data-field-expose]')?.checked).map((row) => { const val = row.querySelector('[data-field-default]')?.value || ''; const valueType = row.dataset.fieldValueType === 'boolean' ? 'boolean' : (val !== '' && !Number.isNaN(Number(val)) ? 'number' : 'string'); const cast = valueType === 'number' ? Number(val) : valueType === 'boolean' ? val === 'true' : val; return { id: row.querySelector('[data-field-id]')?.value.trim() || '', node_id: String(nodeID), input: row.dataset.fieldInput, label: row.querySelector('[data-field-label]')?.value || row.dataset.fieldInput, control: row.querySelector('[data-field-control]')?.value || 'text', value_type: valueType, default: cast, min: row.querySelector('[data-field-min]')?.value || undefined, max: row.querySelector('[data-field-max]')?.value || undefined, step: row.querySelector('[data-field-step]')?.value || undefined, editable: true, source: row.querySelector('[data-field-source]')?.value || 'default' }; }); }
  async function saveNodeFields() {
    if (!selectedWorkflow || !nodeEditorID) return;
    prompter.apply();
    const notes = Object.fromEntries(canvasFields().map((field) => [field.id, field.note || '']));
    const keep = canvasFields().filter((field) => String(field.node_id) !== String(nodeEditorID));
    const added = readFieldEditor($('modal-field-editor'), nodeEditorID).map((field) => ({ ...field, note: notes[field.id] || '' }));
    const fields = keep.concat(added);
    const fieldError = validateCanvasFieldIDs(fields);
    if (fieldError) return notify(fieldError, 'comfy-msg', 'error');
    selectedWorkflow.config = {
      ...(selectedWorkflow.config || {}),
      format: 'ainovel_workflow_config_v1', version: 1, fields,
      bindings: fields.map((field) => ({ key: field.id, node_id: field.node_id, path: `inputs.${field.input}`, type: field.value_type, required: false })),
      defaults: Object.fromEntries(fields.map((field) => [field.id, field.default])),
    };
    selectedWorkflow.bindings = selectedWorkflow.config.bindings;
    selectedWorkflow.defaults = selectedWorkflow.config.defaults;
    canvas.render();
    renderDynamicFields(selectedWorkflow.config);
    const savedID = selectedWorkflow.id;
    closeNodePopup();
    if (!await saveWorkflowDefinition(true)) return;
    if (savedID) await selectWorkflow(savedID);
    window.ImageGeneration?.load?.();
    notify('节点字段已更新', 'comfy-msg', 'success');
  }
  function renderDynamicFields(schema) {
    const fields = canvasFields({ config: schema });
    const host = $('dynamic-fields');
    if (!host) return;
    const sourceLabels = { prompter: '提示词模型', default: '默认值', runtime: '运行时' };
    host.innerHTML = fields.length ? fields.map((field) => `<div class="run-field-preview" data-field-key="${esc(field.id)}"><strong>${esc(field.label || field.input)}</strong><small>${esc(sourceLabels[normalizeFieldSource(field)])} · #${esc(field.node_id)}.${esc(field.input)}</small></div>`).join('') : '<span class="muted">暂无暴露字段</span>';
  }
  async function selectWorkflow(id) {
    try {
      selectedWorkflow = normalizeWorkflowResponse(await api(`/api/v2/image-generation/providers/comfyui/workflows/${encodeURIComponent(id)}`));
      canvas.restore(id);
      let canvasDocumentLoaded = false;
      try {
        const canvasDocument = await api(`/api/v2/image-generation/providers/comfyui/workflows/${encodeURIComponent(id)}/canvas`);
        canvasDocumentLoaded = !!canvasDocument;
        canvas.applyDocument(canvasDocument);
        // An empty fields array is meaningful: it means the user explicitly
        // un-exposed every field and must replace the workflow config.
        if (canvasDocument?.prompter_template != null) selectedWorkflow.prompter_template = canvasDocument.prompter_template || '';
        if (canvasDocument?.prompter_preset != null) selectedWorkflow.prompter_preset = canvasDocument.prompter_preset || '';
        if (Array.isArray(canvasDocument?.fields)) {
          const fields = canvasDocument.fields.map((f) => ({ ...f, label: f.name || f.label || f.input, id: f.id || `${f.node_id}::${f.input}` }));
          selectedWorkflow.config = {
            ...(selectedWorkflow.config || {}),
            fields,
            bindings: fields.map((f) => ({ key: f.id, node_id: f.node_id, path: `inputs.${f.input}`, type: f.value_type || 'string', required: !!f.required })),
            defaults: Object.fromEntries(fields.map((f) => [f.id, f.default])),
          };
          selectedWorkflow.defaults = selectedWorkflow.config.defaults;
          selectedWorkflow.bindings = selectedWorkflow.config.bindings;
        }
      } catch (_) {}
      let schema = null;
      try {
        schema = await api(`/api/v2/image-generation/providers/comfyui/workflows/${encodeURIComponent(id)}/prompt-schema`);
        if (schema?.fields && !canvasDocumentLoaded && !canvasFields().length) selectedWorkflow.config = { ...(selectedWorkflow.config || {}), fields: schema.fields };
      } catch (_) {}
      renderWorkflowList();
      canvas.render();
      renderDynamicFields(selectedWorkflow.config || {});
      prompter.render(schema || {});
      if (!canvas.hasPositions()) canvas.fit(); else canvas.render();
    } catch (error) {
      notify(error.message, 'workflow-msg', 'error');
    }
  }
  function newWorkflow() { selectedWorkflow = { id: '', name: 'unit image', workflow: {}, config: { fields: [], bindings: [], defaults: {} }, defaults: {}, bindings: [] }; canvas.resetPositions(); prompter.reset(); renderWorkflowList(); canvas.render(); prompter.render({}); }
  async function importWorkflow(file) { try { const raw = JSON.parse(await file.text()); selectedWorkflow = { id: '', name: file.name.replace(/\.json$/i, ''), workflow: raw, config: { fields: [], bindings: [], defaults: {} }, defaults: {}, bindings: [] }; canvas.resetPositions(); prompter.reset(); canvas.render(); prompter.render({}); canvas.fit(); notify('工作流已导入。请点击节点暴露字段，然后保存。', 'workflow-msg', 'success'); } catch (error) { notify(`JSON 导入失败：${error.message}`, 'workflow-msg', 'error'); } }
  function showInspector(tab) { document.querySelectorAll('.inspector-tab').forEach((button) => button.classList.toggle('active', button.dataset.inspectorTab === tab)); $('node-inspector').hidden = tab !== 'node'; $('prompt-inspector').hidden = tab !== 'prompt'; $('run-inspector').hidden = tab !== 'run'; }
  canvas.bind();
  document.querySelectorAll('[data-action="close-node"]').forEach((el) => el.addEventListener('click', closeNodePopup));
  document.querySelectorAll('[data-action="save-node-fields"]').forEach((el) => el.addEventListener('click', saveNodeFields));
  document.querySelector('[data-action="save-workflow-definition"]')?.addEventListener('click', () => saveWorkflowDefinition());
  jobs.bind();
  document.querySelector('[data-action="new-workflow"]')?.addEventListener('click', newWorkflow);
  document.querySelector('[data-action="import-workflow"]')?.addEventListener('click', () => $('workflow-file')?.click());
  $('workflow-file')?.addEventListener('change', (e) => e.target.files[0] && importWorkflow(e.target.files[0]));
  $('workflow-list')?.addEventListener('click', (e) => { const id = e.target.closest('[data-workflow-id]')?.dataset.workflowId; if (id) selectWorkflow(id); });
  $('workflow-search')?.addEventListener('input', renderWorkflowList);
  document.querySelectorAll('[data-inspector-tab]').forEach((b) => b.addEventListener('click', () => showInspector(b.dataset.inspectorTab)));
  prompter.bind();
  document.querySelector('[data-action="open-image-profiles"]')?.addEventListener('click', () => {
    window.ImageGeneration?.load?.();
    window.ImageGeneration?.showPane('profiles');
  });

  function translateStaticUI() {
    const text = new Map([
      ['API', '模型 API'], ['Settings', '设置'], ['Writing prompts', '写作提示词'], ['ComfyUI Canvas', 'ComfyUI 画布'], ['ComfyUI', 'ComfyUI'], ['Workflow', '工作流'], ['Test canvas', '测试画布'],
      ['Workflows', '工作流'], ['New workflow', '新建工作流'], ['Import API JSON', '导入 API JSON'], ['Import', '导入'], ['Search workflows', '搜索工作流'], ['No workflows loaded', '暂无工作流'],
      ['Connection', '连接状态'], ['Unknown', '未知'], ['Least queue', '最短队列'], ['Fit', '适配'], ['Fullscreen', '全屏'],
      ['Validate workflow', '校验工作流'], ['Export JSON', '导出 JSON'], ['Node', '节点'], ['Run', '运行'],
      ['Click a node on the canvas to configure exposed fields.', '点击画布节点配置可编辑字段。'], ['Close', '关闭'], ['Apply fields', '应用字段'],
      ['Run test', '运行测试'], ['Idle', '空闲'], ['Cancel', '取消'], ['Retry', '重试'],
      ['Expose fields from nodes to edit them here.', '请先在节点中勾选字段，字段会显示在这里。'], ['Results appear here', '结果将在这里显示'],
      ['Import or select a workflow to begin', '请导入或选择工作流'], ['Workflow graph', '工作流图'], ['Fit graph', '适配画布'], ['Advanced connection settings', '高级连接设置'], ['Base URL', '服务地址'], ['Timeout', '超时时间'], ['Poll interval', '轮询间隔'],
      ['Client ID', '客户端 ID'], ['Max response bytes', '最大响应字节数'], ['Default workflow ID', '默认工作流 ID'], ['Enabled', '启用'], ['Strict mode', '严格模式'],
    ]);
    document.querySelectorAll('body *').forEach((el) => {
      if (el.children.length === 0 && text.has(el.textContent.trim())) el.textContent = text.get(el.textContent.trim());
    });
    document.querySelectorAll('[placeholder]').forEach((el) => { if (text.has(el.getAttribute('placeholder'))) el.setAttribute('placeholder', text.get(el.getAttribute('placeholder'))); });
    document.querySelectorAll('[title]').forEach((el) => { if (text.has(el.getAttribute('title'))) el.setAttribute('title', text.get(el.getAttribute('title'))); });
  }
  translateStaticUI();

  async function saveWorkflowDefinition(silent = false) {
    if (!selectedWorkflow) return false;
    prompter.apply();
    const apiJSON = workflowAPI(selectedWorkflow);
    if (!Object.keys(apiJSON).length) {
      notify('请先导入 ComfyUI API JSON', 'workflow-msg', 'error');
      return false;
    }
    const fields = canvasFields();
    const fieldError = validateCanvasFieldIDs(fields);
    if (fieldError) {
      notify(fieldError, 'workflow-msg', 'error');
      return false;
    }
    const config = {
      format: 'ainovel_workflow_config_v1',
      version: 1,
      fields,
      bindings: fields.map((f) => ({ key: f.id, node_id: f.node_id, path: `inputs.${f.input}`, type: f.value_type || 'string', required: false })),
      defaults: Object.fromEntries(fields.map((f) => [f.id, f.default])),
      outputs: selectedWorkflow.config?.outputs || [],
    };
    const body = {
      format: 'comfyui_api_v1',
      id: selectedWorkflow.id,
      name: selectedWorkflow.name || 'workflow',
      api_json: apiJSON,
      workflow: apiJSON,
      config,
      bindings: config.bindings,
      defaults: config.defaults,
      output: selectedWorkflow.output || {},
      enabled: true,
      instance_id: document.querySelector('input[name="default-instance"]:checked')?.value || '',
    };
    try {
      const saved = normalizeWorkflowResponse(await api(selectedWorkflow.id ? `/api/v2/image-generation/providers/comfyui/workflows/${encodeURIComponent(selectedWorkflow.id)}` : '/api/v2/image-generation/providers/comfyui/workflows/import', {
        method: selectedWorkflow.id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      }));
      const savedID = saved.id || selectedWorkflow.id;
      selectedWorkflow = { ...saved, config, bindings: config.bindings, defaults: config.defaults, workflow: apiJSON, api_json: apiJSON, id: savedID, prompter_template: selectedWorkflow.prompter_template || '', prompter_preset: selectedWorkflow.prompter_preset || '' };
      // This must happen before loadWorkflows/selectWorkflow reads the canvas.
      if (!await canvas.persist()) return false;
      await loadWorkflows(savedID);
      if (!silent) notify('工作流已保存', 'workflow-msg', 'success');
      return true;
    } catch (error) {
      notify(`工作流保存失败：${error.message}`, 'workflow-msg', 'error');
      return false;
    }
  }

  // Canvas fields with exposed:false are legacy tombstones and must not appear
  // in the run inspector or be written back to the canonical document.
  function canvasFields(workflow = selectedWorkflow) { return window.ComfyUIModel.canvasFields(workflow); }

  qs('[data-action="save-comfyui"]')?.addEventListener('click', saveComfyUI);
  qs('[data-action="test-connection"]')?.addEventListener('click', testConnection);
  qs('[data-action="export-workflow"]')?.addEventListener('click', exportWorkflow);
  window.ComfyUI = { load: loadComfyUI, onJobEvent: jobs.onJobEvent };
})();
