/**
 * POST /api/runs/[runId]/publish-vercel
 *
 * Fase 4 do deploy automático: cria um projeto Vercel linkado ao
 * repositório GitHub já criado (Fase 3, via POST .../publish-repo) e
 * dispara o primeiro deploy. Exige as duas conexões (GitHub + Vercel) e o
 * repositório já criado — devolve erro claro se algum pré-requisito faltar
 * em vez de tentar adivinhar.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { getUserVercelToken } from '@/lib/devfactory/run-registry'
import { createVercelProject, triggerDeployment, vercelSlugifyProjectName, ensureProjectEnvVars } from '@/lib/devfactory/vercel-deployer'

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

  if (run.deploy_target === 'manual-export') {
    return NextResponse.json({
      error: 'Este projeto não é elegível para deploy automático — a arquitetura pedida no briefing precisa de um ambiente que a Vercel serverless não hospeda. Baixe o projeto e publique manualmente.',
    }, { status: 422 })
  }

  const project = run.projects as unknown as {
    name: string
    github_owner: string | null
    github_repo: string | null
    github_branch: string | null
  } | null

  if (!project?.github_owner || !project.github_repo) {
    return NextResponse.json(
      { error: 'Crie o repositório no GitHub primeiro (botão "Criar repositório no GitHub").' },
      { status: 409 },
    )
  }

  const accessToken = await getUserVercelToken(user.id)
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Conecte sua conta da Vercel em /settings/api-keys antes de publicar.' },
      { status: 400 },
    )
  }

  const gitRepo = {
    owner:  project.github_owner,
    repo:   project.github_repo,
    branch: project.github_branch ?? 'main',
  }

  const stageOutputs = (run.stage_outputs ?? []) as { stage: string; final_output: unknown }[]
  const backendOutput = stageOutputs.find(so => so.stage === 'backend')?.final_output as { env_vars?: unknown } | undefined
  const envVarNames = Array.isArray(backendOutput?.env_vars)
    ? backendOutput.env_vars.filter((v): v is string => typeof v === 'string')
    : []

  try {
    const projectName = vercelSlugifyProjectName(`${project.name}-${runId.slice(0, 8)}`)
    const vercelProject = await createVercelProject(projectName, gitRepo, accessToken)

    // Sem isso, o build falha em "collect page data" sempre que o código
    // gerado ler process.env no topo do módulo (ex.: cliente Supabase
    // instanciado fora de uma função) — placeholders só destravam o build,
    // não fazem a integração funcionar de verdade (ver comentário em
    // ensureProjectEnvVars). ensureProjectEnvVars devolve só as chaves que
    // conseguiu de fato aplicar (normaliza "NOME=exemplo" pro nome puro,
    // descarta o que nem isso for) — reportar envVarNames cru pro usuário
    // fica enganoso se algumas entradas não viraram env var nenhuma.
    const appliedEnvVars = envVarNames.length > 0
      ? await ensureProjectEnvVars(vercelProject.id, envVarNames, accessToken)
      : []

    const deployment = await triggerDeployment(vercelProject.name, gitRepo, accessToken)

    const deploymentUrl = `https://${deployment.url}`
    await supabase.from('pipeline_runs').update({
      vercel_deployment_url: deploymentUrl,
    }).eq('id', runId)

    return NextResponse.json({
      ok:            true,
      deploymentUrl,
      readyState:    deployment.readyState,
      vercelProject: vercelProject.name,
      placeholderEnvVars: appliedEnvVars,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao publicar na Vercel.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
