import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";
import { gerarCracha }   from "./cracha.js";

// ── Demo para preview ─────────────────────────────────────────────────────────
const DEMO_ALUNO = {
  nome: "Maria José da Silva Santos",
  matricula: "MAT2024001",
  foto_url: null,
  turma: { nome: "7º Ano A" },
  id_estadual: "12.345.678-9",
  telefone: "(69) 99999-9999",
  data_nascimento: "2010-01-01",
  endereco: "Rua dos teste, 123 - Centro",
};

let instId      = null;
let instNome    = "";
let previewTimer = null;
let modoPreview  = "ambos";

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
  ["input-cor1","input-cor2","input-cor-texto","input-cor-decor"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", agendarPreview);
  });

  // Tabs Frente / Verso / Ambos — com animação de transição
  document.querySelectorAll(".cs-vtab").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      document.querySelectorAll(".cs-vtab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      modoPreview = btn.dataset.view;
      // Fade out → gera novo → fade in
      const wrap = document.getElementById("preview-canvas-wrap");
      wrap?.classList.add("switching");
      setTimeout(() => {
        agendarPreview();
        setTimeout(() => wrap?.classList.remove("switching"), 50);
      }, 180);
    });
  });
  document.getElementById("btn-salvar").addEventListener("click", salvar);
  document.getElementById("logo-upload").addEventListener("change", handleLogoUpload);
  document.getElementById("btn-remover-logo").addEventListener("click", removerLogo);

  // Padrões (suporta ambas as classes por compatibilidade)
  document.querySelectorAll(".cs-pattern-opt, .cc-pattern-opt").forEach(el => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".cs-pattern-opt, .cc-pattern-opt").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected");
      document.getElementById("input-padrao").dataset.value = el.dataset.pattern;
      agendarPreview();
    });
  });

  // Fontes (suporta ambas as classes)
  document.querySelectorAll(".cs-font-opt, .cc-font-opt").forEach(el => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".cs-font-opt, .cc-font-opt").forEach(e => e.classList.remove("selected"));
      el.classList.add("selected");
      document.getElementById("input-fonte").dataset.value = el.dataset.font;
      agendarPreview();
    });
  });

  // Preview inicial
  atualizarPreview();
}

// ── Carregar config ───────────────────────────────────────────────────────────
async function carregarConfig() {
  if (!instId) return;
  const { data } = await supabaseAdmin
    .from("cracha_config")
    .select("cor_principal, cor_secundaria, cor_texto, cor_decoracao, logo_url, padrao, fonte")
    .eq("instituicao_id", instId)
    .maybeSingle();

  if (data) {
    // Cores: input + swatch + hex display + CSS var
    const corFields = [
      { inputId: "input-cor1",      swatchId: "swatch1",      valId: "val-cor1",      val: data.cor_principal  || "#2563eb" },
      { inputId: "input-cor2",      swatchId: "swatch2",      valId: "val-cor2",      val: data.cor_secundaria || "#1e40af" },
      { inputId: "input-cor-texto", swatchId: "swatch-texto", valId: "val-cor-texto", val: data.cor_texto       || "#111827" },
      { inputId: "input-cor-decor", swatchId: "swatch-decor", valId: "val-cor-decor", val: data.cor_decoracao  || "#2563eb", isDecor: true },
    ];
    corFields.forEach(f => {
      const inp = document.getElementById(f.inputId);
      const sw  = document.getElementById(f.swatchId);
      const vl  = document.getElementById(f.valId);
      if (inp) inp.value = f.val;
      if (sw)  sw.style.background = f.val;
      if (vl)  vl.textContent = f.val;
      if (f.isDecor) document.documentElement.style.setProperty("--thumb-c", f.val);
    });

    if (data.logo_url) setLogoPreview(data.logo_url);

    // Padrão
    if (data.padrao) {
      document.getElementById("input-padrao").dataset.value = data.padrao;
      document.querySelectorAll(".cs-pattern-opt, .cc-pattern-opt").forEach(e => {
        e.classList.toggle("selected", e.dataset.pattern === data.padrao);
      });
    }
    // Fonte
    if (data.fonte) {
      document.getElementById("input-fonte").dataset.value = data.fonte;
      document.querySelectorAll(".cs-font-opt, .cc-font-opt").forEach(e => {
        e.classList.toggle("selected", e.dataset.font === data.fonte);
      });
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

function getConfig() {
  return {
    cor_principal:  document.getElementById("input-cor1").value,
    cor_secundaria: document.getElementById("input-cor2").value,
    cor_texto:      document.getElementById("input-cor-texto")?.value   || "#111827",
    cor_decoracao:  document.getElementById("input-cor-decor")?.value   || "#2563eb",
    logo_url: document.getElementById("logo-area").dataset.logo || null,
    padrao:   document.getElementById("input-padrao")?.dataset.value || "limpo",
    fonte:    document.getElementById("input-fonte")?.dataset.value  || "georgia",
  };
}

async function atualizarPreview() {
  const config = getConfig();

  const container = document.getElementById("preview-canvas-wrap");
  container.innerHTML = `<div class="preview-loading">Gerando preview…</div>`;

  try {
    const dataUrl = await gerarCracha(DEMO_ALUNO, config, instNome || "Minha Instituição", modoPreview);
    container.innerHTML = `<img src="${dataUrl}" alt="Preview do crachá" />`;
  } catch (e) {
    container.innerHTML = `<div class="cc-preview-err">Erro no preview: ${e.message}</div>`;
  }
}

// ── Salvar ────────────────────────────────────────────────────────────────────
async function salvar() {
  if (!instId) { showToast("Sessão inválida. Recarregue a página.", "error"); return; }

  const btn     = document.getElementById("btn-salvar");
  const origHTML = btn.innerHTML;
  btn.disabled  = true;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" style="animation:spin .8s linear infinite"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Salvando…`;

  try {
    const cfg = getConfig();
    const payload = {
      instituicao_id: instId,
      cor_principal:  cfg.cor_principal,
      cor_secundaria: cfg.cor_secundaria,
      cor_texto:      cfg.cor_texto,
      cor_decoracao:  cfg.cor_decoracao,
      logo_url:       cfg.logo_url,
      padrao:         cfg.padrao,
      fonte:          cfg.fonte,
      atualizado_em:  new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("cracha_config")
      .upsert(payload, { onConflict: "instituicao_id" });

    if (error) {
      showToast("Erro ao salvar: " + error.message, "error");
      console.error("Erro cracha_config upsert:", error);
    } else {
      showToast("Configuração salva!", "success");
    }
  } catch (e) {
    showToast("Erro inesperado: " + e.message, "error");
    console.error("Exceção ao salvar:", e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
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
