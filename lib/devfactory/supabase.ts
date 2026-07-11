/**
 * DevFactory — Supabase Client Factory
 * lib/devfactory/supabase.ts
 *
 * Dois clientes, dois propósitos distintos (ver regra de segurança #5 no
 * CLAUDE.md):
 *
 * 1. createSupabaseServerClient(req) — client escopado à sessão do usuário
 *    (via cookies da request). Usa a anon key + RLS. É o que TODA rota de
 *    API que lida com dados de usuário deve usar.
 *
 * 2. createSupabaseServiceClient() — client com service_role, que ignora
 *    RLS. Reservado para: (a) operações de admin (seed do model registry),
 *    e (b) steps do Workflow SDK, que rodam em background sem cookies de
 *    sessão HTTP disponíveis — nesse caso, cada query já filtra
 *    explicitamente por user_id/run_id como segunda camada de isolamento.
 */

import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`)
  return value
}

export function createSupabaseServerClient(req: NextRequest) {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  // Rotas de API não escrevem cookies de resposta (não há refresh de sessão
  // aqui — isso acontece no middleware/browser client). setAll() é um no-op
  // intencional.
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: () => {},
    },
  })
}

export function createSupabaseServiceClient() {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

  return createServerClient(url, serviceKey, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
  })
}
