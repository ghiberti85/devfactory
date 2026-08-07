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
    const selection = selector.select({
      stage:          'frontend',
      operation:      'refine',
      tier:           2,
      preferFreeTier: true,
      userProviders,
    })

    const isPlatformFree = selection.model.hasFreeTier || selection.model.isLocal
    const { apiKey, baseUrl } = isPlatformFree
      ? { apiKey: process.env[`PLATFORM_${selection.model.provider.toUpperCase()}_FREE_TIER_KEY`] ?? '', baseUrl: undefined }
      : resolveProviderConfig(selection.model.provider as AgentProvider, keyring)

    const filesContext = currentFiles
      .map(f => `--- ${f.path} ---\n${f.content}`)
      .join('\n\n')
      .slice(0, 60_000) // teto de segurança de contexto

    // Timeout maior que o default (120s) — contexto de até 60KB de código
    // + até 16000 tokens de output legitimamente passa dos 120s às vezes.
    const runner = createAgentRunner({ timeoutMs: 240_000 })
    const result = await runner.run({
      stage:     'frontend',
      operation: 'refine',
      modelId:   selection.model.modelId,
      provider:  selection.model.provider as AgentProvider,
      apiKey,
      baseUrl,
      systemPrompt: `Você é um Frontend/Backend Engineer sênior fazendo um AJUSTE PONTUAL num app Next.js já publicado em produção.
Aplique SOMENTE a mudança pedida pelo usuário — não reescreva, reformate ou "melhore" nada que não foi pedido.
Retorne JSON: { "files": [{ "path": "...", "content": "..." }] } contendo APENAS os arquivos que você de fato precisou modificar,
cada um com o conteúdo COMPLETO já corrigido (não um diff/patch). Se não for necessário alterar nenhum arquivo pra atender o
pedido, retorne { "files": [] }. Responda APENAS em JSON.`,
      userPrompt: `## Pedido do usuário:\n${instruction}\n\n## Código-fonte atual do app:\n${filesContext}`,
      previousOutputs: [],
      maxTokens:   16000,
      temperature: 0.2,
    })

    const output = result.output as { files?: unknown; _parseError?: boolean } | null
    if (output?._parseError) {
      return NextResponse.json({ error: 'O modelo não retornou uma resposta válida — tenta descrever o ajuste de outro jeito ou tenta de novo.' }, { status: 502 })
    }

    const files = Array.isArray(output?.files)
      ? (output.files as unknown[]).filter(
          (f): f is GeneratedFile =>
            !!f && typeof f === 'object' && typeof (f as GeneratedFile).path === 'string' && typeof (f as GeneratedFile).content === 'string',
        )
      : []

    if (files.length === 0) {
      return NextResponse.json({ error: 'O modelo não encontrou nenhuma alteração a fazer para esse pedido.' }, { status: 422 })
    }

    return NextResponse.json({ ok: true, files, model: selection.model.displayName })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao gerar o ajuste.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
