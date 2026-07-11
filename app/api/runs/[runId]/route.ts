/**
 * GET    /api/runs/[runId]  → snapshot do estado atual
 * DELETE /api/runs/[runId]  → cancela o workflow em andamento
 *
 * Fonte de verdade do progresso "ao vivo": Postgres (pipeline_runs +
 * stage_outputs + stage_iterations), não getRun() do Workflow SDK — getRun()
 * expõe o retorno FINAL da função workflow (via `.returnValue`), que só
 * resolve quando o workflow termina, não enquanto está suspenso em
 * `await hook` esperando o gate humano. Os steps de persistência
 * (persistAwaitingHumanStep, persistGateDecisionStep em pipeline-workflow.ts)
 * escrevem no Postgres a cada transição para que este snapshot reflita o
 * estado real mesmo com o workflow pausado.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRun } from 'workflow/api'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { runId } = await params
  const supabase = createSupabaseServerClient(req)

  const { data: run, error } = await supabase
    .from('pipeline_runs')
    .select('*, stage_outputs(*, stage_iterations(*))')
    .eq('id', runId)
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Run não encontrado.' }, { status: 404 })
  }
  // RLS já restringe a linha ao dono, mas o filtro explícito é uma segunda
  // camada de defesa e produz um 403 mais claro do que um 404 genérico.
  if (run.user_id !== user.id) {
    return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  }

  if ((run.status === 'completed' || run.status === 'failed') && run.workflow_run_id) {
    try {
      const workflowRun = getRun(run.workflow_run_id)
      if (await workflowRun.exists) {
        const finalOutput = await workflowRun.returnValue
        return NextResponse.json({ ...run, finalOutput })
      }
    } catch {
      // getRun pode já ter expirado a retenção — não é fatal, o snapshot do
      // Postgres já é suficiente para exibir o resultado final.
    }
  }

  return NextResponse.json(run)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { runId } = await params
  const supabase = createSupabaseServerClient(req)

  const { data: run, error } = await supabase
    .from('pipeline_runs')
    .select('id, user_id, status, workflow_run_id')
    .eq('id', runId)
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Run não encontrado.' }, { status: 404 })
  }
  if (run.user_id !== user.id) {
    return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  }
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return NextResponse.json({ error: 'Run já finalizado — nada para cancelar.' }, { status: 409 })
  }
  if (!run.workflow_run_id) {
    return NextResponse.json({ error: 'Run ainda não foi registrado no Workflow SDK.' }, { status: 409 })
  }

  try {
    // Cancelamento programático confirmado no SDK: `Run.cancel()` (ver
    // dist/runtime/run.d.ts em 'workflow' 4.6.0 — não recebe argumentos
    // nesta versão), não apenas via CLI.
    const workflowRun = getRun(run.workflow_run_id)
    await workflowRun.cancel()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao cancelar o workflow.'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  await supabase.from('pipeline_runs').update({ status: 'cancelled' }).eq('id', runId)

  return NextResponse.json({ ok: true })
}
