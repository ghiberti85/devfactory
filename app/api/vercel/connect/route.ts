/**
 * GET    /api/vercel/connect  → inicia o fluxo OAuth + PKCE da Vercel
 * DELETE /api/vercel/connect  → desconecta a conta Vercel do usuário
 */

import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { buildAuthorizeUrl } from '@/lib/devfactory/vercel-connector'

function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/vercel/connect/callback`
}

function randomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes, b => charset[b % charset.length]).join('')
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const state        = randomString(43)
  const nonce         = randomString(43)
  const codeVerifier  = crypto.randomBytes(43).toString('hex')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const authorizeUrl = buildAuthorizeUrl({
    redirectUri:   redirectUri(),
    state,
    nonce,
    codeChallenge,
  })

  const response = NextResponse.redirect(authorizeUrl)

  // Cookies curtos (10min) só pra sobreviver ao round-trip até o callback —
  // nunca persistidos, nunca chegam ao Postgres.
  const cookieOpts = { maxAge: 600, httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' }
  response.cookies.set('vercel_oauth_state', state, cookieOpts)
  response.cookies.set('vercel_oauth_verifier', codeVerifier, cookieOpts)

  return response
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const supabase = createSupabaseServerClient(req)
  const { error } = await supabase.from('user_vercel_connections').delete().eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: `Falha ao desconectar a Vercel: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
