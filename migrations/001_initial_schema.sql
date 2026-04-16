-- ============================================================
-- Migration 001 — Schema inicial
-- Criado em: 2026-04-09
-- Descrição: Tabelas base (instituicoes, turmas, alunos),
--            bucket de fotos e RLS permissiva para prototipagem
-- ============================================================

-- ─── Tabela: instituicoes ─────────────────────────────────────────────────────
create table if not exists instituicoes (
  id   uuid primary key default gen_random_uuid(),
  nome text not null unique
);

-- ─── Tabela: turmas ───────────────────────────────────────────────────────────
create table if not exists turmas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  professor      text,
  horario        text,
  instituicao_id uuid references instituicoes(id) on delete set null
);

-- ─── Tabela: alunos ───────────────────────────────────────────────────────────
create table if not exists alunos (
  id               uuid primary key default gen_random_uuid(),
  nome             text        not null,
  matricula        text        not null unique,
  turma_id         uuid        references turmas(id) on delete set null,
  instituicao_id   uuid        references instituicoes(id) on delete set null,
  foto_url         text,
  telefone         text,
  data_nascimento  date,
  id_estadual      text,
  endereco         text,
  criado_em        timestamptz not null default now()
);

-- ─── Storage bucket para fotos ────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('fotos-alunos', 'fotos-alunos', true)
on conflict do nothing;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- ATENÇÃO: políticas abertas para prototipagem.
-- Substituir na migration 003 por políticas com autenticação.

alter table alunos       enable row level security;
alter table turmas       enable row level security;
alter table instituicoes enable row level security;

create policy "leitura publica alunos"       on alunos       for select using (true);
create policy "leitura publica turmas"       on turmas       for select using (true);
create policy "leitura publica instituicoes" on instituicoes for select using (true);

create policy "insert alunos"       on alunos       for insert with check (true);
create policy "insert turmas"       on turmas       for insert with check (true);
create policy "insert instituicoes" on instituicoes for insert with check (true);

create policy "update alunos"       on alunos       for update using (true);
create policy "delete alunos"       on alunos       for delete using (true);
