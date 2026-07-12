/**
 * GET /auth/callback
 *
 * Destino de redirect do Supabase Auth após o usuário clicar no magic link
 * ou completar o fluxo OAuth (Google/GitHub). Troca o `code` (PKCE) pela
 * sessão e grava os cookies — sem essa rota, signInWithOtp/signInWithOAuth
 * redirecionam de volta com um `code` que nunca vira sessão.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const next = req.nextUrl.searchParams.get('next') ?? '/dashboard'

  if (!code) {
    return NextResponse.redirect(new URL('/login?auth_error=1', req.url))
  }

  const response = NextResponse.redirect(new URL(next, req.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL('/login?auth_error=1', req.url))
  }

  return response
}
