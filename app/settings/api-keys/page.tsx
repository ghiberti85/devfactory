/**
 * app/settings/api-keys/page.tsx
 * Rota: /settings/api-keys
 */

'use client'

import { useRouter } from 'next/navigation'
import ApiKeysSettings from '@/components/ApiKeysSettings'

export default function ApiKeysPage() {
  const router = useRouter()

  return <ApiKeysSettings onBack={() => router.push('/dashboard')} />
}
