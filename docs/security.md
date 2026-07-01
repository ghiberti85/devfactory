# Segurança — DevFactory

> Modelo de ameaças, decisões de segurança e checklist de implementação.

---

## Modelo de ameaças

| Ameaça | Impacto | Controle |
|---|---|---|
| Usuário A acessa runs do usuário B | Alto — dados de projeto/código vazam | RLS no Postgres + verificação de ownership em routes |
| API key de LLM paga usada por outros | Alto — prejuízo financeiro ao dono da key | BYOK: key só no keyring do usuário dono; nunca na plataforma |
| Token de GitHub vazado | Alto — acesso a repos privados | Criptografado em repouso; resolvido na hora; nunca no event log |
| Código gerado pela IA executa no host | Crítico — RCE no servidor | Obrigatório: Vercel Sandbox (microVM isolada) |
| Secrets no event log do Workflow | Médio — log expõe keys | ProjectRun não carrega keys; só `userProviders: string[]` |
| SQL injection | Alto — bypass de RLS | Supabase SDK parametriza queries; nunca string concatenation |
| CSRF em routes de gate | Médio — gate resolvido sem intenção | Token único por gate + verificação de sessão |
| Rate limit abuse | Médio — custo de LLM e Sandbox | Rate limiting por usuário em todas as rotas |
| Token de gate adivinhado | Médio — gate de outro usuário resolvido | Verificação de ownership antes de `resumeHook()` |

---

## Autenticação e sessão

### Fluxo
```
1. Usuário → POST /api/auth → Supabase Auth (magic link / OAuth)
2. Supabase → Set-Cookie com JWT httpOnly, SameSite=Lax, Secure
3. Toda route handler → getSessionUser(req) → valida JWT via Supabase
4. RLS no Postgres → usa auth.uid() do JWT automaticamente
```

### Implementação de `getSessionUser`
```typescript
// lib/devfactory/auth.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

export async function getSessionUser(req: NextRequest): Promise<{ id: string; email: string } | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: () => cookies() }
  )
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return { id: user.id, email: user.email! }
}
```

### Proteção de rotas (middleware)
```typescript
// middleware.ts — NÃO usar cookies().get() diretamente, usar createServerClient
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get: (name) => req.cookies.get(name)?.value,
      set: (name, value, options) => res.cookies.set(name, value, options),
    },
  })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !req.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return res
}
```

---

## BYOK — segurança de chaves

### Regra fundamental
```
API key do usuário NUNCA deve aparecer em:
  - Logs de aplicação
  - Event log do Workflow SDK (input/output de steps)
  - Responses de API (nem mesmo mascarada — só "configurada/não configurada")
  - Client-side code
```

### Ciclo de vida correto
```
1. Usuário digita key em ApiKeysSettings.jsx (campo type="password")
2. POST /api/settings/api-keys → key em transit (HTTPS)
3. Server: criptografar com Supabase Vault (pgsodium) ANTES de salvar
4. Banco: encrypted_key armazenado
5. Em pipeline-workflow.ts (step): getUserKeyring(userId) → decripta AQUI
6. key usada diretamente na chamada HTTP → descartada da memória
7. O step persiste { model, tier, tokens, cost } — NUNCA a key
```

### Criptografia com Supabase Vault
```sql
-- Armazenar
select vault.create_secret(
  'sk-deepseek-...',             -- a key real
  'user_api_key',                -- nome do secret (não único — usar com user_id)
  format('API key do provider %s para user %s', provider, user_id)
) as secret_id;

-- Salvar o secret_id na tabela, não a key
insert into user_api_keys (user_id, provider, vault_secret_id)
values (auth.uid(), 'deepseek', secret_id);

-- Recuperar
select vault.decrypted_secret(vault_secret_id) as api_key
from user_api_keys
where user_id = auth.uid() and provider = 'deepseek';
```

### Mascaramento na UI
```typescript
// Nunca retornar a key real na GET /api/settings/api-keys
// Retornar apenas quais providers estão configurados
return NextResponse.json({
  providers: data.map(row => ({
    provider:    row.provider,
    configured:  true,
    // SEM a key, SEM os primeiros/últimos caracteres
  }))
})

// Na UI — mostrar só que está configurada
<span>✓ configurada</span>
// Ou permitir "Trocar" → campo de input vazio para nova key
```

---

## Execução de código gerado

### Sandbox obrigatória
```typescript
// ✅ CORRETO — sempre via Vercel Sandbox
export async function runTestsInSandbox(files, testCommand) {
  const sandbox = await Sandbox.create({ runtime: 'node24', timeout: 120_000 })

  await writeFiles(sandbox, files)
  await sandbox.runCommand({ cmd: 'npm', args: ['install'] })

  // LOCKDOWN ANTES de rodar código gerado pela IA
  await sandbox.setNetworkPolicy({ policy: 'deny-all' })

  const [cmd, ...args] = testCommand
  const result = await sandbox.runCommand({ cmd, args })
  await sandbox.stop()
  return result
}

// ❌ PROIBIDO — nunca em processo da aplicação
import { exec } from 'child_process'
exec(generatedCommand)  // RCE imediato se code injection

// ❌ PROIBIDO — vm2 tem CVEs conhecidos de escape
import vm2 from 'vm2'  // não adicionar esta dependência
```

### Política de rede da Sandbox
```typescript
// Durante instalação: rede liberada (precisa baixar pacotes)
await Sandbox.create({ runtime: 'node24' })
await sandbox.runCommand({ cmd: 'npm', args: ['install'] })

// ANTES de rodar código da IA: bloquear tudo
await sandbox.setNetworkPolicy({ policy: 'deny-all' })
// Agora o código gerado não pode fazer chamadas externas, exfiltrar dados, etc.

// Para análise que precise acessar a internet (ex: Lighthouse em URL real):
await sandbox.setNetworkPolicy({
  policy: 'user-defined',
  allowedDomains: ['example.com'],  // só o domínio sob teste
})
```

---

## RLS — Row Level Security

### Checklist para toda tabela nova
- [ ] `alter table <tabela> enable row level security`
- [ ] Policy de SELECT: `using (auth.uid() = user_id)`
- [ ] Policy de INSERT: `with check (auth.uid() = user_id)`
- [ ] Policy de UPDATE: `using (auth.uid() = user_id)`
- [ ] Policy de DELETE: `using (auth.uid() = user_id)`
- [ ] Testar: um usuário tentando acessar dados de outro deve receber resultado vazio (não erro)

### Para tabelas com relação indireta
```sql
-- stage_outputs não tem user_id diretamente, mas tem via run_id
create policy "users access only their own stage outputs"
  on stage_outputs for all
  using (
    exists (
      select 1 from pipeline_runs
      where id = stage_outputs.run_id
        and user_id = auth.uid()
    )
  );
```

### Nunca usar service_role em routes públicas
```typescript
// ✅ Client com sessão do usuário → RLS aplica
const supabase = createServerClient(url, anonKey, { cookies: () => cookies() })

// ❌ service_role bypassa RLS → apenas para admin/migrations
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
// Usar APENAS em scripts de seed, migrations, e jobs de manutenção
// NUNCA em route handlers públicos
```

---

## Headers de segurança (next.config.ts)

```typescript
// next.config.ts
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",     // Next.js precisa de inline
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "font-src 'self'",
    ].join('; '),
  },
]

export default {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}
```

---

## Dependências e supply chain

```bash
# Auditar dependências antes de cada deploy
npm audit --audit-level=high

# Verificar licenças (não incluir GPL em produto comercial)
npx license-checker --onlyAllow 'MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC'

# SAST com Semgrep (rodado no CI)
semgrep --config p/typescript p/nextjs p/secrets .
```

### Regras de dependência
- Fixar versões exatas em produção (`"1.2.3"`, não `"^1.2.3"`)
- Revisar o changelog de `workflow`, `@vercel/sandbox` antes de atualizar
- Dependências com CVE high/critical → tratar imediatamente, não deixar para a próxima sprint
- `vm2` está explicitamente banido — o CI deve falhar se aparecer no `package-lock.json`

---

## Checklist de segurança — antes de cada deploy

- [ ] `npm audit` sem issues high/critical
- [ ] `semgrep` sem findings de severidade média ou alta
- [ ] Nenhum secret hard-coded (buscar por `sk-`, `ghp_`, `eyJ` nos diffs)
- [ ] Todas as rotas novas chamam `getSessionUser()` como primeiro passo
- [ ] Todas as tabelas novas têm RLS habilitado
- [ ] Nenhum uso de `service_role` em route handlers
- [ ] Código gerado pela IA só executa via `sandbox-runner.ts`
- [ ] Headers de segurança configurados em `next.config.ts`
