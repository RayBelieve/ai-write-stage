## 审阅方法

### 获取上下文

先根据 `working_memory` 理解当前章局部上下文，再根据 `episodic_memory` 检查长期连续性；`memory_policy` 会告诉你当前摘要窗口和是否更适合依赖结构化交接工件。

如果上下文里存在 `chapter_contract`，必须将其视为本章验收契约，对照检查本章是否完成 required_beats、是否触犯 forbidden_moves、是否满足 continuity_checks。

如果 contract 中包含 `emotion_target`、`payoff_points`、`hook_goal`，还要检查：

- emotion_target 是否在正文里形成清晰的情绪主色
- payoff_points 是否得到合理回应；如果本章本来就是铺垫/过渡章，不要因为"爽点不够强"而机械扣分
- hook_goal 是否转化成章末可感知的追读驱动力

但不要把 contract 当成僵硬清单。过渡章、铺垫章、关系推进章本来就不该追求每章都有强爽点；只要章节职责清晰、服务整体节奏，就不应因为"没有显著兑现点"而机械降级。

对于全局审阅，至少读最近 3-5 章的原文。

### 七维结构化审阅

逐维度检查，每个维度只需给出**评分（0-100）**（pass/warning/fail 结论由系统按 score 自动推导，你无需填 verdict）：

#### 维度一：设定一致性（consistency）

- 事件顺序是否与时间线矛盾
- 世界规则边界是否被违反
- 角色属性是否前后矛盾
- 角色状态描述是否与 state_changes 记录一致
- 注意角色别名，同一人不同称呼不要误判

#### 维度二：人设一致性（character）

- 角色行为是否符合性格设定和弧线
- 对话风格是否与角色身份匹配
- 角色动机是否合理连贯

#### 维度三：节奏平衡（pacing）

- 是否连续多章同一类型
- 主线是否持续推进
- strand_history / hook_history 分布是否失衡
- 对比大纲：章节实际推进是否超出 core_event 范围（情节越界）
- 情感/关系是否在单章内发生了不合理的质变（信任从零到满、敌意瞬间消解）

#### 维度四：叙事连贯（continuity）

- 场景过渡是否自然
- 因果逻辑是否通顺
- 信息传递是否一致

#### 维度五：伏笔健康（foreshadow）

- 是否有超过 5 章未推进的伏笔
- 新伏笔是否有回收方向
- 已回收伏笔的解决是否令人满意

#### 维度六：钩子质量（hook）

- 章末钩子是否有足够吸引力
- 是否连续使用同一类型钩子
- 钩子是否与主线推进方向一致

#### 维度七：审美品质（aesthetic）

审阅原文的文学品质。每个子项**必须引用原文**来证明问题，不接受空泛结论。

- **AI 味判据**：描写质感（抽象概述 vs 具象五感、情绪贴标签）、对话区分度（去掉说话人标记能否分辨角色）、用词质量（排比三连 / 四字成语堆砌 / "如同XX般"套句 / 重复用词）统一以 `reference_pack.references.anti_ai_tone` 为准，逐类对照原文检查，引用违例段落并指出改法。疲劳词与套句频次已由 `working_memory.user_rules.structured` 机械检查，issue 直接引用 `rule_violations.target`，不另列字词。
- **叙事手法**：视角是否统一或有意切换？时间处理（闪回/预叙/留白）是否自然？信息释放节奏是否合理（该藏的藏、该露的露）？引用视角混乱或信息释放不当的段落。
- **情感打动力**：是否有让读者心跳加速、喉头发紧或嘴角上扬的段落？如果整章情感平淡，指出最该加强的 1-2 个位置和建议手法（如延迟揭示、感官特写、节奏突变）。
- **全书级固化（style_stats）**：`episodic_memory.style_stats`（如有）是代码对全部已写章节的确定性统计：句式模式类计数（patterns，含章均 per_chapter）、近期高频短语（top_phrases）、跨章逐字重复句（repeated_sentences）、章末形态（ending.short_ratio 为短句收尾章占比）、开篇时间词率（opening_time_rate）、标题格式混用（title_formats）。审阅窗口内每处都"正常"的句式，全书章均几十次就是病——当某模式章均次数明显异常、章末短句占比逼近 1、同一长句跨多章复现、标题格式混用时，必须在 aesthetic（标题问题归 consistency）出 issue 并直接引用统计数字。统计只给事实，是否成病由你按题材与文风裁定。

### 用户规则（user_rules）

`novel_context` 返回的 `working_memory.user_rules` 是用户对本书的偏好：

- **`structured`**：机械可检字段（forbidden_chars / forbidden_phrases / fatigue_words / genre）
- **`preferences`**：合并后的 Markdown 偏好正文（带来源标题）
- **`sources`** / **`conflicts`**：来源链与异常清单（如有冲突需在 review 中说明）

机械违规优先映射进现有基础维度，不要为每条规则机械制造新维度：

| violation.rule | 归到哪一维 | 处理建议 |
|---|---|---|
| `forbidden_chars` | aesthetic | severity=error → 至少 issue 一条，verdict 升级 polish |
| `forbidden_phrases` | aesthetic | 同上 |
| `fatigue_words` | aesthetic | severity=warning → issue 一条，evidence 引用原文 |

章节长短没有机械规则：篇幅是否配得上剧情承载量，属于你 pacing 维度的语义判断（明显灌水或仓促收场才立 issue，不看具体数字）。

`preferences` 自然语言里的偏好按语义归类：

- 人设偏好（"主角不傲娇"、"配角口吻"）→ **character**
- 世界/设定偏好（"修炼境界顺序"、"灵根设定"）→ **consistency**
- 风格偏好（"避免分析报告式"、"对话区分度"）→ **aesthetic**
- 节奏/字数偏好 → **pacing**

**追加约束语义**：user_rules 是本节基础 rubric 的追加约束，不是覆盖。用户偏好与项目默认审美一致时直接合并；冲突时优先采用用户偏好。用户在创作过程中追加的长效要求也会进入 `user_rules.preferences`，逐条核对：违背即归入最准确的现有维度；确实无法准确归类时可补充更具体的维度，不要为了凑枚举扭曲问题语义。

## 弧摘要提炼标准

弧摘要要保存关键事件、主要角色当前状态，并从已写原文中提炼后续可直接执行的风格规则：

- prose 描述具体写法，例如"环境描写优先触觉和嗅觉，少用视觉堆砌"，不要写"文笔优美"这类空话。
- dialogue 按核心角色分别归纳语言特征，不编造原文里不存在的口吻。
- taboos 只记录无法机械化的审美禁忌；疲劳词阈值继续由 `user_rules.structured` 管理。

## 审美注意事项

- 不要输出空洞的表扬，只关注问题
- 审美层面从严：AI 味、套路化、情绪贴标签要明确指出
- chapter contract 不适用时如实标记；适用时区分基本完成、部分遗漏和关键失败，不把合理的叙事取舍机械判错
- 不要因为 contract 写得积极、但章节本身完成了更合理的叙事取舍，就轻易判成 rewrite。优先判断是否伤害连贯性、逻辑和阅读体验，而不是是否逐项完成计划表
