/**
 * GET    /api/github/connect  → redireciona para o fluxo OAuth do GitHub
 * DELETE /api/github/connect  → desconecta a conta GitHub do usuário
 *
 * Fluxo completo (a implementar com a GitHub App real):
 *   1. GET inicia o redirect para github.com/login/oauth/authorize
 *      com scope 'repo' (ou 'public_repo' se só repos públicos forem necessários)
 *   2. Callback troca o `code` por um access_token
 *   3. Token é criptografado e salvo em user_github_connections
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/github/connect/callback`

  const authorizeUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=repo` +
    `&state=${user.id}` // usado no callback para associar o token ao usuário certo

  return NextResponse.redirect(authorizeUrl)
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const supabase = createSupabaseServerClient(req)
  const { error } = await supabase.from('user_github_connections').delete().eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: `Falha ao desconectar o GitHub: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
