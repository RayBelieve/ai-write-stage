# Web 前端架构

这份文档描述 Web 工作台重构期间的前端边界。后端 API、Host、Store 和
SSE 契约保持不变；前端先在现有的原生静态资源体系内渐进迁移，不以一次性
重写为目标。

## 产品层级

```text
书库（默认入口）
  ├─ 最近继续
  ├─ 所有作品
  └─ 新建作品

写作工作台
  ├─ 作品目录
  ├─ 当前章节与正文
  ├─ 上下文与图片
  └─ 写作操作

酒馆 / 剧场
工具
  ├─ 生图
  ├─ ComfyUI
  └─ 导入导出
设置
```

日志、SSE 流、模型细节和缓存信息属于运行详情，不属于主工作区的一级导航。

## 模块边界

```text
static/
  app-core.js                 共享层：API、store、DOM 查询、通知和命令路由
  writing-state.js            写作状态、缓存/上下文格式化、章节目录渲染
  runtime-events.js           SSE 事件、流式输出、回放与重连
  workspace.js                书库、工作区列表、切换、新建和欢迎页同步
  writing-commands.js         暂停/继续、指令、重写、规划和确认弹窗
  workbench-shell.js          页面导航、导出菜单、图片浏览和全局关闭行为
  writing-view.js             写作页标题、运行详情抽屉等 UI 交互
  comfyui-model.js            ComfyUI 工作流与暴露字段的纯数据规则
  comfyui-canvas.js           工作流图布局、视口与拖拽、画布文档持久化
  comfyui-prompter.js         提示词预设、模板、字段说明
  comfyui-jobs.js             图像任务状态、取消/重试与输出展示
  comfyui.js                  工作流选择、字段编辑、连接表单与模块装配
  app/
    bootstrap.js              应用启动与模块装配
    router.js                 页面级导航
    store.js                  运行状态与 UI 状态
    selectors.js              从状态读取派生数据
  api/                        后端通信，不操作 DOM
  events/                     SSE、流式输出和重连
  shell/                      顶栏、工作区切换、弹窗、抽屉、toast
  views/                      书库、写作、酒馆、设置等页面
  components/                 跨页面可复用组件
  styles/                     token、基础、布局和组件样式
```

当前静态样式文件中的对应边界是：`tokens.css` 提供设计变量，`components.css`
提供工具页共用组件，`library.css` 和 `writing.css` 分别负责书库与写作工作台，
`tavern.css` 负责酒馆与剧场的深色沉浸式布局，`image-generation.css` 负责生图设置
和 ComfyUI 画布的视觉层，`style.css` 暂时保留画布交互基础和历史兼容规则。

ComfyUI 画布负责配置和导出当前 API 工作流；保存工作流时由后端完成校验。
画布的任务页只展示暴露字段与图像任务状态，不直接运行工作流。实际生图通过
生图方案绑定工作流，再由小说、对话或剧场场景触发。

第一阶段保留现有 `app.js` 和功能脚本，通过 `app-core.js` 提供兼容入口；写作页的
状态面板已经由 `writing-state.js` 接管，`app.js` 只保留命令、连接和工作区流程；新代码
不得继续扩大 `app.js` 的职责。每迁移一个功能，再删除对应的旧全局调用。

## 数据流

```text
API / SSE
   ↓
app-core store
   ↓
selectors
   ↓
view render
   ↓
DOM 事件 → command / API
```

约束：

- 页面模块不能直接调用 `fetch`，统一通过 API client。
- 页面模块只更新自己的根节点，不跨页面查询和修改 DOM。
- 业务运行状态与面板展开、当前弹窗等 UI 状态分开保存。
- 渲染逻辑尽量是“状态 → DOM”，副作用集中在命令处理器中。
- `window.*` 只在兼容层保留；迁移后的模块通过显式接口连接。

## 迁移顺序

1. 建立 token、core store、API 和事件边界，不改变用户功能。
2. 将欢迎页改为书库空状态和作品列表，作为默认入口。
3. 重做小说工作台，先迁移目录、当前章节和底部操作栏。
4. 将日志、流式输出迁入运行详情抽屉。（事件抽屉已完成第一步）
5. 迁移酒馆、剧场、生图和 ComfyUI，复用基础组件但保留各自布局。
6. 删除旧样式、旧全局事件和重复的页面状态。

每个阶段都要通过 `go test ./internal/entry/web`，并至少做一次浏览器冒烟检查：
打开书库、切换工作区、进入写作页、暂停/继续和打开设置。

关键流程的隔离浏览器回归可通过
`go test -tags=e2e ./internal/entry/web -run TestBrowserCriticalFlows -count=1` 执行。
它需要本机安装 `agent-browser`，使用临时作品目录和独立浏览器会话，不连接真实
ComfyUI 或写作模型。当前覆盖书库切换、写作入口空输入、ComfyUI 导入、拖拽、
缩放、字段暴露、API JSON 导出、模板与说明保存、画布持久化和任务事件展示。
真实写作暂停/继续、
真实 ComfyUI 出图及连接配置仍需在集成环境验证。
