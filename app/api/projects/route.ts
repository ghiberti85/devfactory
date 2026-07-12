/**
 * POST /api/projects
 * Cria a linha em `projects` que pipeline_runs.project_id referencia.
 *
 * app/projects/new/page.tsx precisa chamar isto ANTES de POST /api/runs —
 * sem essa linha existir, o insert em pipeline_runs falha com
 * "violates foreign key constraint pipeline_runs_project_id_fkey".
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import type { GitHubRepoRef } from '@/lib/devfactory/github-connector'

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const body = (await req.json()) as {
    projectName: string
    briefing?: string
    githubRepo?: GitHubRepoRef
    config?: {
      selectorMode?: string
      preferFreeTier?: boolean
      maxIterationsPerStage?: number
      budgetUsd?: number
    }
  }

  if (!body.projectName?.trim()) {
    return NextResponse.json({ error: 'projectName é obrigatório.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(req)
  const { data, error } = await supabase.from('projects').insert({
    user_id:       user.id,
    name:          body.projectName,
    briefing:      body.briefing ?? '',
    status:        'draft',
    selector_mode: body.config?.selectorMode ?? 'auto',
    budget_usd:    body.config?.budgetUsd,
    max_iterations_per_stage: body.config?.maxIterationsPerStage ?? 3,
    project_mode:  body.githubRepo ? 'brownfield' : 'greenfield',
    github_owner:  body.githubRepo?.owner,
    github_repo:   body.githubRepo?.repo,
    github_branch: body.githubRepo?.branch,
  }).select('id').single()

  if (error || !data) {
    return NextResponse.json({ error: `Falha ao criar o projeto: ${error?.message}` }, { status: 500 })
  }

  return NextResponse.json({ projectId: data.id }, { status: 201 })
}
