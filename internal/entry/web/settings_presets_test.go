package web

import "testing"

func TestDefaultPromptValuesAreComplete(t *testing.T) {
	values := defaultPromptValues()
	// v3 只暴露 3 个创作段；editor 已退役、协议段固化不入库。
	for _, role := range []string{"architect", "chapter_planner", "writer"} {
		if values[role] == "" {
			t.Fatalf("default creative prompt %q is empty", role)
		}
	}
	for _, role := range []string{"editor", "prompter"} {
		if _, ok := values[role]; ok {
			t.Fatalf("retired role %q must not appear in v3 defaults", role)
		}
	}
}

func TestDefaultWritingRulesAreNonEmpty(t *testing.T) {
	if got := defaultWritingRules(); got == "" {
		t.Fatal("default writing rules must not be empty")
	}
}

func TestPresetNameValidation(t *testing.T) {
	if validPresetName("") || validPresetName("   ") || validPresetName(string(make([]rune, 65))) {
		t.Fatal("invalid preset name accepted")
	}
	if !validPresetName("悬疑风格") {
		t.Fatal("valid unicode preset name rejected")
	}
}

func TestMergePromptsDoesNotEraseDefaultsWithEmptyLegacyValues(t *testing.T) {
	got := mergePrompts(map[string]string{"writer": "embedded", "editor": "embedded-editor"}, map[string]string{"writer": "", "editor": "  "})
	if got["writer"] != "embedded" || got["editor"] != "embedded-editor" {
		t.Fatalf("empty legacy values erased defaults: %#v", got)
	}
}
