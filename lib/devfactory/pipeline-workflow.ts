/**
 * DevFactory — Pipeline Workflow (Vercel Workflow SDK)
 * lib/devfactory/pipeline-workflow.ts
 *
 * Substitui o orchestrator.ts original (XState + Map em memória). A pipeline
 * inteira agora é uma função durável: sobrevive a deploys, crashes, e pausas
 * de dias/meses esperando aprovação humana — sem nós termos que desenhar
 * persistência, retry ou observabilidade na mão.
 *
 * Conceitos do Workflow SDK usados aqui:
 *   "use workflow"  → função durável, com replay determinístico
 *   "use step"      → unidade cacheada/retentável (toda chamada de IO vive aqui)
 *   defineHook()    → pausa o workflow esperando um evento externo (gate humano)
 *   sleep()         → pausa por tempo, sem custo de compute enquanto espera
 *
 * IMPORTANTE — segurança: workflows persistem automaticamente o input/output
 * de cada step num event log. Por isso, NUNCA passamos API keys decifradas
 * como dado do workflow — cada step de execução de agente resolve a key na
 * hora, a partir de userId, via getUserKeyring() (run-registry.ts).
 */

import { defineHook, FatalError } from 'workflow'
import { z } from 'zod'

import {
  getPipelineStages,
  type ProjectRun,
  type PipelineStage,
  type StageRecord,
  type StageIteration,
  type SelfCritique,
  type QualityReport,
  type HumanGateDecision,
} from './types'

import { createSelector, DEFAULT_MODELS, type Tier, type Stage as SelectorStage } from './model-selector'
import { createRouter, type RouterProvider } from './complexity-router'
import { createAgentRunner, resolveProviderConfig, type AgentProvider } from './agent-runner'
import { getUserKeyring } from './run-registry'
import { runQualityCheckInSandbox, type QualityDimension as SandboxDimension, type GeneratedFile } from './sandbox-runner'
import { createSupabaseServiceClient } from './supabase'

// ─── Hook: gate humano ──────────────────────────────────────────────────────
// Um único hook reutilizável; o token muda por run+etapa+iteração, então
// múltiplos gates do mesmo run nunca colidem.

export const humanGateHook = defineHook({
  schema: z.object({
    decision:      z.enum(['approved', 'rejected', 'edited']),
    feedback:      z.string().optional(),
    editedOutput:  z.unknown().optional(),
  }),
})

function gateToken(runId: string, stage: PipelineStage, iteration: number): string {
  return `devfactory:${runId}:${stage}:${iteration}`
}

// ─── Prompts por etapa (mesmo conteúdo do orchestrator.ts original) ─────────

const STAGE_OPERATIONS: Record<PipelineStage, string> = {
  codebase_analysis: 'Analisar o repositório conectado: stack, convenções, cobertura de docs e oportunidades de melhoria',
  planning:        'Gerar PRD completo com escopo, requisitos, riscos e estimativas',
  docs_initial:    'Gerar especificação técnica, contratos de API e ADRs',
  design:          'Gerar design tokens, wireframes em JSX e guia de componentes',
  backend:         'Implementar APIs, regras de negócio e schema de banco',
  frontend:        'Implementar componentes, páginas e integração com APIs',
  tests:           'Gerar testes unit, integration e E2E com Playwright',
  quality_council: 'Analisar segurança, performance, SEO, acessibilidade e boas práticas',
  docs_final:      'Atualizar README, changelog e documentação arquitetural',
}

const STAGE_DEFAULT_TIER: Record<PipelineStage, Tier> = {
  codebase_analysis: 2,
  planning:          3,
  docs_initial:      2,
  design:            2,
  backend:           2,
  frontend:          2,
  tests:             1,
  quality_council:   2,
  docs_final:        1,
}

const STAGE_SYSTEM_PROMPTS: Record<PipelineStage, string> = {
  codebase_analysis: `Você é um Staff Engineer fazendo code review de onboarding num repositório existente.
Produza um JSON com: stack_summary, existing_conventions, documentation_coverage, improvement_opportunities[]
({ area, description, impact, effort }), risks_of_changes. Não invente nada fora do contexto fornecido.
Responda APENAS em JSON.`,
  planning: `Você é um Tech Lead sênior. Se houver Repo Context, evolua o que já existe em vez de propor reescrita.
Gere um PRD em JSON: summary, goals, requirements[], risks[], milestones[], tech_stack. Responda APENAS em JSON.`,
  docs_initial: `Você é um Architect. Gere especificação técnica em JSON: api_contracts[], db_schema, adr[], type_definitions.
Responda APENAS em JSON.`,
  design: `Você é um Design Engineer. Gere em JSON: design_tokens, components[], wireframes[]. Responda APENAS em JSON.`,
  backend: `Você é um Backend Engineer sênior. Implemente seguindo SOLID, validação de input, tratamento de erros.
Retorne JSON: files[] (path, content), migration?, env_vars[].`,
  frontend: `Você é um Frontend Engineer sênior. Implemente com acessibilidade (ARIA), responsividade, performance.
Retorne JSON: files[] (path, content), stories[].`,
  tests: `Você é um QA Engineer. Gere testes cobrindo happy path, edge cases, erros.
Retorne JSON: unit_tests[], integration_tests[], e2e_tests[].`,
  quality_council: `Você é um Quality Analyst. Analise o artefato e retorne JSON com issues[] por dimensão.`,
  docs_final: `Você é um Technical Writer. Retorne JSON: readme (markdown), changelog[], architecture_decisions[].`,
}

// ─── Input do workflow (o que entra via start()) ────────────────────────────

export interface PipelineWorkflowInput {
  run: ProjectRun  // já criado via createProjectRun() na API route, ANTES do start()
}

// ─── Workflow principal ─────────────────────────────────────────────────────

export async function runDevFactoryPipeline(input: PipelineWorkflowInput): Promise<ProjectRun> {
  'use workflow'

  let run: ProjectRun = { ...input.run, status: 'running' }
  const stages = getPipelineStages(run.config.projectMode)

  for (const stage of stages) {
    run = await runStageWithGate(run, stage)

    if (run.status === 'failed' || run.status === 'cancelled') {
      return run
    }
  }

  run.status = 'completed'
  run.completedAt = new Date().toISOString()
  return run
}

// ─── Loop de uma etapa: executa → auto-critica → escala → gate humano ───────
// NÃO tem "use step" — precisa criar hooks, e hooks só existem em nível de
// workflow (não dentro de steps).

async function runStageWithGate(run: ProjectRun, stage: PipelineStage): Promise<ProjectRun> {
  let iteration = 0
  let tier: Tier = STAGE_DEFAULT_TIER[stage]
  let lastIterationRecord: StageIteration | null = null

  run = initStage(run, stage)
  await persistStageStartedStep(run.id, stage)

  while (iteration < run.config.maxIterationsPerStage) {
    iteration++

    let stepResult: StageStepResult
    try {
      stepResult = stage === 'quality_council'
        ? await runQualityCouncilStep(run)
        : await runSingleStageStep(run, stage, tier, lastIterationRecord?.agentOutput)
    } catch (err) {
      // FatalError (ex: nenhum modelo disponível) mata o workflow, mas sem
      // isto o Postgres nunca saberia — a run.status ficava presa em
      // "running" pra sempre e a UI continuava girando indefinidamente.
      const message = err instanceof Error ? err.message : 'Erro desconhecido na etapa.'
      await persistStageFailedStep(run.id, stage, message)
      throw err
    }

    lastIterationRecord = stepResult.iteration
    run = appendIteration(run, stage, stepResult.iteration)

    if (stage === 'quality_council') {
      run = { ...run, qualityReports: stepResult.qualityReports ?? [] }
    }

    await persistIterationStep(run.id, stage, stepResult, run.totalCostUsd)

    if (stepResult.iteration.selfCritique.passed) break
    tier = Math.min((tier + 1) as Tier, 3) as Tier  // progressive escalation
  }

  // ── Gate humano — pausa o workflow, custo zero de compute enquanto espera ──
  const token = gateToken(run.id, stage, iteration)
  using hook = humanGateHook.create({ token })

  run = {
    ...run,
    status: 'awaiting_human',
    stages: { ...run.stages, [stage]: { ...run.stages[stage]!, status: 'awaiting_human', gateToken: token } },
  }

  await persistAwaitingHumanStep(run.id, stage, token)  // "use step" — grava no Postgres p/ histórico/observabilidade

  const rawDecision = await hook  // <<< suspende aqui, de minutos a meses

  // O hook resolve com o payload cru do POST /gate (schema Zod, sem decidedAt).
  // decidedAt é carimbado aqui, no momento real em que a decisão chegou —
  // não no momento em que o gate foi criado.
  const decision: HumanGateDecision = { ...rawDecision, decidedAt: new Date().toISOString() }

  const finalOutput = decision.editedOutput ?? lastIterationRecord?.agentOutput
  await persistGateDecisionStep(run.id, stage, decision, finalOutput)  // "use step"

  if (decision.decision === 'rejected') {
    if (iteration < run.config.maxIterationsPerStage) {
      run = rejectStage(run, stage, decision)
      return runStageWithGate(run, stage)  // retry com feedback injetado
    }
    run.status = 'failed'
    return run
  }

  return approveStage(run, stage, decision)
}

// ─── Step: uma operação completa (router → selector → agent → critique) ────

interface StageStepResult {
  iteration:      StageIteration
  qualityReports?: QualityReport[]
}

async function runSingleStageStep(
  run:       ProjectRun,
  stage:     PipelineStage,
  tier:      Tier,
  previousOutput: unknown,
): Promise<StageStepResult> {
  'use step'

  const operation = STAGE_OPERATIONS[stage]

  const router = createRouter({
    provider:            (process.env.ROUTER_PROVIDER as RouterProvider | undefined) ?? 'google',
    apiKey:              process.env.PLATFORM_GOOGLE_FREE_TIER_KEY ?? '',
    modelId:             process.env.ROUTER_MODEL ?? 'gemini-flash-lite-latest',
    fallbackToHeuristic: true,
  })

  const routerOutput = await router.route({
    stage:    stage as SelectorStage,
    operation,
    spec:     run.repoContextSummary
      ? `${run.briefing}\n\n${run.repoContextSummary.slice(0, 1500)}`
      : run.briefing,
  })

  const selector = createSelector([])
  let selection
  try {
    selection = selector.select({
      stage:          stage as SelectorStage,
      operation,
      tier:           Math.max(tier, routerOutput.tier) as Tier,
      preferFreeTier: run.config.preferFreeTier,
      userProviders:  run.userProviders as AgentProvider[],
    })
  } catch (err) {
    // Sem candidato disponível (ex: tier exige modelo pago e o usuário não
    // configurou key) — retry não resolveria nada, então é FatalError, não
    // RetryableError. O workflow para aqui em vez de tentar 3x à toa.
    throw new FatalError(err instanceof Error ? err.message : 'Nenhum modelo disponível para esta operação.')
  }

  // Resolve a key NA HORA — nunca persistida no workflow
  const { keyring } = await getUserKeyring(run.userId)
  const isPlatformFree = selection.model.hasFreeTier || selection.model.isLocal
  const { apiKey, baseUrl } = isPlatformFree
    ? { apiKey: process.env[`PLATFORM_${selection.model.provider.toUpperCase()}_FREE_TIER_KEY`] ?? '', baseUrl: undefined }
    : resolveProviderConfig(selection.model.provider as AgentProvider, keyring)

  const runner = createAgentRunner()
  const result = await runner.run({
    stage,
    operation,
    modelId:      selection.model.modelId,
    provider:     selection.model.provider as AgentProvider,
    apiKey,
    baseUrl,
    systemPrompt: buildSystemPrompt(stage, run),
    userPrompt:   buildUserPrompt(stage, run, previousOutput),
    previousOutputs: previousOutput ? [previousOutput] : [],
    maxTokens:    8192,
    temperature:  0.2,
  })

  // Auto-crítica — modelo barato avalia o output do modelo principal
  const critiqueModel = DEFAULT_MODELS.find(m => m.id === 'gemini-flash-lite')!
  const critiqueResult = await runner.run({
    stage,
    operation: 'self_critique',
    modelId:      critiqueModel.modelId,
    provider:     critiqueModel.provider as AgentProvider,
    apiKey:       process.env.PLATFORM_GOOGLE_FREE_TIER_KEY ?? '',
    systemPrompt: 'Avalie o output a seguir. Responda JSON: { "score": 0-1, "passed": bool, "issues": [], "summary": "" }',
    userPrompt:   JSON.stringify(result.output).slice(0, 3000),
    previousOutputs: [],
    maxTokens:    512,
    temperature:  0.1,
  })

  const critiqueRaw = critiqueResult.output as {
    score?:  number
    passed?: boolean
    issues?: SelfCritique['issues']
  } | null
  const selfCritique: SelfCritique = {
    score:  typeof critiqueRaw?.score === 'number' ? critiqueRaw.score : 0.5,
    passed: critiqueRaw?.passed ?? (critiqueRaw?.score ?? 0.5) >= run.config.selfCritiqueThreshold,
    issues: Array.isArray(critiqueRaw?.issues) ? critiqueRaw.issues : [],
  }

  return {
    iteration: {
      iterationNumber: (run.stages[stage]?.iterations.length ?? 0) + 1,
      operation,
      routerOutput,
      selectionResult: selection,
      agentOutput:  result.output,
      selfCritique,
      startedAt:    new Date().toISOString(),
      completedAt:  new Date().toISOString(),
    },
  }
}

// ─── Step: Quality Council — 5 dimensões em paralelo, com Vercel Sandbox ────

async function runQualityCouncilStep(run: ProjectRun): Promise<StageStepResult> {
  'use step'

  const dimensions: SandboxDimension[] = ['security', 'performance', 'seo', 'a11y', 'best_practices']

  const backendFiles = (run.stages.backend?.finalOutput as { files?: GeneratedFile[] } | null)?.files ?? []
  const frontendFiles = (run.stages.frontend?.finalOutput as { files?: GeneratedFile[] } | null)?.files ?? []
  const allFiles = [...backendFiles, ...frontendFiles]

  // Promise.all dentro de um único step — todas as 5 análises persistem
  // como parte do mesmo step no event log do workflow
  const reports = await Promise.all(
    dimensions.map(dim => runQualityCheckInSandbox(dim, allFiles)),
  )

  const verdicts = reports.map(r => r.verdict)
  const overallPassed = !verdicts.includes('fail')

  // Quality Council não passa pelo Complexity Router (tier fixo por
  // dimensão, ver DIMENSION_TOOLING em sandbox-runner.ts) — as 3 dimensões
  // do RouterOutput não se aplicam individualmente aqui.
  const notApplicable = { score: 0.5, rationale: 'Quality Council usa tier fixo por dimensão — não passa pelo Complexity Router.' }

  return {
    iteration: {
      iterationNumber: (run.stages.quality_council?.iterations.length ?? 0) + 1,
      operation:    STAGE_OPERATIONS.quality_council,
      routerOutput: {
        tier: 2,
        confidence: 1,
        dimensions: { ambiguity: notApplicable, criticality: notApplicable, novelty: notApplicable },
        reason: 'Quality Council — tier fixo por dimensão',
        escalationHint: null,
      },
      // selectionResult fica ausente — não há um único modelo, cada
      // dimensão usa sua própria ferramenta (já registrado em `reports`).
      agentOutput:  reports,
      selfCritique: { score: overallPassed ? 1 : 0.4, passed: overallPassed, issues: [] },
      startedAt:    new Date().toISOString(),
      completedAt:  new Date().toISOString(),
    },
    qualityReports: reports,
  }
}

// Nota: a busca do RepoContext acontece na API route (app/api/runs/route.ts),
// ANTES de start() — não dentro do workflow. Isso mantém o token do GitHub
// fora do event log do workflow e simplifica o replay determinístico.
// O run.repoContextSummary já chega pronto no input; a etapa 'codebase_analysis'
// só roda o agente de análise em cima dele, como qualquer outra etapa.

// ─── Steps de persistência (gravam estado no Postgres p/ o Dashboard/UI) ───

async function persistStageStartedStep(runId: string, stage: PipelineStage): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()

  await supabase.from('pipeline_runs').update({
    status: 'running',
    current_stage: stage,
  }).eq('id', runId)

  await supabase.from('stage_outputs').upsert({
    run_id: runId,
    stage,
    status: 'running',
  }, { onConflict: 'run_id,stage', ignoreDuplicates: false })
}

async function persistStageFailedStep(runId: string, stage: PipelineStage, message: string): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()

  await supabase.from('pipeline_runs').update({
    status: 'failed',
    completed_at: new Date().toISOString(),
  }).eq('id', runId)

  await supabase.from('stage_outputs').update({
    status: 'failed',
    final_output: { error: message },
  }).eq('run_id', runId).eq('stage', stage)
}

async function persistIterationStep(
  runId: string,
  stage: PipelineStage,
  stepResult: StageStepResult,
  runTotalCostUsd: number,
): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()

  const { data: stageOutput } = await supabase
    .from('stage_outputs')
    .select('id')
    .eq('run_id', runId)
    .eq('stage', stage)
    .single()

  if (!stageOutput) return

  const iteration = stepResult.iteration
  await supabase.from('stage_iterations').insert({
    stage_output_id:  stageOutput.id,
    iteration_number: iteration.iterationNumber,
    operation:        iteration.operation,
    model_id:         null, // model_id é FK para o catálogo (models.id) — a seleção guarda modelId/provider como string, não o uuid do catálogo
    tier_used:        iteration.routerOutput.tier,
    prompt:           null, // prompts não são persistidos (podem conter contexto sensível do briefing) — só input/output relevantes
    output:           iteration.agentOutput,
    self_critique:    iteration.selfCritique,
    status:           iteration.selfCritique.passed ? 'passed' : 'retrying',
  })

  await supabase.from('stage_outputs').update({
    iteration_count: iteration.iterationNumber,
  }).eq('id', stageOutput.id)

  if (stage === 'quality_council' && stepResult.qualityReports) {
    await supabase.from('quality_reports').insert(
      stepResult.qualityReports.map(r => ({
        stage_output_id: stageOutput.id,
        dimension:       r.dimension,
        tool_used:       r.model,
        model_analysis:  r.model,
        score:           r.score,
        issues:          r.issues,
        verdict:         r.verdict,
      })),
    )
  }

  await supabase.from('pipeline_runs').update({ total_cost_usd: runTotalCostUsd }).eq('id', runId)
}

async function persistAwaitingHumanStep(runId: string, stage: PipelineStage, token: string): Promise<void> {
  'use step'
  // Roda dentro de um step do Workflow SDK — sem cookies de sessão HTTP
  // disponíveis, por isso usa o client service_role (ver comentário no topo
  // de supabase.ts). Escopado por PK (id do run), não por user_id.
  const supabase = createSupabaseServiceClient()

  await supabase.from('pipeline_runs').update({
    status: 'awaiting_human',
    current_stage: stage,
  }).eq('id', runId)

  await supabase.from('stage_outputs').upsert({
    run_id: runId,
    stage,
    status: 'awaiting_human',
    gate_token: token,
  }, { onConflict: 'run_id,stage' })
}

async function persistGateDecisionStep(
  runId: string,
  stage: PipelineStage,
  decision: HumanGateDecision,
  finalOutput: unknown,
): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()

  const { data: stageOutput } = await supabase
    .from('stage_outputs')
    .select('id')
    .eq('run_id', runId)
    .eq('stage', stage)
    .single()

  if (stageOutput) {
    await supabase.from('human_gates').insert({
      stage_output_id: stageOutput.id,
      decision: decision.decision,
      feedback: decision.feedback,
      edited_output: decision.editedOutput,
    })
    await supabase.from('stage_outputs').update({
      status:       decision.decision === 'rejected' ? 'rejected' : 'approved',
      final_output: decision.decision === 'rejected' ? null : finalOutput,
      completed_at: decision.decision === 'rejected' ? null : new Date().toISOString(),
    }).eq('id', stageOutput.id)
  }
}

// ─── Reducers puros (mesma disciplina do orchestrator.ts original) ─────────

function initStage(run: ProjectRun, stage: PipelineStage): ProjectRun {
  return {
    ...run,
    currentStage: stage,
    stages: {
      ...run.stages,
      [stage]: {
        stage, status: 'running', iterations: [], costUsd: 0,
        startedAt: new Date().toISOString(),
      } satisfies StageRecord,
    },
  }
}

function appendIteration(run: ProjectRun, stage: PipelineStage, iteration: StageIteration): ProjectRun {
  const current = run.stages[stage]!
  const cost = iteration.selectionResult?.estimatedCostUsd ?? 0
  return {
    ...run,
    totalCostUsd: run.totalCostUsd + cost,
    stages: {
      ...run.stages,
      [stage]: { ...current, iterations: [...current.iterations, iteration], costUsd: current.costUsd + cost },
    },
  }
}

function approveStage(run: ProjectRun, stage: PipelineStage, decision: HumanGateDecision): ProjectRun {
  const current = run.stages[stage]!
  const lastIteration = current.iterations.at(-1)
  const output = decision.editedOutput ?? lastIteration?.agentOutput
  return {
    ...run,
    stages: {
      ...run.stages,
      [stage]: { ...current, status: 'approved', humanGate: decision, finalOutput: output, completedAt: new Date().toISOString() },
    },
  }
}

function rejectStage(run: ProjectRun, stage: PipelineStage, decision: HumanGateDecision): ProjectRun {
  const current = run.stages[stage]!
  return { ...run, stages: { ...run.stages, [stage]: { ...current, humanGate: decision } } }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(stage: PipelineStage, run: ProjectRun): string {
  let prompt = STAGE_SYSTEM_PROMPTS[stage]
  const lastGate = run.stages[stage]?.humanGate
  if (lastGate?.decision === 'rejected' && lastGate.feedback) {
    prompt += `\n\nFEEDBACK DA ITERAÇÃO ANTERIOR (OBRIGATÓRIO INCORPORAR):\n${lastGate.feedback}`
  }
  return prompt
}

function buildUserPrompt(stage: PipelineStage, run: ProjectRun, previousOutput: unknown): string {
  const parts = [
    `## Projeto: ${run.projectName}`,
    `## Briefing:\n${run.briefing || '(sem briefing — ver Repo Context abaixo)'}`,
  ]

  if (run.repoContextSummary) {
    parts.push(`## Repo Context:\n${run.repoContextSummary.slice(0, 6000)}`)
  }

  const stages = getPipelineStages(run.config.projectMode)
  const idx = stages.indexOf(stage)
  stages.slice(0, idx).forEach(s => {
    const out = run.stages[s]?.finalOutput
    if (out) parts.push(`## Output de ${s}:\n${JSON.stringify(out).slice(0, 1500)}`)
  })

  if (previousOutput) {
    parts.push(`## Tentativa anterior (melhorar):\n${JSON.stringify(previousOutput).slice(0, 800)}`)
  }

  return parts.join('\n\n')
}
