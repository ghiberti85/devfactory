/**
 * DevFactory — Vercel Connector
 * lib/devfactory/vercel-connector.ts
 *
 * Fluxo OAuth 2.0 + PKCE do "Vercel App" registrado em Account Settings →
 * Apps (ver CLAUDE.md / conversa de setup — não é o mesmo mecanismo do
 * Marketplace de Integrations). Endpoints confirmados contra a doc oficial:
 *   Authorize: https://vercel.com/oauth/authorize
 *   Token:     https://api.vercel.com/login/oauth/token
 */

const AUTHORIZE_URL = 'https://vercel.com/oauth/authorize'
const TOKEN_URL      = 'https://api.vercel.com/login/oauth/token'

// Scopes solicitados na autorização — precisam estar habilitados no app
// (Account Settings → Apps → devfactory → Authentication → Scopes).
export const VERCEL_OAUTH_SCOPE = 'openid email profile offline_access'

export interface VercelTokenResponse {
  access_token:  string
  token_type:    string
  id_token?:     string
  expires_in:    number
  scope:         string
  refresh_token?: string
}

export function buildAuthorizeUrl(params: {
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
}): string {
  const clientId = requiredEnv('VERCEL_OAUTH_CLIENT_ID')
  const query = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  params.redirectUri,
    response_type: 'code',
    scope:         VERCEL_OAUTH_SCOPE,
    state:         params.state,
    nonce:         params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${AUTHORIZE_URL}?${query.toString()}`
}

export async function exchangeCodeForToken(params: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<VercelTokenResponse> {
  const clientId     = requiredEnv('VERCEL_OAUTH_CLIENT_ID')
  const clientSecret = requiredEnv('VERCEL_OAUTH_CLIENT_SECRET')

  // client_secret_post — client_id/client_secret vão no corpo, não no header
  // (o app está configurado pra aceitar os dois métodos; escolhemos este por
  // ser mais simples de implementar com fetch e consistente com o restante
  // do código, ex: github-connector.ts).
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     clientId,
      client_secret: clientSecret,
      code:          params.code,
      code_verifier: params.codeVerifier,
      redirect_uri:  params.redirectUri,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Falha ao trocar o code por token na Vercel: ${res.status} ${body}`)
  }

  return res.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<VercelTokenResponse> {
  const clientId     = requiredEnv('VERCEL_OAUTH_CLIENT_ID')
  const clientSecret = requiredEnv('VERCEL_OAUTH_CLIENT_SECRET')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Falha ao renovar o token da Vercel: ${res.status} ${body}`)
  }

  return res.json()
}

export interface VercelUser {
  id:       string
  username: string
  email:    string
}

export async function getVercelUser(accessToken: string): Promise<VercelUser> {
  const res = await fetch('https://api.vercel.com/v2/user', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Falha ao ler o usuário Vercel: ${res.status}`)
  const data = await res.json()
  return { id: data.user.id, username: data.user.username, email: data.user.email }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`)
  return value
}
