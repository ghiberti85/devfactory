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

// 800s é o máximo GA do Fluid Compute em planos Pro/Enterprise (confirmado
// via docs.vercel.com/functions/limitations). Hobby fica em 300s.
export const maxDuration = 800

const POLL_INTERVAL_MS = 2000
const MAX_STREAM_MS     = (maxDuration - 30) * 1000

function encodeSSE(type: string, payload: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, payload, timestamp: new Date().toISOString() })}\n\n`
}

interface RunSnapshot {
  status: string
  [key: string]: unknown
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- usados na query real comentada abaixo
async function fetchRunSnapshot(runId: string, userId: string): Promise<RunSnapshot | null> {
  // Em produção:
  // const { data } = await supabase
  //   .from('pipeline_runs')
  //   .select('*, stage_outputs(*, stage_iterations(*))')
  //   .eq('id', runId)
  //   .eq('user_id', userId)
  //   .single()
  // return data

  return null  // placeholder — implementar a query acima
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

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now()

      while (Date.now() - startedAt < MAX_STREAM_MS) {
        const snapshot = await fetchRunSnapshot(runId, user.id)

        if (!snapshot) {
          controller.enqueue(encoder.encode(encodeSSE('run.not_found', { runId })))
          controller.close()
          return
        }

        const snapshotJSON = JSON.stringify(snapshot)
        if (snapshotJSON !== lastSnapshotJSON) {
          lastSnapshotJSON = snapshotJSON
          controller.enqueue(encoder.encode(encodeSSE('run.snapshot', snapshot)))

          if (['completed', 'failed', 'cancelled'].includes(snapshot.status)) {
            controller.enqueue(encoder.encode(encodeSSE(`run.${snapshot.status}`, snapshot)))
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
