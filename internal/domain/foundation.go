package domain

import "time"

// FoundationAuditIssue 是 Architect 对已落盘基础设定给出的跨文件一致性问题。
type FoundationAuditIssue struct {
	Artifact    string `json:"artifact"`
	Description string `json:"description"`
	Evidence    string `json:"evidence"`
	Suggestion  string `json:"suggestion,omitempty"`
}

// FoundationAudit 记录一次针对确定版本基础设定的模型审查。
type FoundationAudit struct {
	Fingerprint string                 `json:"fingerprint"`
	Ready       bool                   `json:"ready"`
	Summary     string                 `json:"summary"`
	Issues      []FoundationAuditIssue `json:"issues"`
}

// OutlineConfirmation 记录用户对确定版本基础设定（核心是大纲）的显式确认。
// Fingerprint 绑定确认时刻的 FoundationFingerprint：任何设定工件落盘都会改变
// 指纹，确认随之失效，规划产物必须重新过用户确认门。
type OutlineConfirmation struct {
	ConfirmedAt time.Time `json:"confirmed_at"`
	Fingerprint string    `json:"fingerprint"`
}
