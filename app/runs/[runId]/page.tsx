/**
 * app/runs/[runId]/page.tsx
 * Rota: /runs/[runId]
 */

import HumanGate from '@/components/HumanGate'

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  return <HumanGate runId={runId} />
}
