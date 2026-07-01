/**
 * DevFactory — Auth Helper
 * lib/devfactory/auth.ts
 *
 * Resolve o usuário autenticado a partir da request, usando Supabase Auth.
 * Toda rota que toca runs ou API keys deve passar por aqui — é o que garante
 * que um usuário só acesse seus próprios dados (combinado com RLS no banco).
 */

import { NextRequest } from 'next/server'
// Em produção:
// import { createServerClient } from '@supabase/ssr'
// import { cookies } from 'next/headers'

export interface SessionUser {
  id: string
  email: string
}

export async function getSessionUser(_req: NextRequest): Promise<SessionUser | null> {
  // Em produção:
  // const supabase = createServerClient(url, anonKey, { cookies: () => cookies() })
  // const { data: { user } } = await supabase.auth.getUser()
  // if (!user) return null
  // return { id: user.id, email: user.email! }

  // Placeholder de desenvolvimento — substitua pela integração real acima.
  return { id: 'usr_dev_placeholder', email: 'dev@devfactory.app' }
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Não autenticado.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
