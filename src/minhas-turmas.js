import { supabase } from "./supabase.js";
import { applyNavRole } from "./nav-role.js";

const root = document.getElementById("page-root");
const hoje = new Date().toISOString().split("T")[0];

const DIAS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

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

  const { data: profile } = await supabase
    .from("profiles").select("role, nome").eq("id", session.user.id).single();

  if (!profile) { window.location.href = "/login.html"; return; }
  if (profile.role === "admin") { window.location.href = "/turmas.html"; return; }

  await renderPage(session.user.id, profile.nome);
}

async function renderPage(userId, nome) {
  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  const [{ data: turmas }, { data: chamadas }] = await Promise.all([
    supabase
      .from("turmas")
      .select("id, nome, materia, horario, instituicao_id, instituicoes(nome)")
      .eq("professor_id", userId)
      .order("materia").order("nome"),
    supabase
      .from("chamadas")
      .select("id, turma_id, aberta, data")
      .eq("data", hoje),
  ]);

  // Horários de hoje
  const [{ data: horariosHoje }] = await Promise.all([
    supabase
      .from("horarios")
      .select("turma_id, dia_semana, hora_inicio, hora_fim, sala")
      .in("turma_id", (turmas || []).map(t => t.id)),
  ]);

  const horariosMap = {};
  (horariosHoje || []).forEach(h => {
    if (!horariosMap[h.turma_id]) horariosMap[h.turma_id] = [];
    horariosMap[h.turma_id].push(h);
  });

  const chamadaMap = {};
  (chamadas || []).forEach(c => { chamadaMap[c.turma_id] = c; });

  if (!turmas || turmas.length === 0) {
    root.innerHTML = `
      <div class="mt-header">
        <div class="mt-title">Olá, ${esc(nome || "Professor")}</div>
        <div class="mt-subtitle">Nenhuma turma atribuída ainda.</div>
      </div>
      <div class="mt-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:.3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <p>Nenhuma turma foi atribuída ao seu perfil ainda.<br>Entre em contato com o administrador.</p>
      </div>`;
    return;
  }

  // Agrupa por matéria
  const grupos = {};
  turmas.forEach(t => {
    const mat = t.materia || "Sem matéria";
    if (!grupos[mat]) grupos[mat] = [];
    grupos[mat].push(t);
  });

  const hoje_dia = new Date().getDay(); // 0=Dom..6=Sab

  const gruposHtml = Object.entries(grupos).map(([mat, list]) => `
    <div class="mt-group">
      <div class="mt-group-label">${esc(mat)}</div>
      <div class="mt-cards">
        ${list.map(t => {
          const chamada = chamadaMap[t.turma_id] || chamadaMap[t.id];
          const horariosDaTurma = horariosMap[t.id] || [];
          const horariosHojeStr = horariosDaTurma
            .filter(h => h.dia_semana === hoje_dia)
            .map(h => `${h.hora_inicio.slice(0,5)}–${h.hora_fim.slice(0,5)}${h.sala ? ` · ${h.sala}` : ""}`)
            .join(", ");

          const horarioLegenda = t.horario || horariosHojeStr || "";

          let statusBadge = "";
          let actionBtn = "";
          if (chamada && !chamada.aberta) {
            statusBadge = `<span class="mt-badge mt-badge-done">Encerrada</span>`;
            actionBtn = `<a href="/chamada.html?turma=${t.id}" class="mt-btn mt-btn-ghost">Ver chamada</a>`;
          } else if (chamada && chamada.aberta) {
            statusBadge = `<span class="mt-badge mt-badge-open">Em andamento</span>`;
            actionBtn = `<a href="/chamada.html?turma=${t.id}" class="mt-btn mt-btn-primary">Continuar</a>`;
          } else {
            actionBtn = `<a href="/chamada.html?turma=${t.id}" class="mt-btn mt-btn-primary">Fazer Chamada</a>`;
          }

          return `
            <div class="mt-card">
              <div class="mt-card-top">
                <div class="mt-card-info">
                  <div class="mt-card-nome">${esc(t.nome)}</div>
                  ${t.instituicoes ? `<div class="mt-card-inst">${esc(t.instituicoes.nome)}</div>` : ""}
                  ${horarioLegenda ? `<div class="mt-card-horario">🕐 ${esc(horarioLegenda)}</div>` : ""}
                </div>
                ${statusBadge}
              </div>
              <div class="mt-card-actions">${actionBtn}</div>
            </div>`;
        }).join("")}
      </div>
    </div>`).join("");

  // Chamadas do dia (relatório resumido)
  const chamadas_do_dia = (chamadas || []).filter(c =>
    (turmas || []).some(t => t.id === c.turma_id));

  let relatorioHtml = "";
  if (chamadas_do_dia.length > 0) {
    relatorioHtml = await buildRelatorioHoje(chamadas_do_dia, turmas);
  }

  root.innerHTML = `
    <div class="mt-header">
      <div>
        <div class="mt-title">Olá, ${esc(nome || "Professor")}</div>
        <div class="mt-subtitle">Suas turmas — ${formatarData(hoje)}</div>
      </div>
    </div>
    ${gruposHtml}
    ${chamadas_do_dia.length ? `
      <div class="mt-section-title">Chamadas de hoje</div>
      ${relatorioHtml}
    ` : ""}`;
}

async function buildRelatorioHoje(chamadas, turmas) {
  const turmaMap = {};
  turmas.forEach(t => { turmaMap[t.id] = t; });

  const rows = await Promise.all(chamadas.map(async c => {
    const { data: presencas } = await supabase
      .from("presencas").select("aluno_id").eq("chamada_id", c.id);
    const { data: total } = await supabase
      .from("alunos").select("id", { count: "exact" }).eq("turma_id", c.turma_id);

    const presentes = presencas?.length || 0;
    const totalAlunos = total?.length || 0;
    const ausentes = totalAlunos - presentes;
    const turma = turmaMap[c.turma_id];

    return `
      <div class="rel-row">
        <div class="rel-row-nome">${esc(turma?.nome || "—")}</div>
        <div class="rel-row-stats">
          <span class="rel-stat presente">${presentes} presentes</span>
          <span class="rel-stat ausente">${ausentes} ausentes</span>
          <span class="rel-stat total">${totalAlunos} total</span>
        </div>
        ${c.aberta ? `<span class="mt-badge mt-badge-open" style="font-size:.7rem">Aberta</span>` :
          `<span class="mt-badge mt-badge-done" style="font-size:.7rem">Encerrada</span>`}
      </div>`;
  }));

  return `<div class="rel-list">${rows.join("")}</div>`;
}

function formatarData(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

init();
