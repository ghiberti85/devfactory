/**
 * app/runs/[runId]/page.tsx
 * Rota: /runs/[runId]
 */

import HumanGate from '@/components/HumanGate'

export default function RunPage({ params }: { params: { runId: string } }) {
  return <HumanGate runId={params.runId} />
}
