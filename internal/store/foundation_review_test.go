package store

import (
	"testing"

	"github.com/Leixx98/ai-write-stage/internal/domain"
)

// seedReviewFoundation 落齐一套短篇基础设定（premise/outline/characters/world_rules），
// Phase 为 outline（规划期），用于确认门状态测试。
func seedReviewFoundation(t *testing.T) *Store {
	t.Helper()
	s := NewStore(t.TempDir())
	if err := s.Init(); err != nil {
		t.Fatal(err)
	}
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
	return s
}

// markAuditReady 模拟模型审查通过（指纹取当前实际值）。
func markAuditReady(t *testing.T, s *Store) {
	t.Helper()
	fp, err := s.FoundationFingerprint()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Outline.SaveFoundationAudit(domain.FoundationAudit{Fingerprint: fp, Ready: true, Summary: "设定一致"}); err != nil {
		t.Fatal(err)
	}
}

func TestFoundationReviewGateLifecycle(t *testing.T) {
	s := seedReviewFoundation(t)

	// 审查未就绪：missing 应只剩 foundation_audit，门未到。
	missing, err := s.FoundationMissing()
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 1 || missing[0] != "foundation_audit" {
		t.Fatalf("expected only foundation_audit, got %v", missing)
	}
	review, err := s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if review.Awaiting {
		t.Fatal("gate not reached before audit ready")
	}

	// 审查就绪：进入等待确认。
	markAuditReady(t, s)
	review, err = s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if !review.Awaiting || review.Confirmed {
		t.Fatalf("expected awaiting after audit ready, got %+v", review)
	}
	if review.AuditSummary != "设定一致" {
		t.Fatalf("audit summary = %q", review.AuditSummary)
	}

	// 用户确认：门放行。
	if _, err := s.ConfirmOutline(); err != nil {
		t.Fatal(err)
	}
	review, err = s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if review.Awaiting || !review.Confirmed || review.ConfirmedAt.IsZero() {
		t.Fatalf("expected confirmed after ConfirmOutline, got %+v", review)
	}

	// 大纲被修订（指纹变化）：旧确认与旧审查同时失效。此时处于重审窗口
	// （missing 只剩 foundation_audit，路由会派规划师重审），门暂时未到。
	if err := s.Outline.SaveOutline([]domain.OutlineEntry{{Chapter: 1, Title: "求生（修订）", CoreEvent: "林舟脱险"}}); err != nil {
		t.Fatal(err)
	}
	missing, err = s.FoundationMissing()
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 1 || missing[0] != "foundation_audit" {
		t.Fatalf("stale audit after outline revision, got %v", missing)
	}
	review, err = s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if review.Awaiting || review.Confirmed {
		t.Fatalf("revision should reopen the audit window first, got %+v", review)
	}
	// 重审通过：重新等待用户确认，形成修订闭环。
	markAuditReady(t, s)
	review, err = s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if !review.Awaiting {
		t.Fatalf("re-reviewed revision must await confirmation again, got %+v", review)
	}
}

func TestFoundationReviewLegacyWritingBookUnaffected(t *testing.T) {
	// 旧书兼容：已进入 writing 的书没有 audit/confirmation 工件也不追溯设门。
	s := seedReviewFoundation(t)
	if err := s.Progress.UpdatePhase(domain.PhaseWriting); err != nil {
		t.Fatal(err)
	}
	missing, err := s.FoundationMissing()
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 0 {
		t.Fatalf("legacy writing book should not require audit, got %v", missing)
	}
	review, err := s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if review.Awaiting {
		t.Fatal("writing-phase book must not be blocked by the review gate")
	}
}

func TestConfirmOutlineRequiresPremise(t *testing.T) {
	s := NewStore(t.TempDir())
	if err := s.Init(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfirmOutline(); err == nil {
		t.Fatal("confirm without premise.md (no fingerprint source) must fail")
	}
}

func TestFoundationReviewWritingArcGate(t *testing.T) {
	s := seedReviewFoundation(t)
	markAuditReady(t, s)

	// 规划期确认 → 进入写作：指纹归位，门放行。
	if _, err := s.ConfirmOutline(); err != nil {
		t.Fatal(err)
	}
	if err := s.Progress.UpdatePhase(domain.PhaseWriting); err != nil {
		t.Fatal(err)
	}
	review, err := s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if review.Awaiting || !review.Confirmed {
		t.Fatalf("writing phase with matching confirmation must not be gated, got %+v", review)
	}

	// 弧展开 / 大纲修订（指纹失配）：写作期再次拦停。
	if err := s.Outline.SaveOutline([]domain.OutlineEntry{
		{Chapter: 1, Title: "求生", CoreEvent: "林舟脱险"},
		{Chapter: 2, Title: "试炼", CoreEvent: "新弧展开"},
	}); err != nil {
		t.Fatal(err)
	}
	review, err = s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if !review.Awaiting || review.Confirmed {
		t.Fatalf("arc expansion must reopen the confirmation gate, got %+v", review)
	}
	unconfirmed, err := s.FoundationUnconfirmed()
	if err != nil {
		t.Fatal(err)
	}
	if !unconfirmed {
		t.Fatal("routing halt signal (FoundationUnconfirmed) must be true after arc expansion")
	}

	// 再次确认：门放行，写作继续。
	if _, err := s.ConfirmOutline(); err != nil {
		t.Fatal(err)
	}
	unconfirmed, err = s.FoundationUnconfirmed()
	if err != nil {
		t.Fatal(err)
	}
	if unconfirmed {
		t.Fatal("gate must release after re-confirmation")
	}
}

func TestFoundationReviewLegacyWritingBookWithoutConfirmation(t *testing.T) {
	// 旧书兼容：writing 期且从未有过确认工件（P1 之前开的书）不追溯设门。
	s := seedReviewFoundation(t)
	if err := s.Progress.UpdatePhase(domain.PhaseWriting); err != nil {
		t.Fatal(err)
	}
	review, err := s.FoundationReview()
	if err != nil {
		t.Fatal(err)
	}
	if review.Awaiting {
		t.Fatalf("legacy writing book without any confirmation must not be gated, got %+v", review)
	}
	unconfirmed, err := s.FoundationUnconfirmed()
	if err != nil {
		t.Fatal(err)
	}
	if unconfirmed {
		t.Fatal("legacy book must not halt routing at the arc gate")
	}
}
