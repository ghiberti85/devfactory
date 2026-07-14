import { describe, expect, it } from 'vitest'
import { classifyDeployTarget } from '@/lib/devfactory/deploy-target'

describe('classifyDeployTarget', () => {
  it('classifica uma spec HTTP simples (CRUD) como elegível pra deploy automático', () => {
    const spec = JSON.stringify({
      api_contracts: [{ method: 'POST', path: '/api/contacts', body: { name: 'string', email: 'string' } }],
      db_schema: 'create table contacts (id uuid primary key, name text, email text)',
    })
    const result = classifyDeployTarget(spec)
    expect(result.target).toBe('vercel-serverless')
  })

  it('classifica uma spec com WebSocket como não elegível', () => {
    const spec = JSON.stringify({
      api_contracts: [{ method: 'GET', path: '/ws', description: 'canal de chat em tempo real via websocket' }],
    })
    const result = classifyDeployTarget(spec)
    expect(result.target).toBe('manual-export')
    expect(result.reason).toMatch(/websocket/i)
  })

  it('classifica um worker de fila em background como não elegível', () => {
    const spec = JSON.stringify({
      tech_stack: 'BullMQ worker consumindo a fila de emails em background contínuo',
    })
    const result = classifyDeployTarget(spec)
    expect(result.target).toBe('manual-export')
  })

  it('não derruba por falso positivo de "cron" pontual (ex: Vercel Cron)', () => {
    const spec = JSON.stringify({
      tech_stack: 'usa Vercel Cron para disparar um job diário de limpeza via API route',
    })
    const result = classifyDeployTarget(spec)
    expect(result.target).toBe('vercel-serverless')
  })
})
