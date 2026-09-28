package flow

import (
	"testing"

	"github.com/Leixx98/ai-write-stage/internal/domain"
	storepkg "github.com/Leixx98/ai-write-stage/internal/store"
)

// TestRouteStopsAtArcConfirmationGate 钉住弧/卷边界确认门：
// 写作期规划产物偏离最近一次用户确认（FoundationUnconfirmed=true）时，
// 即使下一弧骨架待展开、下一章计划缺失，也必须停机而不是继续派单。
func TestRouteStopsAtArcConfirmationGate(t *testing.T) {
	base := State{
		Progress: &domain.Progress{
			Phase:             domain.PhaseWriting,
			Layered:           true,
			CompletedChapters: []int{1, 2, 3},
		},
		ArcBoundary: &storepkg.ArcBoundary{
			IsArcEnd:       true,
			NeedsExpansion: true,
			NextVolume:     1,
			NextArc:        2,
		},
		FoundationUnconfirmed: true,
	}
	if got := Route(base); got != nil {
		t.Fatalf("unconfirmed planning change must halt routing, got %+v", got)
	}

	// 卷末三选一场景同样被门拦住。
	volumeEnd := base
	volumeEnd.ArcBoundary = &storepkg.ArcBoundary{IsArcEnd: true, NeedsNewVolume: true}
	if got := Route(volumeEnd); got != nil {
		t.Fatalf("volume-end decision must wait for confirmation gate, got %+v", got)
	}
}

// TestRouteResumesAfterArcConfirmation 确认归位后（FoundationUnconfirmed=false），
// 原有写作期路由恢复：下一弧骨架待展开 → 派 expand_arc。
func TestRouteResumesAfterArcConfirmation(t *testing.T) {
	s := State{
		Progress: &domain.Progress{
			Phase:             domain.PhaseWriting,
			Layered:           true,
			CompletedChapters: []int{1, 2, 3},
		},
		ArcBoundary: &storepkg.ArcBoundary{
			IsArcEnd:       true,
			NeedsExpansion: true,
			NextVolume:     1,
			NextArc:        2,
		},
	}
	got := Route(s)
	if got == nil || got.Agent != "architect_long" {
		t.Fatalf("confirmed state should dispatch expand_arc, got %+v", got)
	}
}
