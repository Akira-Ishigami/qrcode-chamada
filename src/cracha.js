import QRCode from "qrcode";

// ── Dimensões ─────────────────────────────────────────────────────────────────
const CW      = 560;   // largura de cada lado
const CH      = 330;   // altura
const HEADER  = 48;    // barra superior
const FOOTER  = 48;    // barra inferior (nome da inst.)
const BODY    = CH - HEADER - FOOTER;   // 234px
const CR      = 10;    // raio dos cantos
const PHOTO_W = 196;   // largura da área da foto/QR

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
    ctx.fillStyle = cor1 + "28";
    for (let dx = 20; dx < CW; dx += 24) {
      for (let dy = 14; dy < bodyH - 8; dy += 24) {
        ctx.beginPath();
        ctx.arc(ox + dx, bodyY + dy, 1.4, 0, Math.PI * 2);
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

// ── Header ────────────────────────────────────────────────────────────────────
function drawHeader(ctx, ox, oy, cor1, logoImg) {
  // Fundo branco
  ctx.fillStyle = "#ffffff";
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(ox, oy, CW, HEADER);
  ctx.restore();

  // Título SEMPRE 100% centralizado na largura total do card
  ctx.fillStyle = cor1;
  ctx.font = "bold 11px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("IDENTIFICAÇÃO PESSOAL DO ESTUDANTE", ox + CW / 2, oy + HEADER / 2);
  ctx.textBaseline = "alphabetic";

  // Logo box — maior, top right, sobrepõe levemente o título
  if (logoImg) {
    const bw = 72, bh = HEADER - 6, bx = ox + CW - bw - 8, by = oy + 3;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
    const scale = Math.min((bw - 10) / logoImg.width, (bh - 10) / logoImg.height);
    const lw = logoImg.width * scale, lh = logoImg.height * scale;
    ctx.drawImage(logoImg, bx + (bw - lw) / 2, by + (bh - lh) / 2, lw, lh);
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────
function drawFooter(ctx, ox, oy, cor1, cor2, instNome, fonte) {
  const fy = oy + CH - FOOTER;
  // Gradiente horizontal
  const g = ctx.createLinearGradient(ox, 0, ox + CW, 0);
  g.addColorStop(0, cor1); g.addColorStop(1, cor2);
  ctx.fillStyle = g;
  ctx.save();
  rr(ctx, ox, oy, CW, CH, CR);
  ctx.clip();
  ctx.fillRect(ox, fy, CW, FOOTER);
  ctx.restore();

  // Nome da instituição em destaque
  const font = FONT_MAP[fonte]?.display || "Georgia, serif";
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 16px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let txt = instNome || "Chamada QR";
  while (ctx.measureText(txt).width > CW - 40 && txt.length > 4) txt = txt.slice(0, -1);
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

  // ── Foto ocupa TODO o quadrado esquerdo (borda a borda do body) ──
  const photoX = ox;
  const photoY = oy + HEADER;
  const photoW = PHOTO_W;
  const photoH = BODY;

  ctx.save();
  // Clip com os cantos arredondados do card apenas na esquerda
  ctx.beginPath();
  ctx.moveTo(ox + CR, photoY);
  ctx.lineTo(ox + photoW, photoY);
  ctx.lineTo(ox + photoW, photoY + photoH);
  ctx.lineTo(ox + CR, photoY + photoH);
  ctx.quadraticCurveTo(ox, photoY + photoH, ox, photoY + photoH - CR);
  ctx.lineTo(ox, photoY + CR);
  ctx.quadraticCurveTo(ox, photoY, ox + CR, photoY);
  ctx.closePath();
  ctx.clip();

  if (fotoImg) {
    const scale = Math.max(photoW / fotoImg.width, photoH / fotoImg.height);
    const sw = photoW / scale, sh = photoH / scale;
    ctx.drawImage(fotoImg, (fotoImg.width - sw) / 2, (fotoImg.height - sh) / 2, sw, sh,
                  photoX, photoY, photoW, photoH);
  } else {
    // Fundo + silhueta carteirinha
    ctx.fillStyle = "#dde4ec";
    ctx.fillRect(photoX, photoY, photoW, photoH);
    const cx = photoX + photoW / 2;
    ctx.fillStyle = "#9fb0c0";
    const hr = photoH * 0.155;
    const hcy = photoY + photoH * 0.36;
    ctx.beginPath(); ctx.arc(cx, hcy, hr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, photoY + photoH + 2, photoH * 0.45, photoH * 0.32, 0, Math.PI, 0, true);
    ctx.fill();
  }
  ctx.restore();

  // Linha divisória entre foto e texto
  ctx.strokeStyle = "#d1dae3"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + photoW, photoY + 6);
  ctx.lineTo(ox + photoW, photoY + photoH - 6);
  ctx.stroke();

  // ── Campos centralizados verticalmente no lado direito ──
  const tx = ox + PHOTO_W + 16;
  const tw = CW - PHOTO_W - 22;
  // Estima altura total dos campos para centralizar
  const totalH = 23 + 18 + 10 + 40 + 10 + 23 + 18; // ~142px
  let cy = oy + HEADER + Math.round((BODY - totalH) / 2);

  // Função label: negrito pequeno na cor da inst.
  const lbl = (t) => {
    ctx.fillStyle = cor1;
    ctx.font = `bold 9px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.letterSpacing = "0.03em";
    ctx.fillText(t + ":", tx, cy);
    ctx.letterSpacing = "";
    cy += 14;
  };
  // Função valor: fonte escolhida, tamanho maior, cor escura
  const val = (text, sz = 13, maxW = tw) => {
    const lines = wrapLines(ctx, text || "—", maxW - 2, sz, font);
    lines.forEach(line => {
      ctx.fillStyle = "#111827";
      ctx.font = `bold ${sz}px ${font}`;
      ctx.fillText(line, tx, cy);
      cy += sz + 3;
    });
    cy += 4;
  };
  const divider = () => {
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, cy); ctx.lineTo(tx + tw - 2, cy); ctx.stroke();
    cy += 10;
  };

  // NOME
  lbl("Nome"); val(aluno.nome, 15);
  divider();

  // TURMA  |  ID ESTADUAL — lado a lado
  const half   = (tw - 14) / 2;
  const turmaV = aluno.turma?.nome || aluno.turma_nome || "—";
  const idEstV = aluno.id_estadual || "—";

  ctx.fillStyle = cor1; ctx.font = "bold 9px Arial, sans-serif";
  ctx.fillText("Turma:", tx, cy);
  ctx.fillText("Id Estadual:", tx + half + 10, cy);
  cy += 14;

  ctx.fillStyle = "#111827";
  const r1 = fitText(ctx, turmaV, half, 12, 9, font);
  const r2 = fitText(ctx, idEstV, half, 12, 9, font);
  ctx.font = `bold ${r1.size}px ${font}`; ctx.fillText(r1.text, tx, cy);
  ctx.font = `bold ${r2.size}px ${font}`; ctx.fillText(r2.text, tx + half + 10, cy);
  cy += r1.size + 7;
  divider();

  // MATRÍCULA
  lbl("Numero da Matricula"); val(aluno.matricula, 14);
}

// ── VERSO ─────────────────────────────────────────────────────────────────────
function drawVerso(ctx, ox, oy, aluno, cor1, cor2, instNome, qrImg, logoImg, padrao, fonte) {
  const font = FONT_MAP[fonte]?.display || "Georgia, serif";

  drawCardBase(ctx, ox, oy, cor1, cor2, padrao);
  drawHeader(ctx, ox, oy, cor1, logoImg);
  drawFooter(ctx, ox, oy, cor1, cor2, instNome, fonte);

  // ── QR Code ocupa TODO o quadrado esquerdo ──
  const qrAreaX = ox;
  const qrAreaY = oy + HEADER;
  const qrAreaW = PHOTO_W;
  const qrAreaH = BODY;

  // Fundo claro para a área do QR (com clip dos cantos)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ox + CR, qrAreaY);
  ctx.lineTo(ox + qrAreaW, qrAreaY);
  ctx.lineTo(ox + qrAreaW, qrAreaY + qrAreaH);
  ctx.lineTo(ox + CR, qrAreaY + qrAreaH);
  ctx.quadraticCurveTo(ox, qrAreaY + qrAreaH, ox, qrAreaY + qrAreaH - CR);
  ctx.lineTo(ox, qrAreaY + CR);
  ctx.quadraticCurveTo(ox, qrAreaY, ox + CR, qrAreaY);
  ctx.closePath();
  ctx.fillStyle = "#f5f8fc";
  ctx.fill();
  ctx.restore();

  // QR centralizado dentro da área
  const qrS = Math.min(qrAreaW - 24, qrAreaH - 24);
  const qrX = ox + (qrAreaW - qrS) / 2;
  const qrY = oy + HEADER + (BODY - qrS) / 2;

  if (qrImg) {
    ctx.drawImage(qrImg, qrX, qrY, qrS, qrS);
  }

  // Linha divisória
  ctx.strokeStyle = "#d1dae3"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + PHOTO_W, qrAreaY + 6);
  ctx.lineTo(ox + PHOTO_W, qrAreaY + qrAreaH - 6);
  ctx.stroke();

  // ── Campos centralizados verticalmente ──
  const tx = ox + PHOTO_W + 16;
  const tw = CW - PHOTO_W - 22;
  const totalHV = 23 + 18 + 10 + 23 + 18 + 10 + 23 + 15; // ~140px
  let cy = oy + HEADER + Math.round((BODY - totalHV) / 2);

  const lbl = (t) => {
    ctx.fillStyle = cor1;
    ctx.font = "bold 9px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(t + ":", tx, cy);
    cy += 14;
  };
  const val = (text, sz = 13, maxW = tw) => {
    const lines = wrapLines(ctx, text || "—", maxW - 2, sz, font);
    lines.forEach(line => {
      ctx.fillStyle = "#111827";
      ctx.font = `bold ${sz}px ${font}`;
      ctx.fillText(line, tx, cy);
      cy += sz + 3;
    });
    cy += 5;
  };
  const divider = () => {
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, cy); ctx.lineTo(tx + tw - 2, cy); ctx.stroke();
    cy += 10;
  };

  lbl("Telefone");        val(aluno.telefone || "—");          divider();
  lbl("Data nascimento"); val(fmtNasc(aluno.data_nascimento)); divider();
  lbl("Endereço");        val(aluno.endereco || "—", 11);
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
