/**
 * GET /api/vercel/status
 * Diz se o usuário tem a Vercel conectada — usado pelo card de conexão em
 * /settings/api-keys, mesmo padrão de GET /api/github/repos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const supabase = createSupabaseServerClient(req)
  const { data } = await supabase
    .from('user_vercel_connections')
    .select('vercel_user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json({ connected: false })

  return NextResponse.json({ connected: true, vercelUserId: data.vercel_user_id })
}
