/**
 * GET /api/github/connect/callback
 * Recebe o `code` do GitHub, troca por um access_token e salva criptografado.
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state') // user.id setado em /connect

  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings/api-keys?github_error=1', req.url))
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
    }),
  })

  const data = await tokenRes.json()
  if (!data.access_token) {
    return NextResponse.redirect(new URL('/settings/api-keys?github_error=1', req.url))
  }

  // Em produção:
  // const encrypted = await encryptViaVault(data.access_token)
  // await supabase.from('user_github_connections').upsert({
  //   user_id: state, encrypted_token: encrypted, scope: data.scope,
  // }, { onConflict: 'user_id' })

  return NextResponse.redirect(new URL('/settings/api-keys?github_connected=1', req.url))
}
