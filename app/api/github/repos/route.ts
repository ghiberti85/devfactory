/**
 * GET /api/github/repos
 * Lista os repositórios do usuário conectado — usado pelo picker em
 * NewProjectForm quando o modo é "Conectar repositório existente".
 */

import { NextRequest, NextResponse } from 'next/server'
import { listUserRepos } from '@/lib/devfactory/github-connector'
import { getUserGithubToken } from '@/lib/devfactory/run-registry'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const token = await getUserGithubToken(user.id)
  if (!token) {
    return NextResponse.json({ connected: false, repos: [] })
  }

  try {
    const repos = await listUserRepos(token)
    return NextResponse.json({ connected: true, repos })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao listar repositórios.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
