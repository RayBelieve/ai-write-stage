//go:build e2e

package web

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Leixx98/ai-write-stage/internal/comfyui"
)

// Run with: go test -tags=e2e ./internal/entry/web -run TestBrowserCriticalFlows -v
// The test owns a temporary book root and a dedicated browser session.
func TestBrowserCriticalFlows(t *testing.T) {
	binary := "agent-browser"
	if runtime.GOOS == "windows" {
		binary = "agent-browser.cmd"
	}
	if _, err := exec.LookPath(binary); err != nil {
		t.Fatalf("install agent-browser before running e2e tests: %v", err)
	}
	wb, _ := testWorkbench(t)
	defer wb.close()
	server := httptest.NewServer(newHandler(wb))
	defer server.Close()

	session := fmt.Sprintf("ainovel-e2e-%d", time.Now().UnixNano())
	outputDir := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		defer cancel()
		outputFile, err := os.CreateTemp(outputDir, "browser-output-*")
		if err != nil {
			t.Fatal(err)
		}
		defer outputFile.Close()
		command := exec.CommandContext(ctx, binary, append([]string{"--session", session}, args...)...)
		command.Stdout = outputFile
		command.Stderr = outputFile
		if args[0] != "eval" {
			t.Logf("agent-browser %s", strings.Join(args, " "))
		}
		err = command.Run()
		output, readErr := os.ReadFile(outputFile.Name())
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err != nil {
			t.Fatalf("agent-browser %s: %v\n%s", strings.Join(args, " "), err, output)
		}
		return strings.TrimSpace(string(output))
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, binary, "--session", session, "close").Run()
	}()
	eval := func(script string) string {
		t.Helper()
		return run("eval", "-b", base64.StdEncoding.EncodeToString([]byte(script)))
	}
	assert := func(script, description string) {
		t.Helper()
		if got := eval(script); got != "true" {
			t.Fatalf("%s: got %s", description, got)
		}
	}

	run("open", server.URL)
	run("set", "viewport", "1280", "900")
	run("wait", "#welcome-workspace-name")
	run("fill", "#welcome-workspace-name", "E2E First")
	run("click", "#welcome-workspace-create")
	run("wait", "--fn", `document.querySelector('#workspace-current')?.textContent === 'E2E First'`)
	run("wait", "--fn", `document.querySelector('#welcome-workspace-name').value === ''`)
	assert(`!document.querySelector('#welcome-new').hidden`, "new book shows writing entry")
	run("click", "#welcome-start")
	assert(`document.querySelector('#welcome-error').textContent.includes('小说需求')`, "empty writing prompt is rejected")
	eval(`window.WritingWorkspace.closeWelcome()`)
	run("wait", "--fn", `document.documentElement.classList.contains('welcome-seen')`)
	run("click", "#workspace-current")
	run("fill", "#workspace-menu-name", "E2E Second")
	run("click", "#workspace-menu-create")
	run("wait", "--fn", `document.querySelector('#workspace-current')?.textContent === 'E2E Second'`)
	run("click", "#workspace-current")
	run("click", `#workspace-menu-list [data-workspace="E2E First"]`)
	run("wait", "--fn", `document.querySelector('#workspace-current')?.textContent === 'E2E First'`)
	run("click", "#library-open")
	run("click", `#welcome-workspace-list [data-workspace="E2E Second"]`)
	run("wait", "--fn", `document.querySelector('#workspace-current')?.textContent === 'E2E Second'`)
	assert(`document.querySelector('#pause').disabled`, "continue stays disabled before a story starts")
	eval(`window.WritingWorkspace.closeWelcome()`)
	run("wait", "--fn", `document.documentElement.classList.contains('welcome-seen')`)

	run("click", `[data-view="image-generation"]`)
	run("click", `[data-image-settings-view="comfyui"]`)
	run("wait", "--fn", `!document.querySelector('#image-settings-comfyui').hidden`)
	assert(`!document.querySelector('[data-action="validate-workflow"]')`, "redundant validation action is removed")
	run("click", `[data-action="export-workflow"]`)
	assert(`document.querySelector('#toast').textContent.includes('请先导入或选择工作流')`, "export requires a workflow")
	fixture := filepath.Join(t.TempDir(), "e2e-workflow.json")
	workflow := `{"1":{"class_type":"CLIPTextEncode","inputs":{"text":"a quiet library","clip":["2",0]}},"2":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"model.safetensors"}}}`
	if err := os.WriteFile(fixture, []byte(workflow), 0600); err != nil {
		t.Fatal(err)
	}
	run("upload", "#workflow-file", fixture)
	run("wait", "--fn", `document.querySelectorAll('#graph-nodes .graph-node').length === 2`)
	assert(`document.querySelector('#canvas-empty').hidden`, "imported workflow renders nodes")
	run("click", `[data-action="export-workflow"]`)
	assert(`document.querySelector('[data-action="export-workflow"]').download.endsWith('.api.json')`, "export has an API JSON filename")
	assert(`fetch(document.querySelector('[data-action="export-workflow"]').href).then(response => response.json()).then(workflow => workflow['1']?.class_type === 'CLIPTextEncode' && workflow['2']?.class_type === 'CheckpointLoaderSimple')`, "exported API JSON matches imported workflow")

	beforeZoom := eval(`document.querySelector('#canvas-zoom-label').textContent`)
	run("click", `[data-canvas-tool="zoom-in"]`)
	if afterZoom := eval(`document.querySelector('#canvas-zoom-label').textContent`); afterZoom == beforeZoom {
		t.Fatalf("zoom button did not change scale: %s", afterZoom)
	}
	var bounds struct{ X, Y, Width, Height float64 }
	if err := json.Unmarshal([]byte(eval(`document.querySelector('.graph-node[data-node-id="1"]').getBoundingClientRect().toJSON()`)), &bounds); err != nil {
		t.Fatalf("read node bounds: %v", err)
	}
	startX, startY := int(bounds.X+25), int(bounds.Y+20)
	positionBefore := eval(`document.querySelector('.graph-node[data-node-id="1"]').getAttribute('transform')`)
	run("mouse", "move", strconv.Itoa(startX), strconv.Itoa(startY))
	run("mouse", "down", "left")
	run("mouse", "move", strconv.Itoa(startX+50), strconv.Itoa(startY+30))
	run("mouse", "up", "left")
	if positionAfter := eval(`document.querySelector('.graph-node[data-node-id="1"]').getAttribute('transform')`); positionAfter == positionBefore {
		t.Fatalf("node drag did not move: %s", positionAfter)
	}
	run("click", `.graph-node[data-node-id="1"]`)
	run("wait", "--fn", `!document.querySelector('#node-modal').hidden`)
	run("click", `#modal-field-editor [data-field-input="text"] [data-field-expose]`)
	run("click", `#node-modal [data-action="save-node-fields"]`)
	run("wait", "--fn", `document.querySelector('.graph-node[data-node-id="1"]')?.classList.contains('has-exposed') && document.querySelector('#workflow-list').textContent.includes('1 个可配置字段')`)
	run("click", `[data-action="save-workflow-definition"]`)
	run("wait", "--fn", `document.querySelector('#toast').textContent.includes('工作流已保存')`)
	workflowID, err := strconv.Unquote(eval(`document.querySelector('#workflow-list .workflow-item').dataset.workflowId`))
	if err != nil || workflowID == "" {
		t.Fatalf("saved workflow id = %q: %v", workflowID, err)
	}
	loadCanvas := func() comfyui.CanvasDocument {
		t.Helper()
		response, err := server.Client().Get(server.URL + "/api/v2/image-generation/providers/comfyui/workflows/" + url.PathEscape(workflowID) + "/canvas")
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatalf("load saved canvas: HTTP %d", response.StatusCode)
		}
		var saved struct {
			Data comfyui.CanvasDocument `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&saved); err != nil {
			t.Fatal(err)
		}
		return saved.Data
	}
	saved := loadCanvas()
	if len(saved.Nodes) != 2 || len(saved.Fields) != 1 || saved.Fields[0].ID != "text" || saved.Viewport.Scale <= 0 {
		t.Fatalf("saved canvas lost graph or exposed field: %+v", saved)
	}
	run("click", `[data-inspector-tab="prompt"]`)
	run("fill", "#comfy-prompter-template", "Create a quiet library scene.")
	run("fill", `#comfy-field-notes [data-prompter-field-note="text"]`, "Describe the main scene.")
	run("click", `[data-action="apply-prompter"]`)
	run("wait", "--fn", `document.querySelector('#toast').textContent.includes('提示词和字段说明已应用')`)
	saved = loadCanvas()
	if saved.PrompterTemplate != "Create a quiet library scene." || saved.Fields[0].Note != "Describe the main scene." {
		t.Fatalf("prompt editor did not persist template and note: %+v", saved)
	}
	run("click", `[data-inspector-tab="run"]`)
	assert(`document.querySelector('[data-inspector-tab="run"]').textContent === '任务'`, "task tab does not promise a direct run")
	assert(`!!document.querySelector('#dynamic-fields .run-field-preview[data-field-key="text"]')`, "exposed field appears in task inspector")
	assert(`!document.querySelector('#dynamic-fields input, #dynamic-fields select, #dynamic-fields textarea')`, "task inspector does not show inert field inputs")
	run("click", `[data-action="retry-job"]`)
	run("wait", "--fn", `document.querySelector('#toast').textContent.includes('No active job')`)
	eval(`window.ComfyUI.onJobEvent({job_id:'e2e-job',status:'succeeded',outputs:[{kind:'text',preview:'E2E output'}]})`)
	assert(`document.querySelector('#job-status').textContent === '已完成'`, "job event updates run inspector")
	assert(`document.querySelector('#job-outputs').textContent.includes('E2E output')`, "job output appears in run inspector")
	run("click", `[data-action="open-image-profiles"]`)
	assert(`document.querySelector('#image-settings-comfyui').hidden && !document.querySelector('#image-settings-profiles').hidden`, "task inspector opens image profiles")
}
