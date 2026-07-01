import { withWorkflow } from 'workflow/next'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

// Habilita as diretivas "use workflow" e "use step" (pipeline-workflow.ts) —
// sem isso o build da Vercel falha ao processar esses arquivos, já que é
// o passo de build do Workflow SDK que registra os handlers de step/workflow.
export default withWorkflow(nextConfig)
