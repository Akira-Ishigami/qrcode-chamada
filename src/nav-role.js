import { supabase } from "./supabase.js";

// Chame em cada página logo após o DOMContentLoaded.
// Links com [data-admin-only] ficam ocultos para professores.
// Links com [data-prof-only] ficam ocultos para admins.
export async function applyNavRole() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome, email")
    .eq("id", session.user.id)
    .single();

  if (!profile) return;
  const role = profile.role;

  if (role === "professor") {
    document.querySelectorAll("[data-admin-only]").forEach(el => el.style.display = "none");
  }
  if (role === "admin") {
    document.querySelectorAll("[data-prof-only]").forEach(el => el.style.display = "none");
  }

  // Exibe nome do usuário no rodapé da sidebar, se existir o elemento
  const nameEl = document.getElementById("sidebar-user-name");
  if (nameEl) nameEl.textContent = profile.nome || profile.email;

  return profile;
}
