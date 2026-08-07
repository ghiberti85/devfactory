/**
 * GET /api/runs/[runId]/edit/[editId]/stream
 *
 * Ponte de polling → SSE pro "✎ Ajustar", mesmo padrão de
 * app/api/runs/[runId]/stream/route.ts: lê do Postgres (run_edits), não de
 * getRun() do Workflow SDK, porque precisamos do estado intermediário
 * (awaiting_review) enquanto o workflow está suspenso esperando decisão.
 */

import { NextRequest } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

export const maxDuration = 300

const POLL_INTERVAL_MS = 2000
const MAX_STREAM_MS     = (maxDuration - 30) * 1000

const TERMINAL_STATUSES = ['completed', 'failed', 'rejected']

function encodeSSE(type: string, payload: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, payload, timestamp: new Date().toISOString() })}\n\n`
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; editId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { editId } = await params
  const encoder = new TextEncoder()
  let lastSnapshotJSON = ''

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now()

      while (Date.now() - startedAt < MAX_STREAM_MS) {
        const supabase = createSupabaseServerClient(req)
        const { data } = await supabase
          .from('run_edits')
          .select('*')
          .eq('id', editId)
          .eq('user_id', user.id)
          .single()

        if (!data) {
          controller.enqueue(encoder.encode(encodeSSE('edit.not_found', { editId })))
          controller.close()
          return
        }

        const snapshotJSON = JSON.stringify(data)
        if (snapshotJSON !== lastSnapshotJSON) {
          lastSnapshotJSON = snapshotJSON
          controller.enqueue(encoder.encode(encodeSSE('edit.snapshot', data)))

          if (TERMINAL_STATUSES.includes(data.status)) {
            controller.close()
            return
          }
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      }

      controller.close() // timeout de segurança — EventSource do browser reconecta sozinho
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
