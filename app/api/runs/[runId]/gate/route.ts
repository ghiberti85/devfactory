/**
 * POST /api/runs/[runId]/gate
 * Submete a decisão do gate humano — resolve o hook que está pausando o
 * workflow naquela etapa específica, fazendo-o continuar exatamente de
 * onde parou (possivelmente dias depois, sem nenhum processo rodando
 * esperando nesse meio tempo).
 *
 * O token precisa bater exatamente com o gerado em pipeline-workflow.ts
 * (gateToken: `devfactory:${runId}:${stage}:${iteration}`). O front recebe
 * esse token via o snapshot do run (campo gate_token gravado por
 * persistAwaitingHumanStep) e o reenvia aqui.
 */

import { NextRequest, NextResponse } from 'next/server'
import { humanGateHook } from '@/lib/devfactory/pipeline-workflow'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'

export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const body = (await req.json()) as {
    token:        string  // veio do snapshot do run (ver app/api/runs/[runId]/route.ts)
    decision:     'approved' | 'rejected' | 'edited'
    feedback?:    string
    editedOutput?: unknown
  }

  if (!body.token) {
    return NextResponse.json({ error: 'token do gate é obrigatório.' }, { status: 400 })
  }

  // Validação de ownership: o token do gate só pode ser resolvido pelo
  // dono do run. Sem isso, qualquer usuário autenticado que adivinhasse um
  // token poderia interferir no run de outra pessoa.
  const isOwner = await verifyGateTokenOwnership(body.token, user.id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Token inválido ou run não pertence a este usuário.' }, { status: 403 })
  }

  try {
    await humanGateHook.resume(body.token, {
      decision:     body.decision,
      feedback:     body.feedback,
      editedOutput: body.editedOutput,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao resolver o gate.'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  return NextResponse.json({ ok: true })
}

// ─── Ownership check ──────────────────────────────────────────────────────────

async function verifyGateTokenOwnership(token: string, userId: string): Promise<boolean> {
  // O token tem o formato `devfactory:{runId}:{stage}:{iteration}` —
  // extrai o runId e confere contra pipeline_runs.user_id.
  const parts = token.split(':')
  if (parts.length < 4 || parts[0] !== 'devfactory') return false
  const runId = parts[1]

  // Em produção:
  // const { data } = await supabase
  //   .from('pipeline_runs')
  //   .select('user_id')
  //   .eq('id', runId)
  //   .single()
  // return data?.user_id === userId

  console.log(`[DevFactory] Verificando ownership do run ${runId} para user ${userId} (placeholder — sempre true em dev)`)
  return true
}
