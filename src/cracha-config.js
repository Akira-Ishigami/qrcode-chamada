import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";
import { gerarCracha }   from "./cracha.js";

// ── Demo para preview ─────────────────────────────────────────────────────────
const DEMO_ALUNO = {
  nome: "Maria Silva",
  matricula: "MAT2024001",
  foto_url: null,
  turma: { nome: "7º Ano A" },
};

let instId   = null;
let instNome = "";
let previewTimer = null;

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome, email, instituicao_id")
    .eq("id", session.user.id)
    .single();

  if (!profile || profile.role !== "instituicao") {
    window.location.href = profile?.role === "admin" ? "/dashboard.html" : "/chamada.html";
    return;
  }

  instId = profile.instituicao_id;

  await applyNavRole();

  // Nome da instituição
  if (instId) {
    const { data: inst } = await supabase
      .from("instituicoes").select("nome").eq("id", instId).single();
    instNome = inst?.nome || "";
    const el = document.getElementById("sidebar-inst-name");
    if (el) el.textContent = instNome;
  }

  const userEl = document.getElementById("sidebar-user-name");
  if (userEl) userEl.textContent = profile.nome || profile.email || "";

  // Carrega config existente
  await carregarConfig();

  // Eventos
  document.getElementById("input-cor1").addEventListener("input", agendarPreview);
  document.getElementById("input-cor2").addEventListener("input", agendarPreview);
  document.getElementById("btn-salvar").addEventListener("click", salvar);
  document.getElementById("logo-upload").addEventListener("change", handleLogoUpload);
  document.getElementById("btn-remover-logo").addEventListener("click", removerLogo);

  // Preview inicial
  atualizarPreview();
}

// ── Carregar config ───────────────────────────────────────────────────────────
async function carregarConfig() {
  if (!instId) return;
  const { data } = await supabaseAdmin
    .from("cracha_config")
    .select("cor_principal, cor_secundaria, logo_url")
    .eq("instituicao_id", instId)
    .maybeSingle();

  if (data) {
    document.getElementById("input-cor1").value = data.cor_principal  || "#2563eb";
    document.getElementById("input-cor2").value = data.cor_secundaria || "#1e40af";
    if (data.logo_url) {
      setLogoPreview(data.logo_url);
    }
  }
}

// ── Logo upload ───────────────────────────────────────────────────────────────
function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 500 * 1024) {
    showToast("Logo muito grande. Máximo 500KB.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    // Redimensiona para thumbnail (máx 150x150)
    const img = new Image();
    img.onload = () => {
      const MAX = 150;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL("image/png", 0.85);
      setLogoPreview(base64);
      agendarPreview();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function setLogoPreview(base64) {
  const area  = document.getElementById("logo-area");
  const img   = document.getElementById("logo-preview-img");
  const label = document.getElementById("logo-label");
  const btnRm = document.getElementById("btn-remover-logo");
  img.src = base64;
  img.style.display  = "block";
  area.style.borderColor = "var(--acc)";
  label.style.display    = "none";
  btnRm.style.display    = "inline-flex";
  area.dataset.logo = base64;
}

function removerLogo() {
  const area  = document.getElementById("logo-area");
  const img   = document.getElementById("logo-preview-img");
  const label = document.getElementById("logo-label");
  const btnRm = document.getElementById("btn-remover-logo");
  img.src = "";
  img.style.display  = "none";
  area.style.borderColor = "";
  label.style.display    = "";
  btnRm.style.display    = "none";
  area.dataset.logo = "";
  document.getElementById("logo-upload").value = "";
  agendarPreview();
}

// ── Preview ───────────────────────────────────────────────────────────────────
function agendarPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(atualizarPreview, 300);
}

async function atualizarPreview() {
  const cor1    = document.getElementById("input-cor1").value;
  const cor2    = document.getElementById("input-cor2").value;
  const logoUrl = document.getElementById("logo-area").dataset.logo || null;

  const config = { cor_principal: cor1, cor_secundaria: cor2, logo_url: logoUrl };

  const container = document.getElementById("preview-canvas-wrap");
  container.innerHTML = `<div class="preview-loading">Gerando preview…</div>`;

  try {
    const dataUrl = await gerarCracha(DEMO_ALUNO, config, instNome || "Minha Instituição");
    container.innerHTML = `<img src="${dataUrl}" style="max-width:100%;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.1)" alt="Preview do crachá" />`;
  } catch (e) {
    container.innerHTML = `<div class="preview-err">Erro no preview: ${e.message}</div>`;
  }
}

// ── Salvar ────────────────────────────────────────────────────────────────────
async function salvar() {
  const btn  = document.getElementById("btn-salvar");
  const cor1 = document.getElementById("input-cor1").value;
  const cor2 = document.getElementById("input-cor2").value;
  const logo = document.getElementById("logo-area").dataset.logo || null;

  btn.disabled = true;
  btn.textContent = "Salvando…";

  const payload = {
    instituicao_id: instId,
    cor_principal:  cor1,
    cor_secundaria: cor2,
    logo_url:       logo,
    atualizado_em:  new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("cracha_config")
    .upsert(payload, { onConflict: "instituicao_id" });

  btn.disabled = false;
  btn.textContent = "Salvar configuração";

  if (error) {
    showToast("Erro ao salvar: " + error.message, "error");
  } else {
    showToast("Configuração salva!", "success");
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

init();
