package comfyadapter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Leixx98/ai-write-stage/internal/comfyui"
	"github.com/Leixx98/ai-write-stage/internal/imagejob"
)

type testReporter struct {
	status, stage  string
	current, total int
	node           string
	raw            string
}

func (r *testReporter) Stage(status, stage string) { r.status, r.stage = status, stage }
func (r *testReporter) ExternalID(string)          {}
func (r *testReporter) Progress(current, total int, node string) {
	r.current, r.total, r.node = current, total, node
}
func (r *testReporter) Prompt(raw string, _ map[string]any) { r.raw = raw }
func (r *testReporter) ProviderSnapshot(any)                {}

func TestGenerateAndValidatePromptRetriesInvalidJSON(t *testing.T) {
	schema := imagejob.PromptSchema{Fields: []imagejob.PromptField{{ID: "positive_prompt", ValueType: "string", Exposed: true}}}
	var attempts int
	prompter := imagejob.PrompterFunc(func(_ context.Context, request imagejob.PromptRequest) (string, error) {
		attempts++
		if attempts == 1 {
			return "The image is...", nil
		}
		if !strings.Contains(request.SystemPrompt, "JSON 校验") {
			t.Fatal("retry did not include validation feedback")
		}
		return `{"positive_prompt":"portrait"}`, nil
	})
	reporter := &testReporter{}
	raw, parsed, err := generateAndValidatePrompt(context.Background(), prompter, imagejob.PromptRequest{SystemPrompt: "Generate JSON"}, schema, true, reporter)
	if err != nil || attempts != 2 || !parsed.Valid || parsed.Values["positive_prompt"] != "portrait" || reporter.raw != raw {
		t.Fatalf("raw=%q parsed=%+v attempts=%d reporter=%+v err=%v", raw, parsed, attempts, reporter, err)
	}
}

func TestGenerateAndValidatePromptPreservesInvalidResponse(t *testing.T) {
	schema := imagejob.PromptSchema{Fields: []imagejob.PromptField{{ID: "positive_prompt", ValueType: "string", Exposed: true}}}
	var attempts int
	prompter := imagejob.PrompterFunc(func(context.Context, imagejob.PromptRequest) (string, error) {
		attempts++
		return "The image is...", nil
	})
	reporter := &testReporter{}
	_, _, err := generateAndValidatePrompt(context.Background(), prompter, imagejob.PromptRequest{}, schema, true, reporter)
	if err == nil || attempts != 2 || reporter.raw != "The image is..." {
		t.Fatalf("attempts=%d raw=%q err=%v", attempts, reporter.raw, err)
	}
}

func TestImageJobClientIDIsUnique(t *testing.T) {
	if imageJobClientID("ainovel-web", "job-1") == imageJobClientID("ainovel-web", "job-2") {
		t.Fatal("job client IDs must be unique")
	}
}

func TestWaitReadyRetriesTransientFailure(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) < 3 {
			http.Error(w, "starting", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	client, err := comfyui.NewHTTPClient(comfyui.Config{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := waitReady(ctx, client); err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("attempts=%d", attempts.Load())
	}
}

func TestAwaitFallsBackToPollingWhenProgressCloses(t *testing.T) {
	var checks atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/history/prompt-fallback" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if checks.Add(1) == 1 {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		_, _ = w.Write([]byte(`{"prompt-fallback":{"status":{"status_str":"success","completed":true,"messages":[]},"outputs":{}}}`))
	}))
	defer server.Close()
	client, err := comfyui.NewHTTPClient(comfyui.Config{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	events := make(chan comfyui.ProgressEvent)
	close(events)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	history, err := await(ctx, client, "prompt-fallback", events, 5*time.Millisecond, &testReporter{})
	if err != nil {
		t.Fatal(err)
	}
	if history.PromptID != "prompt-fallback" || checks.Load() < 2 {
		t.Fatalf("history=%+v checks=%d", history, checks.Load())
	}
}

func TestAwaitReportsWebSocketProgress(t *testing.T) {
	var checks atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if checks.Add(1) == 1 {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		_, _ = w.Write([]byte(`{"prompt":{"status":{"status_str":"success","completed":true,"messages":[]},"outputs":{}}}`))
	}))
	defer server.Close()
	client, err := comfyui.NewHTTPClient(comfyui.Config{BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	events := make(chan comfyui.ProgressEvent, 2)
	events <- comfyui.ProgressEvent{PromptID: "prompt", Status: "progress", Current: 4, Total: 10, Node: "9"}
	events <- comfyui.ProgressEvent{PromptID: "prompt", Status: "execution_success"}
	reporter := &testReporter{}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := await(ctx, client, "prompt", events, time.Second, reporter); err != nil {
		t.Fatal(err)
	}
	if reporter.status != "running" || reporter.current != 4 || reporter.total != 10 || reporter.node != "9" {
		t.Fatalf("reporter=%+v", reporter)
	}
}
