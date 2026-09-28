package host

import (
	"fmt"
	"strings"
	"time"

	"github.com/Leixx98/ai-write-stage/internal/domain"
	"github.com/Leixx98/ai-write-stage/internal/flow"
	storepkg "github.com/Leixx98/ai-write-stage/internal/store"
)

// 大纲确认门（P1）：规划产物（premise/大纲/角色/规则/罗盘）落盘并通过模型
// 语义审查后，Phase 停在 outline，Engine 因 Route=nil 自然停机；用户通过
// ConfirmOutline 显式确认后才进入 writing。修改走 SubmitOutlineFeedback：
// 反馈作为修订任务确定性派回规划师（用户意图明确，无需 Arbiter 语义裁定），
// 修订落盘改变 FoundationFingerprint，旧确认与旧审查同时失效，重审通过后
// 再次停在确认门——循环直到用户认可当前版本。

// OutlineReviewStatus 透传确认门状态快照（供 Web/Headless 消费）。
func (h *Host) OutlineReviewStatus() (*storepkg.FoundationReview, error) {
	return h.store.FoundationReview()
}

// plannerForTier 复刻 flow.plannerForTier 的选型口径：short 归短篇规划师，
// mid/long 归长篇规划师。
func plannerForTier(tier domain.PlanningTier) string {
	if tier == domain.PlanningTierShort {
		return "architect_short"
	}
	return "architect_long"
}

// ConfirmOutline 确认当前版本的大纲并进入写作：
// 落确认工件（绑定当前指纹）→ Phase 推到 writing → 启动 Engine（Route 派
// chapter_planner 开始第一章）。仅当确认门处于 Awaiting 时允许调用。
func (h *Host) ConfirmOutline() error {
	h.mu.Lock()
	running := h.lifecycle == lifecycleRunning
	h.mu.Unlock()
	if running || h.engine.isRunning() {
		return fmt.Errorf("创作引擎运行中，请先暂停后再确认大纲")
	}

	review, err := h.store.FoundationReview()
	if err != nil {
		return fmt.Errorf("读取确认门状态失败: %w", err)
	}
	if review == nil || !review.Awaiting {
		return fmt.Errorf("当前没有待确认的大纲")
	}

	conf, err := h.store.ConfirmOutline()
	if err != nil {
		return fmt.Errorf("落确认工件失败: %w", err)
	}
	if err := h.store.Progress.UpdatePhase(domain.PhaseWriting); err != nil {
		return fmt.Errorf("进入写作阶段失败: %w", err)
	}
	if _, err := h.store.Decisions.Append(storepkg.DecisionRecord{
		Kind:    "outline_confirm",
		Decider: "user",
		Input:   conf.Fingerprint,
		Reason:  "用户确认当前大纲版本，进入写作",
	}); err != nil {
		// 确认事实已落盘，审计失败不回滚（回滚会让确认与 Phase 不一致）
	}

	summary := "大纲已确认，进入写作阶段"
	if review.Phase == string(domain.PhaseWriting) {
		// 弧/卷边界门：写作中展开新弧/追加新卷后的再次确认
		summary = "新弧/卷规划已确认，继续写作"
	}
	h.emitEvent(Event{Time: time.Now(), Category: "SYSTEM", Level: "success",
		Summary: summary})
	if !h.startEngine(nil) {
		return fmt.Errorf("Engine 启动失败，请稍后通过「继续」恢复")
	}
	return nil
}

// SubmitOutlineFeedback 把用户对大纲的修改意见作为修订任务派回规划师。
// 修订落盘后指纹变化，确认门自动重新生效；修订 → 重审 → 停在确认门的
// 后续轮转由既有路由完成，这里只负责启动第一跳。
func (h *Host) SubmitOutlineFeedback(feedback string) error {
	feedback = strings.TrimSpace(feedback)
	if feedback == "" {
		return fmt.Errorf("feedback is required")
	}
	h.mu.Lock()
	running := h.lifecycle == lifecycleRunning
	h.mu.Unlock()
	if running || h.engine.isRunning() {
		return fmt.Errorf("创作引擎运行中，请先暂停后再提交修订反馈")
	}

	review, err := h.store.FoundationReview()
	if err != nil {
		return fmt.Errorf("读取确认门状态失败: %w", err)
	}
	if review == nil || !review.Awaiting {
		return fmt.Errorf("当前没有待确认的大纲")
	}

	meta, err := h.store.RunMeta.Load()
	if err != nil {
		return fmt.Errorf("load run meta: %w", err)
	}
	if meta == nil || meta.PlanningTier == "" {
		return fmt.Errorf("尚未生成过大纲，没有可修订的对象")
	}
	revisionTask := outlineRevisionTask(review.Phase, feedback)
	if _, err := h.store.Decisions.Append(storepkg.DecisionRecord{
		Kind:    "outline_feedback",
		Decider: "user",
		Input:   feedback,
		Reason:  "用户在确认门提出修订反馈，派回规划师修订",
	}); err != nil {
		// 审计失败不阻断修订（feedback 已包含在任务里）
	}

	h.emitEvent(Event{Time: time.Now(), Category: "SYSTEM", Level: "info",
		Summary: "已提交大纲修订反馈，规划师正在修订"})
	inst := &flow.Instruction{Agent: plannerForTier(meta.PlanningTier), Task: revisionTask,
		Reason: "大纲确认门反馈修订"}
	if !h.startEngine(inst) {
		return fmt.Errorf("Engine 启动失败，请稍后重试")
	}
	return nil
}

func outlineRevisionTask(phase, feedback string) string {
	prefix := "用户对当前大纲提出修订反馈。请先调用 novel_context 读取已落盘的全部设定与审查状态，"
	var instruction string
	if phase == string(domain.PhaseWriting) {
		instruction = "当前处于写作阶段，禁止使用 save_foundation 全量覆盖 outline 或 layered_outline；请根据反馈仅使用受保护的增量工具 revise_outline、expand_arc 或 append_volume 修订尚未发生的规划，绝不能改动已完成章节。"
	} else {
		instruction = "当前处于规划阶段，可根据反馈使用 save_foundation 重落大纲（扁平传 outline、分层传 layered_outline）；角色等其余工件仅在反馈直接涉及且确有必要时修订。"
	}
	return prefix + instruction +
		"修订完成后重新调用 novel_context 并用 audit_foundation 审查，等待用户再次确认。用户反馈如下：\n\n" + feedback
}
