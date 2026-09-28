package host

import (
	"context"
	"strings"
	"testing"

	"github.com/Leixx98/ai-write-stage/internal/domain"
	"github.com/Leixx98/ai-write-stage/internal/store"
)

// newReviewHost 构造带 store 的最小 Host，用于确认门校验分支测试。
// 不启动真实 Engine——成功路径的完整轮转由 store/tools 层测试与路由既有
// 用例覆盖，这里只钉住参数校验与状态判定。
func newReviewHost(t *testing.T) *Host {
	t.Helper()
	dir := t.TempDir()
	roots := store.Open(dir, dir)
	if err := roots.Facts.Init(); err != nil {
		t.Fatal(err)
	}
	h := newFlagTestHost(lifecycleIdle)
	h.roots = roots
	h.store = roots.Facts
	h.runCtx = context.Background()
	h.runCancel = func() {}
	h.closed = make(chan struct{})
	return h
}

func seedPlannedBook(t *testing.T, h *Host) {
	t.Helper()
	s := h.store
	if err := s.Progress.Init("确认门测试", 1); err != nil {
		t.Fatal(err)
	}
	if err := s.Progress.UpdatePhase(domain.PhaseOutline); err != nil {
		t.Fatal(err)
	}
	if err := s.Outline.SavePremise("# 确认门测试\n\n## 主角目标\n林舟求生"); err != nil {
		t.Fatal(err)
	}
	if err := s.Outline.SaveOutline([]domain.OutlineEntry{{Chapter: 1, Title: "求生", CoreEvent: "林舟脱险"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Characters.Save([]domain.Character{{Name: "林舟", Role: "主角", Description: "求生者"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.World.SaveWorldRules([]domain.WorldRule{{Category: "society", Rule: "城门夜禁", Boundary: "入夜关闭"}}); err != nil {
		t.Fatal(err)
	}
}

func TestConfirmOutlineRejectsWhenGateNotReached(t *testing.T) {
	h := newReviewHost(t)
	seedPlannedBook(t, h)
	// 审查未就绪 → 门未到，确认必须被拒。
	if err := h.ConfirmOutline(); err == nil {
		t.Fatal("confirm must be rejected before audit ready")
	}
}

func TestConfirmOutlineRejectsWhileRunning(t *testing.T) {
	h := newReviewHost(t)
	h.lifecycle = lifecycleRunning
	if err := h.ConfirmOutline(); err == nil {
		t.Fatal("confirm must be rejected while engine running")
	}
}

func TestSubmitOutlineFeedbackValidation(t *testing.T) {
	h := newReviewHost(t)
	if err := h.SubmitOutlineFeedback("   "); err == nil {
		t.Fatal("empty feedback must be rejected")
	}
	seedPlannedBook(t, h)
	// 从未落过 scale → 无规划师可派，反馈必须被拒而不是盲启动。
	if err := h.SubmitOutlineFeedback("第二卷转折太快"); err == nil {
		t.Fatal("feedback without planning tier must be rejected")
	}
}

func TestSubmitOutlineFeedbackRequiresPendingGate(t *testing.T) {
	h := newReviewHost(t)
	seedPlannedBook(t, h)
	if err := h.store.RunMeta.SetPlanningTier(domain.PlanningTierShort); err != nil {
		t.Fatal(err)
	}
	if err := h.SubmitOutlineFeedback("第二卷转折太快"); err == nil {
		t.Fatal("feedback outside a pending confirmation gate must be rejected")
	}
}

func TestOutlineRevisionTaskUsesIncrementalToolsDuringWriting(t *testing.T) {
	task := outlineRevisionTask(string(domain.PhaseWriting), "新增弧线索提前铺垫")
	if strings.Contains(task, "save_foundation 重落大纲") {
		t.Fatal("writing-phase feedback must not request full outline replacement")
	}
	for _, tool := range []string{"revise_outline", "expand_arc", "append_volume"} {
		if !strings.Contains(task, tool) {
			t.Fatalf("writing-phase feedback task must mention %s", tool)
		}
	}
}

func TestOutlineRevisionTaskAllowsFullRewriteDuringPlanning(t *testing.T) {
	task := outlineRevisionTask(string(domain.PhaseOutline), "调整主线")
	if !strings.Contains(task, "save_foundation 重落大纲") {
		t.Fatal("planning-phase feedback should allow full outline replacement")
	}
}

func TestOutlineReviewStatusPassthrough(t *testing.T) {
	h := newReviewHost(t)
	review, err := h.OutlineReviewStatus()
	if err != nil {
		t.Fatal(err)
	}
	if review == nil {
		t.Fatal("review status should never be nil")
	}
	if review.Awaiting {
		t.Fatal("fresh workspace must not be awaiting confirmation")
	}
}
