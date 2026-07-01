/**
 * app/dashboard/page.tsx
 * Rota: /dashboard
 */

'use client'

import { useRouter } from 'next/navigation'
import Dashboard from '@/components/Dashboard'

export default function DashboardPage() {
  const router = useRouter()

  return <Dashboard onNewProject={() => router.push('/projects/new')} />
}
