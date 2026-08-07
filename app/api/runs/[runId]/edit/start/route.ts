/**
 * POST /api/runs/[runId]/edit/start
 *
 * "✎ Ajustar" — dispara o ajuste como um Vercel Workflow durável
 * (edit-workflow.ts) e retorna IMEDIATAMENTE um editId. O cliente acompanha
 * o progresso via GET .../edit/[editId]/stream (SSE), do mesmo jeito que a
 * pipeline principal — nenhuma chamada de LLM bloqueia esta rota.
 */

import { NextRequest, NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { runEditWorkflow, type EditWorkflowInput } from '@/lib/devfactory/edit-workflow'

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
    return NextResponse.json(
      { error: 'Publique o site primeiro (botão "Publicar") — ajustes pontuais partem do código já commitado no repositório.' },
      { status: 409 },
    )
  }

  const stageOutputs = (run.stage_outputs ?? []) as { stage: string; final_output: unknown }[]
  const backendOutput = stageOutputs.find(so => so.stage === 'backend')?.final_output as { env_vars?: unknown } | undefined
  const envVarNames = Array.isArray(backendOutput?.env_vars)
    ? backendOutput.env_vars.filter((v): v is string => typeof v === 'string')
    : []

  const editId = crypto.randomUUID()
  const { error: insertError } = await supabase.from('run_edits').insert({
    id: editId, run_id: runId, user_id: user.id, instruction, status: 'running',
  })
  if (insertError) {
    return NextResponse.json({ error: `Falha ao registrar o ajuste: ${insertError.message}` }, { status: 500 })
  }

  const input: EditWorkflowInput = {
    editId,
    runId,
    userId:      user.id,
    instruction,
    projectName: `${project.name}-${runId.slice(0, 8)}`,
    gitRepo: {
      owner:  project.github_owner,
      repo:   project.github_repo,
      branch: project.github_branch ?? 'main',
    },
    deployTarget: (run.deploy_target as 'vercel-serverless' | 'manual-export' | null) ?? null,
    envVarNames,
  }

  const run_ = await start(runEditWorkflow, [input])
  await supabase.from('run_edits').update({ workflow_run_id: run_.runId }).eq('id', editId)

  return NextResponse.json({ editId }, { status: 201 })
}
