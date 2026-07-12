/**
 * GET /api/runs/[runId]/stream
 *
 * Ponte de polling → SSE, lendo do Postgres (não de getRun()).
 *
 * Por quê Postgres e não os primitivos de streaming nativos do Workflow SDK
 * (getWritable(), DurableAgent streams)? Duas razões:
 *
 * 1. Confirmei a existência do recurso ("Streams: Stream data in and out of
 *    workflows with managed persistence") mas não verifiquei a assinatura
 *    exata o suficiente pra confiar em produção.
 * 2. getRun() provavelmente só expõe o retorno FINAL da função workflow —
 *    não o estado intermediário enquanto ela está suspensa esperando um
 *    gate humano (ver comentário em app/api/runs/[runId]/route.ts). O
 *    Postgres, atualizado a cada step de persistência em
 *    pipeline-workflow.ts, é a única fonte confiável de progresso ao vivo
 *    com a informação que tenho agora.
 *
 * Migração recomendada quando a API de streams nativa for validada: trocar
 * o polling abaixo por leitura direta do stream durável do workflow —
 * eliminaria a query repetida e o atraso de até POLL_INTERVAL_MS.
 */

import { NextRequest } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { mapDbRunToProjectRun, type DbPipelineRunRow, type DbProjectRow } from '@/lib/devfactory/run-mapper'
import type { ProjectRun } from '@/lib/devfactory/types'

// 300s é o teto do plano Hobby (confirmado em produção: a Vercel rejeita o
// deploy com "invalid_max_duration" acima disso). Planos Pro/Enterprise com
// Fluid Compute suportam até 800s — subir esse valor quando o projeto migrar.
export const maxDuration = 300

const POLL_INTERVAL_MS = 2000
const MAX_STREAM_MS     = (maxDuration - 30) * 1000

function encodeSSE(type: string, stage: string | null, payload: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, stage, payload, timestamp: new Date().toISOString() })}\n\n`
}

async function fetchRunSnapshot(
  req: NextRequest,
  runId: string,
  userId: string,
): Promise<ProjectRun | null> {
  const supabase = createSupabaseServerClient(req)
  const { data } = await supabase
    .from('pipeline_runs')
    .select('*, stage_outputs(*, stage_iterations(*), quality_reports(*)), projects(*)')
    .eq('id', runId)
    .eq('user_id', userId)
    .single()

  if (!data) return null

  const project = data.projects as unknown as DbProjectRow
  const qualityReportRows = (data.stage_outputs ?? []).flatMap(
    (so: { quality_reports?: unknown[] }) => so.quality_reports ?? [],
  )
  return mapDbRunToProjectRun(data as unknown as DbPipelineRunRow, project, qualityReportRows as never[])
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { runId } = await params
  const encoder = new TextEncoder()
  let lastSnapshotJSON = ''
  let lastStatus: string | null = null
  let sentStarted = false

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now()

      while (Date.now() - startedAt < MAX_STREAM_MS) {
        const snapshot = await fetchRunSnapshot(req, runId, user.id)

        if (!snapshot) {
          controller.enqueue(encoder.encode(encodeSSE('run.not_found', null, { runId })))
          controller.close()
          return
        }

        const snapshotJSON = JSON.stringify(snapshot)
        if (snapshotJSON !== lastSnapshotJSON) {
          lastSnapshotJSON = snapshotJSON
          controller.enqueue(encoder.encode(encodeSSE('run.snapshot', snapshot.currentStage, snapshot)))

          if (!sentStarted && snapshot.status === 'running') {
            sentStarted = true
            controller.enqueue(encoder.encode(encodeSSE('run.started', snapshot.currentStage, snapshot)))
          }

          // Transição de status dispara os eventos semânticos que
          // components/HumanGate.tsx escuta (stage.started/awaiting_human)
          // — sem isso o snapshot chega, mas a UI nunca abre o painel de
          // aprovação nem atualiza o status visível.
          if (snapshot.status !== lastStatus) {
            if (snapshot.status === 'awaiting_human') {
              controller.enqueue(encoder.encode(encodeSSE('stage.awaiting_human', snapshot.currentStage, snapshot)))
            } else if (snapshot.status === 'running' && lastStatus === 'awaiting_human') {
              controller.enqueue(encoder.encode(encodeSSE('stage.started', snapshot.currentStage, snapshot)))
            }
            lastStatus = snapshot.status
          }

          if (['completed', 'failed', 'cancelled'].includes(snapshot.status)) {
            controller.enqueue(encoder.encode(encodeSSE(`run.${snapshot.status}`, snapshot.currentStage, snapshot)))
            controller.close()
            return
          }
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      }

      controller.close()  // timeout de segurança — EventSource do browser reconecta sozinho
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
