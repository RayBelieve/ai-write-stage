/* Workflow graph state, pointer interaction and canvas persistence. */
(() => {
  'use strict';

  function create({ api, notify, esc, getWorkflow, canvasFields, openNodePopup }) {
    const $ = (id) => document.getElementById(id);
    const { workflowAPI, normalizeFieldSource } = window.ComfyUIModel;
    let view = { x: 0, y: 0, k: 1 };
    let positions = {};
    let pointer = null;

    function canvasKey(id) { return `ainovel-comfy-canvas:${id || 'draft'}`; }

    function restore(id) {
      try {
        const value = JSON.parse(localStorage.getItem(canvasKey(id)) || '{}');
        view = { x: 0, y: 0, k: 1, ...(value.viewport || {}) };
        if (Array.isArray(value.nodes)) {
          positions = {};
          value.nodes.forEach((node) => {
            const key = node.source_node_id || node.id?.replace(/^node-/, '');
            if (key != null) positions[String(key)] = { x: Number(node.x) || 40, y: Number(node.y) || 40 };
          });
        } else {
          positions = value.nodes && typeof value.nodes === 'object' ? value.nodes : {};
        }
      } catch (_) {
        view = { x: 0, y: 0, k: 1 };
        positions = {};
      }
    }

    function applyDocument(document) {
      if (document?.viewport) view = { x: document.viewport.x || 0, y: document.viewport.y || 0, k: document.viewport.scale || 1 };
      if (Array.isArray(document?.nodes)) document.nodes.forEach((node) => {
        if (node.source_node_id) positions[node.source_node_id] = { x: node.x || 40, y: node.y || 40 };
      });
    }

    function nodeList() {
      return Object.entries(workflowAPI(getWorkflow())).map(([id, node]) => ({ id, ...(node || {}) }));
    }

    function graphLayout() {
      const list = nodeList();
      const incoming = {};
      list.forEach((node) => { incoming[node.id] = []; });
      list.forEach((node) => Object.values(node.inputs || {}).forEach((value) => {
        if (Array.isArray(value) && value.length && incoming[value[0]]) incoming[node.id].push(String(value[0]));
      }));
      const depth = {};
      const visit = (id, stack = new Set()) => {
        if (depth[id] != null) return depth[id];
        if (stack.has(id)) return 0;
        stack.add(id);
        depth[id] = Math.max(0, ...(incoming[id] || []).map((source) => visit(source, stack) + 1));
        return depth[id];
      };
      list.forEach((node) => visit(node.id));
      const rows = {};
      list.forEach((node) => { const level = depth[node.id] || 0; (rows[level] ||= []).push(node); });
      list.forEach((node) => {
        if (!positions[node.id]) {
          const level = depth[node.id] || 0;
          const row = rows[level].indexOf(node);
          positions[node.id] = { x: 50 + level * 240, y: 40 + row * 110 };
        }
      });
      return { list, depth };
    }

    function render() {
      const svg = $('workflow-canvas');
      if (!svg) return;
      const empty = $('canvas-empty');
      const { list } = graphLayout();
      if (empty) empty.hidden = list.length > 0;
      const edgeHost = $('graph-edges');
      const nodeHost = $('graph-nodes');
      if (!list.length) {
        edgeHost.innerHTML = '';
        nodeHost.innerHTML = '';
        return;
      }
      const edgeParts = [];
      list.forEach((node) => Object.values(node.inputs || {}).forEach((value) => {
        if (!Array.isArray(value) || !value.length || !positions[value[0]]) return;
        const source = positions[value[0]], target = positions[node.id];
        edgeParts.push(`<path class="graph-edge" d="M ${source.x + 176} ${source.y + 35} C ${source.x + 210} ${source.y + 35}, ${target.x - 34} ${target.y + 35}, ${target.x} ${target.y + 35}"/>`);
      }));
      edgeHost.innerHTML = edgeParts.join('');
      const fields = canvasFields();
      nodeHost.innerHTML = list.map((node) => {
        const position = positions[node.id];
        const exposed = fields.filter((field) => String(field.node_id) === String(node.id)).length;
        const title = String(node.class_type || 'Node').replace(/_/g, ' ');
        return `<g class="graph-node ${exposed ? 'has-exposed' : ''}" data-node-id="${esc(node.id)}" transform="translate(${position.x},${position.y})"><rect width="176" height="70"></rect><text x="10" y="22">${esc(title.slice(0, 24))}</text><text class="node-class" x="10" y="40">#${esc(node.id)}</text>${exposed ? `<text class="node-pill" x="10" y="58">已选 ${exposed} 个字段</text>` : '<text class="node-class" x="10" y="58">点击选择可配置输入</text>'}</g>`;
      }).join('');
      $('graph-viewport').setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
      if ($('canvas-zoom-label')) $('canvas-zoom-label').textContent = `${Math.round(view.k * 100)}%`;
    }

    function fit() {
      const { list } = graphLayout();
      if (!list.length) return;
      const xs = list.map((node) => positions[node.id].x), ys = list.map((node) => positions[node.id].y);
      const svg = $('workflow-canvas');
      const width = svg.clientWidth || 800, height = svg.clientHeight || 600;
      const graphWidth = Math.max(...xs) - Math.min(...xs) + 230;
      const graphHeight = Math.max(...ys) - Math.min(...ys) + 120;
      view.k = Math.max(.35, Math.min(1.5, Math.min(width / graphWidth, height / graphHeight)));
      view.x = (width - graphWidth * view.k) / 2 - Math.min(...xs) * view.k;
      view.y = (height - graphHeight * view.k) / 2 - Math.min(...ys) * view.k;
      render();
      persist();
    }

    async function persist() {
      const workflow = getWorkflow();
      if (!workflow?.id) return true;
      const fields = canvasFields().map((field) => ({
        id: field.id, node_id: field.node_id, input: field.input, name: field.label || field.name || field.input,
        control: field.control, value_type: field.value_type || 'string', default: field.default,
        min: field.min, max: field.max, step: field.step, options: field.options || [],
        required: !!field.required, random_enabled: !!field.random_enabled, exposed: true,
        source: normalizeFieldSource(field), note: field.note || '',
      }));
      const list = nodeList();
      const nodes = list.map((node) => ({
        id: `node-${node.id}`, kind: 'workflow', source_node_id: String(node.id), class_type: node.class_type || '',
        label: node.class_type || '', x: positions[node.id]?.x || 40, y: positions[node.id]?.y || 40,
        width: 176, height: 70,
        exposed_field_ids: fields.filter((field) => String(field.node_id) === String(node.id)).map((field) => field.id),
      }));
      const edges = [];
      list.forEach((node) => Object.entries(node.inputs || {}).forEach(([key, value]) => {
        if (Array.isArray(value) && value.length) edges.push({
          id: `edge-${value[0]}-${node.id}-${key}`, source: `node-${value[0]}`, source_handle: `output-${value[1]}`,
          target: `node-${node.id}`, target_handle: key, kind: 'workflow', label: key,
        });
      }));
      const payload = {
        format: 'ainovel_comfy_canvas_v1', version: 1, id: workflow.id, workflow_id: workflow.id,
        title: workflow.name || '', viewport: { x: view.x, y: view.y, scale: view.k, min_scale: .2, max_scale: 3 },
        nodes, edges, fields, prompter_preset: workflow.prompter_preset || '',
        prompter_template: workflow.prompter_template || '', mini_test_cards: [],
      };
      localStorage.setItem(canvasKey(workflow.id), JSON.stringify(payload));
      try {
        await api(`/api/v2/image-generation/providers/comfyui/workflows/${encodeURIComponent(workflow.id)}/canvas`, { method: 'PUT', body: JSON.stringify(payload) });
        return true;
      } catch (error) {
        notify(`画布保存失败：${error.message}`, 'workflow-msg', 'error');
        return false;
      }
    }

    function bind() {
      const svg = $('workflow-canvas');
      if (svg) {
        svg.addEventListener('wheel', (event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.1 : .9;
          view.k = Math.max(.3, Math.min(2.5, view.k * factor));
          render();
        }, { passive: false });
        svg.addEventListener('pointerdown', (event) => {
          const node = event.target.closest('.graph-node');
          const rect = svg.getBoundingClientRect();
          pointer = {
            startX: event.clientX, startY: event.clientY, x: view.x, y: view.y,
            node: node?.dataset.nodeId || '', nodeStart: node ? { ...positions[node.dataset.nodeId] } : null, rect,
          };
          svg.setPointerCapture(event.pointerId);
        });
        svg.addEventListener('pointermove', (event) => {
          if (!pointer) return;
          const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY;
          if (pointer.node) {
            positions[pointer.node] = { x: pointer.nodeStart.x + dx / view.k, y: pointer.nodeStart.y + dy / view.k };
          } else {
            view.x = pointer.x + dx;
            view.y = pointer.y + dy;
          }
          render();
        });
        svg.addEventListener('pointerup', (event) => {
          if (!pointer) return;
          const active = pointer;
          pointer = null;
          const moved = Math.abs(event.clientX - active.startX) + Math.abs(event.clientY - active.startY) > 4;
          if (active.node && !moved) openNodePopup(active.node);
          else persist();
        });
      }
      document.querySelector('[data-canvas-tool="zoom-in"]')?.addEventListener('click', () => {
        view.k = Math.min(2.5, view.k * 1.15);
        render();
      });
      document.querySelector('[data-canvas-tool="zoom-out"]')?.addEventListener('click', () => {
        view.k = Math.max(.3, view.k / 1.15);
        render();
      });
      document.querySelector('[data-canvas-tool="fit"]')?.addEventListener('click', fit);
      document.querySelector('[data-canvas-tool="fullscreen"]')?.addEventListener('click', () => $('canvas-stage')?.requestFullscreen?.());
    }

    return Object.freeze({ bind, render, fit, persist, restore, applyDocument, hasPositions: () => Object.keys(positions).length > 0, resetPositions: () => { positions = {}; } });
  }

  window.ComfyUICanvas = Object.freeze({ create });
})();
