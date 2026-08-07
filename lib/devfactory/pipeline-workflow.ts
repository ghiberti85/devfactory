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
import { getUserKeyring, getUserGithubToken } from './run-registry'
import { runQualityCheckInSandbox, type QualityDimension as SandboxDimension, type GeneratedFile } from './sandbox-runner'
import { createSupabaseServiceClient } from './supabase'
import { classifyDeployTarget } from './deploy-target'
import { commitFiles } from './github-connector'
import { ensureNextScaffold } from './next-scaffold'

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

// Erros propagados de dentro de um "use step" podem chegar como objeto
// serializado em vez de instância real de Error — extrai a mensagem em
// qualquer um dos formatos plausíveis em vez de assumir só `instanceof Error`.
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  try {
    return JSON.stringify(err)
  } catch {
    return 'Erro desconhecido na etapa (não foi possível serializar o motivo).'
  }
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
  design: `Você é um Product Designer sênior de uma agência premiada, especialista em interfaces modernas
(o nível visual de produtos como Linear, Stripe, Vercel — nunca o de um wireframe cru ou um template
genérico de bootstrap). Pense em hierarquia visual, contraste, espaço em branco e personalidade de marca
antes de listar tokens soltos.

Gere em JSON:
- design_tokens: paleta de cores COMPLETA e coesa (primary/secondary/accent, neutros em pelo menos 5 tons de
  cinza, success/warning/error) em hex; escala tipográfica (font family — escolha algo melhor que a fonte
  padrão do sistema, tamanhos de display/h1-h6/body/caption); escala de espaçamento (4/8/12/16/24/32/48/64px);
  border-radius (sm/md/lg/full); sombras (sm/md/lg, sutis, nunca "box-shadow: 5px 5px black").
- components[]: cada componente descreve estados visuais (default/hover/focus/disabled), não só a estrutura.
- wireframes[]: descreva a composição de cada tela pensando em hierarquia (o que o olho vê primeiro), não
  uma lista plana de elementos.

Responda APENAS em JSON.`,
  backend: `Você é um Backend Engineer sênior. Implemente seguindo SOLID, validação de input, tratamento de erros.
Retorne JSON: files[] (path, content), migration?, env_vars[].`,
  frontend: `Você é um Frontend Engineer sênior especializado em UI polida — o nível de acabamento de produtos
como Linear, Stripe ou Vercel, nunca HTML cru com estilo mínimo. Implemente com acessibilidade (ARIA),
responsividade (mobile-first, breakpoints sm/md/lg/xl), performance, e OBRIGATORIAMENTE com Tailwind CSS
(className com classes utilitárias — o projeto já vem com Tailwind configurado, nunca escreva CSS-in-JS
nem <style> inline como estilização principal).

Use os design_tokens da etapa "design" de verdade, não só como referência solta: cores, tipografia,
espaçamento e raio de borda do output anterior viram as classes Tailwind reais (bg-[cor], text-[tamanho],
rounded-[raio], gap-[espaçamento]...). Toda tela precisa de: hierarquia visual clara (um elemento principal
de destaque, não tudo do mesmo tamanho), espaçamento generoso e consistente (nunca elementos colados uns nos
outros), estados de hover/focus/transição em elementos interativos, e pelo menos uma seção com contraste
visual (gradiente sutil, cor de fundo diferente, ou imagem/ilustração) — uma landing page ou app inteiro com
fundo branco/cinza uniforme do topo ao fim parece inacabado.

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
      await persistRunFinishedStep(run.id, run.status)
      return run
    }

    // Calculado assim que docs_initial aprova — backend/frontend (próximas
    // etapas) precisam saber disso pra decidir como empacotar o código
    // (ver buildSystemPrompt). Deterministico, não passa pelo LLM.
    if (stage === 'docs_initial') {
      const specText = JSON.stringify(run.stages.docs_initial?.finalOutput ?? '')
      const classification = classifyDeployTarget(specText)
      run = { ...run, deployTarget: classification.target, deployTargetReason: classification.reason }
      await persistDeployTargetStep(run.id, classification.target, classification.reason)
    }
  }

  run.status = 'completed'
  run.completedAt = new Date().toISOString()
  await persistRunFinishedStep(run.id, 'completed')
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
      //
      // Erros que atravessam a fronteira de um "use step" nem sempre chegam
      // aqui como instância real de Error — o Workflow SDK pode serializar
      // como objeto plano ({ name, message, stack }) ao propagar do step pro
      // workflow. err instanceof Error sozinho perdia a mensagem real (ex:
      // "google 429: quota exceeded...") e caía no fallback genérico.
      const message = extractErrorMessage(err)
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

  // Opção B do fluxo de conexão GitHub (ver NewProjectForm): quando o
  // usuário escolhe conectar o repositório desde o início em vez de só na
  // hora de publicar, cada etapa aprovada vira um commit — o histórico do
  // repo conta a evolução real da pipeline (PRD, spec, design, código).
  //
  // IMPORTANTE: usa publishRepo, NUNCA githubRepo — githubRepo é o repo de
  // CONTEXTO do modo brownfield (só leitura, pro usuário existente); commitar
  // nele automaticamente seria escrever sem permissão no repo de produção de
  // alguém. publishRepo só existe quando o usuário explicitamente escolheu
  // "conectar desde já" num projeto greenfield (ver app/api/runs/route.ts).
  if (run.publishRepo) {
    await persistStageCommitStep(run.userId, run.publishRepo, stage, finalOutput, run.deployTarget)
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
  const { keyring } = await getUserKeyring(run.userId)
  const runner = createAgentRunner()

  // Etapas de código (backend/frontend/tests) geram vários arquivos por
  // resposta — 8192 tokens é fácil de estourar, e uma resposta cortada no
  // meio de um JSON falha o parse (ver extractJSON em agent-runner.ts).
  // Tiers mais altos tendem a suportar (e o Router só escala pra eles
  // quando a etapa já falhou uma vez) janelas de output maiores.
  const isCodeStage = stage === 'backend' || stage === 'frontend' || stage === 'tests'
  const maxTokens = isCodeStage && tier > 1 ? 16000 : 8192

  // Fallback de provider em rate limit (429): retentar o MESMO provider
  // segundos depois não resolve nada (visto em produção: GLM 429 "rate
  // limit" derrubou o step inteiro após 3 tentativas ao mesmo provider,
  // mesmo havendo outros candidatos elegíveis no mesmo tier). Em vez de
  // deixar o step inteiro falhar, escolhe outro modelo excluindo o
  // provider que acabou de rate-limitar — até esgotar os candidatos.
  const excludeProviders: AgentProvider[] = []
  let selection: ReturnType<typeof selector.select>
  let result: Awaited<ReturnType<typeof runner.run>>

  for (let attempt = 0; ; attempt++) {
    try {
      selection = selector.select({
        stage:          stage as SelectorStage,
        operation,
        tier:           Math.max(tier, routerOutput.tier) as Tier,
        preferFreeTier: run.config.preferFreeTier,
        userProviders:  run.userProviders as AgentProvider[],
        excludeProviders,
      })
    } catch (err) {
      // Sem candidato disponível (ex: tier exige modelo pago e o usuário não
      // configurou key, ou todos os providers elegíveis já rate-limitaram
      // nesta iteração) — retry não resolveria nada, então é FatalError, não
      // RetryableError. O workflow para aqui em vez de tentar 3x à toa.
      throw new FatalError(err instanceof Error ? err.message : 'Nenhum modelo disponível para esta operação.')
    }

    // Resolve a key NA HORA — nunca persistida no workflow
    const isPlatformFree = selection.model.hasFreeTier || selection.model.isLocal
    const { apiKey, baseUrl } = isPlatformFree
      ? { apiKey: process.env[`PLATFORM_${selection.model.provider.toUpperCase()}_FREE_TIER_KEY`] ?? '', baseUrl: undefined }
      : resolveProviderConfig(selection.model.provider as AgentProvider, keyring)

    try {
      result = await runner.run({
        stage,
        operation,
        modelId:      selection.model.modelId,
        provider:     selection.model.provider as AgentProvider,
        apiKey,
        baseUrl,
        systemPrompt: buildSystemPrompt(stage, run),
        userPrompt:   buildUserPrompt(stage, run, previousOutput),
        previousOutputs: previousOutput ? [previousOutput] : [],
        maxTokens,
        temperature:  0.2,
      })
      break
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isRateLimit = message.includes('429')
      if (isRateLimit && attempt < 2) {
        excludeProviders.push(selection.model.provider as AgentProvider)
        continue
      }
      throw err
    }
  }

  // JSON cortado/malformado (extractJSON caiu no fallback { content,
  // _parseError: true }) não tem estrutura nenhuma — sem isso, um output
  // truncado passava pela auto-crítica normalmente (o modelo de crítica só
  // vê um JSON.stringify de um objeto genérico e não tem como saber que
  // faltam os campos esperados) e ia pro gate humano como se fosse válido.
  // Visto em produção: pipeline "completou" mas backend/frontend não
  // tinham files[] nenhum na hora de publicar.
  const outputParseFailed = Boolean((result.output as { _parseError?: boolean } | null)?._parseError)

  let selfCritique: SelfCritique
  if (outputParseFailed) {
    selfCritique = {
      score: 0, passed: false,
      issues: [{ severity: 'high', message: 'Resposta do modelo não é JSON válido (provavelmente cortada por limite de tokens) — sem estrutura esperada (ex.: files[]).' }],
    }
  } else {
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
    selfCritique = {
      score:  typeof critiqueRaw?.score === 'number' ? critiqueRaw.score : 0.5,
      passed: critiqueRaw?.passed ?? (critiqueRaw?.score ?? 0.5) >= run.config.selfCritiqueThreshold,
      issues: Array.isArray(critiqueRaw?.issues) ? critiqueRaw.issues : [],
    }
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

async function persistRunFinishedStep(runId: string, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
  'use step'
  // Sem isto, o Postgres ficava preso no último estado intermediário
  // (running/awaiting_human) mesmo com o workflow finalizado — a UI
  // mostrava "executando pipeline" para sempre em runs já concluídos.
  const supabase = createSupabaseServiceClient()
  await supabase.from('pipeline_runs').update({
    status,
    completed_at: new Date().toISOString(),
  }).eq('id', runId)
}

async function persistDeployTargetStep(
  runId: string,
  target: 'vercel-serverless' | 'manual-export',
  reason: string,
): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()
  await supabase.from('pipeline_runs').update({
    deploy_target:        target,
    deploy_target_reason: reason,
  }).eq('id', runId)
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

// ─── Commit por etapa (Fase 2, "opção B") ───────────────────────────────────

const STAGE_COMMIT_FILENAME: Partial<Record<PipelineStage, string>> = {
  codebase_analysis: 'devfactory/00-codebase-analysis.json',
  planning:          'devfactory/01-planning.json',
  docs_initial:      'devfactory/02-docs-initial.json',
  design:            'devfactory/03-design.json',
  tests:             'devfactory/05-tests.json',
  quality_council:   'devfactory/06-quality-council.json',
  docs_final:        'devfactory/07-docs-final.json',
}

async function persistStageCommitStep(
  userId: string,
  publishRepo: { owner: string; repo: string; branch: string },
  stage: PipelineStage,
  finalOutput: unknown,
  deployTarget?: 'vercel-serverless' | 'manual-export',
): Promise<void> {
  'use step'
  const token = await getUserGithubToken(userId)
  if (!token) return // conexão pode ter sido removida no meio do run — não derruba a pipeline por isso

  // backend/frontend geram files[] de verdade — commitam o código em si.
  // As demais etapas geram JSON estruturado (PRD, spec, design tokens...)
  // — commitam como snapshot legível em devfactory/, contando a história
  // da geração no próprio log do git.
  const isCodeStage = stage === 'backend' || stage === 'frontend'
  let files = isCodeStage
    ? ((finalOutput as { files?: GeneratedFile[] } | null)?.files ?? [])
    : [{ path: STAGE_COMMIT_FILENAME[stage] ?? `devfactory/${stage}.json`, content: JSON.stringify(finalOutput, null, 2) }]

  // Cada etapa de código commita sozinha (sem ver o que a outra gerou), então
  // nenhuma garante os arquivos de raiz que fazem "vercel build" reconhecer o
  // app — reforça o scaffold a cada commit de código, idempotente (só some
  // quando o próprio arquivo gerado já existir no repo, que ensureNextScaffold
  // não sabe checar aqui — mas commitFiles/base_tree do GitHub mescla por path,
  // então sobrescrever com o mesmo scaffold é inofensivo).
  if (isCodeStage && deployTarget === 'vercel-serverless' && files.length > 0) {
    files = ensureNextScaffold(files)
  }

  if (files.length === 0) return

  try {
    await commitFiles(publishRepo, token, files, `DevFactory: ${stage} aprovado`)
  } catch {
    // Falha de commit não deve derrubar a pipeline inteira — o usuário
    // ainda pode publicar manualmente depois (Fase 3/4) se isso falhar.
  }
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
    model_provider:   iteration.selectionResult?.model.provider ?? null,
    model_label:      iteration.selectionResult?.model.displayName ?? null,
    tier_used:        iteration.routerOutput.tier,
    cost_usd:         iteration.selectionResult?.estimatedCostUsd ?? 0,
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

  // Restrição de empacotamento pro botão "Publicar" (deploy automático na
  // Vercel) funcionar: só se aplica quando docs_initial já classificou o
  // projeto como elegível — não limita o que o produto final faz, só como
  // o código é organizado (monolito Next.js em vez de servidor separado).
  if ((stage === 'backend' || stage === 'frontend') && run.deployTarget === 'vercel-serverless') {
    prompt += `\n\nRESTRIÇÃO DE EMPACOTAMENTO (obrigatória — o resultado será publicado automaticamente
via Vercel/serverless): gere um único app Next.js (App Router). Backend = API routes em
"app/api/**/route.ts" — nunca um servidor Express/Fastify separado, nunca "app.listen()".
Frontend = páginas/componentes do mesmo app Next.js. Se o schema tiver tabelas, assuma Postgres
(Supabase) e retorne o SQL em "migration" — nunca SQLite em arquivo local (não persiste em serverless).`
  }

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
