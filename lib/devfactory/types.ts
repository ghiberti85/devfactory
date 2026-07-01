/**
 * DevFactory — Domain Types
 * lib/devfactory/types.ts
 *
 * Tipos de domínio puros, sem dependência de runtime (nem XState, nem
 * Workflow SDK). Extraídos do orchestrator.ts original para que tanto o
 * novo pipeline-workflow.ts quanto qualquer código de UI/persistência
 * compartilhem a mesma forma de dados sem acoplar a um motor específico.
 */

import type { Stage, Tier, SelectionResult } from './model-selector'
import type { RouterOutput }                  from './complexity-router'

// ─── Etapas da pipeline ─────────────────────────────────────────────────────

export type PipelineStage =
  | 'codebase_analysis'  // só roda em modo 'brownfield' — repo GitHub existente
  | 'planning'
  | 'docs_initial'
  | 'design'
  | 'backend'
  | 'frontend'
  | 'tests'
  | 'quality_council'
  | 'docs_final'

export type ProjectMode = 'greenfield' | 'brownfield'

export const PIPELINE_STAGES_GREENFIELD: PipelineStage[] = [
  'planning',
  'docs_initial',
  'design',
  'backend',
  'frontend',
  'tests',
  'quality_council',
  'docs_final',
]

export const PIPELINE_STAGES_BROWNFIELD: PipelineStage[] = [
  'codebase_analysis',
  ...PIPELINE_STAGES_GREENFIELD,
]

export function getPipelineStages(mode: ProjectMode): PipelineStage[] {
  return mode === 'brownfield' ? PIPELINE_STAGES_BROWNFIELD : PIPELINE_STAGES_GREENFIELD
}

// ─── Gate humano ────────────────────────────────────────────────────────────

export type HumanDecision = 'approved' | 'rejected' | 'edited'

export interface HumanGateDecision {
  decision:     HumanDecision
  feedback?:    string
  editedOutput?: unknown
  decidedAt:    string  // ISO — serializável pelo Workflow SDK
}

// ─── Iteração / auto-crítica ────────────────────────────────────────────────

export interface StageIteration {
  iterationNumber: number
  operation:       string
  routerOutput:    RouterOutput
  selectionResult: SelectionResult
  agentOutput:     unknown
  selfCritique:    SelfCritique
  startedAt:       string
  completedAt?:    string
}

export interface SelfCritique {
  score:   number          // 0.0 – 1.0
  issues:  CritiqueIssue[]
  passed:  boolean
}

export interface CritiqueIssue {
  severity:  'low' | 'medium' | 'high'
  message:   string
  location?: string
}

export interface StageRecord {
  stage:        PipelineStage
  status:       'pending' | 'running' | 'awaiting_human' | 'approved' | 'failed'
  iterations:   StageIteration[]
  humanGate?:   HumanGateDecision
  finalOutput?: unknown
  startedAt?:   string
  completedAt?: string
  costUsd:      number
  gateToken?:   string  // token do hook ativo — o front reenvia isso em POST .../gate
}

export interface QualityReport {
  dimension: 'security' | 'performance' | 'seo' | 'a11y' | 'best_practices'
  score:     number      // 0-100
  verdict:   'pass' | 'warn' | 'fail'
  issues:    CritiqueIssue[]
  model:     string
}

// ─── Run completo ───────────────────────────────────────────────────────────

export type RunStatus =
  | 'idle'
  | 'running'
  | 'awaiting_human'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RunConfig {
  maxIterationsPerStage: number
  selfCritiqueThreshold: number
  selectorMode:          'auto' | 'auto_override' | 'manual'
  preferFreeTier:        boolean
  excludeOrigins?:       string[]
  budgetUsd?:            number
  projectMode:           ProjectMode
}

export interface ProjectRun {
  id:             string
  userId:         string  // necessário aqui agora — o Workflow não tem "request scope" próprio
  projectId:      string
  projectName:    string
  briefing:       string
  status:         RunStatus
  stages:         Partial<Record<PipelineStage, StageRecord>>
  currentStage:   PipelineStage | null
  qualityReports: QualityReport[]
  totalCostUsd:   number
  startedAt:      string
  completedAt?:   string
  config:         RunConfig

  githubRepo?:         { owner: string; repo: string; branch?: string }
  repoContextSummary?: string

  // BYOK — resolvido UMA VEZ ao iniciar o run e congelado no input do
  // workflow. Workflows são deterministicamente re-executados (replay) em
  // retries, então não podem fazer I/O fora de "use step" — o keyring do
  // usuário é resolvido na API route antes de start() e passado como dado.
  userProviders: string[]
}

// ─── Eventos de stream (consumidos pelo HumanGate via /api/runs/[id]/stream) ─

export interface SSEEvent {
  type:      string
  runId?:    string
  stage?:    PipelineStage
  payload:   unknown
  timestamp: string | Date
}

export function createProjectRun(params: {
  id:           string
  userId:       string
  projectId:    string
  projectName:  string
  briefing:     string
  config?:      Partial<RunConfig>
  githubRepo?:  { owner: string; repo: string; branch?: string }
  repoContextSummary?: string
  userProviders: string[]
}): ProjectRun {
  return {
    id:             params.id,
    userId:         params.userId,
    projectId:      params.projectId,
    projectName:    params.projectName,
    briefing:       params.briefing,
    status:         'idle',
    stages:         {},
    currentStage:   null,
    qualityReports: [],
    totalCostUsd:   0,
    startedAt:      new Date().toISOString(),
    githubRepo:         params.githubRepo,
    repoContextSummary: params.repoContextSummary,
    userProviders:      params.userProviders,
    config: {
      maxIterationsPerStage: params.config?.maxIterationsPerStage ?? 3,
      selfCritiqueThreshold: params.config?.selfCritiqueThreshold ?? 0.70,
      selectorMode:          params.config?.selectorMode          ?? 'auto',
      preferFreeTier:        params.config?.preferFreeTier        ?? false,
      excludeOrigins:        params.config?.excludeOrigins,
      budgetUsd:             params.config?.budgetUsd,
      projectMode:           params.githubRepo ? 'brownfield' : (params.config?.projectMode ?? 'greenfield'),
    },
  }
}
