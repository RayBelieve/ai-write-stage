package play

import (
	"strings"

	"github.com/Leixx98/ai-write-stage/internal/store"
)

type playProfile struct {
	MinCards    int
	MaxCards    int
	RecentBeats int
	WriterTurns int
	FillEmptyCG bool
	PromptHint  string
}

func profileFor(density store.PlayDensity, pacing store.PlayPacing) playProfile {
	recent, writer, fillEmptyCG, densityHint := densityKnobs(density)
	minCards, maxCards, pacingHint := pacingRange(pacing)
	return playProfile{
		MinCards:    minCards,
		MaxCards:    maxCards,
		RecentBeats: maxInt(recent, maxCards/2),
		WriterTurns: maxInt(writer, maxCards),
		FillEmptyCG: fillEmptyCG,
		PromptHint:  joinHints(densityHint, pacingHint),
	}
}

func densityKnobs(density store.PlayDensity) (recent, writer int, fillEmptyCG bool, hint string) {
	if store.NormalizePlayDensity(string(density)) == store.PlayDensityRich {
		return 8, 20, false, "本局档位是丰满：notes 写清冲突与转向。不要宣布全剧结束。"
	}
	return 4, 6, true, "本局档位是精简：少写气氛。不要宣布全剧结束。"
}

func pacingRange(pacing store.PlayPacing) (minCards, maxCards int, hint string) {
	switch store.NormalizePlayPacing(string(pacing)) {
	case store.PlayPacingStory:
		return 10, 15, "本局节奏是剧情多：本段 10～15 拍后再出选项，以剧情推进为主。选项必须带 set_facts。"
	case store.PlayPacingPure:
		return 5, 10, "本局节奏是纯剧情：本段 5～10 拍，任何拍都不要 choice，写完本站压力后自然接下一段。"
	default:
		return 3, 6, "本局节奏是选择多：本段 3～6 拍必须落到选项，不要拖长铺垫。选项必须带 set_facts。"
	}
}

// imageFrequencyHint 返回生图频率档位的换图纪律提示；节俭档返回空，
// 保持 play-planner.md 内置的最保守行为。
func imageFrequencyHint(freq store.PlayImageFrequency) string {
	switch store.NormalizePlayImageFrequency(string(freq)) {
	case store.PlayImageFreqDense:
		return "本局生图频率是密集：多数拍都应有画面。除场景/时间/人物状态切换外，情绪转折、重要反应、动作定格、气氛变化都应 cg=new，平均每 2～3 拍一张；同一画面连续超过 3 拍时应考虑换图并写清 cg_intent 的变化。"
	case store.PlayImageFreqStandard:
		return "本局生图频率是标准：除场景/时间/人物状态切换外，每段第一拍和情绪转折点（对峙升级、关系变化、发现真相、决定行动）也应 cg=new，预计每段 2～4 张。"
	default:
		return ""
	}
}

func joinHints(parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return strings.Join(out, "\n")
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
