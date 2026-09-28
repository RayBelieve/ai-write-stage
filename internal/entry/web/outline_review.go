package web

import (
	"fmt"
	"net/http"
)

// 大纲确认门 API：状态查询 / 确认进入写作 / 反馈修订。
// 状态同时挂在 /api/v2/state 快照里（OutlineReviewPending），这里是显式操作入口。

func (c *v2Controller) outlineReview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		envelopeErr(w, http.StatusMethodNotAllowed, codeInvalidRequest, fmt.Errorf("method not allowed"))
		return
	}
	review, err := c.rt.OutlineReviewStatus()
	if err != nil {
		envelopeErr(w, http.StatusConflict, codeConflict, err)
		return
	}
	envelope(w, http.StatusOK, 0, review, "")
}

func (c *v2Controller) outlineConfirm(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		envelopeErr(w, http.StatusMethodNotAllowed, codeInvalidRequest, fmt.Errorf("method not allowed"))
		return
	}
	if err := c.rt.ConfirmOutline(); err != nil {
		envelopeErr(w, http.StatusConflict, codeConflict, err)
		return
	}
	envelope(w, http.StatusAccepted, 0, map[string]any{"confirmed": true}, "")
}

func (c *v2Controller) outlineFeedback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		envelopeErr(w, http.StatusMethodNotAllowed, codeInvalidRequest, fmt.Errorf("method not allowed"))
		return
	}
	var req struct {
		Feedback string `json:"feedback"`
	}
	if err := decodeBody(r, &req); err != nil {
		envelopeErr(w, http.StatusBadRequest, codeInvalidRequest, err)
		return
	}
	if err := c.rt.SubmitOutlineFeedback(req.Feedback); err != nil {
		envelopeErr(w, http.StatusConflict, codeConflict, err)
		return
	}
	envelope(w, http.StatusAccepted, 0, map[string]any{"accepted": true}, "")
}
