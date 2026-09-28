package headless

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/Leixx98/ai-write-stage/assets"
	"github.com/Leixx98/ai-write-stage/internal/bootstrap"
	"github.com/Leixx98/ai-write-stage/internal/diag"
	"github.com/Leixx98/ai-write-stage/internal/domain"
	"github.com/Leixx98/ai-write-stage/internal/entry/startup"
	"github.com/Leixx98/ai-write-stage/internal/host"
	"github.com/Leixx98/ai-write-stage/internal/store"
)

type Options struct {
	Prompt string
	Stdout io.Writer
	Stderr io.Writer
	// AutoConfirm 为 true 时跳过大纲确认门：规划产物就绪后自动确认并继续写作。
	// 为 false 时停在确认门并打印提示（大纲内容请到 Web 工作台查看/确认）。
	AutoConfirm bool
}

// Run 以无界面模式运行会话内核，直接消费 Engine 事件与流式输出。
// 未来若新增“续写已有小说”等共享启动方式，不应直接堆到这里，
// 而应先落到 internal/entry/startup，再由 headless 入口调用。
func Run(cfg bootstrap.Config, bundle assets.Bundle, opts Options) error {
	stdout := opts.Stdout
	if stdout == nil {
		stdout = os.Stdout
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = os.Stderr
	}
	eng, err := host.New(cfg, bundle, host.WithFileLog("runtime.log", false))
	if err != nil {
		return err
	}
	defer eng.Close()
	if logErr := eng.FileLogError(); logErr != nil {
		fmt.Fprintf(stderr, "警告：文件日志不可用，继续使用终端日志：%v\n", logErr)
	}
	// Export a redacted diagnostic report on normal completion or returned errors.
	// External termination bypasses this defer, so diagnostics must then be exported separately.
	defer func() {
		if _, err := diag.Export(store.NewStore(eng.Dir())); err != nil {
			fmt.Fprintf(stderr, "警告：诊断报告导出失败：%v\n", err)
		}
	}()

	prompt := strings.TrimSpace(opts.Prompt)
	if prompt != "" {
		plan, err := startup.PrepareQuick(startup.Request{
			Mode:        startup.ModeQuick,
			UserPrompt:  prompt,
			OutputDir:   eng.Dir(),
			Interactive: true,
		})
		if err != nil {
			return err
		}
		fmt.Fprintf(stderr, "headless 启动: %s\n", eng.Dir())
		// 启动侧确定性生成本书用户规则快照（用原始 prompt 归一化），须在 StartPrepared 前。
		if err := eng.PrepareUserRules(plan.RawPrompt); err != nil {
			return err
		}
		if err := eng.StartPrepared(plan.RawPrompt); err != nil {
			return err
		}
	} else {
		items, err := eng.ReplayQueue(0)
		if err != nil {
			return err
		}
		roundHasContent, err := replayQueue(items, stdout, stderr)
		if err != nil {
			return err
		}
		label, err := eng.Resume()
		if err != nil {
			return err
		}
		if label == "" {
			return fmt.Errorf("headless 模式需要 --prompt，或输出目录 %q 下已有可恢复会话", eng.Dir())
		}
		fmt.Fprintf(stderr, "headless 恢复: %s (%s)\n", eng.Dir(), label)
		return runWithConfirmGate(eng, stdout, stderr, roundHasContent, opts.AutoConfirm)
	}

	return runWithConfirmGate(eng, stdout, stderr, false, opts.AutoConfirm)
}

// runWithConfirmGate 驱动事件消费循环，并在引擎每轮停机后处理大纲确认门：
// 规划产物就绪且未确认时，AutoConfirm 自动确认续跑；否则打印提示正常退出。
func runWithConfirmGate(eng *host.Host, stdout, stderr io.Writer, roundHasContent, autoConfirm bool) error {
	for {
		roundDone, err := consume(eng, stdout, stderr, roundHasContent)
		if err != nil {
			return err
		}
		if !roundDone {
			return nil // Host 已关闭
		}
		review, err := eng.OutlineReviewStatus()
		if err != nil {
			return fmt.Errorf("读取大纲确认门状态失败: %w", err)
		}
		if review == nil || !review.Awaiting {
			return nil
		}
		if !autoConfirm {
			fmt.Fprintf(stderr, "\n[大纲待确认] 规划已完成，等待你确认后再开写。\n审查结论：%s\n"+
				"查看并确认大纲请打开 Web 工作台；追加 --yes 可自动确认当前大纲直接开写。\n", review.AuditSummary)
			return nil
		}
		fmt.Fprintf(stderr, "\n[大纲待确认] --yes 自动确认当前大纲，继续写作。\n")
		if err := eng.ConfirmOutline(); err != nil {
			return err
		}
		roundHasContent = false
	}
}

// consume 消费事件与流式输出直到一轮引擎停机或 Host 关闭。
// 返回 roundDone=true 表示引擎一轮正常结束（可继续处理确认门）；false 表示 Host 已关闭。
func consume(eng *host.Host, stdout, stderr io.Writer, roundHasContent bool) (bool, error) {
	for {
		select {
		case ev, ok := <-eng.Events():
			if !ok {
				return false, nil
			}
			writeEvent(stderr, ev)
		case event, ok := <-eng.Stream():
			if !ok {
				continue
			}
			var err error
			roundHasContent, err = writeStreamEvent(stdout, event, roundHasContent)
			if err != nil {
				return false, err
			}
		case _, ok := <-eng.Done():
			if !ok {
				return false, nil
			}
			if err := drainPending(eng, stdout, stderr, roundHasContent); err != nil {
				return false, err
			}
			return true, nil
		}
	}
}

func drainPending(eng *host.Host, stdout, stderr io.Writer, roundHasContent bool) error {
	for {
		select {
		case ev, ok := <-eng.Events():
			if ok {
				writeEvent(stderr, ev)
			}
		case event, ok := <-eng.Stream():
			if !ok {
				continue
			}
			var err error
			roundHasContent, err = writeStreamEvent(stdout, event, roundHasContent)
			if err != nil {
				return err
			}
		default:
			if roundHasContent {
				if _, err := io.WriteString(stdout, "\n"); err != nil {
					return err
				}
			}
			return nil
		}
	}
}

func writeEvent(w io.Writer, ev host.Event) {
	if w == nil || strings.TrimSpace(ev.Summary) == "" {
		return
	}
	ts := ev.Time.Format("15:04:05")
	if ts == "00:00:00" {
		ts = "--:--:--"
	}
	fmt.Fprintf(w, "[%s] [%s] %s\n", ts, ev.Category, ev.Summary)
}

func writeStreamEvent(w io.Writer, event host.StreamEvent, roundHasContent bool) (bool, error) {
	switch event.Kind {
	case host.StreamEventClear:
		if !roundHasContent {
			return false, nil
		}
		_, err := io.WriteString(w, "\n\n")
		return false, err
	case host.StreamEventTool:
		if strings.TrimSpace(event.Tool) == "" {
			return roundHasContent, nil
		}
		_, err := fmt.Fprintf(w, "▸ %s\n", event.Tool)
		return true, err
	case host.StreamEventText, host.StreamEventThinking:
		if event.Text == "" {
			return roundHasContent, nil
		}
		_, err := io.WriteString(w, event.Text)
		return true, err
	default:
		return roundHasContent, nil
	}
}

func replayQueue(items []domain.RuntimeQueueItem, stdout, stderr io.Writer) (bool, error) {
	var roundHasContent bool
	var err error
	for _, item := range items {
		switch item.Kind {
		case domain.RuntimeQueueUIEvent:
			writeEvent(stderr, host.Event{
				Time:     item.Time,
				Category: item.Category,
				Summary:  item.Summary,
			})
		case domain.RuntimeQueueStreamClear:
			roundHasContent, err = writeStreamEvent(stdout, host.StreamEvent{Kind: host.StreamEventClear}, roundHasContent)
			if err != nil {
				return roundHasContent, err
			}
		case domain.RuntimeQueueStreamDelta:
			event, ok := host.ReplayStreamEvent(item)
			if !ok {
				continue
			}
			roundHasContent, err = writeStreamEvent(stdout, event, roundHasContent)
			if err != nil {
				return roundHasContent, err
			}
		}
	}
	return roundHasContent, nil
}
