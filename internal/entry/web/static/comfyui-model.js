/* Pure workflow and exposed-field helpers used by the ComfyUI editor. */
(() => {
  'use strict';

  function workflowAPI(workflow) {
    return workflow?.api_json || workflow?.workflow || {};
  }

  function inferCanvasField(nodeID, input, value) {
    const id = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(input)
      ? input
      : `field_${nodeID}_${String(input).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
    const lower = id.toLowerCase();
    const kind = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
    const control = lower.includes('prompt') || lower.includes('text') ? 'textarea'
      : ['seed', 'steps', 'width', 'height'].some((part) => lower.includes(part)) ? 'number'
        : kind === 'boolean' ? 'boolean' : 'text';
    return {
      id, node_id: nodeID, input, label: input, control, value_type: kind, default: value,
      source: kind === 'string' && (control === 'text' || control === 'textarea') ? 'prompter' : 'default',
      editable: true,
    };
  }

  function normalizeFieldSource(field = {}) {
    const source = String(field.source || '').toLowerCase();
    if (['prompter', 'default', 'runtime'].includes(source)) return source;
    const type = field.value_type || field.type || 'string';
    const control = field.control || 'text';
    return type === 'string' && (control === 'text' || control === 'textarea') ? 'prompter' : 'default';
  }

  function validateCanvasFieldIDs(fields) {
    const seen = new Set();
    for (const field of fields) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(field.id || '')) {
        return `JSON 字段键“${field.id || '(空)'}”格式无效，请使用字母或下划线开头，最多 64 个字符。`;
      }
      if (seen.has(field.id)) return `JSON 字段键“${field.id}”重复，请为每个字段设置唯一键。`;
      seen.add(field.id);
    }
    return '';
  }

  function canvasFields(workflow) {
    const cfg = workflow?.config || workflow?.schema || {};
    const fields = Array.isArray(cfg) ? cfg : (cfg.fields || workflow?.fields || []);
    return fields.filter((field) => field && field.exposed !== false).map((field) => ({
      ...field,
      id: field.id || `${field.node_id || field.node || ''}::${field.input || field.key || ''}`,
      node_id: field.node_id || field.node || '',
      input: field.input || field.key || '',
      label: field.label || field.name || field.input || field.key || '',
      control: field.control || 'text',
      value_type: field.value_type || field.type || 'string',
      source: normalizeFieldSource(field),
      note: field.note || '',
    }));
  }

  window.ComfyUIModel = Object.freeze({
    workflowAPI, inferCanvasField, normalizeFieldSource, validateCanvasFieldIDs, canvasFields,
  });
})();
