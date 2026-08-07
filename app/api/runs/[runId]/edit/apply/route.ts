/**
 * POST /api/runs/[runId]/edit/apply
 *
 * Segunda metade do "✎ Ajustar": recebe os arquivos que o usuário REVISOU E
 * APROVOU (vindos de POST .../edit/propose, possivelmente editados à mão no
 * front antes de aprovar) e efetivamente: commita no repositório e dispara
 * um novo deploy na Vercel — reaproveitando deployRunToVercel, a mesma
 * lógica do botão "Publicar"/"Republicar".
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { getUserGithubToken, getUserVercelToken } from '@/lib/devfactory/run-registry'
import { commitFiles } from '@/lib/devfactory/github-connector'
import { deployRunToVercel } from '@/lib/devfactory/vercel-deployer'

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
  const files = Array.isArray(body.files)
    ? (body.files as unknown[]).filter(
        (f): f is GeneratedFile =>
          !!f && typeof f === 'object' && typeof (f as GeneratedFile).path === 'string' && typeof (f as GeneratedFile).content === 'string',
      )
    : []
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''

  if (files.length === 0) {
    return NextResponse.json({ error: 'Nenhum arquivo para aplicar.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(req)
  const { data: run, error } = await supabase
    .from('pipeline_runs')
    .select('id, user_id, deploy_target, stage_outputs(stage, final_output), projects(name, github_owner, github_repo, github_branch)')
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
    return NextResponse.json({ error: 'Repositório ainda não publicado.' }, { status: 409 })
  }

  const githubToken = await getUserGithubToken(user.id)
  if (!githubToken) {
    return NextResponse.json({ error: 'Conecte sua conta do GitHub em /settings/api-keys.' }, { status: 400 })
  }

  const gitRepo = {
    owner:  project.github_owner,
    repo:   project.github_repo,
    branch: project.github_branch ?? 'main',
  }

  try {
    const commit = await commitFiles(
      gitRepo,
      githubToken,
      files,
      `DevFactory: ajuste — ${instruction || 'sem descrição'}`.slice(0, 200),
    )

    // manual-export nunca teve deploy automático pra começo de conversa —
    // só commita o ajuste, sem tentar redeployar o que não existe.
    if (run.deploy_target === 'manual-export') {
      return NextResponse.json({ ok: true, commitUrl: commit.htmlUrl, deployed: false })
    }

    const vercelToken = await getUserVercelToken(user.id)
    if (!vercelToken) {
      return NextResponse.json({
        ok: true, commitUrl: commit.htmlUrl, deployed: false,
        warning: 'Ajuste commitado, mas não consegui redeployar — conecte sua conta da Vercel em /settings/api-keys.',
      })
    }

    const stageOutputs = (run.stage_outputs ?? []) as { stage: string; final_output: unknown }[]
    const backendOutput = stageOutputs.find(so => so.stage === 'backend')?.final_output as { env_vars?: unknown } | undefined
    const envVarNames = Array.isArray(backendOutput?.env_vars)
      ? backendOutput.env_vars.filter((v): v is string => typeof v === 'string')
      : []

    const result = await deployRunToVercel({
      projectName: `${project.name}-${runId.slice(0, 8)}`,
      gitRepo,
      accessToken: vercelToken,
      envVarNames,
    })

    await supabase.from('pipeline_runs').update({
      vercel_deployment_url: result.deploymentUrl,
    }).eq('id', runId)

    return NextResponse.json({ ok: true, commitUrl: commit.htmlUrl, deployed: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao aplicar o ajuste.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
