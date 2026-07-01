/**
 * middleware.ts (raiz do projeto)
 *
 * Protege todas as rotas exceto /login e assets estáticos.
 * Em produção, troque a checagem de cookie por validação real de sessão
 * Supabase (createServerClient + getUser()).
 */

import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const isAuthed = req.cookies.has('sb-access-token') // ajuste para o cookie real do Supabase Auth
  const isPublicRoute = req.nextUrl.pathname.startsWith('/login')

  if (!isAuthed && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
