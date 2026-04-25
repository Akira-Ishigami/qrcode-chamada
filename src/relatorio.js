import { supabase } from "./supabase.js";
import { applyNavRole, podeAdmin } from "./nav-role.js";

const root = document.getElementById("page-root");

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
    .from("profiles").select("role, instituicao_id").eq("id", session.user.id).single();

  if (!profile)                       { window.location.href = "/login.html"; return; }
  if (profile.role === "admin")       { window.location.href = "/dashboard.html"; return; }
  if (profile.role === "professor")   { window.location.href = "/relatorio-dia.html"; return; }

  await renderPage(profile);
}

async function renderPage(profile) {
  const hoje = new Date().toISOString().split("T")[0];
  const adminInstId = profile.role === "instituicao" ? profile.instituicao_id : null;

  // Carrega turmas para o filtro (admin: só da sua instituição)
  let turmasQuery = supabase
    .from("turmas")
    .select("id, nome, instituicao_id, instituicoes(nome)")
    .order("nome");
  if (adminInstId) turmasQuery = turmasQuery.eq("instituicao_id", adminInstId);
  const { data: turmas } = await turmasQuery;

  const turmaOpts = (turmas || []).map(t =>
    `<option value="${t.id}">${esc(t.nome)}${t.instituicoes ? ` — ${esc(t.instituicoes.nome)}` : ""}</option>`
  ).join("");

  root.innerHTML = `
    <div class="rel-header">
      <div>
        <div class="rel-title">Gestão de Chamadas</div>
        <div class="rel-subtitle">Visualize e acompanhe todas as chamadas</div>
      </div>
    </div>
    <div class="rel-filters">
      <label>Data</label>
      <input type="date" id="filtro-data" value="${hoje}" />
      <label>Turma</label>
      <select id="filtro-turma">
        <option value="">Todas as turmas</option>
        ${turmaOpts}
      </select>
    </div>
    <div id="stats-bar" class="rel-stats-bar"></div>
    <div id="chamada-list" class="rel-chamada-list"></div>`;

  document.getElementById("filtro-data").addEventListener("change", () => carregarChamadas(adminInstId));
  document.getElementById("filtro-turma").addEventListener("change", () => carregarChamadas(adminInstId));

  await carregarChamadas(adminInstId);
}

async function carregarChamadas(adminInstId) {
  const data    = document.getElementById("filtro-data").value;
  const turmaId = document.getElementById("filtro-turma").value;

  document.getElementById("chamada-list").innerHTML =
    `<div style="padding:40px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  let query = supabase
    .from("chamadas")
    .select("id, turma_id, data, aberta, turmas(nome, professor, horario, instituicao_id, instituicoes(nome))")
    .eq("data", data)
    .order("data", { ascending: false });

  if (turmaId) {
    query = query.eq("turma_id", turmaId);
  } else if (adminInstId) {
    const { data: instTurmas } = await supabase
      .from("turmas").select("id").eq("instituicao_id", adminInstId);
    const ids = (instTurmas || []).map(t => t.id);
    if (!ids.length) {
      document.getElementById("stats-bar").innerHTML = "";
      document.getElementById("chamada-list").innerHTML =
        `<div class="rel-empty"><p>Nenhuma chamada encontrada para esta data.</p></div>`;
      return;
    }
    query = query.in("turma_id", ids);
  }

  const { data: chamadas, error } = await query;

  if (error) {
    document.getElementById("chamada-list").innerHTML =
      `<div class="rel-empty"><p>Erro: ${esc(error.message)}</p></div>`;
    return;
  }

  if (!chamadas || chamadas.length === 0) {
    document.getElementById("stats-bar").innerHTML = "";
    document.getElementById("chamada-list").innerHTML = `
      <div class="rel-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>Nenhuma chamada encontrada para esta data.</p>
      </div>`;
    return;
  }

  // Carrega presenças de todas as chamadas em paralelo
  const detalhes = await Promise.all(chamadas.map(async c => {
    const [{ data: presencas }, { data: alunos }] = await Promise.all([
      supabase.from("presencas").select("aluno_id").eq("chamada_id", c.id),
      supabase.from("alunos").select("id, nome, matricula").eq("turma_id", c.turma_id).order("nome"),
    ]);
    const presenteIds = new Set((presencas || []).map(p => p.aluno_id));
    const totalAlunos = alunos || [];
    return {
      chamada: c,
      presentes: totalAlunos.filter(a => presenteIds.has(a.id)),
      ausentes:  totalAlunos.filter(a => !presenteIds.has(a.id)),
      alunos: totalAlunos,
    };
  }));

  // Stats globais
  const totalPresentes = detalhes.reduce((s, d) => s + d.presentes.length, 0);
  const totalAusentes  = detalhes.reduce((s, d) => s + d.ausentes.length, 0);

  document.getElementById("stats-bar").innerHTML = `
    <div class="rel-stat-box">
      <div class="num">${chamadas.length}</div>
      <div class="lbl">Chamadas</div>
    </div>
    <div class="rel-stat-box green">
      <div class="num">${totalPresentes}</div>
      <div class="lbl">Presentes</div>
    </div>
    <div class="rel-stat-box red">
      <div class="num">${totalAusentes}</div>
      <div class="lbl">Ausentes</div>
    </div>`;

  document.getElementById("chamada-list").innerHTML = detalhes.map(({ chamada: c, presentes, ausentes, alunos }) => {
    const turma = c.turmas;
    const statusBadge = c.aberta
      ? `<span class="badge-aberta">Aberta</span>`
      : `<span class="badge-encerrada">Encerrada</span>`;

    const alunosRows = alunos.map(a => {
      const isPresente = presentes.some(p => p.id === a.id);
      return `
        <div class="rel-aluno-row">
          <span class="rel-aluno-nome">${esc(a.nome)}</span>
          <span class="rel-aluno-mat">${esc(a.matricula || "")}</span>
          <span class="${isPresente ? "dot-presente" : "dot-ausente"}">
            ${isPresente ? "✓ Presente" : "✗ Ausente"}
          </span>
        </div>`;
    }).join("");

    return `
      <div class="rel-chamada-card" id="card-${c.id}">
        <div class="rel-chamada-header" onclick="toggleCard('${c.id}')">
          <div class="rel-ch-info">
            <div class="rel-ch-nome">${esc(turma?.nome || "—")}</div>
            <div class="rel-ch-meta">
              ${turma?.instituicoes ? esc(turma.instituicoes.nome) + " · " : ""}
              ${turma?.professor ? esc(turma.professor) + " · " : ""}
              ${turma?.horario ? esc(turma.horario) : ""}
            </div>
          </div>
          <div class="rel-ch-badges">
            <span class="badge-presente">${presentes.length} ✓</span>
            <span class="badge-ausente">${ausentes.length} ✗</span>
            ${statusBadge}
          </div>
          <svg class="rel-ch-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
        <div class="rel-alunos">${alunosRows || "<div style='padding:12px 18px;color:var(--text-3);font-size:.85rem'>Nenhum aluno.</div>"}</div>
      </div>`;
  }).join("");
}

window.toggleCard = (id) => {
  document.getElementById("card-" + id)?.classList.toggle("open");
};

function esc(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

init();
