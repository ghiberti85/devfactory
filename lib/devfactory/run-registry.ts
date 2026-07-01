/**
 * DevFactory — User Credentials Resolver
 * lib/devfactory/run-registry.ts
 *
 * Nome do arquivo mantido por compatibilidade com o restante do código que
 * já importa daqui — mas o conteúdo mudou bastante na migração para o
 * Vercel Workflow SDK. O que existia antes (Map em memória de runs ativos,
 * broadcastToRun, buildServices) foi removido: o Workflow SDK já resolve
 * persistência e push em tempo real (ver pipeline-workflow.ts e as rotas
 * em app/api/runs/**). Este arquivo agora cuida só de uma coisa: resolver
 * credenciais do usuário atual (BYOK de modelos LLM + token do GitHub),
 * que continuam sendo responsabilidade da aplicação, não do Workflow SDK.
 */

import type { AgentProvider, ProviderKeyring } from './agent-runner'

// ─── Keyring de modelos LLM (BYOK) ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- userId será usado quando a query real ao Supabase entrar (ver comentário abaixo)
export async function getUserKeyring(userId: string): Promise<{
  keyring: ProviderKeyring
  userProviders: AgentProvider[]
}> {
  // Em produção:
  // const { data } = await supabase
  //   .from('user_api_keys')
  //   .select('provider, encrypted_key')
  //   .eq('user_id', userId)
  // const decrypted = await Promise.all(data.map(decryptViaVault))

  const userKeys: Partial<Record<AgentProvider, string>> = {}

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- userId será usado quando a query real ao Supabase entrar (ver comentário abaixo)
export async function getUserGithubToken(userId: string): Promise<string | null> {
  // Em produção:
  // const { data } = await supabase
  //   .from('user_github_connections')
  //   .select('encrypted_token')
  //   .eq('user_id', userId)
  //   .single()
  // return data ? await decryptViaVault(data.encrypted_token) : null

  return null
}
