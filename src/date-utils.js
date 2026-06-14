// Data local (YYYY-MM-DD) — evita o bug de `toISOString()` virar o dia
// seguinte entre 21h e 23h59 no horário do Brasil (UTC-3).
export function hojeLocal(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
