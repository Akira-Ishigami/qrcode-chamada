import { supabase } from "./supabase.js";
import { applyNavRole } from "./nav-role.js";

const root = document.getElementById("page-root");

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/login.html"; return; }

  await applyNavRole();

  const { data: profile } = await supabase
    .from("profiles").select("role, nome, instituicao_id").eq("id", session.user.id).single();

  if (!profile || profile.role === "admin") {
    window.location.href = "/dashboard.html";
    return;
  }

  await renderPage(profile);
}

async function renderPage(profile) {
  const hoje = new Date().toISOString().split("T")[0];
  const dataFormatada = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const nome = profile.nome;

  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  // Professor: filtra pelas turmas onde o campo professor (text) tem o nome dele
  // Instituição: mostra todas as turmas da instituição
  let turmasQuery = supabase
    .from("turmas")
    .select("id, nome, professor, instituicoes(nome)")
    .order("nome");

  if (profile.role === "professor") {
    turmasQuery = turmasQuery.eq("professor", nome);
  } else {
    turmasQuery = turmasQuery.eq("instituicao_id", profile.instituicao_id);
  }

  const { data: turmas } = await turmasQuery;

  if (!turmas?.length) {
    root.innerHTML = `
      <div class="rd-header">
        <div class="rd-title">Relatório do Dia</div>
        <div class="rd-subtitle">${dataFormatada}</div>
      </div>
      <div class="rd-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="opacity:.25">
          <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
        <p>Você não tem turmas atribuídas.</p>
      </div>`;
    return;
  }

  const turmaIds = turmas.map(t => t.id);

  // Busca chamadas de hoje para as turmas do professor
  const { data: chamadas } = await supabase
    .from("chamadas")
    .select("id, turma_id, aberta")
    .eq("data", hoje)
    .in("turma_id", turmaIds);

  // Para cada chamada, busca presenças
  const detalhes = await Promise.all((chamadas ?? []).map(async c => {
    const [{ data: presencas }, { data: alunos }] = await Promise.all([
      supabase.from("presencas").select("aluno_id").eq("chamada_id", c.id),
      supabase.from("alunos").select("id, nome, matricula").eq("turma_id", c.turma_id).order("nome"),
    ]);
    const presenteIds = new Set((presencas ?? []).map(p => p.aluno_id));
    const lista = alunos ?? [];
    return {
      chamada: c,
      turma: turmas.find(t => t.id === c.turma_id),
      presentes: lista.filter(a => presenteIds.has(a.id)),
      ausentes:  lista.filter(a => !presenteIds.has(a.id)),
    };
  }));

  const turmasSemChamada = turmas.filter(t => !(chamadas ?? []).some(c => c.turma_id === t.id));

  const totalPresentes = detalhes.reduce((s, d) => s + d.presentes.length, 0);
  const totalAusentes  = detalhes.reduce((s, d) => s + d.ausentes.length, 0);

  root.innerHTML = `
    <div class="rd-header">
      <div>
        <div class="rd-eyebrow">Relatório</div>
        <div class="rd-title">Relatório do Dia</div>
        <div class="rd-subtitle">${nome ? `Olá, ${esc(nome)}` : ""}</div>
      </div>
      <div class="rd-date-pill">
        <div class="rd-date-dot"></div>
        ${dataFormatada}
      </div>
    </div>

    ${detalhes.length > 0 ? `
      <div class="rd-stats">
        <div class="rd-stat green" style="animation-delay:0s">
          <div class="rd-stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="rd-stat-info">
            <div class="rd-num">${totalPresentes}</div>
            <div class="rd-lbl">Presentes</div>
          </div>
        </div>
        <div class="rd-stat red" style="animation-delay:.06s">
          <div class="rd-stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
          <div class="rd-stat-info">
            <div class="rd-num">${totalAusentes}</div>
            <div class="rd-lbl">Ausentes</div>
          </div>
        </div>
        <div class="rd-stat blue" style="animation-delay:.12s">
          <div class="rd-stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div class="rd-stat-info">
            <div class="rd-num">${detalhes.length}</div>
            <div class="rd-lbl">Chamadas</div>
          </div>
        </div>
      </div>
    ` : ""}

    <div id="chamadas-list"></div>

    ${turmasSemChamada.length > 0 ? `
      <div class="rd-section-title">Sem chamada hoje</div>
      <div class="rd-sem-chamada">
        ${turmasSemChamada.map(t => `
          <div class="rd-turma-row">
            <div class="rd-turma-dot"></div>
            <span class="rd-turma-nome">${esc(t.nome)}</span>
            ${t.professor ? `<span class="rd-turma-meta">${esc(t.professor)}</span>` : ""}
            ${t.instituicoes ? `<span class="rd-turma-inst">${esc(t.instituicoes.nome)}</span>` : ""}
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;

  const lista = document.getElementById("chamadas-list");

  if (detalhes.length === 0) {
    lista.innerHTML = `
      <div class="rd-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:.25">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>Nenhuma chamada realizada hoje.</p>
      </div>`;
    return;
  }

  detalhes.forEach(({ chamada, turma, presentes, ausentes }) => {
    const total = presentes.length + ausentes.length;
    const pct   = total > 0 ? Math.round((presentes.length / total) * 100) : 0;
    const statusBadge = chamada.aberta
      ? `<span class="badge-aberta">Aberta</span>`
      : `<span class="badge-encerrada">Encerrada</span>`;

    const inicial = (turma?.nome || "?").charAt(0).toUpperCase();
    const pctClass = pct >= 75 ? "green" : pct >= 50 ? "orange" : "red";

    const card = document.createElement("div");
    card.className = "rd-card";
    card.innerHTML = `
      <div class="rd-card-header" onclick="this.closest('.rd-card').classList.toggle('open')">
        <div class="rd-card-avatar">${inicial}</div>
        <div class="rd-card-info">
          <div class="rd-card-nome">${esc(turma?.nome || "—")}</div>
          <div class="rd-card-meta">
            ${turma?.professor ? esc(turma.professor) : ""}
            ${turma?.professor && turma?.instituicoes ? " · " : ""}
            ${turma?.instituicoes ? esc(turma.instituicoes.nome) : ""}
          </div>
        </div>
        <div class="rd-card-badges">
          <span class="badge-presente">${presentes.length} ✓</span>
          <span class="badge-ausente">${ausentes.length} ✗</span>
          ${statusBadge}
        </div>
        <svg class="rd-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="rd-progress">
        <div class="rd-progress-top">
          <span class="rd-progress-label">Frequência</span>
          <span class="rd-progress-pct ${pctClass}">${pct}%</span>
        </div>
        <div class="rd-bar-bg">
          <div class="rd-bar-fill ${pctClass}" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="rd-alunos">
        <div class="rd-alunos-head"><span>Aluno</span><span>Status</span></div>
        ${[...presentes.map(a => ({ ...a, presente: true })), ...ausentes.map(a => ({ ...a, presente: false }))]
          .sort((a, b) => a.nome.localeCompare(b.nome))
          .map(a => `
            <div class="rd-aluno-row">
              <div class="rd-aluno-dot ${a.presente ? "p" : "a"}"></div>
              <span class="rd-aluno-nome">${esc(a.nome)}</span>
              <span class="rd-aluno-status ${a.presente ? "p" : "a"}">${a.presente ? "Presente" : "Ausente"}</span>
            </div>`).join("")}
      </div>
    `;
    lista.appendChild(card);
  });
}

init();
