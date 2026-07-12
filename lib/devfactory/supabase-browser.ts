/**
 * DevFactory — Supabase Browser Client
 * lib/devfactory/supabase-browser.ts
 *
 * Client escopado ao browser (usa localStorage/cookies do próprio navegador
 * para a sessão) — usado pela tela de login e por qualquer componente
 * client-side que precise chamar supabase.auth diretamente. Não confundir
 * com lib/devfactory/supabase.ts, que é server-side (rotas de API).
 */

import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
