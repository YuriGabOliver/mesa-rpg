// Geometria da névoa dinâmica. Usado pelo navegador (mapa.js) e pelo servidor (api/mesa.js).
// Uma parede é { id, p: [x1, y1, x2, y2], t: 0 parede | 1 porta, a: 1 se a porta está aberta }.

// o que bloqueia a visão e o movimento: paredes e portas FECHADAS
export const bloqueiam = (paredes) => (Array.isArray(paredes) ? paredes.filter((s) => s && s.p && (!s.t || !s.a)).map((s) => s.p) : []);

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
const naCaixa = (ax, ay, bx, by, cx, cy) => Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);

// os segmentos A→B e C→D se tocam ou se cruzam?
export function cruza(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy), o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && naCaixa(ax, ay, bx, by, cx, cy)) || (o2 === 0 && naCaixa(ax, ay, bx, by, dx, dy))
    || (o3 === 0 && naCaixa(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && naCaixa(cx, cy, dx, dy, bx, by));
}

// o caminho reto (x0,y0)→(x1,y1) está livre de paredes e portas fechadas?
export function caminhoLivre(paredes, x0, y0, x1, y1, ignoraPortas = false) {
  const segmentos = ignoraPortas
    ? (Array.isArray(paredes) ? paredes.filter((p) => p && p.p && !p.t).map((p) => p.p) : [])
    : bloqueiam(paredes);
  for (const s of segmentos) if (cruza(x0, y0, x1, y1, s[0], s[1], s[2], s[3])) return false;
  return true;
}

// distância do ponto (px,py) ao segmento s
export function distSeg(px, py, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}

function raio(px, py, dx, dy, s) {
  const sx = s[2] - s[0], sy = s[3] - s[1], den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((s[0] - px) * sy - (s[1] - py) * sx) / den, u = ((s[0] - px) * dy - (s[1] - py) * dx) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

// Polígono do que se enxerga a partir de (px,py), até a distância R, com paredes opacas (varredura angular).
// segs: lista de [x1,y1,x2,y2]. Devolve pontos [x,y] em ordem de ângulo (vazio se não houver o que cortar).
export function visibilidade(px, py, R, segs) {
  const S = segs.filter((s) => !(Math.max(s[0], s[2]) < px - R || Math.min(s[0], s[2]) > px + R || Math.max(s[1], s[3]) < py - R || Math.min(s[1], s[3]) > py + R));
  if (!S.length) return [];
  const all = S.concat([[px - R, py - R, px + R, py - R], [px + R, py - R, px + R, py + R], [px + R, py + R, px - R, py + R], [px - R, py + R, px - R, py - R]]);
  const angs = [];
  for (const s of all) for (let i = 0; i < 4; i += 2) { const a = Math.atan2(s[i + 1] - py, s[i] - px); angs.push(a - 1e-4, a, a + 1e-4); }
  angs.sort((a, b) => a - b);
  const pts = [];
  for (const a of angs) {
    const dx = Math.cos(a), dy = Math.sin(a); let melhor = Infinity;
    for (const s of all) { const t = raio(px, py, dx, dy, s); if (t !== null && t < melhor) melhor = t; }
    if (melhor !== Infinity) pts.push([px + dx * melhor, py + dy * melhor]);
  }
  return pts;
}
