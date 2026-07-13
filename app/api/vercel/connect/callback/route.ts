/**
 * GET /api/vercel/connect/callback
 * Recebe o `code` da Vercel, valida o `state` contra o cookie do PKCE,
 * troca por access/refresh token e salva criptografado.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'
import { exchangeCodeForToken, getVercelUser } from '@/lib/devfactory/vercel-connector'
import { encryptSecret } from '@/lib/devfactory/crypto'

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')

  const cookieState    = req.cookies.get('vercel_oauth_state')?.value
  const codeVerifier    = req.cookies.get('vercel_oauth_verifier')?.value

  if (!code || !state || !cookieState || state !== cookieState || !codeVerifier) {
    return NextResponse.redirect(new URL('/settings/api-keys?vercel_error=1', req.url))
  }

  const sessionUser = await getSessionUser(req)
  if (!sessionUser) {
    return NextResponse.redirect(new URL('/settings/api-keys?vercel_error=1', req.url))
  }

  try {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/vercel/connect/callback`
    const token = await exchangeCodeForToken({ code, codeVerifier, redirectUri })
    const vercelUser = await getVercelUser(token.access_token)

    const supabase = createSupabaseServerClient(req)
    const { error } = await supabase.from('user_vercel_connections').upsert({
      user_id:                sessionUser.id,
      encrypted_access_token:  encryptSecret(token.access_token),
      encrypted_refresh_token: token.refresh_token ? encryptSecret(token.refresh_token) : null,
      vercel_user_id:         vercelUser.id,
      scope:                  token.scope,
      expires_at:             new Date(Date.now() + token.expires_in * 1000).toISOString(),
    }, { onConflict: 'user_id' })

    if (error) throw error

    const response = NextResponse.redirect(new URL('/settings/api-keys?vercel_connected=1', req.url))
    response.cookies.delete('vercel_oauth_state')
    response.cookies.delete('vercel_oauth_verifier')
    return response
  } catch {
    return NextResponse.redirect(new URL('/settings/api-keys?vercel_error=1', req.url))
  }
}
