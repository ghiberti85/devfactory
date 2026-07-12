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
    githubRepo,
    config,
  }: {
    projectName: string
    briefing: string
    githubRepo?: { owner: string; repo: string; branch?: string }
    config: Record<string, unknown>
  }) {
    const projectRes = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, briefing, githubRepo, config }),
    })

    if (!projectRes.ok) {
      const { error } = await projectRes.json().catch(() => ({ error: 'Falha ao criar o projeto.' }))
      alert(error)
      return
    }

    const { projectId } = await projectRes.json()

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        projectName,
        briefing,
        githubRepo,
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
