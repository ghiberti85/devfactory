/**
 * POST /api/runs/[runId]/edit/[editId]/decision
 *
 * Resolve o hook do "✎ Ajustar" — equivalente ao gate humano da pipeline
 * principal (app/api/runs/[runId]/gate/route.ts), mas pro workflow de
 * ajuste pontual. Aprovar segue pra commit+deploy (applyEditStep); rejeitar
 * encerra sem tocar em nada.
 */

import { NextRequest, NextResponse } from 'next/server'
import { editGateHook } from '@/lib/devfactory/edit-workflow'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; editId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { editId } = await params
  const body = await req.json().catch(() => ({}))
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null
  if (!decision) {
    return NextResponse.json({ error: 'decision precisa ser "approved" ou "rejected".' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(req)
  const { data: edit, error } = await supabase
    .from('run_edits')
    .select('user_id, gate_token, status')
    .eq('id', editId)
    .single()

  if (error || !edit) {
    return NextResponse.json({ error: 'Ajuste não encontrado.' }, { status: 404 })
  }
  if (edit.user_id !== user.id) {
    return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  }
  if (edit.status !== 'awaiting_review' || !edit.gate_token) {
    return NextResponse.json({ error: 'Este ajuste não está aguardando revisão (talvez já tenha sido decidido).' }, { status: 409 })
  }

  try {
    await editGateHook.resume(edit.gate_token, { decision })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao resolver a decisão.'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  return NextResponse.json({ ok: true })
}
