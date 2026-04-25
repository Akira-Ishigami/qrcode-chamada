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
    window.location.href = profile.role === "professor" ? "/chamada.html" : "/inst-dashboard.html";
    return;
  }

  await renderDashboard();
}

// ─── Dashboard principal ───────────────────────────────────────────────────────
async function renderDashboard() {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje = new Date().toISOString().split("T")[0];
  const dataFmt = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });

  const [
    { data: instituicoes },
    { data: alunos },
    { data: profs },
    { data: chamadas },
  ] = await Promise.all([
    supabase.from("instituicoes").select("id, nome, criado_em").order("nome"),
    supabase.from("alunos").select("id, instituicao_id"),
    supabase.from("profiles").select("id, role, instituicao_id").eq("role", "professor"),
    supabase.from("chamadas").select("id, aberta, turmas(instituicao_id)").eq("data", hoje),
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

  root.innerHTML = `
    <div class="dash-header">
      <div>
        <div class="dash-title">Painel ADM</div>
        <div class="dash-subtitle">${dataFmt}</div>
      </div>
      <button class="tv-btn-add" id="btn-nova-inst">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Instituição
      </button>
    </div>

    <div class="dash-stats-row">
      ${statCard("blue",   iconInst(),  insts.length,  "Instituições")}
      ${statCard("green",  iconAluno(), totalAlun,     "Alunos")}
      ${statCard("purple", iconProf(),  totalProfs,    "Professores")}
      ${statCard("orange", iconQr(),    totalCham,     "Chamadas hoje" + (totalAbr ? ` <span class="dash-badge-aberta">${totalAbr} abertas</span>` : ""))}
    </div>

    <div class="dash-section-title">Instituições cadastradas</div>

    ${insts.length === 0
      ? `<div class="dash-empty">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
           <p>Nenhuma instituição cadastrada ainda.<br>Clique em <strong>Nova Instituição</strong> para começar.</p>
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
      const since = inst.criado_em
        ? new Date(inst.criado_em).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
        : "";

      const card = document.createElement("div");
      card.className = "dash-inst-card";
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="dic-header">
          <div class="dic-avatar">${iconInst()}</div>
          <div class="dic-info">
            <div class="dic-name">${esc(inst.nome)}</div>
            ${since ? `<div class="dic-since">Desde ${since}</div>` : ""}
          </div>
        </div>
        <div class="dic-stats">
          <div class="dic-stat"><span class="dic-num">${na}</span><span class="dic-lbl">alunos</span></div>
          <div class="dic-stat"><span class="dic-num">${np}</span><span class="dic-lbl">profs</span></div>
          <div class="dic-stat"><span class="dic-num">${nc}</span><span class="dic-lbl">chamadas</span></div>
        </div>
        <div class="dic-actions">
          <button class="dic-btn-detail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
            Ver detalhes
          </button>
          <button class="dic-btn-reset" title="Redefinir senha">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          </button>
          <button class="dic-btn-del" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      `;

      card.querySelector(".dic-btn-detail").addEventListener("click", () =>
        renderInstDetail(inst.id, inst.nome));
      card.querySelector(".dic-btn-reset").addEventListener("click", () =>
        abrirModalResetSenha(inst.id, inst.nome));
      card.querySelector(".dic-btn-del").addEventListener("click", () =>
        confirmarExcluir(inst.id, inst.nome));

      grid.appendChild(card);
    });
  }
}

// ─── Detalhe da Instituição ────────────────────────────────────────────────────
async function renderInstDetail(instId, instNome) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje = new Date().toISOString().split("T")[0];

  const [
    { data: turmas },
    { data: alunos },
    { data: profs },
    { data: chamadas },
  ] = await Promise.all([
    supabase.from("turmas").select("id, nome, materia, horario").eq("instituicao_id", instId).order("nome"),
    supabase.from("alunos").select("id, nome, matricula, turma_id").eq("instituicao_id", instId).order("nome"),
    supabase.from("profiles").select("id, nome, email").eq("instituicao_id", instId).eq("role", "professor").order("nome"),
    supabase.from("chamadas")
      .select("id, aberta, data, turmas!inner(nome, instituicao_id)")
      .eq("turmas.instituicao_id", instId)
      .order("data", { ascending: false })
      .limit(20),
  ]);

  const nTurmas  = (turmas  ?? []).length;
  const nAlunos  = (alunos  ?? []).length;
  const nProfs   = (profs   ?? []).length;
  const chamHoje = (chamadas ?? []).filter(c => c.data === hoje);
  const abertas  = chamHoje.filter(c => c.aberta).length;

  // Alunos por turma
  const alunosPorTurma = {};
  (alunos ?? []).forEach(a => {
    if (a.turma_id) {
      if (!alunosPorTurma[a.turma_id]) alunosPorTurma[a.turma_id] = 0;
      alunosPorTurma[a.turma_id]++;
    }
  });

  // Chamada de hoje por turma
  const chamHojeMap = {};
  chamHoje.forEach(c => { chamHojeMap[c.turmas?.nome] = c; });

  root.innerHTML = `
    <!-- Breadcrumb -->
    <div class="det-breadcrumb">
      <button class="det-btn-back" id="btn-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="15 18 9 12 15 6"/></svg>
        Voltar
      </button>
      <span class="det-bc-sep">/</span>
      <span class="det-bc-name">${esc(instNome)}</span>
    </div>

    <!-- Header -->
    <div class="det-header">
      <div class="det-header-left">
        <div class="det-avatar">${iconInst()}</div>
        <div>
          <div class="det-title">${esc(instNome)}</div>
          <div class="det-subtitle">Visão detalhada da instituição</div>
        </div>
      </div>
      <div class="det-header-actions">
        <button class="dic-btn-reset det-action-btn" id="btn-reset-detail">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          Redefinir senha
        </button>
        <button class="dic-btn-del det-action-btn" id="btn-del-detail" style="width:auto;padding:0 12px;gap:6px;font-size:.78rem;font-weight:600;color:var(--red-text)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          Excluir
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="det-stats">
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#eff6ff;color:#2563eb">${iconTurma()}</div>
        <div class="det-stat-num">${nTurmas}</div>
        <div class="det-stat-lbl">Turmas</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#f0fdf4;color:#16a34a">${iconAluno()}</div>
        <div class="det-stat-num">${nAlunos}</div>
        <div class="det-stat-lbl">Alunos</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#faf5ff;color:#7c3aed">${iconProf()}</div>
        <div class="det-stat-num">${nProfs}</div>
        <div class="det-stat-lbl">Professores</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#fff7ed;color:#ea580c">${iconQr()}</div>
        <div class="det-stat-num">${chamHoje.length}</div>
        <div class="det-stat-lbl">Chamadas hoje${abertas ? ` <span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 5px;font-size:.6rem;font-weight:700;margin-left:3px">${abertas} abertas</span>` : ""}</div>
      </div>
    </div>

    <!-- Turmas -->
    <div class="det-section">
      <div class="det-section-title">Turmas (${nTurmas})</div>
      ${nTurmas === 0
        ? `<div class="det-empty">Nenhuma turma cadastrada.</div>`
        : `<div class="det-table-wrap">
            <table class="det-table">
              <thead><tr>
                <th>Turma</th>
                <th>Matéria</th>
                <th>Alunos</th>
                <th>Chamada hoje</th>
              </tr></thead>
              <tbody>
                ${(turmas ?? []).map(t => `
                  <tr>
                    <td><span class="det-td-name">${esc(t.nome)}</span></td>
                    <td><span class="det-td-sub">${esc(t.materia || "—")}</span></td>
                    <td>${alunosPorTurma[t.id] ?? 0}</td>
                    <td>${chamHojeMap[t.nome]
                      ? chamHojeMap[t.nome].aberta
                        ? `<span class="det-badge open">Aberta</span>`
                        : `<span class="det-badge done">Encerrada</span>`
                      : `<span class="det-td-sub">—</span>`}
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`
      }
    </div>

    <!-- Professores -->
    <div class="det-section">
      <div class="det-section-title">Professores (${nProfs})</div>
      ${nProfs === 0
        ? `<div class="det-empty">Nenhum professor cadastrado.</div>`
        : `<div class="det-table-wrap">
            <table class="det-table">
              <thead><tr><th>Nome</th><th>E-mail</th></tr></thead>
              <tbody>
                ${(profs ?? []).map(p => `
                  <tr>
                    <td>
                      <div class="det-prof-cell">
                        <div class="det-prof-avatar">${esc((p.nome || p.email || "?").charAt(0).toUpperCase())}</div>
                        <span class="det-td-name">${esc(p.nome || "—")}</span>
                      </div>
                    </td>
                    <td><span class="det-td-sub">${esc(p.email || "—")}</span></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`
      }
    </div>

    <!-- Chamadas recentes -->
    <div class="det-section">
      <div class="det-section-title">Chamadas recentes</div>
      ${(chamadas ?? []).length === 0
        ? `<div class="det-empty">Nenhuma chamada registrada ainda.</div>`
        : `<div class="det-chamadas">
            ${(chamadas ?? []).slice(0, 10).map(c => `
              <div class="det-cham-row">
                <div class="det-cham-dot ${c.aberta ? "open" : "done"}"></div>
                <div class="det-cham-info">
                  <span class="det-cham-nome">${esc(c.turmas?.nome ?? "—")}</span>
                  <span class="det-cham-data">${new Date(c.data + "T00:00:00").toLocaleDateString("pt-BR")}</span>
                </div>
                <span class="det-badge ${c.aberta ? "open" : "done"}">${c.aberta ? "Aberta" : "Encerrada"}</span>
              </div>`).join("")}
          </div>`
      }
    </div>
  `;

  document.getElementById("btn-back").addEventListener("click", renderDashboard);
  document.getElementById("btn-reset-detail").addEventListener("click", () =>
    abrirModalResetSenha(instId, instNome));
  document.getElementById("btn-del-detail").addEventListener("click", () =>
    confirmarExcluir(instId, instNome, true));
}

// ─── Modal: Nova Instituição ───────────────────────────────────────────────────
function abrirModalNovaInst() {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${iconInst()}</div>
      <div><h2>Nova Instituição</h2><p>Cria a conta de acesso e o registro</p></div>
      <button class="tv-modal-x" id="modal-x">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
    const err   = overlay.querySelector("#modal-err");
    const btn   = overlay.querySelector("#modal-ok");
    const nome  = overlay.querySelector("#inst-nome").value.trim();
    const email = overlay.querySelector("#inst-email").value.trim();
    const senha = overlay.querySelector("#inst-senha").value;

    err.textContent = "";
    if (!nome)          { err.textContent = "Informe o nome.";   return; }
    if (!email)         { err.textContent = "Informe o e-mail."; return; }
    if (senha.length < 8) { err.textContent = "Senha mínimo 8 caracteres."; return; }

    btn.disabled = true;
    btn.textContent = "Criando…";

    const { data: instData, error: instErr } = await supabase
      .from("instituicoes").insert({ nome }).select("id").single();

    if (instErr) {
      err.textContent = instErr.code === "23505" ? "Nome já existe." : instErr.message;
      btn.disabled = false; btn.textContent = "Criar"; return;
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email, password: senha, email_confirm: true,
      user_metadata: { role: "instituicao", nome },
    });

    if (userErr) {
      await supabase.from("instituicoes").delete().eq("id", instData.id);
      err.textContent = userErr.message;
      btn.disabled = false; btn.textContent = "Criar"; return;
    }

    await supabaseAdmin.from("profiles")
      .update({ instituicao_id: instData.id })
      .eq("id", userData.user.id);

    fechar();
    showToast(`Instituição "${nome}" criada!`, "success");
    await renderDashboard();
  });
}

// ─── Modal: Redefinir senha ────────────────────────────────────────────────────
function abrirModalResetSenha(instId, instNome) {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${iconInst()}</div>
      <div><h2>Redefinir Senha</h2><p>${esc(instNome)}</p></div>
      <button class="tv-modal-x" id="modal-x">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("id")
      .eq("instituicao_id", instId).eq("role", "instituicao").single();

    if (!profile) { err.textContent = "Usuário não encontrado."; btn.disabled = false; btn.textContent = "Salvar"; return; }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: senha });
    if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = "Salvar"; return; }

    fechar();
    showToast("Senha redefinida!", "success");
  });
}

// ─── Modal: Confirmar exclusão ─────────────────────────────────────────────────
function confirmarExcluir(instId, instNome, voltarAoDash = false) {
  const overlay = criarOverlay(`
    <div class="tv-modal-body" style="padding:32px 24px;text-align:center">
      <div style="width:52px;height:52px;border-radius:14px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </div>
      <h3 style="font-size:1.05rem;font-weight:700;color:var(--text);margin-bottom:8px;letter-spacing:-.01em">Excluir instituição?</h3>
      <p style="font-size:.875rem;color:var(--text-2);line-height:1.6;max-width:280px;margin:0 auto 24px">
        Isso remove <strong>${esc(instNome)}</strong> e todos os dados vinculados (turmas, alunos, chamadas). Esta ação é irreversível.
      </p>
      <div style="display:flex;gap:10px;">
        <button class="tv-btn-ghost" id="modal-cancel" style="flex:1">Cancelar</button>
        <button id="modal-ok" style="flex:1;padding:10px;border:none;border-radius:9px;background:var(--red);color:white;font-size:.875rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background .13s">Excluir</button>
      </div>
      <div class="tv-modal-err" id="modal-err" style="margin-top:10px"></div>
    </div>
  `);

  const fechar = () => overlay.remove();
  overlay.querySelector("#modal-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", onEsc); }
  });

  overlay.querySelector("#modal-ok").addEventListener("click", async () => {
    const btn = overlay.querySelector("#modal-ok");
    const err = overlay.querySelector("#modal-err");
    btn.disabled = true; btn.textContent = "Excluindo…";

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("id").eq("instituicao_id", instId).eq("role", "instituicao").single();

    if (profile) {
      await supabaseAdmin.auth.admin.deleteUser(profile.id);
    }

    const { error } = await supabase.from("instituicoes").delete().eq("id", instId);
    if (error) {
      err.textContent = "Não foi possível excluir: " + error.message;
      btn.disabled = false; btn.textContent = "Excluir"; return;
    }

    fechar();
    showToast(`"${instNome}" excluída.`, "success");
    await renderDashboard();
  });
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
function iconTurma() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }

init();
