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
// Desenhado APÓS o fundo branco, clipado apenas na área do corpo (entre header e footer)
function drawPadrao(ctx, ox, oy, cor1, padrao) {
  if (!padrao || padrao === "limpo") return;

  const bodyY = oy + HEADER;
  const bodyH = CH - HEADER - FOOTER;

  ctx.save();
  // Clip apenas na área do corpo — não cobre header nem footer
  ctx.beginPath();
  ctx.rect(ox, bodyY, CW, bodyH);
  ctx.clip();

  if (padrao === "geometrico") {
    // Triângulo grande top-left
    ctx.fillStyle = cor1 + "38";
    ctx.beginPath();
    ctx.moveTo(ox, bodyY);
    ctx.lineTo(ox + 200, bodyY);
    ctx.lineTo(ox, bodyY + 160);
    ctx.closePath();
    ctx.fill();
    // Triângulo menor bottom-right
    ctx.fillStyle = cor1 + "28";
    ctx.beginPath();
    ctx.moveTo(ox + CW, bodyY + bodyH);
    ctx.lineTo(ox + CW - 130, bodyY + bodyH);
    ctx.lineTo(ox + CW, bodyY + bodyH - 100);
    ctx.closePath();
    ctx.fill();
    // Linha diagonal de acento
    ctx.strokeStyle = cor1 + "22";
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(ox, bodyY + bodyH - 30);
    ctx.lineTo(ox + 60, bodyY + bodyH);
    ctx.stroke();

  } else if (padrao === "pontos") {
    ctx.fillStyle = cor1 + "40";
    for (let dx = 16; dx < CW; dx += 20) {
      for (let dy = 10; dy < bodyH - 6; dy += 20) {
        ctx.beginPath();
        ctx.arc(ox + dx, bodyY + dy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

  } else if (padrao === "diagonal") {
    ctx.strokeStyle = cor1 + "35";
    ctx.lineWidth = 20;
    // Faixas diagonais no canto superior direito
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + CW - 20 - i * 32, bodyY);
      ctx.lineTo(ox + CW, bodyY + 20 + i * 32);
      ctx.stroke();
    }
    // Espelho inferior esquerdo
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(ox, bodyY + bodyH - i * 32);
      ctx.lineTo(ox + i * 32, bodyY + bodyH);
      ctx.stroke();
    }

  } else if (padrao === "ondas") {
    // Onda principal
    ctx.fillStyle = cor1 + "30";
    ctx.beginPath();
    ctx.moveTo(ox, bodyY + bodyH * 0.55);
    ctx.bezierCurveTo(
      ox + CW * 0.28, bodyY + bodyH * 0.32,
      ox + CW * 0.65, bodyY + bodyH * 0.78,
      ox + CW,         bodyY + bodyH * 0.5
    );
    ctx.lineTo(ox + CW, bodyY + bodyH);
    ctx.lineTo(ox, bodyY + bodyH);
    ctx.closePath();
    ctx.fill();
    // Onda secundária (mais clara)
    ctx.fillStyle = cor1 + "18";
    ctx.beginPath();
    ctx.moveTo(ox, bodyY + bodyH * 0.42);
    ctx.bezierCurveTo(
      ox + CW * 0.35, bodyY + bodyH * 0.22,
      ox + CW * 0.72, bodyY + bodyH * 0.62,
      ox + CW,         bodyY + bodyH * 0.36
    );
    ctx.lineTo(ox + CW, bodyY + bodyH);
    ctx.lineTo(ox, bodyY + bodyH);
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

  // ── Foto retangular (esquerda) — estilo carteirinha ──
  const photoX = ox + 14;
  const photoY = oy + HEADER + 10;
  const photoW = PHOTO_W - 10;
  const photoH = BODY - 20;

  ctx.fillStyle = "#f0f4f8";
  ctx.strokeStyle = "#c8d4e0";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(photoX, photoY, photoW, photoH, 6);
  ctx.fill(); ctx.stroke();

  if (fotoImg) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(photoX, photoY, photoW, photoH, 6); ctx.clip();
    const scale = Math.max(photoW / fotoImg.width, photoH / fotoImg.height);
    const sw = photoW / scale, sh = photoH / scale;
    ctx.drawImage(fotoImg, (fotoImg.width - sw) / 2, (fotoImg.height - sh) / 2, sw, sh,
                  photoX, photoY, photoW, photoH);
    ctx.restore();
  } else {
    // Silhueta estilo carteirinha (cabeça + ombros)
    const cx = photoX + photoW / 2;
    const headR = photoH * 0.16;
    const headCY = photoY + photoH * 0.35;
    ctx.fillStyle = "#b0bec9";
    ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, photoY + photoH * 0.82, photoH * 0.26, photoH * 0.22, 0, Math.PI, 0, true);
    ctx.fill();
  }

  // ── Campos de texto (direita) ──
  const tx  = ox + PHOTO_W + 14;
  const tw  = CW - PHOTO_W - 20;
  const lbl = (t) => {
    ctx.fillStyle = "#374151";
    ctx.font = `bold 10px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(t + ":", tx, cy);
    cy += 15;
  };
  const val = (text, sz = 12, maxW = tw) => {
    ctx.fillStyle = "#111827";
    const lines = wrapLines(ctx, text || "—", maxW - 4, sz, font);
    lines.forEach(line => {
      ctx.font = `${sz}px ${font}`;
      ctx.fillText(line, tx, cy);
      cy += sz + 2;
    });
    cy += 5;
  };
  const divider = () => {
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, cy); ctx.lineTo(tx + tw - 4, cy); ctx.stroke();
    cy += 8;
  };

  let cy = oy + HEADER + 16;

  // Nome
  lbl("Nome"); val(aluno.nome, 14);
  divider();

  // Turma  |  Id Estadual  (lado a lado)
  const half = (tw - 16) / 2;
  const turmaVal = aluno.turma?.nome || aluno.turma_nome || "—";
  const idEstVal = aluno.id_estadual || "—";

  ctx.fillStyle = "#374151"; ctx.font = "bold 10px Arial, sans-serif";
  ctx.fillText("Turma:", tx, cy);
  ctx.fillText("Id Estadual:", tx + half + 14, cy);
  cy += 15;

  ctx.fillStyle = "#111827";
  const t1 = fitText(ctx, turmaVal, half, 11, 9, font);
  const t2 = fitText(ctx, idEstVal, half, 11, 9, font);
  ctx.font = `${t1.size}px ${font}`; ctx.fillText(t1.text, tx, cy);
  ctx.font = `${t2.size}px ${font}`; ctx.fillText(t2.text, tx + half + 14, cy);
  cy += t1.size + 8;
  divider();

  // Número da Matrícula
  lbl("Numero da Matricula"); val(aluno.matricula, 13);
}

// ── VERSO ─────────────────────────────────────────────────────────────────────
function drawVerso(ctx, ox, oy, aluno, cor1, cor2, instNome, qrImg, logoImg, padrao, fonte) {
  const font = FONT_MAP[fonte]?.display || "Georgia, serif";

  drawCardBase(ctx, ox, oy, cor1, cor2, padrao);
  drawHeader(ctx, ox, oy, cor1, logoImg);
  drawFooter(ctx, ox, oy, cor1, cor2, instNome, fonte);

  // ── QR Code grande (esquerda) ──
  const qrX = ox + 14;
  const qrY = oy + HEADER + 12;
  const qrS = PHOTO_W - 14;   // quase tão largo quanto a área de foto

  if (qrImg) {
    ctx.drawImage(qrImg, qrX, qrY, qrS, qrS);
  }

  // ── Campos (direita) ──
  const tx = ox + PHOTO_W + 14;
  const tw = CW - PHOTO_W - 20;
  let cy = oy + HEADER + 18;

  const lbl = (t) => {
    ctx.fillStyle = "#374151";
    ctx.font = "bold 10px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(t + ":", tx, cy);
    cy += 15;
  };
  const val = (text, sz = 11, maxW = tw) => {
    ctx.fillStyle = "#111827";
    const lines = wrapLines(ctx, text || "—", maxW - 4, sz, font);
    lines.forEach(line => {
      ctx.font = `${sz}px ${font}`;
      ctx.fillText(line, tx, cy);
      cy += sz + 2;
    });
    cy += 6;
  };
  const divider = () => {
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, cy); ctx.lineTo(tx + tw - 4, cy); ctx.stroke();
    cy += 8;
  };

  lbl("Telefone");        val(aluno.telefone || "—");          divider();
  lbl("Data nascimento"); val(fmtNasc(aluno.data_nascimento)); divider();
  lbl("Endereço");        val(aluno.endereco || "—", 10);
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
