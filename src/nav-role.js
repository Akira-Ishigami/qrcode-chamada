import { supabase } from "./supabase.js";

// Uso: <a href="..." data-role="admin super_admin"> — visível apenas para os roles listados.
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

export function podeAdmin(role) {
  return role === "admin" || role === "super_admin";
}
