-- ═══════════════════════════════════════════════════════════════
-- Migration 004 — Criar conta admin: akira.vha@gmail.com
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- Limpa tentativa anterior (seguro: só apaga se existir)
DELETE FROM auth.identities WHERE provider_id = 'akira.vha@gmail.com';
DELETE FROM public.profiles  WHERE email       = 'akira.vha@gmail.com';
DELETE FROM auth.users       WHERE email       = 'akira.vha@gmail.com';

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN

  -- ── 1. Cria o usuário em auth.users ─────────────────────────
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    'akira.vha@gmail.com',
    crypt('zaq1xsw2', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"nome":"akira","role":"admin"}',
    now(),
    now(),
    '', '', '', ''
  );

  -- ── 2. Cria identidade email (necessária para o login) ──────
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_uid,
    'akira.vha@gmail.com',
    jsonb_build_object('sub', v_uid::text, 'email', 'akira.vha@gmail.com'),
    'email',
    now(),
    now(),
    now()
  );

  -- ── 3. Garante o profile como admin (trigger pode já ter criado) ──
  INSERT INTO public.profiles (id, role, nome, email)
  VALUES (v_uid, 'admin', 'akira', 'akira.vha@gmail.com')
  ON CONFLICT (id) DO UPDATE SET
    role  = 'admin',
    nome  = 'akira',
    email = 'akira.vha@gmail.com';

  RAISE NOTICE 'Admin criado com sucesso! ID: %', v_uid;

END $$;

-- Confirma o resultado
SELECT id, role, nome, email FROM public.profiles WHERE email = 'akira.vha@gmail.com';
