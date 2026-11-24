// Clima da Mesa Leve: partículas desenhadas num canvas por cima do mapa.
// Leve de propósito: só roda quando a cena tem clima, a ~30 quadros/s, para quando a aba fica escondida,
// desenha tudo em lotes (um traço por tipo) e cada aparelho pode desligar o efeito. Nada disso é enviado pela rede:
// o servidor só guarda { tipo, dir, vento, cob } e cada navegador simula as próprias gotas.

export const TIPOS = [['nenhum', 'Nenhum'], ['chuva', 'Chuva'], ['tempestade', 'Tempestade'], ['neve', 'Neve'], ['neblina', 'Neblina'], ['cinzas', 'Cinzas e brasas']];
const MAX = { chuva: 900, tempestade: 1100, neve: 520, cinzas: 260 }; // partículas com intensidade 100 num mapa de 1600×1000
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = Math.random;
const PI2 = Math.PI * 2;

export class Clima {
  constructor(canvas, mapa) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.mapa = mapa;
    this.cfg = null; this.chave = ''; this.ps = []; this.on = true; this.raf = 0; this.ult = 0; this.flash = 0; this.proxRaio = 0; this.sprite = null;
    this.reduz = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.addEventListener('visibilitychange', () => this.agenda());
  }

  // chamado a cada estado novo; só reinicia se o clima mudou de verdade
  define(cfg) {
    const ok = cfg && TIPOS.some((t) => t[0] === cfg.tipo && t[0] !== 'nenhum');
    const novo = ok ? { tipo: cfg.tipo, dir: Number(cfg.dir) || 0, vento: clamp(Number(cfg.vento) || 0, 0, 100), cob: clamp(Number(cfg.cob) || 50, 1, 100) } : null;
    const k = novo ? JSON.stringify(novo) : '';
    if (k === this.chave) return;
    const mudouTipo = (novo && novo.tipo) !== (this.cfg && this.cfg.tipo);
    this.chave = k; this.cfg = novo;
    if (mudouTipo) { this.ps = []; this.flash = 0; this.proxRaio = 4 + rnd() * 6; } // ajustar vento/intensidade não recomeça as gotas
    this.limpa(); this.agenda();
  }
  ligar(b) { this.on = !!b; this.limpa(); this.agenda(); }
  ativo() { return !!this.cfg && this.on && !document.hidden; }
  agenda() { if (this.ativo() && !this.raf) { this.ult = 0; this.raf = requestAnimationFrame((t) => this.quadro(t)); } }

  sincTamanho() {
    const m = this.mapa.c;
    if (this.c.width !== m.width || this.c.height !== m.height) { this.c.width = m.width; this.c.height = m.height; this.c.style.width = m.style.width; this.c.style.height = m.style.height; }
  }
  limpa() { this.sincTamanho(); this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.c.width, this.c.height); }

  quadro(t) {
    this.raf = 0;
    if (!this.ativo()) { this.limpa(); return; }
    const volta = () => { this.raf = requestAnimationFrame((x) => this.quadro(x)); };
    if (this.ult && t - this.ult < (this.reduz ? 60 : 30)) return volta(); // ~30 quadros/s (~15 com "reduzir movimento")
    const dt = this.ult ? Math.min(0.1, (t - this.ult) / 1000) : 0.033;
    this.ult = t;
    this.passo(dt); this.desenha();
    volta();
  }

  /* ---------- simulação ---------- */
  passo(dt) {
    const { w, h } = this.mapa.cena, cfg = this.cfg, tipo = cfg.tipo;
    const sc = clamp(Math.max(w, h) / 1600, 0.7, 2.5), area = clamp((w * h) / 1.6e6, 0.5, 2);
    const rad = (cfg.dir * Math.PI) / 180, vv = cfg.vento * 7 * sc, wx = Math.cos(rad) * vv, wy = Math.sin(rad) * vv;
    const fog = tipo === 'neblina';
    const alvo = fog ? Math.round(6 + cfg.cob * 0.16) : Math.round(Math.min(1300, Math.max(1, (cfg.cob / 100) * MAX[tipo] * area * (this.reduz ? 0.4 : 1))));
    if (this.ps.length > alvo) this.ps.length = alvo;
    while (this.ps.length < alvo) {
      const z = 0.55 + rnd() * 0.45;
      this.ps.push({ x: rnd() * w, y: rnd() * h, z, f: rnd() * PI2, q: rnd() < 0.3 ? 1 : 0, r: (0.22 + rnd() * 0.3) * Math.max(w, h), vx: 0, vy: 0 });
    }
    for (const p of this.ps) {
      let vx, vy;
      if (tipo === 'chuva' || tipo === 'tempestade') { vx = wx * (0.7 + 0.5 * p.z); vy = 1150 * sc * p.z + wy * 0.4; }
      else if (tipo === 'neve') { p.f += dt * (1 + p.z); vx = wx * 0.6 + Math.sin(p.f) * 22 * sc; vy = 75 * sc * p.z + wy * 0.4; }
      else if (tipo === 'cinzas') { p.f += dt * (1.5 + p.z); vx = wx * 0.5 + Math.sin(p.f) * 18 * sc; vy = -38 * sc * p.z + wy * 0.5; }
      else { p.f += dt * 0.3; vx = wx * 0.18 + 9 * sc * p.z; vy = wy * 0.18 + Math.sin(p.f) * 4 * sc; } // neblina: deriva lenta
      p.vx = vx; p.vy = vy; p.x += vx * dt; p.y += vy * dt;
      const mg = fog ? p.r : 0; // dá a volta no mapa (neblina sai por inteiro antes de reaparecer)
      if (p.x < -mg) p.x += w + 2 * mg; else if (p.x > w + mg) p.x -= w + 2 * mg;
      if (p.y < -mg) p.y += h + 2 * mg; else if (p.y > h + mg) p.y -= h + 2 * mg;
    }
    if (tipo === 'tempestade' && !this.reduz) {
      this.proxRaio -= dt; if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
      if (this.proxRaio <= 0) { this.flash = 1; this.proxRaio = 5 + rnd() * 9; } // um clarão suave, sem pisca-pisca
    }
  }

  /* ---------- desenho (um traço por tipo, recortado ao mapa) ---------- */
  desenha() {
    const g = this.g, m = this.mapa, v = m.view, d = m.dpr, { w, h } = m.cena, cfg = this.cfg, tipo = cfg.tipo;
    const sc = clamp(Math.max(w, h) / 1600, 0.7, 2.5), px = 1 / v.s; // px = 1 pixel da tela, em unidades do mapa
    this.sincTamanho();
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.c.width, this.c.height);
    g.save();
    g.setTransform(d * v.s, 0, 0, d * v.s, d * v.x, d * v.y);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();

    if (tipo === 'chuva' || tipo === 'tempestade') {
      if (tipo === 'tempestade') { g.fillStyle = `rgba(8,12,28,${0.1 + cfg.cob * 0.0013})`; g.fillRect(0, 0, w, h); }
      g.lineWidth = Math.max(1.4 * sc, 1.1 * px); g.lineCap = 'round'; g.strokeStyle = 'rgba(185,205,255,.5)'; g.beginPath();
      for (const p of this.ps) { g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022); }
      g.stroke();
      if (this.flash > 0) { g.fillStyle = `rgba(255,255,255,${this.flash * 0.22})`; g.fillRect(0, 0, w, h); }
    } else if (tipo === 'neve') {
      g.fillStyle = 'rgba(255,255,255,.88)'; g.beginPath();
      for (const p of this.ps) { const r = Math.max((1.2 + p.z * 2.4) * sc, 0.9 * px); g.moveTo(p.x + r, p.y); g.arc(p.x, p.y, r, 0, PI2); }
      g.fill();
    } else if (tipo === 'cinzas') {
      for (let q = 0; q < 2; q++) {
        g.fillStyle = q ? 'rgba(255,150,60,.92)' : 'rgba(175,172,168,.7)'; g.beginPath();
        for (const p of this.ps) { if (p.q !== q) continue; const r = Math.max((q ? 1.2 : 1.6) * (0.7 + p.z) * sc, 0.8 * px); g.moveTo(p.x + r, p.y); g.arc(p.x, p.y, r, 0, PI2); }
        g.fill();
      }
    } else { // neblina: manchas grandes e suaves
      const s = this.sprite || (this.sprite = this.criaSprite()), a = 0.04 + cfg.cob * 0.0015; // no máximo ~0,2 por mancha: o mapa continua legível
      for (const p of this.ps) { g.globalAlpha = a * p.z; g.drawImage(s, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); }
      g.globalAlpha = 1;
    }
    g.restore();
  }
  criaSprite() {
    const s = document.createElement('canvas'); s.width = s.height = 128;
    const x = s.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(225,230,238,1)'); gr.addColorStop(1, 'rgba(225,230,238,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return s;
  }
}
