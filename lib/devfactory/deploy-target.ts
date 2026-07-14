/**
 * DevFactory — Classificador de Deploy Target
 * lib/devfactory/deploy-target.ts
 *
 * Decide se o projeto gerado cabe no deploy automático (Vercel serverless)
 * ou só na exportação manual (zip/repo, sem botão "Publicar"). Regra
 * determinística (grep de padrões), não um julgamento do LLM — mais barato,
 * auditável, e não varia de execução pra execução com o mesmo input.
 *
 * Critério (ver conversa de design): cabe em serverless se, e só se, toda
 * comunicação é request/response HTTP, sem processo em background contínuo
 * e sem dependência de runtime que a Vercel não hospeda.
 */

import type { DeployTarget } from './types'

// Padrões que indicam arquitetura incompatível com serverless — cada um
// captura uma classe de motivo, usada na mensagem explicativa pro usuário.
const DISQUALIFYING_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bwebsocket\b/i,                          reason: 'comunicação via WebSocket persistente' },
  { pattern: /\bsocket\.io\b/i,                          reason: 'comunicação via Socket.IO (WebSocket persistente)' },
  { pattern: /\blong[- ]?polling\b/i,                    reason: 'long polling de conexão mantida aberta' },
  { pattern: /\b(worker|daemon)\b.{0,30}\b(background|contínu|24\/7|persistente)/i, reason: 'processo em background contínuo' },
  { pattern: /\b(cron job|scheduled job|job scheduler)\b.{0,30}\b(interno|próprio|custom)/i, reason: 'scheduler próprio rodando dentro do processo (crons pontuais via Vercel Cron cabem, um scheduler interno não)' },
  { pattern: /\bmessage queue\b|\brabbitmq\b|\bkafka\b|\bbullmq\b.{0,30}\bworker/i, reason: 'fila de mensagens com worker consumidor de longa duração' },
  { pattern: /\bffmpeg\b|\bvideo (encoding|transcod)/i,  reason: 'processamento de vídeo (binário/tempo de execução incompatível com serverless)' },
  { pattern: /\bgpu\b.{0,20}\b(required|necess[aá]rio|inference)/i, reason: 'dependência de GPU' },
  { pattern: /\btcp socket\b|\braw socket\b|\bnon-http protocol\b/i, reason: 'protocolo não-HTTP' },
]

export interface DeployTargetClassification {
  target: DeployTarget
  reason: string
}

export function classifyDeployTarget(specText: string): DeployTargetClassification {
  for (const { pattern, reason } of DISQUALIFYING_PATTERNS) {
    if (pattern.test(specText)) {
      return {
        target: 'manual-export',
        reason: `Não elegível para deploy automático: ${reason}. Baixe o projeto e hospede num ambiente que suporte essa arquitetura.`,
      }
    }
  }

  return {
    target: 'vercel-serverless',
    reason: 'Elegível para deploy automático — arquitetura request/response HTTP, sem processo em background contínuo.',
  }
}
