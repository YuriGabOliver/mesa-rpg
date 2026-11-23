// Motor do mapa: canvas 2D puro (sem bibliotecas). Pan, zoom, pinça, grade, tokens, névoa e régua.
export class Mapa {
  constructor(canvas, cb) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.cb = cb || {};
    this.view = { x: 0, y: 0, s: 1 };
    this.cena = { w: 1600, h: 1000, grade: { on: true, size: 70, snap: true, m: 1.5 }, nevoa: false };
    this.img = null; this.tokens = []; this.nevoa = []; this.mestre = false;
    this.ferr = 'mover'; this.sel = null; this.ptrs = new Map(); this.acao = null;
    this.fog = document.createElement('canvas'); this.fogSujo = true; this.sujo = true; this.dpr = 1;
    this.ultimoToque = { id: null, t: 0 }; this.regua = null; this.previa = null; this.primeiraVez = true;
    new ResizeObserver(() => this.redimensiona()).observe(canvas.parentElement);
    this.eventos(); this.redimensiona();
    const laco = () => { if (this.sujo) { this.sujo = false; this.desenha(); } requestAnimationFrame(laco); };
    requestAnimationFrame(laco);
  }
  get arrastando() { return !!this.acao && this.acao.tipo === 'token'; }
  redesenha() { this.sujo = true; }
  redimensiona() {
    const p = this.c.parentElement, r = p.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.max(1, Math.round(r.width * this.dpr)); this.c.height = Math.max(1, Math.round(r.height * this.dpr));
    this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
    this.W = r.width; this.H = r.height;
    if (this.primeiraVez && r.width > 50) { this.centralizar(); this.primeiraVez = false; }
    this.sujo = true;
  }
  setMestre(b) { this.mestre = b; if (!b && this.ferr === 'nevoa') this.setFerramenta('mover'); this.sujo = true; }
  setFerramenta(f) { this.ferr = f; this.regua = null; this.previa = null; this.sujo = true; }
  setCena(cena) {
    const mudouTam = cena.w !== this.cena.w || cena.h !== this.cena.h;
    this.cena = cena; this.fogSujo = true; this.sujo = true;
    if (mudouTam) this.centralizar();
  }
  setImagem(url) {
    if (!url) { this.img = null; this.sujo = true; return; }
    const im = new Image();
    im.onload = () => { this.img = im; this.sujo = true; };
    im.src = url;
  }
  setTokens(t) { this.tokens = t.map((x) => ({ ...x })); if (this.sel && !this.tokens.find((k) => k.id === this.sel)) this.sel = null; this.sujo = true; }
  setNevoa(n) { this.nevoa = n; this.fogSujo = true; this.sujo = true; }
  selecionar(id, avisa = true) { if (this.sel === id) return; this.sel = id; this.sujo = true; if (avisa && this.cb.onSelecionar) this.cb.onSelecionar(id); }
  centralizar() {
    if (!this.W) return;
    const s = Math.min(this.W / this.cena.w, this.H / this.cena.h) * 0.96;
    this.view = { s, x: (this.W - this.cena.w * s) / 2, y: (this.H - this.cena.h * s) / 2 }; this.sujo = true;
  }
  irPara(x, y) { this.view.x = this.W / 2 - x * this.view.s; this.view.y = this.H / 2 - y * this.view.s; this.sujo = true; }
  centro() { return this.mundo(this.W / 2, this.H / 2); }
  mundo(sx, sy) { return { x: (sx - this.view.x) / this.view.s, y: (sy - this.view.y) / this.view.s }; }
  zoomEm(sx, sy, f) {
    const v = this.view, ns = Math.min(8, Math.max(0.05, v.s * f)), k = ns / v.s;
    v.x = sx - (sx - v.x) * k; v.y = sy - (sy - v.y) * k; v.s = ns; this.sujo = true;
  }
  raio(t) { return (t.tam * this.cena.grade.size) / 2 * 0.92; }
  pode(t) { return this.mestre || (this.cb.podeMover ? this.cb.podeMover(t) : false); }
  hit(p) {
    const extra = 6 / this.view.s;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i];
      if (Math.hypot(p.x - t.x, p.y - t.y) <= this.raio(t) + extra) return t;
    }
    return null;
  }
  encaixa(t) {
    const g = this.cena.grade;
    if (!g.on || !g.snap) return { x: t.x, y: t.y };
    const lado = t.tam * g.size, x0 = Math.round((t.x - lado / 2) / g.size) * g.size, y0 = Math.round((t.y - lado / 2) / g.size) * g.size;
    return { x: x0 + lado / 2, y: y0 + lado / 2 };
  }
  eventos() {
    const c = this.c;
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomEm(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.ptrs.size === 2) { this.cancelaAcao(); this.acao = { tipo: 'pinca', ...this.medePinca() }; return; }
      if (this.ptrs.size > 2) return;
      const p = this.mundo(e.offsetX, e.offsetY);
      if (this.ferr === 'regua') { this.acao = { tipo: 'regua' }; this.regua = { a: p, b: p }; }
      else if (this.ferr === 'nevoa' && this.mestre) { this.acao = { tipo: 'nevoa', a: p }; this.previa = { a: p, b: p }; }
      else {
        const t = this.hit(p);
        if (t) {
          this.selecionar(t.id);
          const agora = performance.now();
          if (this.ultimoToque.id === t.id && agora - this.ultimoToque.t < 400 && this.cb.onDuplo) this.cb.onDuplo(t.id);
          this.ultimoToque = { id: t.id, t: agora };
          if (this.pode(t)) { this.acao = { tipo: 'token', id: t.id, dx: p.x - t.x, dy: p.y - t.y, mexeu: false }; return; }
        } else this.selecionar(null);
        this.acao = { tipo: 'pan', sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y };
      }
      this.sujo = true;
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      const a = this.acao; if (!a) return;
      if (a.tipo === 'pinca' && this.ptrs.size >= 2) {
        const n = this.medePinca();
        this.zoomEm(n.cx, n.cy, n.d / a.d);
        this.view.x += n.cx - a.cx; this.view.y += n.cy - a.cy;
        this.acao = { tipo: 'pinca', ...n };
      } else if (a.tipo === 'pan') { this.view.x = a.vx + e.offsetX - a.sx; this.view.y = a.vy + e.offsetY - a.sy; }
      else if (a.tipo === 'token') {
        const t = this.tokens.find((k) => k.id === a.id); const p = this.mundo(e.offsetX, e.offsetY);
        if (t) { t.x = Math.min(this.cena.w, Math.max(0, p.x - a.dx)); t.y = Math.min(this.cena.h, Math.max(0, p.y - a.dy)); a.mexeu = true; }
      } else if (a.tipo === 'regua') this.regua.b = this.mundo(e.offsetX, e.offsetY);
      else if (a.tipo === 'nevoa') this.previa.b = this.mundo(e.offsetX, e.offsetY);
      this.sujo = true;
    });
    const fim = (e) => {
      this.ptrs.delete(e.pointerId);
      const a = this.acao;
      if (a && a.tipo === 'pinca') { if (this.ptrs.size < 2) this.acao = null; return; }
      if (!a) return;
      if (a.tipo === 'token' && a.mexeu) {
        const t = this.tokens.find((k) => k.id === a.id);
        if (t) { const q = this.encaixa(t); t.x = q.x; t.y = q.y; if (this.cb.onMover) this.cb.onMover(t.id, t.x, t.y); }
      } else if (a.tipo === 'nevoa' && this.previa) {
        const { a: p, b: q } = this.previa;
        const r = [Math.min(p.x, q.x), Math.min(p.y, q.y), Math.abs(p.x - q.x), Math.abs(p.y - q.y)];
        this.previa = null;
        if (r[2] > 8 && r[3] > 8 && this.cb.onNevoa) this.cb.onNevoa(r.map(Math.round));
      }
      this.acao = null; this.sujo = true;
    };
    c.addEventListener('pointerup', fim); c.addEventListener('pointercancel', fim);
  }
  cancelaAcao() { this.previa = null; this.acao = null; }
  medePinca() {
    const [a, b] = [...this.ptrs.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
  renderNevoa() {
    const { w, h } = this.cena, f = Math.min(1, 2048 / Math.max(w, h));
    this.fog.width = Math.ceil(w * f); this.fog.height = Math.ceil(h * f);
    const x = this.fog.getContext('2d'); x.fillStyle = '#050403'; x.fillRect(0, 0, this.fog.width, this.fog.height);
    for (const r of this.nevoa) x.clearRect(r[0] * f, r[1] * f, r[2] * f, r[3] * f);
    this.fogSujo = false;
  }
  desenha() {
    const g = this.g, { w, h, grade } = this.cena, v = this.view, d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0b0a09'; g.fillRect(0, 0, this.c.width, this.c.height);
    g.setTransform(d * v.s, 0, 0, d * v.s, d * v.x, d * v.y);
    g.fillStyle = '#2b241c'; g.fillRect(0, 0, w, h);
    if (this.img) g.drawImage(this.img, 0, 0, w, h);
    if (grade.on) {
      g.beginPath();
      for (let x = 0; x <= w; x += grade.size) { g.moveTo(x, 0); g.lineTo(x, h); }
      for (let y = 0; y <= h; y += grade.size) { g.moveTo(0, y); g.lineTo(w, y); }
      g.lineWidth = 1 / v.s; g.strokeStyle = 'rgba(255,255,255,.28)'; g.stroke();
    }
    const nevoaOn = this.cena.nevoa;
    const fog = () => { if (!nevoaOn) return; if (this.fogSujo) this.renderNevoa(); g.globalAlpha = this.mestre ? 0.5 : 1; g.drawImage(this.fog, 0, 0, w, h); g.globalAlpha = 1; };
    if (this.mestre) { fog(); this.desenhaTokens(); } else { this.desenhaTokens(); fog(); }
    if (this.previa) {
      const { a, b } = this.previa; g.fillStyle = 'rgba(255,255,255,.18)'; g.strokeStyle = '#fff'; g.lineWidth = 2 / v.s; g.setLineDash([8 / v.s, 6 / v.s]);
      g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); g.setLineDash([]);
    }
    if (this.regua) {
      const { a, b } = this.regua, dist = Math.hypot(b.x - a.x, b.y - a.y) / grade.size, k = 1 / v.s;
      g.strokeStyle = '#ffd34d'; g.fillStyle = '#ffd34d'; g.lineWidth = 3 * k; g.setLineDash([10 * k, 6 * k]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(a.x, a.y, 5 * k, 0, 7); g.fill(); g.beginPath(); g.arc(b.x, b.y, 5 * k, 0, 7); g.fill();
      const txt = `${dist.toFixed(1).replace('.', ',')} casas · ${(dist * grade.m).toFixed(1).replace('.', ',')} m`;
      g.font = `bold ${15 * k}px system-ui,sans-serif`; const tw = g.measureText(txt).width;
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(b.x + 10 * k, b.y + 8 * k, tw + 12 * k, 24 * k);
      g.fillStyle = '#ffd34d'; g.textBaseline = 'middle'; g.fillText(txt, b.x + 16 * k, b.y + 20 * k);
    }
  }
  desenhaTokens() {
    const g = this.g, k = 1 / this.view.s;
    for (const t of this.tokens) {
      const r = this.raio(t), oculto = t.vis === false;
      g.globalAlpha = oculto ? 0.45 : 1;
      g.beginPath(); g.arc(t.x, t.y + 2 * k, r, 0, 7); g.fillStyle = 'rgba(0,0,0,.45)'; g.fill();
      g.beginPath(); g.arc(t.x, t.y, r, 0, 7); g.fillStyle = t.cor || '#c0392b'; g.fill();
      g.lineWidth = 3 * k; g.strokeStyle = this.sel === t.id ? '#ffd34d' : '#fff';
      if (oculto) g.setLineDash([6 * k, 4 * k]); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#fff'; g.font = `bold ${r * 0.85}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText((t.nome || '?').slice(0, 2).toUpperCase(), t.x, t.y + r * 0.04);
      g.font = `bold ${Math.max(11 * k, r * 0.34)}px system-ui,sans-serif`; g.textBaseline = 'top';
      g.lineWidth = 3 * k; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(t.nome || '', t.x, t.y + r + 3 * k); g.fillText(t.nome || '', t.x, t.y + r + 3 * k);
      g.globalAlpha = 1;
    }
    g.textAlign = 'start';
  }
}
