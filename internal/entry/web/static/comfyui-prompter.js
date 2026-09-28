/* Prompt preset and field-note editor for ComfyUI workflows. */
(() => {
  'use strict';

  function create({ api, notify, esc, getWorkflow, canvasFields, persistCanvas, saveWorkflowDefinition, showInspector }) {
    const $ = (id) => document.getElementById(id);
    const { normalizeFieldSource } = window.ComfyUIModel;
    let presets = [];
    let currentSchema = null;

    function selectedPreset() {
      return presets.find((preset) => preset.id === $('comfy-prompter-preset')?.value);
    }

    function updatePresetHelp() {
      const preset = selectedPreset();
      if ($('comfy-prompter-preset-help')) {
        $('comfy-prompter-preset-help').textContent = preset?.description || '提示词模板会与字段说明一起发送给提示词模型。';
      }
    }

    function render(schema = currentSchema || {}) {
      currentSchema = schema || {};
      if (Array.isArray(schema?.presets)) presets = schema.presets;
      const select = $('comfy-prompter-preset');
      const template = $('comfy-prompter-template');
      const notes = $('comfy-field-notes');
      if (!select || !template || !notes) return;
      const workflow = getWorkflow();
      const presetID = workflow?.prompter_preset || schema?.preset || presets[0]?.id || '';
      select.innerHTML = presets.map((preset) => `<option value="${esc(preset.id)}" ${preset.id === presetID ? 'selected' : ''}>${esc(preset.label || preset.id)}</option>`).join('');
      select.disabled = !workflow || !presets.length;
      template.disabled = !workflow;
      template.value = workflow?.prompter_template || schema?.template || schema?.default_template || '';
      updatePresetHelp();
      const sourceLabels = { prompter: '提示词模型', default: '工作流默认值', runtime: '运行时输入' };
      const fields = canvasFields();
      notes.innerHTML = fields.length ? fields.map((field) => `<label class="field-note"><span><code>${esc(field.id)}</code><small>${esc(sourceLabels[normalizeFieldSource(field)] || field.source || '')} · #${esc(field.node_id)}.${esc(field.input)}</small></span><textarea rows="2" data-prompter-field-note="${esc(field.id)}" placeholder="说明该字段应生成什么内容">${esc(field.note || '')}</textarea></label>`).join('') : '<span class="muted">请先在节点中暴露字段。</span>';
    }

    function apply() {
      const workflow = getWorkflow();
      if (!workflow) return false;
      workflow.prompter_preset = $('comfy-prompter-preset')?.value || workflow.prompter_preset || '';
      workflow.prompter_template = $('comfy-prompter-template')?.value || '';
      const noteValues = new Map([...document.querySelectorAll('[data-prompter-field-note]')].map((input) => [input.dataset.prompterFieldNote, input.value]));
      const fields = canvasFields().map((field) => ({ ...field, note: noteValues.has(field.id) ? noteValues.get(field.id) : field.note || '' }));
      workflow.config = { ...(workflow.config || {}), fields };
      return true;
    }

    async function applySettings() {
      if (!getWorkflow()?.id) return notify('请先保存工作流', 'comfy-msg', 'error');
      apply();
      if (await saveWorkflowDefinition(true)) {
        showInspector('prompt');
        notify('提示词和字段说明已应用到工作流', 'comfy-msg', 'success');
      }
    }

    async function savePreset(action) {
      const workflow = getWorkflow();
      if (!workflow?.id) return notify('请先保存工作流', 'comfy-msg', 'error');
      apply();
      let name = $('comfy-prompter-preset')?.value || '';
      if (action === 'save_as') {
        name = window.prompt('输入新预设名称', '')?.trim() || '';
        if (!name) return;
      }
      if (!name) return notify('请选择或填写预设名称', 'comfy-msg', 'error');
      if (!await persistCanvas()) return;
      const request = { action, name, workflow_id: workflow.id, template: workflow.prompter_template, overwrite: false };
      let schema;
      try {
        schema = await api('/api/v2/image-generation/providers/comfyui/prompter-presets', { method: 'PUT', body: JSON.stringify(request) });
      } catch (error) {
        if (action !== 'save_as' || error.status !== 409 || !window.confirm('同名预设已存在，是否覆盖？')) {
          return notify(`预设保存失败：${error.message}`, 'comfy-msg', 'error');
        }
        request.overwrite = true;
        try {
          schema = await api('/api/v2/image-generation/providers/comfyui/prompter-presets', { method: 'PUT', body: JSON.stringify(request) });
        } catch (retryError) {
          return notify(`预设保存失败：${retryError.message}`, 'comfy-msg', 'error');
        }
      }
      workflow.prompter_preset = name;
      workflow.prompter_template = schema?.template || request.template;
      render(schema);
      notify(action === 'save_as' ? '提示词预设已另存' : '提示词预设已覆盖', 'comfy-msg', 'success');
    }

    function bind() {
      $('comfy-prompter-preset')?.addEventListener('change', () => {
        const preset = selectedPreset();
        if (preset && $('comfy-prompter-template')) $('comfy-prompter-template').value = preset.template || '';
        updatePresetHelp();
      });
      document.querySelector('[data-action="apply-prompter"]')?.addEventListener('click', applySettings);
      document.querySelector('[data-action="save-prompter-preset"]')?.addEventListener('click', () => savePreset('save'));
      document.querySelector('[data-action="save-prompter-preset-as"]')?.addEventListener('click', () => savePreset('save_as'));
    }

    return Object.freeze({ apply, bind, render, reset() { currentSchema = null; } });
  }

  window.ComfyUIPrompter = Object.freeze({ create });
})();
