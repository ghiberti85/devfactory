/**
 * DevFactory — User Credentials Resolver
 * lib/devfactory/run-registry.ts
 *
 * Resolve credenciais do usuário atual (BYOK de modelos LLM + token do
 * GitHub). Chamado tanto de rotas de API (com sessão HTTP) quanto de dentro
 * de steps do Workflow SDK (sem cookies de sessão disponíveis) — por isso
 * usa o client service_role (createSupabaseServiceClient), sempre com o
 * filtro explícito `.eq('user_id', userId)` como segunda camada de
 * isolamento além do RLS.
 */

import type { AgentProvider, ProviderKeyring } from './agent-runner'
import { createSupabaseServiceClient } from './supabase'
import { decryptSecret, encryptSecret } from './crypto'
import { refreshAccessToken } from './vercel-connector'

// ─── Keyring de modelos LLM (BYOK) ─────────────────────────────────────────

export async function getUserKeyring(userId: string): Promise<{
  keyring: ProviderKeyring
  userProviders: AgentProvider[]
}> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('provider, encrypted_key')
    .eq('user_id', userId)

  if (error) throw new Error(`Falha ao ler as API keys do usuário: ${error.message}`)

  const userKeys: Partial<Record<AgentProvider, string>> = {}
  for (const row of data ?? []) {
    try {
      userKeys[row.provider as AgentProvider] = decryptSecret(row.encrypted_key)
    } catch {
      // Key corrompida/ilegível não deve derrubar o run inteiro — apenas
      // fica indisponível como se o usuário não a tivesse configurado.
    }
  }

  const keyring: ProviderKeyring = {
    anthropic:  userKeys.anthropic,
    openai:     userKeys.openai,
    google:     userKeys.google,
    deepseek:   userKeys.deepseek,
    qwen:       userKeys.qwen,
    moonshot:   userKeys.moonshot,
    minimax:    userKeys.minimax,
    glm:        userKeys.glm,
    groq:       userKeys.groq,
    mistral:    userKeys.mistral,
    openrouter: userKeys.openrouter,
  }

  const userProviders = Object.entries(userKeys)
    .filter(([, key]) => Boolean(key))
    .map(([provider]) => provider as AgentProvider)

  return { keyring, userProviders }
}

// ─── Token do GitHub (modo brownfield) ─────────────────────────────────────

export async function getUserGithubToken(userId: string): Promise<string | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('user_github_connections')
    .select('encrypted_token')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler a conexão GitHub do usuário: ${error.message}`)
  if (!data) return null

  try {
    return decryptSecret(data.encrypted_token)
  } catch {
    return null
  }
}

// ─── Token da Vercel (deploy automático) ────────────────────────────────────

export async function getUserVercelToken(userId: string): Promise<string | null> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('user_vercel_connections')
    .select('encrypted_access_token, encrypted_refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler a conexão Vercel do usuário: ${error.message}`)
  if (!data) return null

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0
  const isExpired = expiresAt < Date.now() + 60_000 // margem de 1min

  if (!isExpired) {
    try {
      return decryptSecret(data.encrypted_access_token)
    } catch {
      return null
    }
  }

  // Access token expirado — o deploy pode acontecer dias depois da conexão
  // (usuário aprovando gates), então renovar via refresh_token é o caminho
  // normal, não uma exceção.
  if (!data.encrypted_refresh_token) return null

  try {
    const refreshToken = decryptSecret(data.encrypted_refresh_token)
    const renewed = await refreshAccessToken(refreshToken)

    await supabase.from('user_vercel_connections').update({
      encrypted_access_token:  encryptSecret(renewed.access_token),
      encrypted_refresh_token: renewed.refresh_token ? encryptSecret(renewed.refresh_token) : null,
      expires_at:              new Date(Date.now() + renewed.expires_in * 1000).toISOString(),
    }).eq('user_id', userId)

    return renewed.access_token
  } catch {
    return null
  }
}
