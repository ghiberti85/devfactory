/**
 * GET    /api/runs/[runId]  → snapshot do estado atual
 * DELETE /api/runs/[runId]  → cancela o workflow em andamento
 *
 * CORREÇÃO IMPORTANTE em relação à primeira versão deste arquivo: getRun()
 * do Workflow SDK provavelmente só expõe o retorno FINAL da função workflow
 * (disponível quando ela termina) — não variáveis locais enquanto o
 * workflow está suspenso em `await hook` esperando o gate humano. Por isso,
 * o snapshot "ao vivo" (etapa atual, token do gate, outputs parciais) tem
 * que vir do Postgres, que os steps de persistência (persistAwaitingHumanStep,
 * persistGateDecisionStep em pipeline-workflow.ts) já escrevem a cada
 * transição. getRun() entra só como cross-check de status terminal
 * (completed/failed) e para recuperar o output final quando o run acabou.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRun } from 'workflow/api'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  // Fonte primária: Postgres (pipeline_runs + stage_outputs + stage_iterations)
  // Em produção:
  // const { data: run } = await supabase
  //   .from('pipeline_runs')
  //   .select('*, stage_outputs(*, stage_iterations(*))')
  //   .eq('id', params.runId)
  //   .single()
  // if (!run) return NextResponse.json({ error: 'Run não encontrado.' }, { status: 404 })
  // if (run.user_id !== user.id) return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  // if (['completed', 'failed'].includes(run.status)) {
  //   // Cross-check / complementa com o output final do workflow, se disponível
  //   try {
  //     const wfRun = await getRun(params.runId)
  //     return NextResponse.json({ ...run, finalOutput: (wfRun as any).output })
  //   } catch { /* getRun pode já ter expirado a retenção — não é fatal */ }
  // }
  // return NextResponse.json(run)

  return NextResponse.json(
    { error: 'Implementar leitura de pipeline_runs no Supabase — ver comentário acima.' },
    { status: 501 },
  )
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  // ⚠️ O Workflow SDK expõe cancelamento via CLI ("Use the Workflow SDK CLI
  // to cancel runs that should no longer wait" — doc de Hooks & Webhooks).
  // Verificar se também existe uma função programática equivalente em
  // 'workflow/api' (ex: cancelRun) antes de usar isto em produção — não
  // confirmei isso com uma busca direta.
  return NextResponse.json(
    { error: 'Cancelamento programático ainda não implementado — verificar API atual do Workflow SDK.' },
    { status: 501 },
  )
}
