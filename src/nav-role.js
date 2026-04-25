import { supabase } from "./supabase.js";

// Roles: admin | instituicao | professor
// Uso: <a href="..." data-role="instituicao professor"> — visível apenas para os roles listados.
// Sem data-role → visível para todos.
export async function applyNavRole() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome, email, instituicao_id")
    .eq("id", session.user.id)
    .single();

  if (!profile) return;

  document.querySelectorAll("[data-role]").forEach(el => {
    const allowed = el.dataset.role.split(" ");
    if (!allowed.includes(profile.role)) el.style.display = "none";
  });

  const nameEl = document.getElementById("sidebar-user-name");
  if (nameEl) nameEl.textContent = profile.nome || profile.email;

  return profile;
}

// true se pode gerenciar dados da instituição (turmas, alunos, etc.)
export function podeInstituicao(role) {
  return role === "instituicao";
}

// compatibilidade: mantém podeAdmin apontando para podeInstituicao
export function podeAdmin(role) {
  return podeInstituicao(role);
}
