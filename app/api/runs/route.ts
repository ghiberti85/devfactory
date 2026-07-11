/**
 * POST /api/runs
 * Inicia um novo run da pipeline DevFactory como um Vercel Workflow durável.
 *
 * Mudança em relação à v0.1: não existe mais "service.start(run)" segurando
 * estado em memória. start() dispara o workflow no Vercel e retorna
 * imediatamente um runId — o workflow continua executando de forma durável
 * mesmo que esta função termine, e sobrevive a deploys/restarts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'

import { runDevFactoryPipeline } from '@/lib/devfactory/pipeline-workflow'
import { createProjectRun, type RunConfig } from '@/lib/devfactory/types'
import { fetchRepoContext, repoContextToPromptSummary, type GitHubRepoRef } from '@/lib/devfactory/github-connector'
import { getUserGithubToken, getUserKeyring } from '@/lib/devfactory/run-registry'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const body = (await req.json()) as {
    projectId: string
    projectName: string
    briefing?: string
    githubRepo?: GitHubRepoRef
    config?: Partial<RunConfig>
  }

  if (!body.projectName?.trim()) {
    return NextResponse.json({ error: 'projectName é obrigatório.' }, { status: 400 })
  }
  if (!body.githubRepo && !body.briefing?.trim()) {
    return NextResponse.json(
      { error: 'briefing é obrigatório quando nenhum repositório é conectado.' },
      { status: 400 },
    )
  }

  let repoContextSummary: string | undefined
  if (body.githubRepo) {
    const token = await getUserGithubToken(user.id)
    if (!token) {
      return NextResponse.json(
        { error: 'Conecte sua conta do GitHub em /settings/api-keys antes de usar um repositório existente.' },
        { status: 400 },
      )
    }
    try {
      const repoContext = await fetchRepoContext(body.githubRepo, token)
      repoContextSummary = repoContextToPromptSummary(repoContext)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao ler o repositório.'
      return NextResponse.json({ error: message }, { status: 422 })
    }
  }

  // userProviders é só metadado (quais providers o usuário tem key própria) —
  // NUNCA a key em si. As keys decifradas são resolvidas dentro de cada step
  // do workflow, na hora, via getUserKeyring(run.userId). Isso evita que
  // segredos fiquem persistidos no event log durável do workflow.
  const { userProviders } = await getUserKeyring(user.id)

  const run = createProjectRun({
    id:           crypto.randomUUID(),
    userId:       user.id,
    projectId:    body.projectId,
    projectName:  body.projectName,
    briefing:     body.briefing ?? '',
    config:       body.config,
    githubRepo:   body.githubRepo,
    repoContextSummary,
    userProviders,
  })

  // Cria a linha de pipeline_runs ANTES de start() — os steps de persistência
  // do workflow (pipeline-workflow.ts) fazem UPDATE por id a partir daqui, e
  // o dashboard/stream precisam encontrar a linha desde o primeiro poll.
  const supabase = createSupabaseServerClient(req)
  const { error: insertError } = await supabase.from('pipeline_runs').insert({
    id:            run.id,
    project_id:    run.projectId,
    user_id:       user.id,
    status:        'running',
    current_stage: null,
  })
  if (insertError) {
    return NextResponse.json({ error: `Falha ao registrar o run: ${insertError.message}` }, { status: 500 })
  }

  // start() retorna um objeto Run<TResult> (não `{ runId }`) — confirmado
  // contra os tipos publicados de 'workflow' (dist/api.d.ts): `runId` é uma
  // propriedade da instância de Run, junto com .cancel(), .status etc.
  const run_ = await start(runDevFactoryPipeline, [{ run }])

  // Registra o runId do Workflow SDK (distinto do id interno usado nas URLs)
  // para que GET/DELETE em [runId]/route.ts consigam chamar getRun() depois.
  await supabase.from('pipeline_runs').update({ workflow_run_id: run_.runId }).eq('id', run.id)

  return NextResponse.json({ runId: run.id, status: 'started' }, { status: 201 })
}
