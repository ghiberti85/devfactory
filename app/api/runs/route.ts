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

  // ⚠️ Verificar a assinatura exata de start() na doc atual do Workflow SDK
  // (useworkflow.dev/docs/api-reference/workflow-api/start) antes de rodar —
  // confirmei via busca que `start` é exportado de 'workflow/api' e que
  // workflows são disparados a partir de rotas normais (não de dentro de
  // outro workflow sem estar envolto em step), mas não tive um exemplo
  // completo da forma de chamada/retorno no momento em que escrevi isto.
  const { runId } = await start(runDevFactoryPipeline, [{ run }])

  return NextResponse.json({ runId, status: 'started' }, { status: 201 })
}
