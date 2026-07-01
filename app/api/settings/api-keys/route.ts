/**
 * GET    /api/settings/api-keys  → lista providers configurados (mascarados)
 * POST   /api/settings/api-keys  → salva/atualiza uma key (criptografada)
 * DELETE /api/settings/api-keys  → remove a key de um provider
 *
 * Body (POST/DELETE): { provider: string, apiKey?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  // Em produção:
  // const { data } = await supabase
  //   .from('user_api_keys')
  //   .select('provider, created_at')
  //   .eq('user_id', user.id)
  // (nunca retornar a key em texto puro — só os providers configurados)

  return NextResponse.json({ providers: [] })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const body = (await req.json()) as { provider: string; apiKey: string }
  if (!body.provider || !body.apiKey?.trim()) {
    return NextResponse.json({ error: 'provider e apiKey são obrigatórios.' }, { status: 400 })
  }

  // Em produção:
  // const encrypted = await encryptViaVault(body.apiKey)
  // await supabase.from('user_api_keys').upsert({
  //   user_id: user.id, provider: body.provider, encrypted_key: encrypted,
  // }, { onConflict: 'user_id,provider' })

  return NextResponse.json({ ok: true, provider: body.provider })
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const body = (await req.json()) as { provider: string }

  // Em produção:
  // await supabase.from('user_api_keys').delete()
  //   .eq('user_id', user.id).eq('provider', body.provider)

  return NextResponse.json({ ok: true })
}
