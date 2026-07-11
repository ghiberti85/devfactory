/**
 * GET    /api/settings/api-keys  → lista providers configurados (mascarados)
 * POST   /api/settings/api-keys  → salva/atualiza uma key (criptografada)
 * DELETE /api/settings/api-keys  → remove a key de um provider
 *
 * Body (POST/DELETE): { provider: string, apiKey?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { encryptSecret } from '@/lib/devfactory/crypto'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const supabase = createSupabaseServerClient(req)
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('provider, created_at')
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: `Falha ao listar API keys: ${error.message}` }, { status: 500 })
  }

  // Nunca retorna a key em texto puro — só os providers configurados.
  return NextResponse.json({ providers: data ?? [] })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const body = (await req.json()) as { provider: string; apiKey: string }
  if (!body.provider || !body.apiKey?.trim()) {
    return NextResponse.json({ error: 'provider e apiKey são obrigatórios.' }, { status: 400 })
  }

  const encrypted = encryptSecret(body.apiKey)
  const supabase = createSupabaseServerClient(req)
  const { error } = await supabase.from('user_api_keys').upsert({
    user_id:       user.id,
    provider:      body.provider,
    encrypted_key: encrypted,
  }, { onConflict: 'user_id,provider' })

  if (error) {
    return NextResponse.json({ error: `Falha ao salvar a API key: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, provider: body.provider })
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const body = (await req.json()) as { provider: string }
  if (!body.provider) {
    return NextResponse.json({ error: 'provider é obrigatório.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(req)
  const { error } = await supabase.from('user_api_keys').delete()
    .eq('user_id', user.id).eq('provider', body.provider)

  if (error) {
    return NextResponse.json({ error: `Falha ao remover a API key: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
