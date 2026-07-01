/**
 * app/login/page.tsx
 * Rota: /login
 */

'use client'

import { useRouter } from 'next/navigation'
import AuthGate from '@/components/AuthGate'
// Em produção:
// import { createBrowserClient } from '@supabase/ssr'

export default function LoginPage() {
  const router = useRouter()

  async function handleLogin({ provider, email }: { provider: string; email?: string }) {
    // Em produção:
    // const supabase = createBrowserClient(url, anonKey)
    // if (provider === 'magic') {
    //   const { error } = await supabase.auth.signInWithOtp({ email })
    //   if (error) throw error
    //   return // usuário clica no link do email e cai em /dashboard
    // }
    // const { error } = await supabase.auth.signInWithOAuth({ provider })
    // if (error) throw error

    // Placeholder de desenvolvimento:
    console.log('login', { provider, email })
    router.push('/dashboard')
  }

  return <AuthGate onLogin={handleLogin} />
}
