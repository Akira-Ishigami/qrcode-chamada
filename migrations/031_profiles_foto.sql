-- Migration 031 — Foto de perfil para professores
-- Criado em: 2026-06-13

alter table profiles
  add column if not exists foto_url text;
