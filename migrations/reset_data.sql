-- ════════════════════════════════════════════════════════════════
--  RESET DE DADOS — apaga tudo exceto o(s) admin(s)
--  Execute no Supabase SQL Editor
--  A ordem importa: respeita as FK RESTRICT/CASCADE
-- ════════════════════════════════════════════════════════════════

-- 1. presencas — CASCADE de chamadas e alunos
DELETE FROM public.presencas;

-- 2. chamadas — CASCADE de turmas (mas deleta explícito para garantir)
DELETE FROM public.chamadas;

-- 3. horarios — CASCADE de turmas
DELETE FROM public.horarios;

-- 4. materias — CASCADE de instituicoes
DELETE FROM public.materias;

-- 5. alunos — RESTRICT em turmas e instituicoes, então apaga antes deles
DELETE FROM public.alunos;

-- 6. turmas — RESTRICT em instituicoes, então apaga antes
DELETE FROM public.turmas;

-- 7. instituicoes — agora seguro (sem turmas/alunos/materias)
DELETE FROM public.instituicoes;

-- 8. profiles — remove todos exceto admin
--    (a conta no auth.users continua, só o perfil é removido)
DELETE FROM public.profiles WHERE role != 'admin';

-- ────────────────────────────────────────────────────────────────
-- Verificação: deve retornar só o(s) admin(s)
SELECT id, role, nome, email FROM public.profiles;
-- ────────────────────────────────────────────────────────────────
