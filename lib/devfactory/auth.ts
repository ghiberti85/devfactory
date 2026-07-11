/**
 * DevFactory — Auth Helper
 * lib/devfactory/auth.ts
 *
 * Resolve o usuário autenticado a partir da request, usando Supabase Auth.
 * Toda rota que toca runs ou API keys deve passar por aqui — é o que garante
 * que um usuário só acesse seus próprios dados (combinado com RLS no banco).
 */

import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from './supabase'

export interface SessionUser {
  id: string
  email: string
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const supabase = createSupabaseServerClient(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return null
  return { id: user.id, email: user.email }
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Não autenticado.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
