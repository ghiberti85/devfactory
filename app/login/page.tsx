/**
 * app/login/page.tsx
 * Rota: /login
 */

'use client'

import AuthGate from '@/components/AuthGate'
import { createSupabaseBrowserClient } from '@/lib/devfactory/supabase-browser'

export default function LoginPage() {
  async function handleLogin({ provider, email }: { provider: string; email?: string }) {
    const supabase = createSupabaseBrowserClient()
    const redirectTo = `${window.location.origin}/auth/callback`

    if (provider === 'magic') {
      const { error } = await supabase.auth.signInWithOtp({
        email: email!,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) throw error
      return // usuário clica no link do email e cai em /auth/callback → /dashboard
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider as 'github' | 'google',
      options: { redirectTo },
    })
    if (error) throw error
    // signInWithOAuth já redireciona o browser — nada a fazer depois daqui.
  }

  return <AuthGate onLogin={handleLogin} />
}
