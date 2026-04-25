import { supabase }      from "./supabase.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { applyNavRole }  from "./nav-role.js";

const root = document.getElementById("page-root");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  await applyNavRole();

  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role").eq("id", session.user.id).single();

  if (profileError || !profile) {
    root.innerHTML = `<div class="tv-error">Erro ao carregar perfil. <a href="/login.html">Login</a></div>`;
    return;
  }

  if (profile.role !== "admin") {
    window.location.href = profile.role === "professor" ? "/chamada.html" : "/turmas.html";
    return;
  }

  await renderDashboard();
}

// ─── Render principal ─────────────────────────────────────────────────────────
async function renderDashboard() {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const [
    { data: instituicoes },
    { data: alunos },
    { data: profs },
    { data: chamadas },
  ] = await Promise.all([
    supabase.from("instituicoes").select("id, nome, criado_em").order("nome"),
    supabase.from("alunos").select("id, instituicao_id"),
    supabase.from("profiles").select("id, role, instituicao_id").eq("role", "professor"),
    supabase.from("chamadas").select("id, aberta, turmas(instituicao_id)")
      .eq("data", new Date().toISOString().split("T")[0]),
  ]);

  const insts      = instituicoes ?? [];
  const totalAlun  = (alunos ?? []).length;
  const totalProfs = (profs  ?? []).length;
  const totalCham  = (chamadas ?? []).length;
  const totalAbr   = (chamadas ?? []).filter(c => c.aberta).length;

  const alunosPorInst = {};
  const profsPorInst  = {};
  const chamPorInst   = {};
  (alunos ?? []).forEach(a => { if (a.instituicao_id) alunosPorInst[a.instituicao_id] = (alunosPorInst[a.instituicao_id]??0)+1; });
  (profs  ?? []).forEach(p => { if (p.instituicao_id) profsPorInst [p.instituicao_id] = (profsPorInst [p.instituicao_id]??0)+1; });
  (chamadas ?? []).forEach(c => { const id = c.turmas?.instituicao_id; if (id) chamPorInst[id] = (chamPorInst[id]??0)+1; });

  const dataFmt = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });

  root.innerHTML = `
    <div class="dash-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:28px">
      <div>
        <div class="dash-title">Painel Admin</div>
        <div class="dash-subtitle">${dataFmt}</div>
      </div>
      <button class="tv-btn-add" id="btn-nova-inst">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Instituição
      </button>
    </div>

    <div class="dash-stats-row">
      ${statCard("blue",   iconInst(),       insts.length,  "Instituições")}
      ${statCard("green",  iconAluno(),      totalAlun,     "Alunos")}
      ${statCard("purple", iconProf(),       totalProfs,    "Professores")}
      ${statCard("orange", iconQr(),         totalCham,     "Chamadas hoje" + (totalAbr ? ` <span class="dash-badge-aberta">${totalAbr} abertas</span>` : ""))}
    </div>

    <div class="dash-section-title">Instituições cadastradas</div>

    ${insts.length === 0
      ? `<div class="dash-empty">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:.25"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
           <p>Nenhuma instituição cadastrada ainda.</p>
         </div>`
      : `<div class="dash-inst-grid" id="inst-grid"></div>`
    }
  `;

  document.getElementById("btn-nova-inst").addEventListener("click", abrirModalNovaInst);

  if (insts.length > 0) {
    const grid = document.getElementById("inst-grid");
    insts.forEach((inst, i) => {
      const na = alunosPorInst[inst.id] ?? 0;
      const np = profsPorInst [inst.id] ?? 0;
      const nc = chamPorInst  [inst.id] ?? 0;
      const card = document.createElement("div");
      card.className = "dash-inst-card";
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="dic-header">
          <div class="dic-name">${esc(inst.nome)}</div>
          <button class="tvc-del" title="Excluir instituição" data-id="${inst.id}" data-nome="${esc(inst.nome)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
        <div class="dic-stats">
          <div class="dic-stat"><span class="dic-num">${na}</span><span class="dic-lbl">alunos</span></div>
          <div class="dic-stat" style="border-left:1px solid var(--border)"><span class="dic-num">${np}</span><span class="dic-lbl">profs</span></div>
          <div class="dic-stat" style="border-left:1px solid var(--border)"><span class="dic-num">${nc}</span><span class="dic-lbl">chamadas</span></div>
        </div>
        <div class="dic-footer" style="display:flex;gap:8px;margin-top:12px">
          <button class="tv-btn-add green" style="font-size:.75rem;padding:7px 12px" data-action="reset-senha" data-id="${inst.id}" data-nome="${esc(inst.nome)}">
            Redefinir senha
          </button>
        </div>
      `;
      card.querySelector("[data-action='reset-senha']").addEventListener("click", () =>
        abrirModalResetSenha(inst.id, inst.nome));
      card.querySelector(".tvc-del").addEventListener("click", () =>
        confirmarExcluir(inst.id, inst.nome));
      grid.appendChild(card);
    });
  }
}

// ─── Modal: Nova Instituição ──────────────────────────────────────────────────
function abrirModalNovaInst() {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${iconInst()}</div>
      <div><h2>Nova Instituição</h2><p>Cria a conta de acesso e o registro</p></div>
      <button class="tv-modal-x" id="modal-x">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="tv-modal-body">
      <label class="tv-label">Nome da instituição <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="inst-nome" placeholder="Ex: Escola Estadual João Silva" autocomplete="off"/>
      <label class="tv-label">E-mail de acesso <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="inst-email" type="email" placeholder="escola@email.com" autocomplete="off"/>
      <label class="tv-label">Senha inicial <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="inst-senha" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password"/>
      <div class="tv-modal-err" id="modal-err"></div>
    </div>
    <div class="tv-modal-foot">
      <button class="tv-btn-ghost" id="modal-cancel">Cancelar</button>
      <button class="tv-btn-add" id="modal-ok">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Criar
      </button>
    </div>
  `);

  const fechar = () => overlay.remove();
  overlay.querySelector("#modal-x").addEventListener("click", fechar);
  overlay.querySelector("#modal-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });

  overlay.querySelector("#inst-nome").focus();

  overlay.querySelector("#modal-ok").addEventListener("click", async () => {
    const err  = overlay.querySelector("#modal-err");
    const btn  = overlay.querySelector("#modal-ok");
    const nome = overlay.querySelector("#inst-nome").value.trim();
    const email = overlay.querySelector("#inst-email").value.trim();
    const senha = overlay.querySelector("#inst-senha").value;

    err.textContent = "";
    if (!nome)                   { err.textContent = "Informe o nome.";   return; }
    if (!email)                  { err.textContent = "Informe o e-mail."; return; }
    if (senha.length < 8)        { err.textContent = "Senha mínimo 8 caracteres."; return; }

    btn.disabled = true;
    btn.textContent = "Criando…";

    // 1. Cria o registro da instituição
    const { data: instData, error: instErr } = await supabase
      .from("instituicoes").insert({ nome }).select("id").single();

    if (instErr) {
      err.textContent = instErr.code === "23505" ? "Nome já existe." : instErr.message;
      btn.disabled = false; btn.textContent = "Criar"; return;
    }

    // 2. Cria o usuário auth com role instituicao
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { role: "instituicao", nome },
    });

    if (userErr) {
      // Desfaz a instituição criada
      await supabase.from("instituicoes").delete().eq("id", instData.id);
      err.textContent = userErr.message;
      btn.disabled = false; btn.textContent = "Criar"; return;
    }

    // 3. Vincula o perfil à instituição (trigger já criou o profile)
    await supabaseAdmin
      .from("profiles")
      .update({ instituicao_id: instData.id })
      .eq("id", userData.user.id);

    fechar();
    showToast(`Instituição "${nome}" criada!`, "success");
    await renderDashboard();
  });
}

// ─── Modal: Redefinir senha ───────────────────────────────────────────────────
function abrirModalResetSenha(instId, instNome) {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${iconInst()}</div>
      <div><h2>Redefinir Senha</h2><p>${esc(instNome)}</p></div>
      <button class="tv-modal-x" id="modal-x">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="tv-modal-body">
      <label class="tv-label">Nova senha <span style="color:var(--red)">*</span></label>
      <input class="tv-input" id="nova-senha" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password"/>
      <div class="tv-modal-err" id="modal-err"></div>
    </div>
    <div class="tv-modal-foot">
      <button class="tv-btn-ghost" id="modal-cancel">Cancelar</button>
      <button class="tv-btn-add" id="modal-ok">Salvar</button>
    </div>
  `);

  const fechar = () => overlay.remove();
  overlay.querySelector("#modal-x").addEventListener("click", fechar);
  overlay.querySelector("#modal-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  overlay.querySelector("#nova-senha").focus();

  overlay.querySelector("#modal-ok").addEventListener("click", async () => {
    const err   = overlay.querySelector("#modal-err");
    const btn   = overlay.querySelector("#modal-ok");
    const senha = overlay.querySelector("#nova-senha").value;
    if (senha.length < 8) { err.textContent = "Mínimo 8 caracteres."; return; }

    btn.disabled = true; btn.textContent = "Salvando…";

    // Busca o user_id do perfil vinculado a esta instituição com role instituicao
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("instituicao_id", instId)
      .eq("role", "instituicao")
      .single();

    if (!profile) { err.textContent = "Usuário não encontrado."; btn.disabled = false; btn.textContent = "Salvar"; return; }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: senha });
    if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = "Salvar"; return; }

    fechar();
    showToast("Senha redefinida!", "success");
  });
}

// ─── Excluir instituição ──────────────────────────────────────────────────────
async function confirmarExcluir(instId, instNome) {
  if (!confirm(`Excluir "${instNome}"?\nIsso remove todos os dados vinculados (turmas, alunos, etc.).`)) return;

  // Remove o usuário auth com role instituicao vinculado
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("id").eq("instituicao_id", instId).eq("role", "instituicao").single();

  if (profile) {
    await supabaseAdmin.auth.admin.deleteUser(profile.id);
  }

  const { error } = await supabase.from("instituicoes").delete().eq("id", instId);
  if (error) { showToast("Não foi possível excluir: " + error.message, "error"); return; }

  showToast(`"${instNome}" excluída.`, "success");
  await renderDashboard();
}

// ─── Utilitários ──────────────────────────────────────────────────────────────
function criarOverlay(html) {
  const overlay = document.createElement("div");
  overlay.className = "tv-modal-overlay";
  overlay.innerHTML = `<div class="tv-modal-card">${html}</div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add("open"), 10);
  return overlay;
}

function statCard(color, icon, num, lbl) {
  return `
    <div class="dash-stat-card">
      <div class="dash-stat-icon ${color}">${icon}</div>
      <div class="dash-stat-num">${num}</div>
      <div class="dash-stat-lbl">${lbl}</div>
    </div>`;
}

function iconInst()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function iconAluno() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`; }
function iconProf()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function iconQr()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>`; }

init();
