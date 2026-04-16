-- ============================================================
-- Migration 002 — Chamadas e Presenças
-- Criado em: 2026-04-09
-- Descrição: Tabelas para registrar sessões de chamada e
--            presenças individuais de alunos por chamada
-- ============================================================

-- ─── Tabela: chamadas ─────────────────────────────────────────────────────────
create table if not exists chamadas (
  id         uuid    primary key default gen_random_uuid(),
  turma_id   uuid    not null references turmas(id) on delete cascade,
  data       date    not null default current_date,
  aberta     boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- ─── Tabela: presencas ────────────────────────────────────────────────────────
create table if not exists presencas (
  id            uuid primary key default gen_random_uuid(),
  chamada_id    uuid not null references chamadas(id) on delete cascade,
  aluno_id      uuid not null references alunos(id)   on delete cascade,
  registrado_em timestamptz not null default now(),
  unique(chamada_id, aluno_id)
);

-- ─── Índices ──────────────────────────────────────────────────────────────────
create index if not exists idx_chamadas_turma_data on chamadas(turma_id, data);
create index if not exists idx_presencas_chamada   on presencas(chamada_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table chamadas  enable row level security;
alter table presencas enable row level security;

create policy "leitura chamadas"  on chamadas  for select using (true);
create policy "insert chamadas"   on chamadas  for insert with check (true);
create policy "update chamadas"   on chamadas  for update using (true);

create policy "leitura presencas" on presencas for select using (true);
create policy "insert presencas"  on presencas for insert with check (true);
create policy "delete presencas"  on presencas for delete using (true);
