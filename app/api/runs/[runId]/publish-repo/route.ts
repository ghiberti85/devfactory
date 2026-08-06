/**
 * POST /api/runs/[runId]/publish-repo
 *
 * Fase 3 do deploy automático: cria um repositório novo no GitHub do
 * usuário (com o token dele, nunca o do DevFactory) e commita os arquivos
 * gerados (backend + frontend) num commit só, via Git Data API.
 *
 * Se o run já tem um repositório (opção B da Fase 2 — conectado desde o
 * início, ver pipeline-workflow.ts persistStageCommitStep), não cria outro
 * — só garante que backend/frontend estão commitados nele e devolve a URL.
 *
 * Ainda não faz deploy (Fase 4) — só devolve a URL do repositório criado.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { getUserGithubToken } from '@/lib/devfactory/run-registry'
import { createRepository, commitFiles, slugifyRepoName } from '@/lib/devfactory/github-connector'
import { ensureNextScaffold } from '@/lib/devfactory/next-scaffold'

interface GeneratedFile {
  path:    string
  content: string
}

function extractFiles(finalOutput: unknown): GeneratedFile[] {
  if (!finalOutput || typeof finalOutput !== 'object') return []
  const files = (finalOutput as { files?: unknown }).files
  if (!Array.isArray(files)) return []
  return files.filter(
    (f): f is GeneratedFile => typeof f?.path === 'string' && typeof f?.content === 'string',
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { runId } = await params
  const supabase = createSupabaseServerClient(req)

  const { data: run, error } = await supabase
    .from('pipeline_runs')
    .select('id, user_id, project_id, deploy_target, stage_outputs(stage, final_output), projects(name, github_owner, github_repo, github_branch)')
    .eq('id', runId)
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Run não encontrado.' }, { status: 404 })
  }
  if (run.user_id !== user.id) {
    return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  }

  const token = await getUserGithubToken(user.id)
  if (!token) {
    return NextResponse.json(
      { error: 'Conecte sua conta do GitHub em /settings/api-keys antes de publicar um repositório.' },
      { status: 400 },
    )
  }

  const stageOutputs = (run.stage_outputs ?? []) as { stage: string; final_output: unknown }[]
  const backend = stageOutputs.find(so => so.stage === 'backend')
  const frontend = stageOutputs.find(so => so.stage === 'frontend')
  const generatedFiles = [
    ...extractFiles(backend?.final_output),
    ...extractFiles(frontend?.final_output),
  ]

  // Sem isso, backend/frontend saem de duas chamadas de LLM que não se veem
  // uma à outra — nenhuma garante package.json/next.config/tsconfig, e sem
  // esses arquivos "vercel build" não reconhece o projeto (deploy fica
  // READY mas o site é 404). Só se aplica quando a Fase 5 classificou o
  // projeto como publicável via Vercel (deployTarget === 'vercel-serverless').
  const allFiles = run.deploy_target === 'vercel-serverless'
    ? ensureNextScaffold(generatedFiles)
    : generatedFiles

  if (generatedFiles.length === 0) {
    return NextResponse.json(
      { error: 'Nenhum arquivo gerado ainda — as etapas backend/frontend precisam estar aprovadas.' },
      { status: 409 },
    )
  }

  const project = run.projects as unknown as {
    name: string
    github_owner: string | null
    github_repo: string | null
    github_branch: string | null
  } | null

  try {
    // Opção B (Fase 2): o repo já existe e já recebeu commit a cada etapa
    // aprovada — não cria outro, só devolve a URL existente.
    if (project?.github_owner && project.github_repo) {
      return NextResponse.json({
        ok:            true,
        repoUrl:       `https://github.com/${project.github_owner}/${project.github_repo}`,
        owner:         project.github_owner,
        repo:          project.github_repo,
        defaultBranch: project.github_branch ?? 'main',
        alreadyExisted: true,
      })
    }

    const projectName = project?.name ?? 'devfactory-project'
    const repoName = `${slugifyRepoName(projectName)}-${runId.slice(0, 8)}`

    const created = await createRepository(repoName, token, {
      private: true,
      description: `Gerado pelo DevFactory a partir do run ${runId}`,
    })

    const commit = await commitFiles(
      { owner: created.owner, repo: created.repo, branch: created.defaultBranch },
      token,
      allFiles,
      'DevFactory: código gerado pela pipeline (backend + frontend)',
    )

    await supabase.from('projects').update({
      github_owner:  created.owner,
      github_repo:   created.repo,
      github_branch: created.defaultBranch,
    }).eq('id', run.project_id)

    return NextResponse.json({
      ok:            true,
      repoUrl:       created.htmlUrl,
      owner:         created.owner,
      repo:          created.repo,
      defaultBranch: created.defaultBranch,
      commitUrl:     commit.htmlUrl,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao criar o repositório no GitHub.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
