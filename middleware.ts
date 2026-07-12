/**
 * middleware.ts (raiz do projeto)
 *
 * Protege todas as rotas exceto /login e assets estáticos, validando a
 * sessão real do Supabase Auth (não apenas a presença de um cookie por
 * nome). Também repassa cookies renovados (refresh de token) na resposta —
 * sem isso, sessões expiram silenciosamente em navegação client-side.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const isPublicRoute =
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/auth/callback')

  let response = NextResponse.next({ request: req })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          response = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return response
}

export const config = {
  // .well-known/workflow/* fica de fora: são as chamadas internas do Workflow
  // SDK (resume de steps/hooks) — interceptá-las com o gate de auth acima
  // quebra a execução/retomada dos workflows.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)'],
}
