// Mesa Leve v0.12: régua com formas, seleção de elementos (com trava) e desenho livre.
// Métodos acrescentados à classe Mapa (ver fim do mapa.js). Tudo em Canvas 2D, sem bibliotecas.
import { distSeg } from './geo.js';

const COR_REGUA = '#ffd34d';
const fmt = (n) => n.toFixed(1).replace('.', ',');
const rotulo = (g, casas) => `${fmt(casas)} casas${g.m ? ` · ${fmt(casas * g.m)} m` : ''}`;

export const extras = {
  /* ---------- régua ---------- */
  // ajuste na grade: livre | centro (meio da casa) | canto (cruzamento das linhas)
  snapR(p) {
    const s = this.cena.grade.size, m = this.reguaCfg.snap;
    if (m === 'centro') return { x: (Math.floor(p.x / s) + 0.5) * s, y: (Math.floor(p.y / s) + 0.5) * s };
    if (m === 'canto') return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
    return { x: p.x, y: p.y };
  },
  setReguaCfg(o) { this.reguaCfg = { ...this.reguaCfg, ...o }; if (this.regua) this.regua.forma = this.reguaCfg.forma; this.sujo = true; },
  // cria um ponto fixo na linha (botão direito, ou botão "Ponto" no celular)
  pontoRegua() {
    const r = this.regua; if (!r || r.forma !== 'linha' || r.pts.length >= 20) return false;
    r.pts.push({ ...r.b }); this.sujo = true; this.emiteRegua(false); return true;
  },
  emiteRegua(fim) {
    if (!this.cb.onRegua) return;
    if (!this.reguaCfg.mostrar) return;
    const r = this.regua; if (!r) return;
    this.cb.onRegua({ f: r.forma, pts: r.pts.map((q) => [Math.round(q.x), Math.round(q.y)]), b: [Math.round(r.b.x), Math.round(r.b.y)], larg: r.larg, perm: this.reguaCfg.tempo === 'perm', fim: !!fim });
  },
  fechaRegua() {
    const r = this.regua; if (!r) return;
    if (this.reguaCfg.passo && r.forma === 'linha') { this.sujo = true; return; } // ponto a ponto: continua até Limpar/Esc
    if (this.reguaCfg.tempo === 'perm' && (Math.hypot(r.b.x - r.pts[0].x, r.b.y - r.pts[0].y) > 4 || r.pts.length > 1)) this.reguasFixas.push({ ...r, pts: r.pts.map((q) => ({ ...q })), b: { ...r.b } });
    this.emiteRegua(true); this.regua = null; this.sujo = true;
  },
  limpaReguas() { this.reguasFixas = []; this.regua = null; this.sujo = true; if (this.cb.onRegua) this.cb.onRegua({ limpa: true }); },
  setReguaRemota(pid, o) {
    if (o.limpa) { for (const k of [...this.reguasRemotas.keys()]) if (k === pid || k.startsWith(pid + ':')) this.reguasRemotas.delete(k); this.sujo = true; return; }
    const val = { forma: o.f, pts: o.pts.map((q) => ({ x: q[0], y: q[1] })), b: { x: o.b[0], y: o.b[1] }, larg: o.larg || 1, cor: o.cor, nome: o.nome };
    if (o.fim && o.perm) { this.reguasRemotas.delete(pid); this.reguasRemotas.set(`${pid}:${performance.now()}`, val); }
    else if (o.fim) this.reguasRemotas.delete(pid);
    else this.reguasRemotas.set(pid, val);
    this.sujo = true;
  },
  // texto + geometria de uma medida
  desenhaRegua(r, cor) {
    const g = this.g, k = 1 / this.view.s, gr = this.cena.grade, s = gr.size, a = r.pts[0], b = r.b;
    const rotulos = [];
    g.save(); g.strokeStyle = cor; g.fillStyle = cor; g.lineWidth = 3 * k; g.lineJoin = 'round';
    const preenche = () => { g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1; g.setLineDash([10 * k, 6 * k]); g.stroke(); g.setLineDash([]); };
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (r.forma === 'quadrado') {
      g.beginPath(); g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(dx), Math.abs(dy)); preenche();
      rotulos.push([b, `${fmt(Math.abs(dx) / s)} × ${fmt(Math.abs(dy) / s)} casas`]);
    } else if (r.forma === 'circulo') {
      g.beginPath(); g.arc(a.x, a.y, L, 0, 7); preenche(); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      rotulos.push([b, `raio ${rotulo(gr, L / s)}`]);
    } else if (r.forma === 'cone') {
      const u = L ? { x: dx / L, y: dy / L } : { x: 1, y: 0 }, n = { x: -u.y, y: u.x };
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x + n.x * L / 2, b.y + n.y * L / 2); g.lineTo(b.x - n.x * L / 2, b.y - n.y * L / 2); g.closePath(); preenche();
      rotulos.push([b, rotulo(gr, L / s)]);
    } else if (r.forma === 'rajada') {
      const u = L ? { x: dx / L, y: dy / L } : { x: 1, y: 0 }, n = { x: -u.y * r.larg * s / 2, y: u.x * r.larg * s / 2 };
      g.beginPath(); g.moveTo(a.x + n.x, a.y + n.y); g.lineTo(b.x + n.x, b.y + n.y); g.lineTo(b.x - n.x, b.y - n.y); g.lineTo(a.x - n.x, a.y - n.y); g.closePath(); preenche();
      rotulos.push([b, `${rotulo(gr, L / s)} · larg. ${r.larg}`]);
    } else { // linha, com pontos fixos: mostra a distância acumulada em cada ponto
      const vs = [...r.pts, b]; let acum = 0;
      g.setLineDash([10 * k, 6 * k]); g.beginPath(); g.moveTo(vs[0].x, vs[0].y); for (const q of vs.slice(1)) g.lineTo(q.x, q.y); g.stroke(); g.setLineDash([]);
      for (let i = 1; i < vs.length; i++) { acum += Math.hypot(vs[i].x - vs[i - 1].x, vs[i].y - vs[i - 1].y) / s; if (i < vs.length - 1 || vs.length === 2) rotulos.push([vs[i], rotulo(gr, acum)]); else rotulos.push([vs[i], `${rotulo(gr, acum)}`]); }
    }
    for (const q of r.pts) { g.beginPath(); g.arc(q.x, q.y, 5 * k, 0, 7); g.fill(); }
    g.beginPath(); g.arc(b.x, b.y, 5 * k, 0, 7); g.fill();
    g.font = `bold ${15 * k}px system-ui,sans-serif`; g.textBaseline = 'middle';
    for (const [q, t] of rotulos) { const tw = g.measureText(t).width; g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(q.x + 10 * k, q.y + 8 * k, tw + 12 * k, 24 * k); g.fillStyle = cor; g.fillText(t, q.x + 16 * k, q.y + 20 * k); }
    if (r.nome) { g.font = `${12 * k}px system-ui,sans-serif`; g.fillStyle = cor; g.fillText(r.nome, a.x + 8 * k, a.y - 12 * k); }
    g.restore();
  },
  desenhaReguas() {
    for (const r of this.reguasRemotas.values()) this.desenhaRegua(r, r.cor || '#6cf');
    for (const r of this.reguasFixas) this.desenhaRegua(r, COR_REGUA);
    if (this.regua) this.desenhaRegua(this.regua, COR_REGUA);
  },

  /* ---------- seleção de elementos ---------- */
  limpaSelecao() { if (this.selEl.size) { this.selEl.clear(); this.avisaSel(); } this.sujo = true; },
  avisaSel() { if (this.cb.onSelecaoEl) this.cb.onSelecaoEl([...this.selEl]); },
  selecionaRetangulo(a, b, soma) {
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    if (!soma) this.selEl.clear();
    for (const e of this.elementos) if (e.x + e.w / 2 >= x1 && e.x - e.w / 2 <= x2 && e.y + e.h / 2 >= y1 && e.y - e.h / 2 <= y2) this.selEl.add(e.id);
    this.avisaSel(); this.sujo = true;
  },
  desenhaSelecao() {
    const g = this.g, k = 1 / this.view.s;
    if (this.mestre) {
      for (const e of this.elementos) if (e.lock) { g.font = `${16 * k}px system-ui,sans-serif`; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText('🔒', e.x + e.w / 2 - 2 * k, e.y - e.h / 2 + 2 * k); g.textAlign = 'start'; }
      for (const e of this.elementos) if (this.selEl.has(e.id)) { g.strokeStyle = e.lock ? '#e0654f' : '#4da3ff'; g.lineWidth = 2 * k; g.setLineDash([7 * k, 5 * k]); g.strokeRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h); g.setLineDash([]); }
    }
    if (this.marq) {
      const { a, b } = this.marq; g.fillStyle = 'rgba(77,163,255,.15)'; g.strokeStyle = '#4da3ff'; g.lineWidth = 1.5 * k;
      g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  },

  /* ---------- desenho livre ---------- */
  setDeseCfg(o) { this.deseCfg = { ...this.deseCfg, ...o }; this.dese = null; this.sujo = true; },
  traco(d) { // desenha um desenho (guardado ou em andamento) no contexto atual
    const g = this.g, p = d.p; g.globalAlpha = d.op; g.strokeStyle = d.cor; g.lineWidth = d.esp; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
    if (d.k === 'rect') g.rect(p[0], p[1], p[2], p[3]);
    else if (d.k === 'elipse') g.ellipse(p[0], p[1], Math.max(0.5, p[2]), Math.max(0.5, p[3]), 0, 0, 7);
    else { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); if (p.length === 2) g.lineTo(p[0] + 0.01, p[1]); }
    g.stroke(); g.globalAlpha = 1;
  },
  desenhaDesenhos() {
    for (const d of this.cena.desenhos || []) this.traco(d);
    if (this.dese) this.traco(this.dese);
  },
  // a prévia vira um desenho já no formato do servidor
  montaDesenho(pts, b) {
    const c = this.deseCfg, R = Math.round, a = pts[0];
    const base = { cor: c.cor, esp: c.esp, op: c.op };
    if (c.modo === 'linha') return { k: 'linha', p: [R(a.x), R(a.y), R(b.x), R(b.y)], ...base };
    if (c.modo === 'rect') return { k: 'rect', p: [R(Math.min(a.x, b.x)), R(Math.min(a.y, b.y)), R(Math.abs(b.x - a.x)), R(Math.abs(b.y - a.y))], ...base };
    if (c.modo === 'elipse') return { k: 'elipse', p: [R((a.x + b.x) / 2), R((a.y + b.y) / 2), R(Math.abs(b.x - a.x) / 2), R(Math.abs(b.y - a.y) / 2)], ...base };
    const passo = Math.max(1, Math.ceil(pts.length / 190)), q = [];
    pts.forEach((v, i) => { if (i % passo === 0 || i === pts.length - 1) q.push(R(v.x), R(v.y)); });
    return { k: 'livre', p: q, ...base };
  },
  hitDesenho(p) { // para a borracha
    const tol = 8 / this.view.s, ds = this.cena.desenhos || [];
    for (let i = ds.length - 1; i >= 0; i--) {
      const d = ds[i], q = d.p, t = tol + d.esp / 2; let ok = false;
      if (d.k === 'rect') { const [x, y, w, h] = q; ok = [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]].some((s) => distSeg(p.x, p.y, s) <= t); }
      else if (d.k === 'elipse') { const n = Math.hypot((p.x - q[0]) / Math.max(1, q[2]), (p.y - q[1]) / Math.max(1, q[3])); ok = Math.abs(n - 1) * Math.min(Math.max(1, q[2]), Math.max(1, q[3])) <= t; }
      else for (let j = 0; j + 3 < q.length || (q.length === 2 && j === 0); j += 2) { const x2 = q.length === 2 ? q[0] : q[j + 2], y2 = q.length === 2 ? q[1] : q[j + 3]; if (distSeg(p.x, p.y, [q[j], q[j + 1], x2, y2]) <= t) { ok = true; break; } }
      if (ok) return d;
    }
    return null;
  },
};
