package tools

import "fmt"

// WriterPlanningBudget bounds the part of a chapter plan projected into one
// local Writer request. Smaller context windows require shorter, denser cards.
//
// 字数档位的取向：unit 是 Writer 单次生成的完整叙事片段，过小（300 字级）
// 会逼 Writer 一句一拍地赶 required_beats，全书退化为短句平铺。下限 500 字
// 保证每个 beat 有铺陈空间；上限按窗口对应的输出预算倒推（预算见
// writerOutputTokenLimit：8K 档 ≈1800 tokens、16K 档 ≈2400、大窗口 ≈6000），
// 留足 JSON 包装与重试余量。
type WriterPlanningBudget struct {
	ContextWindow            int
	MinUnitChars             int
	MaxUnitChars             int
	MaxRequiredBeats         int
	MaxUnitForbiddenMoves    int
	MaxChapterListItems      int
	MaxChapterForbiddenMoves int
	MaxCreativeFreedom       int
	MaxItemRunes             int
	MaxSceneFieldRunes       int
	MaxUnitFieldRunes        int
}

// WriterPlanningBudgetForContext returns conservative limits for the Writer's
// configured window. Zero-valued list/text limits mean that legacy large-window
// behavior is preserved.
func WriterPlanningBudgetForContext(window int) WriterPlanningBudget {
	budget := WriterPlanningBudget{
		ContextWindow: window,
		MinUnitChars:  500,
		MaxUnitChars:  2000,
	}
	switch {
	case window > 0 && window <= 8192:
		budget.MaxUnitChars = 1200
		budget.MaxRequiredBeats = 3
		budget.MaxUnitForbiddenMoves = 5
		budget.MaxChapterListItems = 6
		budget.MaxChapterForbiddenMoves = 4
		budget.MaxCreativeFreedom = 3
		budget.MaxItemRunes = 72
		budget.MaxSceneFieldRunes = 120
		budget.MaxUnitFieldRunes = 100
	case window > 0 && window <= 16384:
		budget.MaxUnitChars = 1600
		budget.MaxRequiredBeats = 3
		budget.MaxUnitForbiddenMoves = 6
		budget.MaxChapterListItems = 8
		budget.MaxChapterForbiddenMoves = 6
		budget.MaxCreativeFreedom = 4
		budget.MaxItemRunes = 100
		budget.MaxSceneFieldRunes = 160
		budget.MaxUnitFieldRunes = 140
	}
	return budget
}

// Instruction is appended to the cloud planner prompt. The tool schema and
// Execute validation remain authoritative if a model ignores this text.
func (b WriterPlanningBudget) Instruction() string {
	if b.ContextWindow <= 0 || b.MaxRequiredBeats == 0 {
		return fmt.Sprintf("Writer 当前采用大窗口档位；每个 unit 可在 %d-%d 字内按情节密度动态规划，仍应使用简洁、可执行的场景卡。", b.MinUnitChars, b.MaxUnitChars)
	}
	return fmt.Sprintf(
		"Writer 上下文窗口为 %d tokens。为保证本地模型可执行并给正文留出铺陈空间：每个 unit 可在 %d-%d 字内按实际情节密度动态规划，低密度承接/过渡通常 500-800 字，中等密度推进通常 800-1400 字，高密度冲突/转折通常 1400-2000 字；不得把所有 unit 机械设为同一字数。required_beats 每个最多 %d 项，且一个 beat 是一个完整叙事动作（含人物反应与余波），不是一句话事件——宁可少列，让 Writer 把每个动作写足；unit forbidden_moves 最多 %d 项；每个条目最多 %d 字；场景状态/冲突/转折等字段最多 %d 字；end_anchor/transition 最多 %d 字；creative_freedom 最多 %d 项；本章 forbidden_moves 最多 %d 项。全章通常 3-5 个 unit；不得用增加字段长度代替拆分 unit。",
		b.ContextWindow, b.MinUnitChars, b.MaxUnitChars, b.MaxRequiredBeats,
		b.MaxUnitForbiddenMoves, b.MaxItemRunes, b.MaxSceneFieldRunes,
		b.MaxUnitFieldRunes, b.MaxCreativeFreedom, b.MaxChapterForbiddenMoves,
	)
}
