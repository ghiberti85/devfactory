/**
 * DevFactory — Postgres → ProjectRun Mapper
 * lib/devfactory/run-mapper.ts
 *
 * As rotas de leitura (GET /api/runs/[runId], stream SSE) consultam o
 * Postgres, que guarda o run em formato relacional (pipeline_runs +
 * stage_outputs + stage_iterations + quality_reports) — bem diferente do
 * shape de ProjectRun (objeto aninhado) que os componentes de UI
 * (HumanGate.tsx, Dashboard.jsx) esperam. Esta função faz a tradução.
 */

import type {
  ProjectRun, PipelineStage, StageRecord, StageIteration,
  QualityReport, RunConfig, RunStatus, ProjectMode,
} from './types'

interface DbStageIterationRow {
  iteration_number: number
  operation: string | null
  tier_used: number | null
  output: unknown
  self_critique: { score?: number; passed?: boolean; issues?: unknown } | null
  status: string | null
  created_at: string
}

interface DbStageOutputRow {
  stage: string
  status: string
  final_output: unknown
  gate_token: string | null
  started_at: string
  completed_at: string | null
  stage_iterations: DbStageIterationRow[] | null
}

interface DbQualityReportRow {
  dimension: string
  score: number
  verdict: string
  issues: unknown
  model_analysis: unknown
}

export interface DbPipelineRunRow {
  id: string
  project_id: string
  user_id: string
  status: string
  current_stage: string | null
  workflow_run_id: string | null
  started_at: string
  completed_at: string | null
  total_cost_usd: number | string | null
  stage_outputs: DbStageOutputRow[] | null
}

export interface DbProjectRow {
  id: string
  name: string
  briefing: string | null
  selector_mode: string | null
  budget_usd: number | string | null
  max_iterations_per_stage: number | null
  project_mode: string | null
  github_owner: string | null
  github_repo: string | null
  github_branch: string | null
  repo_context_summary: string | null
}

const STAGE_STATUS_MAP: Record<string, StageRecord['status']> = {
  pending:        'pending',
  running:        'running',
  awaiting_human: 'awaiting_human',
  approved:       'approved',
  rejected:       'pending', // rejeitado com retry ainda restante volta a rodar
  failed:         'failed',
}

function mapIteration(row: DbStageIterationRow, allQualityReports: QualityReport[]): StageIteration {
  return {
    iterationNumber: row.iteration_number,
    operation:        row.operation ?? '',
    routerOutput: {
      tier:       (row.tier_used as 1 | 2 | 3) ?? 1,
      confidence: 1,
      dimensions: {
        ambiguity:   { score: 0.5, rationale: '' },
        criticality: { score: 0.5, rationale: '' },
        novelty:     { score: 0.5, rationale: '' },
      },
      reason:         '',
      escalationHint: null,
    },
    agentOutput: allQualityReports.length > 0 ? allQualityReports : row.output,
    selfCritique: {
      score:  row.self_critique?.score ?? 0,
      passed: row.self_critique?.passed ?? false,
      issues: Array.isArray(row.self_critique?.issues) ? (row.self_critique!.issues as StageIteration['selfCritique']['issues']) : [],
    },
    startedAt:   row.created_at,
    completedAt: row.created_at,
  }
}

export function mapDbRunToProjectRun(
  run: DbPipelineRunRow,
  project: DbProjectRow,
  qualityReportRows: DbQualityReportRow[] = [],
): ProjectRun {
  const qualityReports: QualityReport[] = qualityReportRows.map(r => ({
    dimension: r.dimension as QualityReport['dimension'],
    score:     r.score,
    verdict:   r.verdict as QualityReport['verdict'],
    issues:    Array.isArray(r.issues) ? (r.issues as QualityReport['issues']) : [],
    model:     typeof r.model_analysis === 'string' ? r.model_analysis : '',
  }))

  const stages: Partial<Record<PipelineStage, StageRecord>> = {}
  for (const so of run.stage_outputs ?? []) {
    const stage = so.stage as PipelineStage
    const iterations = [...(so.stage_iterations ?? [])]
      .sort((a, b) => a.iteration_number - b.iteration_number)
      .map(it => mapIteration(it, stage === 'quality_council' ? qualityReports : []))

    stages[stage] = {
      stage,
      status:      STAGE_STATUS_MAP[so.status] ?? 'pending',
      iterations,
      finalOutput: so.final_output ?? undefined,
      startedAt:   so.started_at,
      completedAt: so.completed_at ?? undefined,
      costUsd:     0, // custo só é somado no total do run (pipeline_runs.total_cost_usd)
      gateToken:   so.gate_token ?? undefined,
    }
  }

  const config: RunConfig = {
    maxIterationsPerStage: project.max_iterations_per_stage ?? 3,
    selfCritiqueThreshold: 0.7,
    selectorMode:          (project.selector_mode as RunConfig['selectorMode']) ?? 'auto',
    preferFreeTier:        true,
    budgetUsd:             project.budget_usd != null ? Number(project.budget_usd) : undefined,
    projectMode:           (project.project_mode as ProjectMode) ?? 'greenfield',
  }

  return {
    id:             run.id,
    userId:         run.user_id,
    projectId:      run.project_id,
    projectName:    project.name,
    briefing:       project.briefing ?? '',
    status:         run.status as RunStatus,
    stages,
    currentStage:   (run.current_stage as PipelineStage) ?? null,
    qualityReports,
    totalCostUsd:   Number(run.total_cost_usd ?? 0),
    startedAt:      run.started_at,
    completedAt:    run.completed_at ?? undefined,
    config,
    githubRepo: project.github_owner && project.github_repo
      ? { owner: project.github_owner, repo: project.github_repo, branch: project.github_branch ?? undefined }
      : undefined,
    repoContextSummary: project.repo_context_summary ?? undefined,
    userProviders: [],
  }
}
