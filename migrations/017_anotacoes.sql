-- ── Tabela de anotações do painel administrativo ──────────────────────────────
create table if not exists anotacoes (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null default '',
  body        text not null default '',
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Índice para buscar anotações por admin rapidamente
create index if not exists anotacoes_admin_id_idx on anotacoes(admin_id, updated_at desc);

-- RLS: cada admin só vê/edita suas próprias anotações
alter table anotacoes enable row level security;

create policy "admin pode ver suas anotacoes"
  on anotacoes for select
  using (auth.uid() = admin_id);

create policy "admin pode inserir anotacoes"
  on anotacoes for insert
  with check (auth.uid() = admin_id);

create policy "admin pode atualizar anotacoes"
  on anotacoes for update
  using (auth.uid() = admin_id);

create policy "admin pode excluir anotacoes"
  on anotacoes for delete
  using (auth.uid() = admin_id);
