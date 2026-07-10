/**
 * DevFactory — Seed do Model Registry
 * scripts/seed-models.ts
 *
 * Popula a tabela `models` do Supabase a partir de DEFAULT_MODELS
 * (lib/devfactory/model-selector.ts — fonte da verdade do catálogo).
 * Idempotente: recria o catálogo do zero a cada execução, já que `models`
 * é tabela de catálogo compartilhado, não dado de usuário.
 *
 * Uso: npm run db:seed
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY — só é seguro aqui porque é um script de
 * seed rodado manualmente, nunca um route handler (ver docs/security.md).
 */

import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_MODELS, type Model } from '../lib/devfactory/model-selector'

if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local')
}

function toRow(model: Model) {
  return {
    name:               model.name,
    display_name:       model.displayName,
    provider:           model.provider,
    model_id:           model.modelId,
    is_default:         model.isDefault,
    is_active:          model.isActive,
    is_local:           model.isLocal,
    tier_capability:    model.tierCapability,
    context_window:     model.contextWindow,
    strengths:          model.strengths,
    cost_input_per_1m:  model.costInputPer1M,
    cost_output_per_1m: model.costOutputPer1M,
    has_free_tier:      model.hasFreeTier,
    free_tier_rpm:      model.freeTierRpm ?? null,
    free_tier_rpd:      model.freeTierRpd ?? null,
    latency_profile:    model.latencyProfile,
    api_endpoint:       model.apiEndpoint ?? null,
    license:            model.license ?? null,
    origin:             model.origin,
  }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios (configure em .env.local).',
    )
  }

  const supabase = createClient(url, serviceKey)

  const { error: deleteError } = await supabase
    .from('models')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (deleteError) throw deleteError

  const rows = DEFAULT_MODELS.map(toRow)
  const { error: insertError } = await supabase.from('models').insert(rows)
  if (insertError) throw insertError

  console.log(`[seed-models] ${rows.length} modelos inseridos em 'models'.`)
}

main().catch(err => {
  console.error('[seed-models] Falhou:', err)
  process.exit(1)
})
