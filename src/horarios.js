import { supabase } from "./supabase.js";
import { applyNavRole, podeAdmin } from "./nav-role.js";

const root = document.getElementById("page-root");
const DIAS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const SVG_PLUS  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const SVG_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

let turmaId  = null;
let materia  = null;

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3500);
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }
  await applyNavRole();
  const { data: profile } = await supabase.from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();
  if (!profile || !podeAdmin(profile.role)) { window.location.href = "/minhas-turmas.html"; return; }
  await renderPage(profile);
}

async function renderPage(profile) {
  const isAdmin = profile.role === "admin";
  const adminInstId = isAdmin ? profile.instituicao_id : null;

  // admin: pula o seletor de instituição e carrega turmas direto
  const stepInstHtml = isAdmin ? "" : `
    <div class="hor-step">
      <div class="hor-step-num">1</div>
      <div class="hor-step-body">
        <label>Instituição</label>
        <select id="sel-inst">
          <option value="">Selecione…</option>
        </select>
      </div>
    </div>`;

  root.innerHTML = `
    <div class="hor-header">
      <div>
        <div class="hor-title">Horários de Aula</div>
        <div class="hor-subtitle">Selecione a turma, depois a matéria</div>
      </div>
    </div>
    <div class="hor-steps">
      ${stepInstHtml}
      <div class="hor-step">
        <div class="hor-step-num">${isAdmin ? "1" : "2"}</div>
        <div class="hor-step-body">
          <label>Turma</label>
          <select id="sel-turma" ${isAdmin ? "" : "disabled"}>
            <option value="">${isAdmin ? "Carregando…" : "— primeiro selecione a instituição —"}</option>
          </select>
        </div>
      </div>
      <div class="hor-step" id="step-materia" style="display:none">
        <div class="hor-step-num">${isAdmin ? "2" : "3"}</div>
        <div class="hor-step-body">
          <label>Matéria</label>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="sel-materia" style="flex:1">
              <option value="">Selecione ou crie…</option>
            </select>
            <span style="color:var(--text-3);font-size:.8rem">ou</span>
            <input type="text" id="nova-materia" placeholder="Nova matéria…" style="flex:1;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:.875rem;outline:none" />
            <button class="btn btn-primary" id="btn-sel-mat">${SVG_PLUS} Ver</button>
          </div>
        </div>
      </div>
    </div>
    <div id="hor-content"></div>`;

  async function carregarTurmasDaInst(instId) {
    const selTurma = document.getElementById("sel-turma");
    selTurma.innerHTML = `<option value="">Carregando…</option>`;
    selTurma.disabled = true;
    const { data: turmas } = await supabase
      .from("turmas").select("id, nome").eq("instituicao_id", instId).order("nome");
    if (!turmas?.length) { selTurma.innerHTML = `<option value="">Nenhuma turma</option>`; return; }
    selTurma.innerHTML = `<option value="">Selecione a turma…</option>` +
      turmas.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join("");
    selTurma.disabled = false;
  }

  // ── Evento: selecionar instituição (só super_admin vê esse select) ──────────
  if (!isAdmin) {
    const { data: insts } = await supabase.from("instituicoes").select("id, nome").order("nome");
    const selInst = document.getElementById("sel-inst");
    selInst.innerHTML = `<option value="">Selecione…</option>` +
      (insts || []).map(i => `<option value="${i.id}">${esc(i.nome)}</option>`).join("");

    selInst.addEventListener("change", async () => {
      const instId = selInst.value;
      turmaId = null; materia = null;
      document.getElementById("hor-content").innerHTML = "";
      document.getElementById("step-materia").style.display = "none";
      if (instId) await carregarTurmasDaInst(instId);
      else {
        const s = document.getElementById("sel-turma");
        s.innerHTML = `<option value="">— primeiro selecione a instituição —</option>`;
        s.disabled = true;
      }
    });
  } else if (adminInstId) {
    await carregarTurmasDaInst(adminInstId);
  }

  // ── Evento: selecionar turma ─────────────────────────────────────────────────
  document.getElementById("sel-turma").addEventListener("change", async () => {
    turmaId = document.getElementById("sel-turma").value;
    materia = null;
    document.getElementById("hor-content").innerHTML = "";

    if (!turmaId) { document.getElementById("step-materia").style.display = "none"; return; }

    // Carrega matérias já usadas nessa turma
    const { data: mats } = await supabase
      .from("horarios").select("materia").eq("turma_id", turmaId);

    const setMat = new Set((mats || []).map(m => m.materia));
    const selMat = document.getElementById("sel-materia");
    selMat.innerHTML = `<option value="">Selecione…</option>` +
      [...setMat].sort().map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");

    document.getElementById("step-materia").style.display = "";
  });

  // ── Evento: confirmar matéria ────────────────────────────────────────────────
  document.getElementById("btn-sel-mat").addEventListener("click", () => {
    const sel    = document.getElementById("sel-materia").value;
    const custom = document.getElementById("nova-materia").value.trim();
    materia = custom || sel;
    if (!materia) { showToast("Selecione ou digite a matéria", "error"); return; }
    renderHorarios();
  });
}

async function renderHorarios() {
  const content = document.getElementById("hor-content");
  content.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const { data: horarios } = await supabase
    .from("horarios")
    .select("*")
    .eq("turma_id", turmaId)
    .eq("materia", materia)
    .order("dia_semana")
    .order("hora_inicio");

  const diaOpts = DIAS.map((d, i) => `<option value="${i}">${d}</option>`).join("");

  const rows = (horarios || []).map(h => `
    <tr>
      <td><span class="dia-pill">${DIAS[h.dia_semana]}</span></td>
      <td>${h.hora_inicio.slice(0,5)}</td>
      <td>${h.hora_fim.slice(0,5)}</td>
      <td>${esc(h.sala || "—")}</td>
      <td style="text-align:right">
        <button class="btn-del-row" data-id="${h.id}">${SVG_TRASH}</button>
      </td>
    </tr>`).join("");

  content.innerHTML = `
    <div class="hor-turma-block">
      <div class="hor-turma-header">
        <div class="hor-materia-label">${esc(materia)}</div>
      </div>

      <div class="hor-table-wrap">
        <table class="hor-table">
          <thead>
            <tr><th>Dia</th><th>Início</th><th>Fim</th><th>Sala</th><th style="width:48px"></th></tr>
          </thead>
          <tbody id="hor-tbody">
            ${rows || `<tr><td colspan="5" style="padding:14px 16px;color:var(--text-3);font-size:.85rem">Sem horários cadastrados para esta matéria.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="hor-form">
        <div class="hor-form-title">Adicionar horário</div>
        <div class="hor-form-grid">
          <div>
            <label>Dia</label>
            <select id="h-dia">${diaOpts}</select>
          </div>
          <div>
            <label>Início</label>
            <input type="time" id="h-inicio" value="07:00" />
          </div>
          <div>
            <label>Fim</label>
            <input type="time" id="h-fim" value="08:00" />
          </div>
          <div>
            <label>Sala (opcional)</label>
            <input type="text" id="h-sala" placeholder="Ex: Sala 5" />
          </div>
          <div style="display:flex;align-items:flex-end">
            <button class="btn btn-primary" id="btn-add-hor">${SVG_PLUS} Adicionar</button>
          </div>
        </div>
      </div>
    </div>`;

  // Excluir
  document.getElementById("hor-tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-del-row[data-id]");
    if (!btn) return;
    const { error } = await supabase.from("horarios").delete().eq("id", btn.dataset.id);
    if (error) { showToast("Erro ao excluir", "error"); return; }
    showToast("Removido.", "success");
    renderHorarios();
  });

  // Adicionar
  document.getElementById("btn-add-hor").addEventListener("click", async () => {
    const dia    = parseInt(document.getElementById("h-dia").value);
    const inicio = document.getElementById("h-inicio").value;
    const fim    = document.getElementById("h-fim").value;
    const sala   = document.getElementById("h-sala").value.trim();

    if (!inicio || !fim) { showToast("Preencha início e fim", "error"); return; }
    if (inicio >= fim)   { showToast("Início deve ser antes do fim", "error"); return; }

    const btn = document.getElementById("btn-add-hor");
    btn.disabled = true;

    const { error } = await supabase.from("horarios").insert({
      turma_id: turmaId, materia, dia_semana: dia,
      hora_inicio: inicio, hora_fim: fim, sala: sala || null,
    });

    btn.disabled = false;
    if (error) { showToast("Erro: " + error.message, "error"); return; }

    document.getElementById("h-sala").value = "";
    showToast("Horário adicionado!", "success");
    renderHorarios();
  });
}

function esc(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

init();
