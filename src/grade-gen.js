// ─────────────────────────────────────────────────────────────────────────────
// Motor de geração de grade horária (puro — sem DOM)
// Encaixa as aulas (demanda) nos slots respeitando:
//  - turma nunca com 2 aulas no mesmo slot
//  - professor nunca em 2 turmas no mesmo slot
//  - indisponibilidade do professor
//  - máx. de aulas da mesma matéria por dia
//  - recreio fixo / janela da turma / dias letivos
// e tenta evitar "janelas" (buracos) na agenda do professor.
// ─────────────────────────────────────────────────────────────────────────────

const T = (t) => { const [h, m] = String(t).split(":"); return (+h) * 60 + (+m); };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function construirSlots(turma, config) {
  // Janela própria da turma tem prioridade; senão usa a janela da config.
  const ini = T(turma.hora_inicio || config.hora_inicio || "07:00");
  const fim = T(turma.hora_fim    || config.hora_fim    || "12:00");
  const passo = config.aula_min + (config.intervalo_min || 0);
  const recIni = config.recreio_inicio ? T(config.recreio_inicio) : null;
  const recFim = config.recreio_fim    ? T(config.recreio_fim)    : null;

  const slots = [];
  for (const dia of config.dias_semana) {
    let t = ini;
    while (t + config.aula_min <= fim) {
      const a = t, b = t + config.aula_min;
      // se a aula invadiria o recreio, pula direto pro fim do recreio (não perde a vaga)
      if (recIni != null && recFim != null && a < recFim && b > recIni) {
        t = recFim;
        continue;
      }
      slots.push({ dia, ini: a, fim: b });
      t += passo;
    }
  }
  return slots;
}

function indexIndisp(indisponibilidade) {
  const idx = {};
  (indisponibilidade || []).forEach(r => {
    (idx[r.professor_id] ??= []).push({ dia: r.dia_semana, ini: T(r.hora_inicio), fim: T(r.hora_fim) });
  });
  return idx;
}
function profIndisponivel(idx, profId, s) {
  const blocos = idx[profId];
  if (!blocos) return false;
  return blocos.some(b => b.dia === s.dia && s.ini < b.fim && s.fim > b.ini);
}

function embaralhar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function contarJanelas(placed, passo) {
  // gaps por professor/dia (heurístico, para desempate)
  const porProfDia = {};
  placed.forEach(p => {
    if (!p.professor_id) return;
    (porProfDia[`${p.professor_id}|${p.dia}`] ??= []).push(p.ini);
  });
  let gaps = 0;
  Object.values(porProfDia).forEach(mins => {
    mins.sort((a, b) => a - b);
    for (let i = 1; i < mins.length; i++) {
      const d = mins[i] - mins[i - 1];
      if (d > passo) gaps += Math.round(d / passo) - 1;
    }
  });
  return gaps;
}

function encaixar(unidades, slotsByTurma, indispIdx, config, travados) {
  const passo = config.aula_min + (config.intervalo_min || 0);
  const turmaBusy = new Set();
  const profBusy  = new Set();
  const matDia     = new Map();
  const turmaDia   = new Map(); // total de aulas (qualquer matéria) já alocadas na turma naquele dia
  const matHorario = new Map(); // quantos dias a matéria já caiu nesse mesmo horário do dia (evita repetir)

  const ocupar = (turma, prof, mat, dia, ini) => {
    turmaBusy.add(`${turma}|${dia}|${ini}`);
    if (prof) profBusy.add(`${prof}|${dia}|${ini}`);
    const k = `${turma}|${mat}|${dia}`;
    matDia.set(k, (matDia.get(k) || 0) + 1);
    const td = `${turma}|${dia}`;
    turmaDia.set(td, (turmaDia.get(td) || 0) + 1);
    const mh = `${turma}|${mat}|${ini}`;
    matHorario.set(mh, (matHorario.get(mh) || 0) + 1);
  };

  // Aulas travadas ocupam slots de antemão
  (travados || []).forEach(h => ocupar(h.turma_id, h.professor_id, h.materia_id, h.dia_semana, T(h.hora_inicio)));

  const placed = [], unplaced = [];
  for (const u of unidades) {
    const slots = slotsByTurma[u.turma_id] || [];
    let melhor = null, melhorScore = -Infinity;

    for (const s of slots) {
      if (turmaBusy.has(`${u.turma_id}|${s.dia}|${s.ini}`)) continue;
      if (u.professor_id && profBusy.has(`${u.professor_id}|${s.dia}|${s.ini}`)) continue;
      if (u.professor_id && profIndisponivel(indispIdx, u.professor_id, s)) continue;
      const turmaDiaKey = `${u.turma_id}|${s.dia}`;
      if ((turmaDia.get(turmaDiaKey) || 0) >= config.max_materia_dia) continue;

      // Score: adjacência do professor (evita janelas) + mais cedo + espalhar matéria
      const matKey = `${u.turma_id}|${u.materia_id}|${s.dia}`;
      const matHorarioKey = `${u.turma_id}|${u.materia_id}|${s.ini}`;
      let score = 0;
      if (u.professor_id) {
        if (profBusy.has(`${u.professor_id}|${s.dia}|${s.ini - passo}`)) score += 10;
        if (profBusy.has(`${u.professor_id}|${s.dia}|${s.ini + passo}`)) score += 10;
      }
      score -= (matDia.get(matKey) || 0) * 200;     // não repete a matéria no mesmo dia (só se não houver outra opção)
      score -= (matHorario.get(matHorarioKey) || 0) * 8; // evita repetir o mesmo horário do dia em dias seguidos
      score -= s.ini / 600;                       // empacota mais cedo
      score += Math.random() * 4;                 // ruído — evita que a mesma grade saia sempre igual

      if (score > melhorScore) { melhorScore = score; melhor = s; }
    }

    if (melhor) {
      ocupar(u.turma_id, u.professor_id, u.materia_id, melhor.dia, melhor.ini);
      placed.push({ ...u, dia: melhor.dia, ini: melhor.ini, fim: melhor.fim });
    } else {
      unplaced.push(u);
    }
  }

  return { placed, unplaced, gaps: contarJanelas(placed, passo) };
}

// API principal
// { turmas:[{id,hora_inicio,hora_fim}], config, demanda:[{turma_id,materia_id,professor_id,aulas_semana}],
//   indisponibilidade:[...], travados:[horarios] }
export function gerarGrade({ turmas, config, demanda, indisponibilidade = [], travados = [] }) {
  const slotsByTurma = {};
  turmas.forEach(t => { slotsByTurma[t.id] = construirSlots(t, config); });
  const indispIdx = indexIndisp(indisponibilidade);

  // Expande a demanda em unidades de aula
  const unidades = [];
  demanda.forEach(d => {
    for (let i = 0; i < (d.aulas_semana || 0); i++) {
      unidades.push({ turma_id: d.turma_id, materia_id: d.materia_id, professor_id: d.professor_id || null });
    }
  });

  // Ordena por dificuldade: professor com mais carga primeiro (mais restrito)
  const cargaProf = {};
  unidades.forEach(u => { if (u.professor_id) cargaProf[u.professor_id] = (cargaProf[u.professor_id] || 0) + 1; });
  const base = unidades.slice().sort((a, b) => (cargaProf[b.professor_id] || 0) - (cargaProf[a.professor_id] || 0));

  let best = null;
  const RESTARTS = 60;
  for (let r = 0; r < RESTARTS; r++) {
    const ordem = r === 0 ? base : embaralhar(base);
    const res = encaixar(ordem, slotsByTurma, indispIdx, config, travados);
    if (!best
        || res.unplaced.length < best.unplaced.length
        || (res.unplaced.length === best.unplaced.length && res.gaps < best.gaps)) {
      best = res;
    }
    if (best.unplaced.length === 0 && best.gaps === 0) break;
  }

  const horarios = best.placed.map(p => ({
    turma_id: p.turma_id, materia_id: p.materia_id, professor_id: p.professor_id,
    dia_semana: p.dia, hora_inicio: toHHMM(p.ini), hora_fim: toHHMM(p.fim),
  }));

  // Agrega não alocadas por (turma, matéria)
  const agg = {};
  best.unplaced.forEach(u => {
    const k = `${u.turma_id}|${u.materia_id}`;
    (agg[k] ??= { turma_id: u.turma_id, materia_id: u.materia_id, faltam: 0 }).faltam++;
  });

  return { horarios, naoAlocadas: Object.values(agg), totalSlots: Object.values(slotsByTurma).reduce((s, a) => s + a.length, 0) };
}
