package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/Leixx98/ai-write-stage/internal/domain"
	"github.com/Leixx98/ai-write-stage/internal/errs"
)

// Store is the novel-facts composition root. Image jobs and tavern sessions
// live on the process-wide Roots, not on this type.
type Store struct {
	dir string

	Progress    *ProgressStore
	Outline     *OutlineStore
	Drafts      *DraftStore
	Summaries   *SummaryStore
	RunMeta     *RunMetaStore
	UserRules   *UserRulesStore
	Signals     *SignalStore
	Runtime     *RuntimeStore
	Characters  *CharacterStore
	Cast        *CastStore
	World       *WorldStore
	Checkpoints *CheckpointStore
	Sessions    *SessionStore
	Usage       *UsageStore
	Simulation  *SimulationStore
	Decisions   *DecisionStore

	crossMu sync.Mutex // 串行化跨域协调；不代表多个文件具备事务原子性
}

// Roots is the process-wide workspace: novel facts, image media, and tavern.
type Roots struct {
	Workspace   string
	Facts       *Store
	Images      *ImageStore
	ImageConfig *ImageConfigStore
	ComfyUI     *ComfyUIStore
	Tavern      *GalgameStore
}

// NewStore creates the novel-facts store for a workspace root. The returned
// Store.Dir is workspaceDir/novel; callers that already hold a Store should
// reuse it instead of passing Store.Dir back into NewStore.
func NewStore(workspaceDir string) *Store {
	return Open(workspaceDir, "").Facts
}

// NewStoreForProject creates novel facts for a workspace. Image-generation
// configuration is machine-global and is not stored in the project.
func NewStoreForProject(workspaceDir, projectDir string) *Store {
	return Open(workspaceDir, projectDir).Facts
}

// Open builds the three composition roots for one workspace directory.
func Open(workspaceDir, projectDir string) *Roots {
	novel := NovelDir(workspaceDir)
	io := newIO(novel)
	configIO := newIO(imageGenerationConfigDir())
	outline := NewOutlineStore(io)
	facts := &Store{
		dir:         novel,
		Progress:    NewProgressStore(newIO(novel)),
		Outline:     outline,
		Drafts:      NewDraftStore(newIO(novel)),
		Summaries:   NewSummaryStore(newIO(novel), outline),
		RunMeta:     NewRunMetaStore(newIO(novel)),
		UserRules:   NewUserRulesStore(newIO(novel)),
		Signals:     NewSignalStore(newIO(novel)),
		Runtime:     NewRuntimeStore(newIO(novel)),
		Characters:  NewCharacterStore(newIO(novel), outline),
		Cast:        NewCastStore(newIO(novel)),
		World:       NewWorldStore(newIO(novel)),
		Checkpoints: NewCheckpointStore(io),
		Sessions:    NewSessionStore(newIO(novel)),
		Usage:       NewUsageStore(newIO(novel)),
		Simulation:  NewSimulationStore(newIO(novel)),
		Decisions:   NewDecisionStore(newIO(novel)),
	}
	return &Roots{
		Workspace:   workspaceDir,
		Facts:       facts,
		Images:      NewImageStore(io),
		ImageConfig: NewImageConfigStore(configIO),
		ComfyUI:     NewComfyUIStore(configIO),
		Tavern:      NewGalgameStore(newIO(TavernDir(workspaceDir))),
	}
}

func imageGenerationConfigDir() string {
	if root := os.Getenv("AINOVEL_HOME"); root != "" {
		return filepath.Join(root, "image-generation")
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, ".ainovel", "image-generation")
}

// Dir 返回输出根目录。
func (s *Store) Dir() string { return s.dir }

// CheckConsistency 对事实层做一次浅层校验，用于启动/恢复时生成 warning。
// 纯只读：不修正数据，仅返回可读的问题描述。调用方决定如何展示（log / UI）。
// 为避免扫全目录带来的 IO 开销，只校验 Progress 的关键点：
//   - 最后一个完成章节必须在 chapters/ 下存在终稿
//   - Layered 模式下，当前 Volume/Arc 必须能在 layered_outline 中找到
func (s *Store) CheckConsistency() []string {
	var warnings []string
	progress, err := s.Progress.Load()
	if err != nil {
		return append(warnings, fmt.Sprintf("progress 读取失败: %v", err))
	}
	if progress == nil {
		return warnings
	}
	if n := len(progress.CompletedChapters); n > 0 {
		lastCh := progress.CompletedChapters[n-1]
		if text, err := s.Drafts.LoadChapterText(lastCh); err != nil {
			warnings = append(warnings, fmt.Sprintf("第 %d 章终稿读取失败: %v", lastCh, err))
		} else if text == "" {
			warnings = append(warnings, fmt.Sprintf("progress 标记第 %d 章已完成，但 chapters/%02d.md 不存在或为空", lastCh, lastCh))
		}
	}
	if progress.Layered && progress.CurrentVolume > 0 && progress.CurrentArc > 0 {
		volumes, err := s.Outline.LoadLayeredOutline()
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("分层大纲读取失败: %v", err))
		} else if len(volumes) > 0 {
			found := false
			for _, v := range volumes {
				if v.Index != progress.CurrentVolume {
					continue
				}
				for _, a := range v.Arcs {
					if a.Index == progress.CurrentArc {
						found = true
						break
					}
				}
				break
			}
			if !found {
				warnings = append(warnings, fmt.Sprintf("progress 当前 V%d A%d 在分层大纲中找不到对应条目", progress.CurrentVolume, progress.CurrentArc))
			}
		}
	}
	return warnings
}

// FoundationMissing 返回基础设定中尚缺的项，按用于 Prompt/Reminder 的稳定顺序排列。
// 长篇模式（已有 layered_outline）额外要求 compass。读取失败必须原样返回，不能把
// 损坏或无权限读取的工件误判成“尚未创建”，否则调用方可能覆盖真实数据。
func (s *Store) FoundationMissing() ([]string, error) {
	var missing []string
	premise, err := s.Outline.LoadPremise()
	if err != nil {
		return nil, fmt.Errorf("load premise: %w", err)
	}
	if premise == "" {
		missing = append(missing, "premise")
	}
	outline, err := s.Outline.LoadOutline()
	if err != nil {
		return nil, fmt.Errorf("load outline: %w", err)
	}
	if len(outline) == 0 {
		missing = append(missing, "outline")
	}
	characters, err := s.Characters.Load()
	if err != nil {
		return nil, fmt.Errorf("load characters: %w", err)
	}
	if len(characters) == 0 {
		missing = append(missing, "characters")
	}
	rules, err := s.World.LoadWorldRules()
	if err != nil {
		return nil, fmt.Errorf("load world rules: %w", err)
	}
	if len(rules) == 0 {
		missing = append(missing, "world_rules")
	}
	layered, err := s.Outline.LoadLayeredOutline()
	if err != nil {
		return nil, fmt.Errorf("load layered outline: %w", err)
	}
	if len(layered) > 0 {
		compass, err := s.Outline.LoadCompass()
		if err != nil {
			return nil, fmt.Errorf("load compass: %w", err)
		}
		if compass == nil {
			missing = append(missing, "compass")
		}
	}
	// 新书要过两道门才能从规划进入写作：模型的语义审查（audit ready）与用户的
	// 显式确认（outline_confirmation）。审查/确认都是动作而非文件缺失，因此只在
	// 其它工件齐全时追加。旧书（已在 writing/complete）不追溯设门，保持历史项目
	// 兼容；确认失效由指纹判定——任何设定工件落盘都会使旧确认失效、audit 重审。
	if len(missing) == 0 {
		progress, err := s.Progress.Load()
		if err != nil {
			return nil, fmt.Errorf("load progress: %w", err)
		}
		if progress == nil {
			missing = append(missing, "foundation_audit")
		} else {
			switch progress.Phase {
			case domain.PhaseWriting, domain.PhaseComplete:
				// 旧书 / 已过门：维持原语义，规划期门禁不再适用。
			default:
				audit, aerr := s.Outline.LoadFoundationAudit()
				if aerr != nil {
					return nil, fmt.Errorf("load foundation audit: %w", aerr)
				}
				ready := audit != nil && audit.Ready
				if ready {
					fp, ferr := s.FoundationFingerprint()
					if ferr != nil {
						return nil, fmt.Errorf("fingerprint foundation: %w", ferr)
					}
					ready = audit.Fingerprint == fp
				}
				if !ready {
					missing = append(missing, "foundation_audit")
				}
			}
		}
	}
	return missing, nil
}

// FoundationReview 是规划产物的用户确认门状态快照。规划完成（基础设定齐全且
// 模型审查 ready）但尚无匹配当前指纹的用户确认时 Awaiting=true；Engine 在该
// 状态下 Route=nil 自然停机，Web/Headless 消费此状态呈现"大纲确认页"。
type FoundationReview struct {
	Awaiting     bool // true = 规划产物已就绪，等待用户确认
	Confirmed    bool // 存在与当前指纹匹配的显式确认
	ConfirmedAt  time.Time
	Fingerprint  string
	AuditSummary string // 模型审查结论摘要（未就绪时为空）
	Phase        string
}

// FoundationReview 读取用户确认门状态。两道门共用一套指纹判定：
//   - 规划期（全书大纲门）：基础设定齐全且审查 ready 后等待首次确认；
//   - 写作期（弧/卷边界门）：expand_arc / append_volume / revise_outline 等
//     规划动作改写产物后指纹失配，继续写作前等待再次确认；从未确认过的
//     旧书（无确认工件）不追溯设门，维持升级前的写作流。
func (s *Store) FoundationReview() (*FoundationReview, error) {
	progress, err := s.Progress.Load()
	if err != nil {
		return nil, fmt.Errorf("load progress: %w", err)
	}
	review := &FoundationReview{}
	if progress == nil {
		return review, nil
	}
	review.Phase = string(progress.Phase)
	switch progress.Phase {
	case domain.PhaseComplete:
		return review, nil
	}
	missing, err := s.FoundationMissing()
	if err != nil {
		return nil, fmt.Errorf("load foundation state: %w", err)
	}
	if len(missing) > 0 {
		return review, nil // 工件未齐或审查未就绪：还没到确认门
	}
	if audit, err := s.Outline.LoadFoundationAudit(); err == nil && audit != nil {
		review.AuditSummary = audit.Summary
	}
	fp, err := s.FoundationFingerprint()
	if err != nil {
		return nil, fmt.Errorf("fingerprint foundation: %w", err)
	}
	review.Fingerprint = fp
	conf, err := s.Outline.LoadOutlineConfirmation()
	if err != nil {
		return nil, fmt.Errorf("load outline confirmation: %w", err)
	}
	if conf != nil && conf.Fingerprint == fp {
		review.Confirmed = true
		review.ConfirmedAt = conf.ConfirmedAt
	}
	if progress.Phase == domain.PhaseWriting {
		// 写作期只拦「确认过但规划又被改」的书；从未确认的旧书放行。
		review.Awaiting = conf != nil && !review.Confirmed
	} else {
		// 规划期：新书必须过用户确认才能开写。
		review.Awaiting = !review.Confirmed
	}
	return review, nil
}

// FoundationUnconfirmed 报告路由是否应停机等确认（确认门的单一真相源，
// 与 FoundationReview 同口径）：写作期规划产物偏离最近一次用户确认。
func (s *Store) FoundationUnconfirmed() (bool, error) {
	review, err := s.FoundationReview()
	if err != nil {
		return false, err
	}
	return review.Awaiting, nil
}

// ConfirmOutline 落用户确认工件（绑定当前指纹）。Phase 推进与引擎重启由 Host 层
// 负责，这里只做事实写入；重复确认幂等（覆盖写同一指纹）。
func (s *Store) ConfirmOutline() (domain.OutlineConfirmation, error) {
	fp, err := s.FoundationFingerprint()
	if err != nil {
		return domain.OutlineConfirmation{}, fmt.Errorf("fingerprint foundation: %w", err)
	}
	conf := domain.OutlineConfirmation{ConfirmedAt: time.Now(), Fingerprint: fp}
	if err := s.Outline.SaveOutlineConfirmation(conf); err != nil {
		return domain.OutlineConfirmation{}, fmt.Errorf("save outline confirmation: %w: %w", errs.ErrStoreWrite, err)
	}
	return conf, nil
}

// FoundationFingerprint 返回当前基础设定工件的内容指纹。Architect 必须把
// novel_context 读到的这个值原样交回审查工具，确保结论针对的是实际落盘版本，
// 而不是会话中尚未保存或已经过期的内容。
func (s *Store) FoundationFingerprint() (string, error) {
	files := []string{"premise.md", "outline.json", "characters.json", "world_rules.json"}
	layered, err := s.Outline.LoadLayeredOutline()
	if err != nil {
		return "", fmt.Errorf("load layered outline: %w", err)
	}
	if len(layered) > 0 {
		files = append(files, "layered_outline.json", "meta/compass.json")
	}

	h := sha256.New()
	for _, rel := range files {
		data, err := os.ReadFile(filepath.Join(s.dir, filepath.FromSlash(rel)))
		if err != nil {
			return "", fmt.Errorf("read %s: %w", rel, err)
		}
		_, _ = h.Write([]byte(rel))
		_, _ = h.Write([]byte{0})
		_, _ = h.Write(data)
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Init 创建所需的子目录结构。
func (s *Store) Init() error {
	if err := s.Checkpoints.InitError(); err != nil {
		return fmt.Errorf("load checkpoints: %w", err)
	}
	return s.Progress.io.EnsureDirs([]string{
		"chapters", "summaries", "drafts", "reviews", "meta", "meta/runtime", "meta/runtime/tasks", "meta/sessions", "meta/sessions/agents",
	})
}

// ── 跨域协调方法 ──

// ExpandArc 将骨架弧校准并展开为详细章节（Outline + Progress 联动）。
func (s *Store) ExpandArc(volumeIdx, arcIdx int, expansion domain.ArcExpansion) error {
	s.crossMu.Lock()
	defer s.crossMu.Unlock()

	s.Outline.io.mu.Lock()
	defer s.Outline.io.mu.Unlock()

	volumes, err := s.Outline.expandArcUnlocked(volumeIdx, arcIdx, expansion)
	if err != nil {
		return err
	}

	s.Progress.io.mu.Lock()
	defer s.Progress.io.mu.Unlock()

	p, err := s.Progress.loadUnlocked()
	if err != nil {
		return err
	}
	if p == nil {
		p = &domain.Progress{}
	}
	p.TotalChapters = domain.EstimatedChapterCapacity(volumes)
	return s.Progress.saveUnlocked(p)
}

// AppendVolume 追加新卷到分层大纲末尾（Outline + Progress 联动）。
func (s *Store) AppendVolume(vol domain.VolumeOutline) error {
	s.crossMu.Lock()
	defer s.crossMu.Unlock()

	s.Outline.io.mu.Lock()
	defer s.Outline.io.mu.Unlock()

	volumes, err := s.Outline.appendVolumeUnlocked(vol)
	if err != nil {
		return err
	}

	s.Progress.io.mu.Lock()
	defer s.Progress.io.mu.Unlock()

	p, err := s.Progress.loadUnlocked()
	if err != nil {
		return err
	}
	if p == nil {
		p = &domain.Progress{}
	}
	p.TotalChapters = domain.EstimatedChapterCapacity(volumes)
	return s.Progress.saveUnlocked(p)
}

// ReviseOutline 从 fromChapter 起替换尚未发生的计划尾段。
// 扁平大纲替换全书尾段；分层大纲只替换目标章所在弧的尾段。这个定义让同一载荷
// 重放仍得到同一结果，同时避免 JSON Patch 和 insert/delete 等操作枚举。
func (s *Store) ReviseOutline(fromChapter int, replacement []domain.OutlineEntry) (int, error) {
	if fromChapter <= 0 {
		return 0, fmt.Errorf("from_chapter must be > 0: %w", errs.ErrToolArgs)
	}

	s.crossMu.Lock()
	defer s.crossMu.Unlock()

	s.Outline.io.mu.Lock()
	defer s.Outline.io.mu.Unlock()
	s.Progress.io.mu.Lock()
	defer s.Progress.io.mu.Unlock()

	p, err := s.Progress.loadUnlocked()
	if err != nil {
		return 0, fmt.Errorf("load progress: %w: %w", errs.ErrStoreRead, err)
	}
	if p == nil {
		return 0, fmt.Errorf("progress 未初始化: %w", errs.ErrToolPrecondition)
	}
	if p.Phase == domain.PhaseComplete {
		return 0, fmt.Errorf("全书已完结，不允许修改大纲: %w", errs.ErrToolPrecondition)
	}
	protected := p.InProgressChapter
	if latest := p.LatestCompleted(); latest > protected {
		protected = latest
	}
	if fromChapter <= protected {
		return 0, fmt.Errorf("第 %d 章已完成或正在写作；大纲修订必须从第 %d 章之后开始: %w",
			fromChapter, protected, errs.ErrToolPrecondition)
	}

	if p.Layered {
		volumes, err := s.Outline.reviseLayeredTailUnlocked(fromChapter, replacement)
		if err != nil {
			return 0, err
		}
		p.TotalChapters = domain.EstimatedChapterCapacity(volumes)
		if err := s.Progress.saveUnlocked(p); err != nil {
			return 0, fmt.Errorf("save progress: %w: %w", errs.ErrStoreWrite, err)
		}
		return p.TotalChapters, nil
	}

	outline, err := s.Outline.reviseFlatTailUnlocked(fromChapter, replacement)
	if err != nil {
		return 0, err
	}
	p.TotalChapters = len(outline)
	if err := s.Progress.saveUnlocked(p); err != nil {
		return 0, fmt.Errorf("save progress: %w: %w", errs.ErrStoreWrite, err)
	}
	return p.TotalChapters, nil
}

// ClearHandledSteer 清除 PendingSteer 并重置旧版 FlowSteering 状态。
// 两个文件无法组成文件系统事务，因此先写可重复的 Progress，最后才删除恢复意图；
// 任一步失败都至少保留 PendingSteer，下一次 Resume 可以安全重放。
func (s *Store) ClearHandledSteer() error {
	s.crossMu.Lock()
	defer s.crossMu.Unlock()

	s.RunMeta.io.mu.Lock()
	defer s.RunMeta.io.mu.Unlock()
	s.Progress.io.mu.Lock()
	defer s.Progress.io.mu.Unlock()

	meta, err := s.RunMeta.loadUnlocked()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	p, err := s.Progress.loadUnlocked()
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if p != nil && p.Flow == domain.FlowSteering {
		if err := domain.ValidateFlowTransition(p.Flow, domain.FlowWriting); err != nil {
			return err
		}
		p.Flow = domain.FlowWriting
		if err := s.Progress.saveUnlocked(p); err != nil {
			return err
		}
	}
	if meta != nil && meta.PendingSteer != "" {
		meta.PendingSteer = ""
		if err := s.RunMeta.saveUnlocked(*meta); err != nil {
			return err
		}
	}
	return nil
}
