import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DevFactory',
  description: 'Autonomous Software Factory — agentes de IA por etapa, custo otimizado',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
