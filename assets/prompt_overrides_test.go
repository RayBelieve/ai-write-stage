package assets

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Leixx98/ai-write-stage/internal/store"
)

func writePromptSettings(t *testing.T, dir string, value any) {
	t.Helper()
	path := filepath.Join(store.NovelDir(dir), "meta", "web", "prompts.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLoadPromptOverridesUsesActivePreset(t *testing.T) {
	dir := t.TempDir()
	writePromptSettings(t, dir, map[string]any{
		"version":       3,
		"active_preset": "冷峻",
		"presets": map[string]any{
			"默认配置": map[string]any{"prompts": map[string]string{"writer": "default"}},
			"冷峻":   map[string]any{"prompts": map[string]string{"writer": "custom", "architect": "plan"}},
		},
		"prompts": map[string]string{"writer": "stale"},
	})
	got, err := LoadPromptOverrides(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got["writer"] != "custom" || got["architect"] != "plan" {
		t.Fatalf("active preset not selected: %#v", got)
	}
}

func TestApplyPromptOverridesMapsArchitectAndCoreRoles(t *testing.T) {
	bundle := Bundle{Prompts: Prompts{
		ArchitectShort: "short",
		ArchitectLong:  "long",
		Writer:         "writer",
	}}
	ApplyPromptOverrides(&bundle, map[string]string{
		"architect":       "architect-custom",
		"chapter_planner": "planner-custom",
		"writer":          "writer-custom",
		"editor":          "editor-custom",
		"prompter":        "prompter-custom",
	})
	// 协议段固化：覆盖不得触碰。
	if bundle.Prompts.ArchitectShort != "short" || bundle.Prompts.ArchitectLong != "long" || bundle.Prompts.Writer != "writer" {
		t.Fatalf("protocol segments must stay intact: %#v", bundle.Prompts)
	}
	// 覆盖只作用于创作段；architect 创作段由短篇/长篇共用。
	if bundle.Prompts.CreativeArchitect != "architect-custom" {
		t.Fatalf("architect creative override not shared: %#v", bundle.Prompts)
	}
	if bundle.Prompts.CreativeChapterPlanner != "planner-custom" || bundle.Prompts.CreativeWriter != "writer-custom" {
		t.Fatalf("creative overrides not applied: %#v", bundle.Prompts)
	}
	// 未在白名单内的 key（退役角色 / 遗留字段）一律忽略。
	if bundle.Prompts.CreativeEditor != "" || bundle.Prompts.Editor != "" || bundle.Prompts.Prompter != "" {
		t.Fatalf("unknown keys must be ignored: %#v", bundle.Prompts)
	}
}
