import QRCode from "qrcode";

// ── Dimensões ─────────────────────────────────────────────────────────────────
const CW      = 540;   // largura de cada lado
const CH      = 310;   // altura
const HEADER  = 44;    // barra superior
const FOOTER  = 42;    // barra inferior (nome da inst.)
const BODY    = CH - HEADER - FOOTER;   // 224px
const CR      = 10;    // raio dos cantos
const PHOTO_W = 178;   // largura da área da foto/QR

// ── Fontes disponíveis ────────────────────────────────────────────────────────
const FONT_MAP = {
  georgia:  { display: "Georgia, serif",            label: "Georgia, serif" },
  arial:    { display: "Arial, sans-serif",          label: "Arial, sans-serif" },
  courier:  { display: "'Courier New', monospace",   label: "Courier New" },
  times:    { display: "'Times New Roman', serif",   label: "Times New Roman" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadImg(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx, text, maxW, maxSz, minSz, font) {
  if (!text) return { text: "—", size: maxSz };
  let sz = maxSz;
  ctx.font = `bold ${sz}px ${font}`;
  while (ctx.measureText(text).width > maxW && sz > minSz) {
    sz--; ctx.font = `bold ${sz}px ${font}`;
  }
  let t = text;
  while (ctx.measureText(t).width > maxW && t.length > 2) t = t.slice(0, -1);
  return { text: t !== text ? t + "…" : t, size: sz };
}

function wrapLines(ctx, text, maxW, sz, font) {
  ctx.font = `bold ${sz}px ${font}`;
  if (!text || ctx.measureText(text).width <= maxW) return [text || "—"];
  const words = text.split(" ");
  let l1 = "", l2 = "";
  for (const w of words) {
    const t = l1 ? l1 + " " + w : w;
    if (!l2 && ctx.measureText(t).width <= maxW) l1 = t;
    else l2 = l2 ? l2 + " " + w : w;
  }
  while (l2 && ctx.measureText(l2).width > maxW && l2.length > 2) l2 = l2.slice(0, -1);
  if (l2 && !text.endsWith(l2.replace("…", ""))) l2 += "…";
  return l2 ? [l1, l2] : [l1];
}

function fmtNasc(s) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString("pt-BR");
}

// ── Padrões decorativos ───────────────────────────────────────────────────────
function drawPadrao(ctx, ox, oy, cor1, padrao) {
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();

  if (padrao === "geometrico") {
    // Triângulo top-left
    ctx.fillStyle = cor1 + "20";
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + 180, oy);
    ctx.lineTo(ox, oy + 140);
    ctx.closePath();
    ctx.fill();
    // Triângulo menor bottom-right
    ctx.fillStyle = cor1 + "14";
    ctx.beginPath();
    ctx.moveTo(ox + CW, oy + CH);
    ctx.lineTo(ox + CW - 120, oy + CH);
    ctx.lineTo(ox + CW, oy + CH - 90);
    ctx.closePath();
    ctx.fill();
    // Linha diagonal decorativa
    ctx.strokeStyle = cor1 + "18";
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.moveTo(ox, oy + CH - 60);
    ctx.lineTo(ox + 80, oy + CH);
    ctx.stroke();

  } else if (padrao === "pontos") {
    ctx.fillStyle = cor1 + "18";
    for (let dx = 18; dx < CW; dx += 20) {
      for (let dy = HEADER + 6; dy < CH - FOOTER - 4; dy += 20) {
        ctx.beginPath();
        ctx.arc(ox + dx, oy + dy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

  } else if (padrao === "diagonal") {
    // Faixa diagonal no canto top-right
    ctx.strokeStyle = cor1 + "16";
    ctx.lineWidth = 22;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + CW - 30 - i * 28, oy + HEADER);
      ctx.lineTo(ox + CW, oy + HEADER + 30 + i * 28);
      ctx.stroke();
    }
    // Espelho bottom-left
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + CH - FOOTER - i * 28);
      ctx.lineTo(ox + 30 + i * 28, oy + CH - FOOTER);
      ctx.stroke();
    }

  } else if (padrao === "ondas") {
    // Onda suave no fundo
    ctx.fillStyle = cor1 + "0f";
    ctx.beginPath();
    ctx.moveTo(ox, oy + CH * 0.6);
    ctx.bezierCurveTo(
      ox + CW * 0.25, oy + CH * 0.45,
      ox + CW * 0.6,  oy + CH * 0.75,
      ox + CW,         oy + CH * 0.5
    );
    ctx.lineTo(ox + CW, oy + CH - FOOTER);
    ctx.lineTo(ox, oy + CH - FOOTER);
    ctx.closePath();
    ctx.fill();
    // Segunda onda
    ctx.fillStyle = cor1 + "08";
    ctx.beginPath();
    ctx.moveTo(ox, oy + CH * 0.5);
    ctx.bezierCurveTo(
      ox + CW * 0.3, oy + CH * 0.35,
      ox + CW * 0.7, oy + CH * 0.65,
      ox + CW,        oy + CH * 0.4
    );
    ctx.lineTo(ox + CW, oy + CH - FOOTER);
    ctx.lineTo(ox, oy + CH - FOOTER);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ── Estrutura base do card ────────────────────────────────────────────────────
function drawCardBase(ctx, ox, oy, cor1, cor2, padrao) {
  // Fundo branco
  ctx.fillStyle = "#ffffff";
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.fill();

  // Padrão decorativo
  drawPadrao(ctx, ox, oy, cor1, padrao || "limpo");

  // Borda externa
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1.5;
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.stroke();
}

// ── Header: "IDENTIFICAÇÃO PESSOAL DO ESTUDANTE" ─────────────────────────────
function drawHeader(ctx, ox, oy, cor1, logoImg) {
  // Fundo do header (branco com linha inferior colorida)
  ctx.fillStyle = "#ffffff";
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(ox, oy, CW, HEADER);
  ctx.restore();

  // Linha inferior do header
  ctx.strokeStyle = cor1;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + 10, oy + HEADER);
  ctx.lineTo(ox + CW - 10, oy + HEADER);
  ctx.stroke();

  // Título centralizado
  const titleX = logoImg ? ox + CW / 2 - 30 : ox + CW / 2;
  ctx.fillStyle = cor1;
  ctx.font = "bold 11px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("IDENTIFICAÇÃO PESSOAL DO ESTUDANTE", titleX, oy + HEADER / 2);

  // Logo box (top right)
  if (logoImg) {
    const bx = ox + CW - 66, by = oy + 4, bw = 60, bh = HEADER - 8;
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 5); ctx.fill(); ctx.stroke();
    // Logo dentro da box
    const scale = Math.min((bw - 8) / logoImg.width, (bh - 8) / logoImg.height);
    const lw = logoImg.width * scale, lh = logoImg.height * scale;
    ctx.drawImage(logoImg, bx + (bw - lw) / 2, by + (bh - lh) / 2, lw, lh);
  }

  ctx.textBaseline = "alphabetic";
}

// ── Footer: "Nome da Instituição" ─────────────────────────────────────────────
function drawFooter(ctx, ox, oy, cor1, cor2, instNome, fonte) {
  const fy = oy + CH - FOOTER;
  const g = ctx.createLinearGradient(ox, 0, ox + CW, 0);
  g.addColorStop(0, cor1); g.addColorStop(1, cor2);
  ctx.fillStyle = g;
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(ox, fy, CW, FOOTER);
  ctx.restore();

  // Nome da instituição
  const font = FONT_MAP[fonte]?.display || "Georgia, serif";
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 14px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Trunca se necessário
  let txt = instNome || "Chamada QR";
  while (ctx.measureText(txt).width > CW - 30 && txt.length > 4) txt = txt.slice(0, -1);
  if (txt !== (instNome || "Chamada QR")) txt += "…";
  ctx.fillText(txt, ox + CW / 2, fy + FOOTER / 2);
  ctx.textBaseline = "alphabetic";
}

// ── FRENTE ────────────────────────────────────────────────────────────────────
async function drawFrente(ctx, ox, oy, aluno, cor1, cor2, instNome, fotoImg, logoImg, padrao, fonte) {
  const font = FONT_MAP[fonte]?.display || "Georgia, serif";

  drawCardBase(ctx, ox, oy, cor1, cor2, padrao);
  drawHeader(ctx, ox, oy, cor1, logoImg);
  drawFooter(ctx, ox, oy, cor1, cor2, instNome, fonte);

  // ── Foto (área esquerda) ──
  const photoX = ox + 12;
  const photoY = oy + HEADER + 12;
  const photoW = PHOTO_W - 18;
  const photoH = BODY - 24;

  // Fundo cinza claro para a foto
  ctx.fillStyle = "#f1f5f9";
  ctx.strokeStyle = cor1 + "30";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(photoX, photoY, photoW, photoH, 7); ctx.fill(); ctx.stroke();

  if (fotoImg) {
    // Cover mode no rect
    ctx.save();
    ctx.beginPath(); ctx.roundRect(photoX, photoY, photoW, photoH, 7); ctx.clip();
    const scale = Math.max(photoW / fotoImg.width, photoH / fotoImg.height);
    const sw = photoW / scale, sh = photoH / scale;
    const sx = (fotoImg.width - sw) / 2, sy = (fotoImg.height - sh) / 2;
    ctx.drawImage(fotoImg, sx, sy, sw, sh, photoX, photoY, photoW, photoH);
    ctx.restore();
  } else {
    // Silhueta de pessoa
    const cx = photoX + photoW / 2;
    // Cabeça
    ctx.fillStyle = "#94a3b8";
    ctx.beginPath();
    ctx.arc(cx, photoY + photoH * 0.32, photoH * 0.14, 0, Math.PI * 2);
    ctx.fill();
    // Corpo
    ctx.beginPath();
    ctx.ellipse(cx, photoY + photoH * 0.72, photoH * 0.22, photoH * 0.24, 0, 0, Math.PI);
    ctx.fill();
  }

  // Linha divisória entre foto e texto
  ctx.strokeStyle = cor1 + "28";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + PHOTO_W + 2, oy + HEADER + 8);
  ctx.lineTo(ox + PHOTO_W + 2, oy + HEADER + BODY - 8);
  ctx.stroke();

  // ── Campos de texto (área direita) ──
  const tx = ox + PHOTO_W + 16;
  const tw = CW - PHOTO_W - 20;
  let cy = oy + HEADER + 16;

  const drawField = (label, value, sz = 13, color = "#0f172a", lineAfter = true) => {
    // Label
    ctx.fillStyle = cor1;
    ctx.font = `bold 8.5px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(label.toUpperCase() + ":", tx, cy);
    cy += 14;

    // Valor
    const lines = wrapLines(ctx, value || "—", tw - 6, sz, font);
    lines.forEach(line => {
      ctx.fillStyle = color;
      ctx.font = `bold ${sz}px ${font}`;
      ctx.fillText(line, tx, cy);
      cy += sz + 2;
    });

    if (lineAfter) {
      cy += 5;
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, cy); ctx.lineTo(tx + tw - 4, cy); ctx.stroke();
      cy += 6;
    } else {
      cy += 4;
    }
  };

  // Nome
  drawField("Nome", aluno.nome, 15, "#0f172a");

  // Turma + ID Estadual lado a lado
  const halfW = (tw - 12) / 2;
  const turmaVal = aluno.turma?.nome || aluno.turma_nome || "—";
  const idEst    = aluno.id_estadual || "—";

  ctx.fillStyle = cor1;
  ctx.font = "bold 8.5px Arial, sans-serif";
  ctx.fillText("TURMA:", tx, cy);
  ctx.fillText("ID ESTADUAL:", tx + halfW + 12, cy);
  cy += 13;

  const t1 = fitText(ctx, turmaVal, halfW, 11, 9, font);
  const t2 = fitText(ctx, idEst, halfW, 11, 9, font);
  ctx.fillStyle = "#1e293b";
  ctx.font = `bold ${t1.size}px ${font}`;
  ctx.fillText(t1.text, tx, cy);
  ctx.font = `bold ${t2.size}px ${font}`;
  ctx.fillText(t2.text, tx + halfW + 12, cy);
  cy += 16;
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, cy); ctx.lineTo(tx + tw - 4, cy); ctx.stroke();
  cy += 7;

  // Número da Matrícula
  drawField("Número da Matrícula", aluno.matricula, 13, "#0f172a", false);
}

// ── VERSO ─────────────────────────────────────────────────────────────────────
function drawVerso(ctx, ox, oy, aluno, cor1, cor2, instNome, qrImg, logoImg, padrao, fonte) {
  const font = FONT_MAP[fonte]?.display || "Georgia, serif";

  drawCardBase(ctx, ox, oy, cor1, cor2, padrao);
  drawHeader(ctx, ox, oy, cor1, logoImg);
  drawFooter(ctx, ox, oy, cor1, cor2, instNome, fonte);

  // ── QR Code (área esquerda) ──
  const qrPad = 14;
  const qrX   = ox + qrPad;
  const qrY   = oy + HEADER + qrPad;
  const qrS   = PHOTO_W - qrPad * 2 + 4;

  // Fundo branco com borda
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = cor1 + "28";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(qrX - 4, qrY - 4, qrS + 8, BODY - qrPad * 2 + 8, 6); ctx.fill(); ctx.stroke();

  if (qrImg) {
    // Centro vertical do QR
    const qrCenter = oy + HEADER + BODY / 2;
    const qs = Math.min(qrS, BODY - 20);
    ctx.drawImage(qrImg, qrX, qrCenter - qs / 2, qs, qs);
  }

  // Divisória
  ctx.strokeStyle = cor1 + "28";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + PHOTO_W + 2, oy + HEADER + 8);
  ctx.lineTo(ox + PHOTO_W + 2, oy + HEADER + BODY - 8);
  ctx.stroke();

  // ── Campos (área direita) ──
  const tx = ox + PHOTO_W + 16;
  const tw = CW - PHOTO_W - 20;
  let cy = oy + HEADER + 18;

  const drawField = (label, value, sz = 11, lineAfter = true) => {
    ctx.fillStyle = cor1;
    ctx.font = "bold 8.5px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label.toUpperCase() + ":", tx, cy);
    cy += 13;

    const lines = wrapLines(ctx, value || "—", tw - 6, sz, font);
    lines.forEach(line => {
      ctx.fillStyle = "#1e293b";
      ctx.font = `bold ${sz}px ${font}`;
      ctx.fillText(line, tx, cy);
      cy += sz + 2;
    });

    if (lineAfter) {
      cy += 5;
      ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tx, cy); ctx.lineTo(tx + tw - 4, cy); ctx.stroke();
      cy += 7;
    } else {
      cy += 4;
    }
  };

  drawField("Telefone",         aluno.telefone || "—");
  drawField("Data de Nascimento", fmtNasc(aluno.data_nascimento));
  drawField("Endereço",         aluno.endereco || "—", 10, false);
}

// ── Export principal ──────────────────────────────────────────────────────────
export async function gerarCracha(aluno, config, instNome) {
  const GAP = 28, PAD = 20;

  const canvas = document.createElement("canvas");
  canvas.width  = CW * 2 + GAP + PAD * 2;
  canvas.height = CH + PAD * 2;
  const ctx = canvas.getContext("2d");

  // Fundo neutro
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cor1   = config?.cor_principal  || "#2563eb";
  const cor2   = config?.cor_secundaria || "#1e40af";
  const padrao = config?.padrao || "limpo";
  const fonte  = config?.fonte  || "georgia";

  const qrDataUrl = await QRCode.toDataURL(aluno.matricula || aluno.id || "—", {
    width: 220, margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  const [fotoImg, logoImg, qrImg] = await Promise.all([
    loadImg(aluno.foto_url),
    loadImg(config?.logo_url || null),
    loadImg(qrDataUrl),
  ]);

  await drawFrente(ctx, PAD, PAD, aluno, cor1, cor2, instNome, fotoImg, logoImg, padrao, fonte);
  drawVerso(ctx, PAD + CW + GAP, PAD, aluno, cor1, cor2, instNome, qrImg, logoImg, padrao, fonte);

  return canvas.toDataURL("image/png");
}

export function downloadCracha(dataUrl, nomeAluno) {
  const a = document.createElement("a");
  a.href = dataUrl;
  const safe = (nomeAluno || "aluno")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_");
  a.download = `Cracha_${safe}.png`;
  a.click();
}

export async function buscarCrachaConfig(supabaseAdmin, instId) {
  const { data } = await supabaseAdmin
    .from("cracha_config")
    .select("cor_principal, cor_secundaria, logo_url, padrao, fonte")
    .eq("instituicao_id", instId)
    .maybeSingle();
  return data;
}
