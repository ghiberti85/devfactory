/**
 * app/projects/new/page.tsx
 * Rota: /projects/new
 */

'use client'

import { useRouter } from 'next/navigation'
import NewProjectForm from '@/components/NewProjectForm'

export default function NewProjectPage() {
  const router = useRouter()

  async function handleSubmit({
    projectName,
    briefing,
    config,
  }: {
    projectName: string
    briefing: string
    config: Record<string, unknown>
  }) {
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: crypto.randomUUID(),
        projectName,
        briefing,
        config,
      }),
    })

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Falha ao iniciar o run.' }))
      alert(error)
      return
    }

    const { runId } = await res.json()
    router.push(`/runs/${runId}`)
  }

  return (
    <NewProjectForm
      onSubmit={handleSubmit}
      onCancel={() => router.push('/dashboard')}
    />
  )
}
