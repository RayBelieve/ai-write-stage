package host

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Leixx98/ai-write-stage/internal/domain"
	"github.com/Leixx98/ai-write-stage/internal/flow"
	storepkg "github.com/Leixx98/ai-write-stage/internal/store"
)

// writerStablePromptPrefix builds book-level and chapter-level facts that are
// placed before the per-unit task by the subagent runner.
func writerStablePromptPrefix(store *storepkg.Store, inst *flow.Instruction) string {
	if store == nil || inst == nil || inst.Agent != "writer" || inst.Chapter <= 0 {
		return ""
	}

	book := map[string]any{}
	if premise, err := store.Outline.LoadPremise(); err == nil && strings.TrimSpace(premise) != "" {
		book["premise"] = premise
	}
	if characters, err := store.Characters.Load(); err == nil && len(characters) > 0 {
		book["characters"] = characters
	}
	if rules, err := store.World.LoadWorldRules(); err == nil && len(rules) > 0 {
		book["world_rules"] = rules
	}
	if compass, err := store.Outline.LoadCompass(); err == nil && compass != nil {
		book["compass"] = compass
	}
	if userRules, err := store.UserRules.Load(); err == nil && userRules != nil {
		book["user_rules"] = userRules
	}

	chapter := map[string]any{}
	if entry, err := store.Outline.GetChapterOutline(inst.Chapter); err == nil && entry != nil {
		chapter["outline"] = entry
	}
	if plan, err := store.Drafts.LoadChapterPlan(inst.Chapter); err == nil && plan != nil {
		chapter["plan"] = stableChapterPlan(plan)
	}
	if progress, err := store.Progress.Load(); err == nil && progress != nil {
		chapter["position"] = map[string]any{
			"volume":  progress.CurrentVolume,
			"arc":     progress.CurrentArc,
			"chapter": inst.Chapter,
		}
		if arc := currentArc(store, progress.CurrentVolume, progress.CurrentArc); arc != nil {
			chapter["arc"] = arc
		}
	}

	sections := make([]string, 0, 3)
	if text := marshalStablePromptSection("书籍稳定上下文", book); text != "" {
		sections = append(sections, text)
	}
	if text := marshalStablePromptSection("当前章节稳定上下文", chapter); text != "" {
		sections = append(sections, text)
	}
	return strings.Join(sections, "\n\n")
}

func marshalStablePromptSection(title string, value map[string]any) string {
	if len(value) == 0 {
		return ""
	}
	b, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("【%s】\n%s", title, b)
}

func stableChapterPlan(plan *domain.ChapterPlan) map[string]any {
	if plan == nil {
		return nil
	}
	return map[string]any{
		"chapter":          plan.Chapter,
		"title":            plan.Title,
		"goal":             plan.Goal,
		"conflict":         plan.Conflict,
		"hook":             plan.Hook,
		"opening_state":    plan.OpeningState,
		"target_chars":     plan.TargetChars,
		"emotion_arc":      plan.EmotionArc,
		"notes":            plan.Notes,
		"creative_freedom": plan.CreativeFreedom,
		"contract":         plan.Contract,
	}
}

func currentArc(store *storepkg.Store, volume, arc int) map[string]any {
	if store == nil || volume <= 0 || arc <= 0 {
		return nil
	}
	volumes, err := store.Outline.LoadLayeredOutline()
	if err != nil {
		return nil
	}
	for _, item := range volumes {
		if item.Index != volume {
			continue
		}
		for _, candidate := range item.Arcs {
			if candidate.Index != arc {
				continue
			}
			return map[string]any{
				"volume_title": item.Title,
				"volume_theme": item.Theme,
				"title":        candidate.Title,
				"goal":         candidate.Goal,
			}
		}
	}
	return nil
}
