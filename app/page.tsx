/**
 * app/page.tsx
 * Rota: /
 *
 * Em produção, o middleware.ts (veja arquivo na raiz) já redireciona
 * usuários não autenticados para /login antes de chegar aqui. Esta página
 * só decide entre dashboard e login como fallback.
 */

import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/dashboard')
}
