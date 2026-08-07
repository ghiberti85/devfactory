/**
 * POST /api/runs/[runId]/edit/propose
 *
 * "✎ Ajustar" — pedido do usuário: depois que o pipeline termina e o site
 * já está publicado, poder descrever um ajuste pontual (ex.: "remove esse
 * link quebrado no rodapé do formulário") sem precisar rodar a pipeline
 * inteira de novo. Essa rota faz só a PROPOSTA — uma chamada de LLM só,
 * usando o código-fonte ATUAL do repo como contexto — e devolve os arquivos
 * alterados pro usuário revisar antes de aplicar (POST .../edit/apply).
 *
 * Não persiste nada no Postgres — o resultado fica só na resposta HTTP até
 * o usuário aprovar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { getUserGithubToken, getUserKeyring } from '@/lib/devfactory/run-registry'
import { fetchSourceFiles } from '@/lib/devfactory/github-connector'
import { createSelector } from '@/lib/devfactory/model-selector'
import { createAgentRunner, resolveProviderConfig, type AgentProvider } from '@/lib/devfactory/agent-runner'

// 300s é o teto do plano Hobby (mesmo limite documentado em
// stream/route.ts). Essa rota faz a PRIMEIRA chamada de LLM direta de
// dentro de uma rota Next.js normal (as outras rodam dentro de steps do
// Vercel Workflow SDK, com duração gerida separadamente) — sem isso, o
// limite padrão da plataforma (bem menor que 300s) mata a função antes
// mesmo do timeout interno do AgentRunner disparar.
export const maxDuration = 300

interface GeneratedFile {
  path:    string
  content: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  if (!instruction) {
    return NextResponse.json({ error: 'Descreva o ajuste que você quer fazer.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(req)
  const { data: run, error } = await supabase
    .from('pipeline_runs')
    .select('id, user_id, projects(name, github_owner, github_repo, github_branch)')
    .eq('id', runId)
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Run não encontrado.' }, { status: 404 })
  }
  if (run.user_id !== user.id) {
    return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  }

  const project = run.projects as unknown as {
    name: string
    github_owner: string | null
    github_repo: string | null
    github_branch: string | null
  } | null

  if (!project?.github_owner || !project.github_repo) {
    return NextResponse.json(
      { error: 'Publique o site primeiro (botão "Publicar") — ajustes pontuais partem do código já commitado no repositório.' },
      { status: 409 },
    )
  }

  const githubToken = await getUserGithubToken(user.id)
  if (!githubToken) {
    return NextResponse.json(
      { error: 'Conecte sua conta do GitHub em /settings/api-keys antes de propor um ajuste.' },
      { status: 400 },
    )
  }

  const gitRepo = {
    owner:  project.github_owner,
    repo:   project.github_repo,
    branch: project.github_branch ?? 'main',
  }

  try {
    const currentFiles = await fetchSourceFiles(gitRepo, githubToken)
    if (currentFiles.length === 0) {
      return NextResponse.json({ error: 'Não encontrei arquivos de código-fonte no repositório.' }, { status: 409 })
    }

    const { keyring, userProviders } = await getUserKeyring(user.id)
    const selector = createSelector([])

    const filesContext = currentFiles
      .map(f => `--- ${f.path} ---\n${f.content}`)
      .join('\n\n')
      .slice(0, 60_000) // teto de segurança de contexto

    const systemPrompt = `Você é um Frontend/Backend Engineer sênior fazendo um ajuste num app Next.js já publicado em produção —
pode ser desde uma correção pontual (ex.: remover um link quebrado) até um pedido com várias partes (corrigir bugs, adicionar
novas seções/componentes de UI, etc.) — atenda TUDO que foi pedido, por completo, sem pular partes por serem trabalhosas.
Não altere nada que não foi pedido (não "melhore" código não relacionado).
Retorne JSON: { "files": [{ "path": "...", "content": "..." }] } contendo TODOS os arquivos que precisou criar ou modificar
pra atender o pedido por completo, cada um com o conteúdo COMPLETO (não um diff/patch). Se o pedido envolver criar um
componente novo (ex.: um card, um accordion), crie o arquivo novo E atualize quem precisa importá-lo. Se não for necessário
alterar nenhum arquivo, retorne { "files": [] }. Responda APENAS em JSON.`
    const userPrompt = `## Pedido do usuário:\n${instruction}\n\n## Código-fonte atual do app:\n${filesContext}`

    // Começa no tier 1 (rápido, geralmente free tier) — a maioria dos
    // ajustes é pequena e não precisa de um modelo caro. Só escala tier
    // (mais orçamento de tokens) se a tentativa anterior vier cortada.
    const attempts: Array<{ tier: 1 | 2 | 3; maxTokens: number }> = [
      { tier: 1, maxTokens: 12000 },
      { tier: 2, maxTokens: 16000 },
      { tier: 3, maxTokens: 32000 },
    ]

    // Orçamento de tempo TOTAL da rota, não por tentativa — sem isso, 2
    // tiers × 3 providers × um timeout individual generoso somava fácil
    // mais que os 300s do maxDuration da função, e quando a Vercel mata a
    // função no meio a resposta vira uma página de erro da plataforma (não
    // JSON), o que o cliente tentava JSON.parse cegamente e quebrava com
    // "unexpected character at line 1 column 1". Agora cada tentativa
    // individual é mais curta (90s) E paramos de tentar mais uma vez perto
    // do teto, devolvendo um erro JSON claro em vez de deixar a plataforma
    // derrubar a função sem controle.
    const startedAt = Date.now()
    const DEADLINE_MS = 260_000 // ~40s de margem sob o teto de 300s

    let files: GeneratedFile[] = []
    let modelUsed = ''
    let lastParseFailed = false
    let timedOut = false
    const rateLimitedProviders: AgentProvider[] = []
    const runner = createAgentRunner({ timeoutMs: 90_000 })

    outer: for (const attempt of attempts) {
      // Rate limit (429) num provider não é motivo pra escalar tier nem
      // desistir — é motivo pra tentar outro provider no MESMO tier (visto
      // em produção: GLM "该模型当前访问量过大" — infra externa sobrecarregada,
      // nada a ver com o tamanho do pedido). Mesmo padrão de fallback já
      // usado em runSingleStageStep (pipeline-workflow.ts).
      for (let providerAttempt = 0; providerAttempt < 2; providerAttempt++) {
        if (Date.now() - startedAt > DEADLINE_MS) { timedOut = true; break outer }

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
          break outer // esgotou candidatos neste tier (e nos anteriores) — não adianta tentar o próximo tier
        }

        const isPlatformFree = selection.model.hasFreeTier || selection.model.isLocal
        const { apiKey, baseUrl } = isPlatformFree
          ? { apiKey: process.env[`PLATFORM_${selection.model.provider.toUpperCase()}_FREE_TIER_KEY`] ?? '', baseUrl: undefined }
          : resolveProviderConfig(selection.model.provider as AgentProvider, keyring)

        let result
        try {
          // Timeout maior que o default (120s) — contexto de até 60KB de
          // código + até 32000 tokens de output passa dos 120s às vezes.
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
        if (lastParseFailed) break // tenta o próximo tier (mais orçamento), não o mesmo provider de novo

        files = Array.isArray(output?.files)
          ? (output.files as unknown[]).filter(
              (f): f is GeneratedFile =>
                !!f && typeof f === 'object' && typeof (f as GeneratedFile).path === 'string' && typeof (f as GeneratedFile).content === 'string',
            )
          : []
        modelUsed = selection.model.displayName
        break outer
      }
    }

    if (timedOut && files.length === 0) {
      return NextResponse.json({
        error: 'O ajuste está demorando demais (esgotamos o tempo tentando diferentes modelos) — tenta de novo em instantes, ou descreve um pedido menor/mais específico.',
      }, { status: 504 })
    }

    if (lastParseFailed && files.length === 0) {
      return NextResponse.json({
        error: 'A resposta do modelo veio incompleta mesmo após tentar com mais orçamento de tokens — pedidos muito grandes (várias seções novas de uma vez) às vezes precisam ser divididos em dois pedidos menores.',
      }, { status: 502 })
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'O modelo não encontrou nenhuma alteração a fazer para esse pedido.' }, { status: 422 })
    }

    return NextResponse.json({ ok: true, files, model: modelUsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao gerar o ajuste.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
