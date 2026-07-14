-- ═══════════════════════════════════════════════════════════════════════════
-- DevFactory — Schema Supabase completo
-- db/schema.sql
--
-- Consolida: model registry, pipeline runs, observabilidade, e BYOK
-- (Bring Your Own Key) com Row Level Security para isolamento multi-tenant.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Model Registry ────────────────────────────────────────────────────────

create table models (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  display_name text not null,
  provider     text not null,
  model_id     text not null,
  is_default   boolean default false,
  is_active    boolean default true,
  is_local     boolean default false,

  tier_capability  int check (tier_capability in (1,2,3)),
  context_window   int,
  strengths        text[],

  cost_input_per_1m   numeric(10,4) default 0,
  cost_output_per_1m  numeric(10,4) default 0,
  has_free_tier        boolean default false,
  free_tier_rpm        int,
  free_tier_rpd        int,

  latency_profile text check (latency_profile in ('fast','medium','slow')),
  api_endpoint  text,

  license       text,
  origin        text,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─── BYOK — API Keys por usuário ───────────────────────────────────────────
-- Critico para multi-tenant: cada usuário só pode usar modelos pagos cujo
-- provider ele mesmo configurou aqui. encrypted_key NUNCA fica em texto puro
-- — use Supabase Vault (pgsodium) ou criptografia na camada de aplicação
-- antes do insert.

create table user_api_keys (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) not null,
  provider       text not null,
  encrypted_key  text not null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique(user_id, provider)
);

alter table user_api_keys enable row level security;

create policy "users manage only their own api keys"
  on user_api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── GitHub — conexão por usuário (modo brownfield) ────────────────────────
-- Mesmo princípio do BYOK de modelos: o token é do usuário, nunca compartilhado.
-- Escopo OAuth 'repo' dá acesso de leitura/escrita aos repos que o usuário
-- autorizar explicitamente durante o fluxo do GitHub App/OAuth.

create table user_github_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) not null unique,
  encrypted_token text not null,
  scope           text,
  github_username text,
  connected_at    timestamptz default now()
);

alter table user_github_connections enable row level security;

create policy "users manage only their own github connection"
  on user_github_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Vercel — conexão por usuário (deploy automático) ──────────────────────
-- Mesmo princípio: token do usuário, nunca compartilhado. refresh_token é
-- necessário porque o deploy pode acontecer muito depois da conexão (ex:
-- usuário aprova o gate humano dias depois) — access_token de curta duração
-- sozinho não seria suficiente.

create table user_vercel_connections (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references auth.users(id) not null unique,
  encrypted_access_token  text not null,
  encrypted_refresh_token text,
  team_id                text, -- time Vercel selecionado como alvo do deploy (null = conta pessoal)
  vercel_user_id         text,
  scope                  text,
  expires_at             timestamptz,
  connected_at           timestamptz default now()
);

alter table user_vercel_connections enable row level security;

create policy "users manage only their own vercel connection"
  on user_vercel_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Projetos ──────────────────────────────────────────────────────────────

create table projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) not null,
  name          text not null,
  description   text,
  briefing      text,
  status        text default 'draft',
  selector_mode text default 'auto',
  budget_usd    numeric(10,4),
  max_iterations_per_stage int default 3,

  -- modo brownfield: repositório existente conectado
  project_mode    text default 'greenfield' check (project_mode in ('greenfield','brownfield')),
  github_owner    text,
  github_repo     text,
  github_branch   text,
  repo_context_summary text, -- snapshot textual gerado pela etapa codebase_analysis

  created_at    timestamptz default now()
);

alter table projects enable row level security;

create policy "users manage only their own projects"
  on projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Override de modelo por etapa ──────────────────────────────────────────

create table stage_model_overrides (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  stage       text not null,
  operation   text,
  model_id    uuid references models(id),
  created_at  timestamptz default now(),
  unique(project_id, stage, operation)
);

alter table stage_model_overrides enable row level security;

create policy "users manage overrides only on their own projects"
  on stage_model_overrides for all
  using (exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid()));

-- ─── Execuções da pipeline ──────────────────────────────────────────────────

create table pipeline_runs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references projects(id) on delete cascade,
  user_id      uuid references auth.users(id) not null,
  status       text default 'running',
  current_stage text,
  workflow_run_id text, -- runId retornado por start() (Vercel Workflow SDK) — usado por getRun()/cancel()
  deploy_target        text check (deploy_target in ('vercel-serverless','manual-export')), -- calculado após docs_initial (ver lib/devfactory/deploy-target.ts)
  deploy_target_reason text,
  started_at   timestamptz default now(),
  completed_at timestamptz,
  total_cost_usd numeric(10,6) default 0,
  total_tokens_input  bigint default 0,
  total_tokens_output bigint default 0
);

alter table pipeline_runs enable row level security;

create policy "users manage only their own runs"
  on pipeline_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Output de cada etapa ───────────────────────────────────────────────────

create table stage_outputs (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid references pipeline_runs(id) on delete cascade,
  stage        text not null,
  status       text default 'pending',
  final_output jsonb,
  gate_token   text, -- token do humanGateHook ativo nesta etapa (ver pipeline-workflow.ts)
  iteration_count int default 0,
  started_at   timestamptz default now(),
  completed_at timestamptz,
  unique(run_id, stage)
);

alter table stage_outputs enable row level security;

create policy "users access stage outputs only of their own runs"
  on stage_outputs for all
  using (exists (select 1 from pipeline_runs r where r.id = run_id and r.user_id = auth.uid()))
  with check (exists (select 1 from pipeline_runs r where r.id = run_id and r.user_id = auth.uid()));

-- ─── Iterações dentro de uma etapa ──────────────────────────────────────────

create table stage_iterations (
  id              uuid primary key default gen_random_uuid(),
  stage_output_id uuid references stage_outputs(id) on delete cascade,
  iteration_number int not null,
  operation       text,
  model_id        uuid references models(id),
  tier_used       int,
  prompt          text,
  output          jsonb,
  self_critique   jsonb,
  status          text,
  created_at      timestamptz default now()
);

alter table stage_iterations enable row level security;

create policy "users access iterations only of their own runs"
  on stage_iterations for all
  using (exists (
    select 1 from stage_outputs so
    join pipeline_runs r on r.id = so.run_id
    where so.id = stage_output_id and r.user_id = auth.uid()
  ));

-- ─── Chamadas de modelo (granular — base do dashboard de custo) ────────────

create table model_calls (
  id              uuid primary key default gen_random_uuid(),
  iteration_id    uuid references stage_iterations(id) on delete cascade,
  model_id        uuid references models(id),
  call_type       text,
  tokens_input    int,
  tokens_output   int,
  cost_usd        numeric(10,6),
  latency_ms      int,
  provider_response_id text,
  created_at      timestamptz default now()
);

alter table model_calls enable row level security;

create policy "users access model calls only of their own runs"
  on model_calls for all
  using (exists (
    select 1 from stage_iterations si
    join stage_outputs so on so.id = si.stage_output_id
    join pipeline_runs r on r.id = so.run_id
    where si.id = iteration_id and r.user_id = auth.uid()
  ));

-- ─── Gates humanos ──────────────────────────────────────────────────────────

create table human_gates (
  id              uuid primary key default gen_random_uuid(),
  stage_output_id uuid references stage_outputs(id) on delete cascade,
  decision        text,
  feedback        text,
  edited_output   jsonb,
  decided_at      timestamptz default now()
);

alter table human_gates enable row level security;

create policy "users access human gates only of their own runs"
  on human_gates for all
  using (exists (
    select 1 from stage_outputs so
    join pipeline_runs r on r.id = so.run_id
    where so.id = stage_output_id and r.user_id = auth.uid()
  ));

-- ─── Histórico de performance por modelo (alimenta o Selector) ─────────────
-- Esta tabela é AGREGADA POR USUÁRIO — cada usuário tem seu próprio
-- aprendizado, já que cada um usa modelos diferentes dependendo das keys
-- que configurou.

create table model_performance_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) not null,
  model_id        uuid references models(id),
  stage           text not null,
  operation       text,
  total_calls     int default 0,
  human_approvals int default 0,
  human_rejections int default 0,
  avg_self_critique_score numeric(4,3),
  avg_cost_usd    numeric(10,6),
  avg_latency_ms  int,
  avg_tokens_output int,
  performance_score numeric(4,3),
  last_updated    timestamptz default now(),
  unique(user_id, model_id, stage, operation)
);

alter table model_performance_history enable row level security;

create policy "users see only their own performance history"
  on model_performance_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Quality Council ────────────────────────────────────────────────────────

create table quality_reports (
  id              uuid primary key default gen_random_uuid(),
  stage_output_id uuid references stage_outputs(id) on delete cascade,
  dimension       text,
  tool_used       text,
  model_id        uuid references models(id),
  raw_tool_output jsonb,
  model_analysis  jsonb,
  score           numeric(5,2),
  issues          jsonb,
  verdict         text,
  created_at      timestamptz default now()
);

alter table quality_reports enable row level security;

create policy "users access quality reports only of their own runs"
  on quality_reports for all
  using (exists (
    select 1 from stage_outputs so
    join pipeline_runs r on r.id = so.run_id
    where so.id = stage_output_id and r.user_id = auth.uid()
  ));

-- ─── models é tabela pública de catálogo — leitura liberada a todos ────────

alter table models enable row level security;

create policy "anyone authenticated can read the model registry"
  on models for select
  using (auth.role() = 'authenticated');

-- Apenas service_role (backend) pode inserir/atualizar o catálogo de modelos.
-- Nenhuma policy de insert/update/delete é criada para usuários comuns.

-- ─── Views de observabilidade ───────────────────────────────────────────────

create view run_cost_breakdown as
select
  pr.id as run_id, pr.project_id, pr.user_id,
  so.stage, m.display_name as model_name, m.provider, m.origin,
  count(mc.id) as total_calls,
  sum(mc.tokens_input) as tokens_input,
  sum(mc.tokens_output) as tokens_output,
  sum(mc.cost_usd) as cost_usd,
  avg(mc.latency_ms) as avg_latency_ms
from model_calls mc
join stage_iterations si on si.id = mc.iteration_id
join stage_outputs so    on so.id = si.stage_output_id
join pipeline_runs pr    on pr.id = so.run_id
join models m            on m.id  = mc.model_id
group by pr.id, pr.project_id, pr.user_id, so.stage, m.id;

create view model_selector_scores as
select
  m.id, m.display_name, m.provider, m.tier_capability, m.cost_output_per_1m,
  mph.user_id, mph.stage, mph.operation, mph.performance_score, mph.total_calls,
  round(mph.human_approvals::numeric / nullif(mph.total_calls, 0) * 100, 1) as approval_rate_pct
from model_performance_history mph
join models m on m.id = mph.model_id
where m.is_active = true
order by mph.user_id, mph.stage, mph.performance_score desc;
