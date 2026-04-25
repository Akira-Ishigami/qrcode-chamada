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
    .from("profiles").select("role, nome").eq("id", session.user.id).single();

  if (!profile || profile.role !== "professor") {
    window.location.href = "/turmas.html";
    return;
  }

  await renderPage(session.user.id, profile.nome);
}

async function renderPage(userId, nome) {
  const hoje = new Date().toISOString().split("T")[0];
  const dataFormatada = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  root.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Carregando…</div>`;

  // Busca turmas do professor
  const { data: turmas } = await supabase
    .from("turmas")
    .select("id, nome, horario, instituicoes(nome)")
    .eq("professor_id", userId)
    .order("nome");

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
        <div class="rd-title">Relatório do Dia</div>
        <div class="rd-subtitle">Olá, ${esc(nome || "Professor")} · ${dataFormatada}</div>
      </div>
    </div>

    ${detalhes.length > 0 ? `
      <div class="rd-stats">
        <div class="rd-stat green"><span class="rd-num">${totalPresentes}</span><span class="rd-lbl">Presentes</span></div>
        <div class="rd-stat red"><span class="rd-num">${totalAusentes}</span><span class="rd-lbl">Ausentes</span></div>
        <div class="rd-stat blue"><span class="rd-num">${detalhes.length}</span><span class="rd-lbl">Chamadas</span></div>
      </div>
    ` : ""}

    <div id="chamadas-list"></div>

    ${turmasSemChamada.length > 0 ? `
      <div class="rd-section-title">Sem chamada hoje</div>
      <div class="rd-sem-chamada">
        ${turmasSemChamada.map(t => `
          <div class="rd-turma-row">
            <span class="rd-turma-nome">${esc(t.nome)}</span>
            ${t.horario ? `<span class="rd-turma-meta">${esc(t.horario)}</span>` : ""}
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

    const card = document.createElement("div");
    card.className = "rd-card";
    card.innerHTML = `
      <div class="rd-card-header" onclick="this.closest('.rd-card').classList.toggle('open')">
        <div class="rd-card-info">
          <div class="rd-card-nome">${esc(turma?.nome || "—")}</div>
          <div class="rd-card-meta">
            ${turma?.instituicoes ? esc(turma.instituicoes.nome) + " · " : ""}
            ${turma?.horario ? esc(turma.horario) : ""}
          </div>
        </div>
        <div class="rd-card-badges">
          <span class="rd-pct ${pct >= 75 ? "green" : pct >= 50 ? "orange" : "red"}">${pct}%</span>
          <span class="badge-presente">${presentes.length} ✓</span>
          <span class="badge-ausente">${ausentes.length} ✗</span>
          ${statusBadge}
        </div>
        <svg class="rd-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      <div class="rd-alunos">
        ${[...presentes.map(a => ({ ...a, presente: true })), ...ausentes.map(a => ({ ...a, presente: false }))]
          .sort((a, b) => a.nome.localeCompare(b.nome))
          .map(a => `
            <div class="rd-aluno-row">
              <span class="rd-aluno-nome">${esc(a.nome)}</span>
              <span class="${a.presente ? "dot-presente" : "dot-ausente"}">
                ${a.presente ? "✓ Presente" : "✗ Ausente"}
              </span>
            </div>
          `).join("")}
      </div>
    `;
    lista.appendChild(card);
  });
}

init();
