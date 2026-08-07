/**
 * DevFactory — Edit Workflow (Vercel Workflow SDK)
 * lib/devfactory/edit-workflow.ts
 *
 * "✎ Ajustar" — pedido pontual pós-publicação, rodando como Vercel Workflow
 * durável em vez de uma chamada de LLM bloqueada dentro de uma rota HTTP
 * síncrona (a primeira versão disso). Esse era o problema real: uma geração
 * de código pode legitimamente levar minutos, e nenhum ajuste de timeout
 * resolve isso quando ela está presa dentro do teto de duração de uma
 * função serverless. Aqui roda exatamente como a pipeline principal —
 * "use step" pra I/O, hook pra pausar esperando revisão humana, sem
 * pressão nenhuma de tempo de resposta HTTP.
 */

import { defineHook, FatalError } from 'workflow'
import { z } from 'zod'

import { createSelector } from './model-selector'
import { createAgentRunner, resolveProviderConfig, type AgentProvider } from './agent-runner'
import { getUserKeyring, getUserGithubToken, getUserVercelToken } from './run-registry'
import { fetchSourceFiles, commitFiles } from './github-connector'
import { deployRunToVercel } from './vercel-deployer'
import { createSupabaseServiceClient } from './supabase'
import { extractErrorMessage } from './pipeline-workflow'

export const editGateHook = defineHook({
  schema: z.object({ decision: z.enum(['approved', 'rejected']) }),
})

export function editGateToken(editId: string): string {
  return `devfactory-edit:${editId}`
}

export interface GeneratedFile {
  path:    string
  content: string
}

export interface EditWorkflowInput {
  editId:       string
  runId:        string
  userId:       string
  instruction:  string
  projectName:  string
  gitRepo:      { owner: string; repo: string; branch: string }
  deployTarget: 'vercel-serverless' | 'manual-export' | null
  envVarNames:  string[]
}

// ─── Workflow principal ─────────────────────────────────────────────────────

export async function runEditWorkflow(input: EditWorkflowInput): Promise<void> {
  'use workflow'

  let proposal: { files: GeneratedFile[]; model: string }
  try {
    proposal = await proposeEditStep(input)
  } catch (err) {
    await persistEditFailedStep(input.editId, extractErrorMessage(err))
    return
  }

  if (proposal.files.length === 0) {
    await persistEditFailedStep(input.editId, 'O modelo não encontrou nenhuma alteração a fazer para esse pedido.')
    return
  }

  // Sem "use step" aqui por baixo — hooks só existem em nível de workflow,
  // mesma regra da pipeline principal (ver humanGateHook em pipeline-workflow.ts).
  const token = editGateToken(input.editId)
  using hook = editGateHook.create({ token })
  await persistEditAwaitingReviewStep(input.editId, proposal.files, proposal.model, token)

  const decision = await hook  // <<< suspende aqui — zero custo de compute, sobrevive a deploys

  if (decision.decision === 'rejected') {
    await persistEditRejectedStep(input.editId)
    return
  }

  await persistEditApplyingStep(input.editId)
  try {
    const result = await applyEditStep(input, proposal.files)
    await persistEditCompletedStep(input.editId, result)
  } catch (err) {
    await persistEditFailedStep(input.editId, extractErrorMessage(err))
  }
}

// ─── Step: gerar a proposta ─────────────────────────────────────────────────

async function proposeEditStep(input: EditWorkflowInput): Promise<{ files: GeneratedFile[]; model: string }> {
  'use step'

  const githubToken = await getUserGithubToken(input.userId)
  if (!githubToken) throw new FatalError('Conecte sua conta do GitHub em /settings/api-keys antes de propor um ajuste.')

  const currentFiles = await fetchSourceFiles(input.gitRepo, githubToken)
  if (currentFiles.length === 0) throw new FatalError('Não encontrei arquivos de código-fonte no repositório.')

  const { keyring, userProviders } = await getUserKeyring(input.userId)
  const selector = createSelector([])

  const filesContext = currentFiles
    .map(f => `--- ${f.path} ---\n${f.content}`)
    .join('\n\n')
    .slice(0, 60_000)

  const systemPrompt = `Você é um Frontend/Backend Engineer sênior fazendo um ajuste num app Next.js já publicado em produção —
pode ser desde uma correção pontual (ex.: remover um link quebrado) até um pedido com várias partes (corrigir bugs, adicionar
novas seções/componentes de UI, etc.) — atenda TUDO que foi pedido, por completo, sem pular partes por serem trabalhosas.
Não altere nada que não foi pedido (não "melhore" código não relacionado).
Retorne JSON: { "files": [{ "path": "...", "content": "..." }] } contendo TODOS os arquivos que precisou criar ou modificar
pra atender o pedido por completo, cada um com o conteúdo COMPLETO (não um diff/patch). Se o pedido envolver criar um
componente novo (ex.: um card, um accordion), crie o arquivo novo E atualize quem precisa importá-lo. Se não for necessário
alterar nenhum arquivo, retorne { "files": [] }. Responda APENAS em JSON.`
  const userPrompt = `## Pedido do usuário:\n${input.instruction}\n\n## Código-fonte atual do app:\n${filesContext}`

  // Sem pressão de teto de duração de rota HTTP aqui dentro — é um step do
  // Workflow SDK, pode legitimamente levar minutos. Começa no tier 1
  // (rápido) e só escala orçamento/tier se vier cortado.
  const attempts: Array<{ tier: 1 | 2 | 3; maxTokens: number }> = [
    { tier: 1, maxTokens: 12000 },
    { tier: 2, maxTokens: 16000 },
    { tier: 3, maxTokens: 32000 },
  ]

  const rateLimitedProviders: AgentProvider[] = []
  const runner = createAgentRunner({ timeoutMs: 280_000 })
  let lastParseFailed = false

  outer: for (const attempt of attempts) {
    for (let providerAttempt = 0; providerAttempt < 3; providerAttempt++) {
      let selection
      try {
        selection = selector.select({
          stage:          'frontend',
          operation:      'refine',
          tier:           attempt.tier,
          preferFreeTier: true,
          userProviders,
          excludeProviders: rateLimitedProviders,
        })
      } catch {
        break outer // esgotou candidatos — não adianta tentar o próximo tier
      }

      const isPlatformFree = selection.model.hasFreeTier || selection.model.isLocal
      const { apiKey, baseUrl } = isPlatformFree
        ? { apiKey: process.env[`PLATFORM_${selection.model.provider.toUpperCase()}_FREE_TIER_KEY`] ?? '', baseUrl: undefined }
        : resolveProviderConfig(selection.model.provider as AgentProvider, keyring)

      let result
      try {
        result = await runner.run({
          stage:     'frontend',
          operation: 'refine',
          modelId:      selection.model.modelId,
          provider:     selection.model.provider as AgentProvider,
          apiKey,
          baseUrl,
          systemPrompt,
          userPrompt,
          previousOutputs: [],
          maxTokens:    attempt.maxTokens,
          temperature:  0.2,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('429')) {
          rateLimitedProviders.push(selection.model.provider as AgentProvider)
          continue // outro provider, mesmo tier
        }
        throw err
      }

      const output = result.output as { files?: unknown; _parseError?: boolean } | null
      lastParseFailed = Boolean(output?._parseError)
      if (lastParseFailed) break // próximo tier (mais orçamento)

      const files = Array.isArray(output?.files)
        ? (output.files as unknown[]).filter(
            (f): f is GeneratedFile =>
              !!f && typeof f === 'object' && typeof (f as GeneratedFile).path === 'string' && typeof (f as GeneratedFile).content === 'string',
          )
        : []
      return { files, model: selection.model.displayName }
    }
  }

  if (lastParseFailed) {
    throw new Error('A resposta do modelo veio incompleta mesmo após tentar com mais orçamento de tokens — pedidos muito grandes às vezes precisam ser divididos em dois pedidos menores.')
  }
  throw new Error('Não consegui gerar o ajuste — todos os modelos disponíveis falharam ou estavam sobrecarregados.')
}

// ─── Step: aplicar (commit + deploy) ────────────────────────────────────────

async function applyEditStep(
  input: EditWorkflowInput,
  files: GeneratedFile[],
): Promise<{ commitUrl: string; deploymentUrl?: string }> {
  'use step'

  const githubToken = await getUserGithubToken(input.userId)
  if (!githubToken) throw new FatalError('Conecte sua conta do GitHub em /settings/api-keys.')

  const commit = await commitFiles(
    input.gitRepo,
    githubToken,
    files,
    `DevFactory: ajuste — ${input.instruction}`.slice(0, 200),
  )

  if (input.deployTarget === 'manual-export') {
    return { commitUrl: commit.htmlUrl }
  }

  const vercelToken = await getUserVercelToken(input.userId)
  if (!vercelToken) {
    return { commitUrl: commit.htmlUrl } // commitado, mas sem Vercel conectada não dá pra redeployar — não é falha fatal
  }

  const result = await deployRunToVercel({
    projectName: input.projectName,
    gitRepo:     input.gitRepo,
    accessToken: vercelToken,
    envVarNames: input.envVarNames,
  })

  return { commitUrl: commit.htmlUrl, deploymentUrl: result.deploymentUrl }
}

// ─── Steps de persistência ──────────────────────────────────────────────────

async function persistEditFailedStep(editId: string, error: string): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()
  await supabase.from('run_edits').update({
    status: 'failed', error, updated_at: new Date().toISOString(),
  }).eq('id', editId)
}

async function persistEditAwaitingReviewStep(
  editId: string,
  files: GeneratedFile[],
  model: string,
  token: string,
): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()
  await supabase.from('run_edits').update({
    status: 'awaiting_review', proposed_files: files, model_used: model, gate_token: token,
    updated_at: new Date().toISOString(),
  }).eq('id', editId)
}

async function persistEditRejectedStep(editId: string): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()
  await supabase.from('run_edits').update({
    status: 'rejected', updated_at: new Date().toISOString(),
  }).eq('id', editId)
}

async function persistEditApplyingStep(editId: string): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()
  await supabase.from('run_edits').update({
    status: 'applying', updated_at: new Date().toISOString(),
  }).eq('id', editId)
}

async function persistEditCompletedStep(
  editId: string,
  result: { commitUrl: string; deploymentUrl?: string },
): Promise<void> {
  'use step'
  const supabase = createSupabaseServiceClient()
  await supabase.from('run_edits').update({
    status: 'completed', commit_url: result.commitUrl, deployment_url: result.deploymentUrl ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', editId)
}
