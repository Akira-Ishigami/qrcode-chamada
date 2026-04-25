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

function setActive(id) {
  document.querySelectorAll(".sidebar-nav .sidebar-link").forEach(el => el.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("role, id").eq("id", session.user.id).single();

  if (!profile || profile.role !== "admin") {
    window.location.href = profile?.role === "professor" ? "/chamada.html" : "/inst-dashboard.html";
    return;
  }

  // Guarda user id para notas
  window._adminId = session.user.id;

  // Navegação sidebar
  document.getElementById("nav-dashboard").addEventListener("click", () => { setActive("nav-dashboard"); renderDashboard(); });
  document.getElementById("nav-instituicoes").addEventListener("click", () => { setActive("nav-instituicoes"); renderInstituicoes(); });
  document.getElementById("nav-anotacoes").addEventListener("click", () => { setActive("nav-anotacoes"); renderAnotacoes(); });

  await renderDashboard();
}

// ══ VIEW 1: DASHBOARD (read-only) ════════════════════════════════════════════
async function renderDashboard() {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje    = new Date().toISOString().split("T")[0];
  const dataFmt = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" });
  const h       = new Date().getHours();
  const greeting = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";

  const [
    { data: instituicoes },
    { data: alunos },
    { data: profs },
    { data: chamadas },
  ] = await Promise.all([
    supabase.from("instituicoes").select("id, nome"),
    supabase.from("alunos").select("id"),
    supabase.from("profiles").select("id").eq("role", "professor"),
    supabase.from("chamadas")
      .select("id, aberta, turmas(nome, instituicoes(nome))")
      .eq("data", hoje)
      .order("criado_em", { ascending: false })
      .limit(15),
  ]);

  const nInst   = (instituicoes ?? []).length;
  const nAlunos = (alunos ?? []).length;
  const nProfs  = (profs ?? []).length;
  const nCham   = (chamadas ?? []).length;
  const nAbr    = (chamadas ?? []).filter(c => c.aberta).length;

  root.innerHTML = `
    <div class="dash-header">
      <div>
        <div class="dash-greeting">${greeting}</div>
        <div class="dash-title">Painel ADM</div>
        <div class="dash-subtitle">${dataFmt}</div>
      </div>
    </div>

    <div class="dash-stats-row">
      <div class="dash-stat-card" style="animation-delay:0s">
        <div class="dash-stat-icon blue">${svgInst()}</div>
        <div class="dash-stat-num">${nInst}</div>
        <div class="dash-stat-lbl">Instituições</div>
      </div>
      <div class="dash-stat-card" style="animation-delay:.06s">
        <div class="dash-stat-icon green">${svgAluno()}</div>
        <div class="dash-stat-num">${nAlunos}</div>
        <div class="dash-stat-lbl">Alunos</div>
      </div>
      <div class="dash-stat-card" style="animation-delay:.12s">
        <div class="dash-stat-icon purple">${svgProf()}</div>
        <div class="dash-stat-num">${nProfs}</div>
        <div class="dash-stat-lbl">Professores</div>
      </div>
      <div class="dash-stat-card" style="animation-delay:.18s">
        <div class="dash-stat-icon orange">${svgQr()}</div>
        <div class="dash-stat-num">${nCham}</div>
        <div class="dash-stat-lbl">Chamadas hoje${nAbr ? `<br><span class="dash-badge-aberta">${nAbr} abertas</span>` : ""}</div>
      </div>
    </div>

    <div class="dash-section-title">Chamadas de hoje</div>
    ${nCham === 0
      ? `<div style="background:var(--surface);border:1px dashed var(--border-2);border-radius:12px;padding:32px;text-align:center;color:var(--text-3);font-size:.875rem">Nenhuma chamada registrada hoje.</div>`
      : `<div class="dash-activity">
          ${(chamadas ?? []).map((c, i) => `
            <div class="dash-act-row" style="animation-delay:${i*.04}s">
              <div class="dash-act-dot ${c.aberta ? "aberta" : "fechada"}"></div>
              <div class="dash-act-info">
                <div class="dash-act-turma">${esc(c.turmas?.nome ?? "—")}</div>
                ${c.turmas?.instituicoes?.nome ? `<div class="dash-act-inst">${esc(c.turmas.instituicoes.nome)}</div>` : ""}
              </div>
              <span class="dash-act-badge ${c.aberta ? "aberta" : "fechada"}">${c.aberta ? "Aberta" : "Encerrada"}</span>
            </div>`).join("")}
        </div>`
    }
  `;
}

// ══ VIEW 2: INSTITUIÇÕES (lista + detalhe) ════════════════════════════════════
async function renderInstituicoes() {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje = new Date().toISOString().split("T")[0];

  const [
    { data: instituicoes },
    { data: alunos },
    { data: profs },
    { data: chamadas },
  ] = await Promise.all([
    supabase.from("instituicoes").select("id, nome, criado_em").order("nome"),
    supabase.from("alunos").select("id, instituicao_id"),
    supabase.from("profiles").select("id, instituicao_id").eq("role", "professor"),
    supabase.from("chamadas").select("id, aberta, turmas(instituicao_id)").eq("data", hoje),
  ]);

  const insts = instituicoes ?? [];
  const alunosPorInst = {};
  const profsPorInst  = {};
  const chamPorInst   = {};

  (alunos ?? []).forEach(a => { if (a.instituicao_id) alunosPorInst[a.instituicao_id] = (alunosPorInst[a.instituicao_id]??0)+1; });
  (profs  ?? []).forEach(p => { if (p.instituicao_id) profsPorInst [p.instituicao_id] = (profsPorInst [p.instituicao_id]??0)+1; });
  (chamadas ?? []).forEach(c => { const id = c.turmas?.instituicao_id; if (id) chamPorInst[id] = (chamPorInst[id]??0)+1; });

  root.innerHTML = `
    <div class="inst-header">
      <div>
        <div class="inst-title">Instituições</div>
        <div class="inst-subtitle">${insts.length} instituição${insts.length !== 1 ? "s" : ""} cadastrada${insts.length !== 1 ? "s" : ""}</div>
      </div>
      <button class="tv-btn-add" id="btn-nova-inst">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Instituição
      </button>
    </div>

    ${insts.length === 0
      ? `<div class="inst-empty">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
           <p>Nenhuma instituição cadastrada ainda.</p>
         </div>`
      : `<div class="inst-table-wrap">
           <table class="inst-table">
             <thead>
               <tr>
                 <th>Instituição</th>
                 <th>Alunos</th>
                 <th>Professores</th>
                 <th>Chamadas hoje</th>
                 <th></th>
               </tr>
             </thead>
             <tbody id="inst-tbody"></tbody>
           </table>
         </div>`
    }
  `;

  document.getElementById("btn-nova-inst").addEventListener("click", abrirModalNovaInst);

  if (insts.length > 0) {
    const tbody = document.getElementById("inst-tbody");
    insts.forEach((inst, i) => {
      const na = alunosPorInst[inst.id] ?? 0;
      const np = profsPorInst [inst.id] ?? 0;
      const nc = chamPorInst  [inst.id] ?? 0;
      const since = inst.criado_em
        ? new Date(inst.criado_em).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
        : "";

      const tr = document.createElement("tr");
      tr.className = "clickable";
      tr.style.animationDelay = `${i * .04}s`;
      tr.innerHTML = `
        <td>
          <div class="inst-name-cell">
            <div class="inst-avatar">${svgInst()}</div>
            <div>
              <div class="inst-name-txt">${esc(inst.nome)}</div>
              ${since ? `<div class="inst-since">Desde ${since}</div>` : ""}
            </div>
          </div>
        </td>
        <td><span class="inst-mini-stat">${na}</span></td>
        <td><span class="inst-mini-stat">${np}</span></td>
        <td>${nc > 0
          ? `<span class="inst-mini-stat">${nc}</span>`
          : `<span style="color:var(--text-3);font-size:.8rem">—</span>`}
        </td>
        <td>
          <svg class="inst-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
        </td>
      `;
      tr.addEventListener("click", () => renderInstDetalhe(inst.id, inst.nome));
      tbody.appendChild(tr);
    });
  }
}

// ── Detalhe de uma instituição ────────────────────────────────────────────────
async function renderInstDetalhe(instId, instNome) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const hoje = new Date().toISOString().split("T")[0];

  const [
    { data: turmas },
    { data: alunos },
    { data: profs },
    { data: chamadas },
  ] = await Promise.all([
    supabase.from("turmas").select("id, nome, materia").eq("instituicao_id", instId).order("nome"),
    supabase.from("alunos").select("id, nome, matricula, turma_id").eq("instituicao_id", instId).order("nome"),
    supabase.from("profiles").select("id, nome, email").eq("instituicao_id", instId).eq("role", "professor").order("nome"),
    supabase.from("chamadas")
      .select("id, aberta, data, turmas!inner(nome, instituicao_id)")
      .eq("turmas.instituicao_id", instId)
      .order("data", { ascending: false })
      .limit(20),
  ]);

  const chamHoje = (chamadas ?? []).filter(c => c.data === hoje);
  const abertas  = chamHoje.filter(c => c.aberta).length;

  // Agrupa alunos por turma
  const turmaMap = {};
  (turmas ?? []).forEach(t => { turmaMap[t.id] = { ...t, alunos: [] }; });
  (alunos ?? []).forEach(a => { if (turmaMap[a.turma_id]) turmaMap[a.turma_id].alunos.push(a); });

  const gruposTurma = Object.values(turmaMap);
  const semTurma    = (alunos ?? []).filter(a => !turmaMap[a.turma_id]);

  root.innerHTML = `
    <div class="det-breadcrumb">
      <button class="det-btn-back" id="btn-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="15 18 9 12 15 6"/></svg>
        Instituições
      </button>
      <span class="det-bc-sep">/</span>
      <span class="det-bc-name">${esc(instNome)}</span>
    </div>

    <div class="det-header">
      <div class="det-header-left">
        <div class="det-avatar">${svgInst()}</div>
        <div>
          <div class="det-title">${esc(instNome)}</div>
          <div class="det-subtitle">Informações detalhadas</div>
        </div>
      </div>
      <div class="det-header-actions">
        <button class="det-btn-reset" id="btn-reset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          Redefinir senha
        </button>
        <button class="det-btn-del" id="btn-del">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          Excluir
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="det-stats">
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#eff6ff;color:#2563eb">${svgTurma()}</div>
        <div class="det-stat-num">${(turmas??[]).length}</div>
        <div class="det-stat-lbl">Turmas</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#f0fdf4;color:#16a34a">${svgAluno()}</div>
        <div class="det-stat-num">${(alunos??[]).length}</div>
        <div class="det-stat-lbl">Alunos</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#faf5ff;color:#7c3aed">${svgProf()}</div>
        <div class="det-stat-num">${(profs??[]).length}</div>
        <div class="det-stat-lbl">Professores</div>
      </div>
      <div class="det-stat">
        <div class="det-stat-icon" style="background:#fff7ed;color:#ea580c">${svgQr()}</div>
        <div class="det-stat-num">${chamHoje.length}</div>
        <div class="det-stat-lbl">Chamadas hoje${abertas ? `<br><span style="font-size:.6rem;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 5px;font-weight:700">${abertas} abertas</span>` : ""}</div>
      </div>
    </div>

    <!-- Alunos por turma -->
    <div class="det-section">
      <div class="det-section-title">Alunos por turma (${(alunos??[]).length})</div>
      ${gruposTurma.length === 0 && semTurma.length === 0
        ? `<div class="det-empty">Nenhum aluno cadastrado.</div>`
        : `<div id="det-alunos-list"></div>`
      }
    </div>

    <!-- Professores -->
    <div class="det-section">
      <div class="det-section-title">Professores (${(profs??[]).length})</div>
      ${(profs??[]).length === 0
        ? `<div class="det-empty">Nenhum professor cadastrado.</div>`
        : `<div class="det-table-wrap">
            <table class="det-table">
              <thead><tr><th>Nome</th><th>E-mail</th></tr></thead>
              <tbody>
                ${(profs??[]).map(p => `
                  <tr>
                    <td>
                      <div class="det-prof-cell">
                        <div class="det-prof-avatar">${esc((p.nome||p.email||"?").charAt(0).toUpperCase())}</div>
                        <span class="det-td-name">${esc(p.nome||"—")}</span>
                      </div>
                    </td>
                    <td><span class="det-td-sub">${esc(p.email||"—")}</span></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`
      }
    </div>

    <!-- Chamadas -->
    <div class="det-section">
      <div class="det-section-title">Chamadas recentes (${(chamadas??[]).length})</div>
      ${(chamadas??[]).length === 0
        ? `<div class="det-empty">Nenhuma chamada registrada ainda.</div>`
        : `<div class="det-chamadas">
            ${(chamadas??[]).map(c => `
              <div class="det-cham-row">
                <div class="det-cham-dot ${c.aberta ? "open" : "done"}"></div>
                <div class="det-cham-info">
                  <span class="det-cham-nome">${esc(c.turmas?.nome??"—")}</span>
                  <span class="det-cham-data">${new Date(c.data+"T00:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"numeric",month:"short"})}</span>
                </div>
                <span class="det-badge ${c.aberta?"open":"done"}">${c.aberta?"Aberta":"Encerrada"}</span>
              </div>`).join("")}
          </div>`
      }
    </div>
  `;

  // Popula alunos por turma com accordion
  if (document.getElementById("det-alunos-list")) {
    const list = document.getElementById("det-alunos-list");
    gruposTurma.forEach(t => {
      const group = document.createElement("div");
      group.className = "det-turma-group";
      group.innerHTML = `
        <div class="det-turma-label" data-open="false">
          <span>${esc(t.nome)}${t.materia ? ` <span style="color:var(--text-3);font-weight:500">· ${esc(t.materia)}</span>` : ""}</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="det-turma-count">${t.alunos.length} aluno${t.alunos.length!==1?"s":""}</span>
            <svg class="det-turma-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="det-turma-body">
          ${t.alunos.length === 0
            ? `<div style="padding:10px 14px;color:var(--text-3);font-size:.82rem">Nenhum aluno nesta turma.</div>`
            : t.alunos.map((a, i) => `
                <div class="det-aluno-row">
                  <span class="det-aluno-num">${i+1}</span>
                  <span class="det-aluno-nome">${esc(a.nome)}</span>
                  ${a.matricula ? `<span class="det-aluno-mat">${esc(a.matricula)}</span>` : ""}
                </div>`).join("")
          }
        </div>
      `;
      const label = group.querySelector(".det-turma-label");
      const body  = group.querySelector(".det-turma-body");
      label.addEventListener("click", () => {
        const open = label.dataset.open === "true";
        label.dataset.open = !open;
        label.classList.toggle("open", !open);
        body.classList.toggle("open", !open);
      });
      list.appendChild(group);
    });

    if (semTurma.length > 0) {
      const group = document.createElement("div");
      group.className = "det-turma-group";
      group.innerHTML = `
        <div class="det-turma-label" data-open="false">
          <span style="color:var(--text-3)">Sem turma atribuída</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="det-turma-count">${semTurma.length} aluno${semTurma.length!==1?"s":""}</span>
            <svg class="det-turma-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="det-turma-body">
          ${semTurma.map((a, i) => `
            <div class="det-aluno-row">
              <span class="det-aluno-num">${i+1}</span>
              <span class="det-aluno-nome">${esc(a.nome)}</span>
              ${a.matricula ? `<span class="det-aluno-mat">${esc(a.matricula)}</span>` : ""}
            </div>`).join("")}
        </div>
      `;
      const label = group.querySelector(".det-turma-label");
      const body  = group.querySelector(".det-turma-body");
      label.addEventListener("click", () => {
        const open = label.dataset.open === "true";
        label.dataset.open = !open;
        label.classList.toggle("open", !open);
        body.classList.toggle("open", !open);
      });
      list.appendChild(group);
    }
  }

  document.getElementById("btn-back").addEventListener("click", () => renderInstituicoes());
  document.getElementById("btn-reset").addEventListener("click", () => abrirModalResetSenha(instId, instNome));
  document.getElementById("btn-del").addEventListener("click", () => confirmarExcluir(instId, instNome));
}

// ══ VIEW 3: ANOTAÇÕES ════════════════════════════════════════════════════════
function renderAnotacoes() {
  const storageKey = `adm_notes_${window._adminId || "local"}`;
  const pinsKey    = `adm_pins_${window._adminId  || "local"}`;

  const saved = localStorage.getItem(storageKey) || "";
  const pins  = JSON.parse(localStorage.getItem(pinsKey) || "[]");

  const renderPins = () => {
    const container = document.getElementById("pins-container");
    if (!container) return;
    const pinList = JSON.parse(localStorage.getItem(pinsKey) || "[]");
    if (pinList.length === 0) {
      container.innerHTML = `<div style="font-size:.78rem;color:var(--text-3);padding:8px 0">Nenhuma nota fixada.<br>Selecione texto e clique em "Fixar seleção".</div>`;
      return;
    }
    container.innerHTML = pinList.map((p, i) => `
      <div class="notes-pin-card">
        <div class="notes-pin-text">${esc(p.text)}</div>
        <div class="notes-pin-date">${p.date}</div>
        <button class="notes-pin-del" data-i="${i}" title="Remover">✕</button>
      </div>`).join("");
    container.querySelectorAll(".notes-pin-del").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const idx  = parseInt(btn.dataset.i);
        const list = JSON.parse(localStorage.getItem(pinsKey) || "[]");
        list.splice(idx, 1);
        localStorage.setItem(pinsKey, JSON.stringify(list));
        renderPins();
      });
    });
  };

  root.innerHTML = `
    <div class="notes-header">
      <div class="notes-title">Anotações</div>
      <div class="notes-subtitle">Notas pessoais — salvas localmente neste navegador</div>
    </div>

    <div class="notes-wrap">
      <div class="notes-main">
        <div class="notes-card">
          <div class="notes-toolbar">
            <span class="notes-toolbar-title">Bloco de notas</span>
            <span class="notes-save-status" id="save-status">Pronto</span>
          </div>
          <textarea class="notes-textarea" id="notes-ta" placeholder="Escreva suas anotações aqui...">${esc(saved)}</textarea>
          <div class="notes-actions">
            <button class="notes-btn-save" id="btn-save-notes">Salvar</button>
            <button class="notes-btn-pin" id="btn-pin-sel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="margin-right:5px"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14"/><path d="M12 3l3 7H9l3-7z"/></svg>
              Fixar seleção
            </button>
            <button class="notes-btn-clear" id="btn-clear-notes">Limpar</button>
          </div>
        </div>
      </div>

      <div class="notes-sidebar">
        <div class="notes-pins-title">Notas fixadas</div>
        <div id="pins-container"></div>
      </div>
    </div>
  `;

  renderPins();

  const ta         = document.getElementById("notes-ta");
  const saveStatus = document.getElementById("save-status");
  let autoTimer    = null;

  const save = (showMsg = true) => {
    localStorage.setItem(storageKey, ta.value);
    if (showMsg) {
      saveStatus.textContent = "Salvo ✓";
      saveStatus.className   = "notes-save-status saved";
      setTimeout(() => { saveStatus.textContent = "Pronto"; saveStatus.className = "notes-save-status"; }, 2000);
    }
  };

  // Auto-save após 1.5s sem digitar
  ta.addEventListener("input", () => {
    saveStatus.textContent = "Não salvo…";
    saveStatus.className   = "notes-save-status";
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => save(true), 1500);
  });

  document.getElementById("btn-save-notes").addEventListener("click", () => save(true));

  document.getElementById("btn-pin-sel").addEventListener("click", () => {
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const text  = ta.value.substring(start, end).trim();
    if (!text) { showToast("Selecione um trecho do texto antes de fixar.", "error"); return; }
    const list = JSON.parse(localStorage.getItem(pinsKey) || "[]");
    list.unshift({ text, date: new Date().toLocaleDateString("pt-BR", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) });
    localStorage.setItem(pinsKey, JSON.stringify(list));
    renderPins();
    showToast("Trecho fixado!", "success");
  });

  document.getElementById("btn-clear-notes").addEventListener("click", () => {
    if (!ta.value.trim()) return;
    const overlay = criarOverlay(`
      <div class="tv-modal-body" style="padding:28px 24px;text-align:center">
        <h3 style="font-size:1rem;font-weight:700;color:var(--text);margin-bottom:8px">Limpar anotações?</h3>
        <p style="font-size:.875rem;color:var(--text-2);margin-bottom:20px">Todo o conteúdo do bloco será apagado.</p>
        <div style="display:flex;gap:10px">
          <button class="tv-btn-ghost" id="m-cancel" style="flex:1">Cancelar</button>
          <button id="m-ok" style="flex:1;padding:10px;border:none;border-radius:9px;background:var(--red);color:white;font-size:.875rem;font-weight:700;cursor:pointer;font-family:inherit">Limpar</button>
        </div>
      </div>
    `);
    overlay.querySelector("#m-cancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector("#m-ok").addEventListener("click", () => {
      ta.value = "";
      save(false);
      saveStatus.textContent = "Pronto";
      overlay.remove();
    });
  });
}

// ══ MODAIS ════════════════════════════════════════════════════════════════════
function abrirModalNovaInst() {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${svgInst()}</div>
      <div><h2>Nova Instituição</h2><p>Cria a conta de acesso e o registro</p></div>
      <button class="tv-modal-x" id="modal-x">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="tv-modal-body">
      <label class="tv-label">Nome <span style="color:var(--red)">*</span></label>
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
    if (!nome)            { err.textContent = "Informe o nome.";   return; }
    if (!email)           { err.textContent = "Informe o e-mail."; return; }
    if (senha.length < 8) { err.textContent = "Senha mínimo 8 caracteres."; return; }

    btn.disabled = true; btn.textContent = "Criando…";

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
    showToast(`"${nome}" criada!`, "success");
    await renderInstituicoes();
  });
}

function abrirModalResetSenha(instId, instNome) {
  const overlay = criarOverlay(`
    <div class="tv-modal-head">
      <div class="tv-modal-icon inst">${svgInst()}</div>
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

function confirmarExcluir(instId, instNome) {
  const overlay = criarOverlay(`
    <div class="tv-modal-body" style="padding:32px 24px;text-align:center">
      <div style="width:52px;height:52px;border-radius:14px;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </div>
      <h3 style="font-size:1.05rem;font-weight:700;color:var(--text);margin-bottom:8px">Excluir instituição?</h3>
      <p style="font-size:.875rem;color:var(--text-2);line-height:1.6;max-width:280px;margin:0 auto 24px">
        Remove <strong>${esc(instNome)}</strong> e todos os dados vinculados. Irreversível.
      </p>
      <div style="display:flex;gap:10px">
        <button class="tv-btn-ghost" id="m-cancel" style="flex:1">Cancelar</button>
        <button id="m-ok" style="flex:1;padding:10px;border:none;border-radius:9px;background:var(--red);color:white;font-size:.875rem;font-weight:700;cursor:pointer;font-family:inherit">Excluir</button>
      </div>
      <div class="tv-modal-err" id="modal-err" style="margin-top:10px"></div>
    </div>
  `);

  const fechar = () => overlay.remove();
  overlay.querySelector("#m-cancel").addEventListener("click", fechar);
  overlay.addEventListener("click", e => { if (e.target === overlay) fechar(); });

  overlay.querySelector("#m-ok").addEventListener("click", async () => {
    const btn = overlay.querySelector("#m-ok");
    const err = overlay.querySelector("#modal-err");
    btn.disabled = true; btn.textContent = "Excluindo…";

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("id").eq("instituicao_id", instId).eq("role", "instituicao").single();
    if (profile) await supabaseAdmin.auth.admin.deleteUser(profile.id);

    const { error } = await supabase.from("instituicoes").delete().eq("id", instId);
    if (error) { err.textContent = "Erro: " + error.message; btn.disabled = false; btn.textContent = "Excluir"; return; }

    fechar();
    showToast(`"${instNome}" excluída.`, "success");
    setActive("nav-instituicoes");
    await renderInstituicoes();
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function criarOverlay(html) {
  const o = document.createElement("div");
  o.className = "tv-modal-overlay";
  o.innerHTML = `<div class="tv-modal-card">${html}</div>`;
  document.body.appendChild(o);
  setTimeout(() => o.classList.add("open"), 10);
  return o;
}

function svgInst()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`; }
function svgAluno() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`; }
function svgProf()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
function svgQr()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><rect x="7" y="14" width="3" height="3"/><rect x="14" y="14" width="3" height="3"/></svg>`; }
function svgTurma() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }

init();
