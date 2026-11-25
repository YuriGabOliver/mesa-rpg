// Motor do mapa: canvas 2D puro (sem bibliotecas). Pan, zoom, pinça, grade, tokens (com imagem), névoa e régua.
import { bloqueiam, caminhoLivre, distSeg, visibilidade } from './geo.js';
const SUPORTA_FILTRO =typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const NEVOA_COR = '#050403';
const normOp = (o) => (Array.isArray(o) ? { t: 'r', k: 'rect', x: o[0], y: o[1], w: o[2], h: o[3] } : o); // formato antigo

export class Mapa {
  constructor(canvas, cb) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.cb = cb || {};
    this.view = { x: 0, y: 0, s: 1 };
    this.cena = { w: 1600, h: 1000, grade: { on: true, size: 70, snap: true, m: 1.5 }, nevoa: false };
    this.img = null; this.tokens = []; this.nevoa = []; this.mestre = false;
    this.ferr = 'mover'; this.sel = null; this.ptrs = new Map(); this.acao = null;
    this.nevoaFerr = { acao: 'r', modo: 'rect', raio: 40 }; // acao: r revelar / h esconder; modo: rect, circ, pincel
    this.fogA = document.createElement('canvas'); this.fogB = document.createElement('canvas'); this.fogInfo = null;
    this.imgs = new Map(); this.fogSujo = true; this.sujo = true; this.dpr = 1;
    this.ultimoToque = { id: null, t: 0 }; this.regua = null; this.previa = null; this.primeiraVez = true;
    this.parede = { modo: 'parede', grade: true }; this.pw = null; this.bloq = []; // névoa dinâmica: ferramenta de paredes e o que bloqueia a visão
    new ResizeObserver(() => this.redimensiona()).observe(canvas.parentElement);
    this.eventos(); this.redimensiona();
    const laco = () => { if (this.sujo) { this.sujo = false; this.desenha(); } requestAnimationFrame(laco); };
    requestAnimationFrame(laco);
  }
  get arrastando() { return !!this.acao && this.acao.tipo === 'token'; }
  redimensiona() {
    const p = this.c.parentElement, r = p.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.max(1, Math.round(r.width * this.dpr)); this.c.height = Math.max(1, Math.round(r.height * this.dpr));
    this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
    this.W = r.width; this.H = r.height;
    if (this.primeiraVez && r.width > 50) { this.centralizar(); this.primeiraVez = false; }
    this.sujo = true;
  }
  setMestre(b) { this.mestre = b; if (!b && (this.ferr === 'nevoa' || this.ferr === 'parede')) this.setFerramenta('mover'); this.sujo = true; }
  setFerramenta(f) { this.ferr = f; this.regua = null; this.previa = null; this.pw = null; this.sujo = true; }
  setParedeFerr(o) { this.parede = { ...this.parede, ...o }; this.pw = null; this.sujo = true; }
  setNevoaFerr(o) { this.nevoaFerr = { ...this.nevoaFerr, ...o }; this.previa = null; this.sujo = true; }
  setCena(cena) {
    const mudouTam = cena.w !== this.cena.w || cena.h !== this.cena.h;
    this.cena = cena; this.bloq = bloqueiam(cena.paredes); this.fogSujo = true; this.sujo = true;
    if (mudouTam) this.centralizar();
  }
  setImagem(url) {
    if (!url) { this.img = null; this.sujo = true; return; }
    const im = new Image();
    im.onload = () => { this.img = im; this.sujo = true; };
    im.src = url;
  }
  setTokens(t) {
    this.tokens = t.map((x) => ({ ...x }));
    if (this.sel && !this.tokens.find((k) => k.id === this.sel)) this.sel = null;
    this.fogSujo = true; this.sujo = true;
  }
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
  /* ---------- paredes e portas (névoa dinâmica) ---------- */
  // ímã: gruda na ponta de outra parede; senão, no cruzamento da grade (se ligado)
  snapParede(p) {
    const tol = 14 / this.view.s; let melhor = null, dm = tol;
    for (const s of this.cena.paredes || []) for (let i = 0; i < 4; i += 2) { const d = Math.hypot(p.x - s.p[i], p.y - s.p[i + 1]); if (d < dm) { dm = d; melhor = { x: s.p[i], y: s.p[i + 1] }; } }
    if (melhor) return melhor;
    const g = this.cena.grade;
    if (this.parede.grade && g.on && g.size) {
      const gx = Math.round(p.x / g.size) * g.size, gy = Math.round(p.y / g.size) * g.size;
      if (Math.hypot(p.x - gx, p.y - gy) < tol * 1.6) return { x: gx, y: gy };
    }
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }
  hitParede(p) {
    let melhor = null, dm = 10 / this.view.s;
    for (const s of this.cena.paredes || []) { const d = distSeg(p.x, p.y, s.p); if (d <= dm) { dm = d; melhor = s; } }
    return melhor;
  }
  cliqueParede(p) { // modos de clique: apagar e abrir/fechar
    const s = this.hitParede(p), m = this.parede.modo; if (!s || !this.cb.onParede) return;
    if (m === 'apagar') this.cb.onParede({ op: 'del', id: s.id });
    else if (m === 'abrir') { if (s.t) this.cb.onParede({ op: 'alterna', id: s.id }); else if (this.cb.aviso) this.cb.aviso('Isso é uma parede. Use “Porta” para transformar em porta.'); }
    else if (m === 'porta') this.cb.onParede({ op: 'tipo', id: s.id }); // clicar numa parede a transforma em porta (e uma porta, em parede)
  }

  eventos() {
    const c = this.c;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomEm(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    c.addEventListener('contextmenu', (e) => {
      const t = this.hit(this.mundo(e.offsetX, e.offsetY));
      e.preventDefault();
      if (!t) return;
      if (this.cb.onTokenContext) this.cb.onTokenContext(t.id, e.clientX, e.clientY);
    });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.ptrs.size === 2) { this.cancelaAcao(); this.acao = { tipo: 'pinca', ...this.medePinca() }; return; }
      if (this.ptrs.size > 2) return;
      const p = this.mundo(e.offsetX, e.offsetY);
      if (e.button === 1 || e.button === 2) { this.acao = { tipo: 'pan', sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y }; return; } // botão do meio/direito sempre move o mapa
      if (this.ferr === 'regua') { this.acao = { tipo: 'regua' }; this.regua = { a: p, b: p }; }
      else if (this.ferr === 'nevoa' && this.mestre) { this.acao = { tipo: 'nevoa' }; this.previa = { a: p, b: p, pts: [p] }; }
      else if (this.ferr === 'parede' && this.mestre) {
        const m = this.parede.modo;
        if (m === 'parede' || m === 'porta') { const q = this.snapParede(p); this.acao = { tipo: 'parede', sx: e.offsetX, sy: e.offsetY }; this.pw = { a: q, b: q }; }
        else this.acao = { tipo: 'pan', sx: e.offsetX, sy: e.offsetY, vx: this.view.x, vy: this.view.y, clique: p }; // apagar/abrir: arrastar move o mapa, tocar age
      }
      else {
        const t = this.hit(p);
        if (t) {
          this.selecionar(t.id);
          const agora = performance.now();
          if (this.ultimoToque.id === t.id && agora - this.ultimoToque.t < 400 && this.cb.onDuplo) this.cb.onDuplo(t.id);
          this.ultimoToque = { id: t.id, t: agora };
          if (this.pode(t)) { this.acao = { tipo: 'token', id: t.id, dx: p.x - t.x, dy: p.y - t.y, mexeu: false, x0: t.x, y0: t.y }; return; }
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
        if (t) { t.x = Math.min(this.cena.w, Math.max(0, p.x - a.dx)); t.y = Math.min(this.cena.h, Math.max(0, p.y - a.dy)); a.mexeu = true; if (t.visao > 0) this.fogSujo = true; }
      } else if (a.tipo === 'parede' && this.pw) this.pw.b = this.snapParede(this.mundo(e.offsetX, e.offsetY));
      else if (a.tipo === 'regua') this.regua.b = this.mundo(e.offsetX, e.offsetY);
      else if (a.tipo === 'nevoa' && this.previa) {
        const p = this.mundo(e.offsetX, e.offsetY); this.previa.b = p;
        const u = this.previa.pts[this.previa.pts.length - 1];
        if (Math.hypot(p.x - u.x, p.y - u.y) > Math.max(4, this.nevoaFerr.raio / 4)) this.previa.pts.push(p);
      }
      this.sujo = true;
    });
    const fim = (e) => {
      this.ptrs.delete(e.pointerId);
      const a = this.acao;
      if (a && a.tipo === 'pinca') { if (this.ptrs.size < 2) this.acao = null; return; }
      if (!a) return;
      if (a.tipo === 'token' && a.mexeu) {
        const t = this.tokens.find((k) => k.id === a.id);
        if (t) {
          const q = this.encaixa(t);
          if (!this.mestre && this.cena.bloqueia !== false && !caminhoLivre(this.cena.paredes, a.x0, a.y0, q.x, q.y)) { // parede ou porta fechada no caminho: volta
            t.x = a.x0; t.y = a.y0; this.fogSujo = true; if (this.cb.aviso) this.cb.aviso('Caminho bloqueado por uma parede ou porta fechada');
          } else { t.x = q.x; t.y = q.y; this.fogSujo = true; if (this.cb.onMover) this.cb.onMover(t.id, t.x, t.y); }
        }
      } else if (a.tipo === 'parede' && this.pw) {
        const { a: pa, b: pb } = this.pw, m = this.parede.modo; this.pw = null;
        const arrastou = Math.hypot(e.offsetX - a.sx, e.offsetY - a.sy) >= 6;
        if (!arrastou) { if (m === 'porta') this.cliqueParede(this.mundo(e.offsetX, e.offsetY)); }
        else if (Math.hypot(pb.x - pa.x, pb.y - pa.y) >= 8 && this.cb.onParede) this.cb.onParede({ op: 'add', segs: [{ p: [pa.x, pa.y, pb.x, pb.y], t: m === 'porta' ? 1 : 0 }] });
      } else if (a.tipo === 'pan' && a.clique) {
        if (Math.hypot(e.offsetX - a.sx, e.offsetY - a.sy) < 6) this.cliqueParede(a.clique);
      } else if (a.tipo === 'nevoa' && this.previa) {
        const op = this.opDaPrevia(); this.previa = null;
        if (op && this.cb.onNevoa) this.cb.onNevoa(op);
      }
      this.acao = null; this.sujo = true;
    };
    c.addEventListener('pointerup', fim); c.addEventListener('pointercancel', fim);
  }
  opDaPrevia() {
    const { a, b, pts } = this.previa, f = this.nevoaFerr, t = f.acao, R = Math.round;
    if (f.modo === 'rect') {
      const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      return w > 8 && h > 8 ? { t, k: 'rect', x: R(Math.min(a.x, b.x)), y: R(Math.min(a.y, b.y)), w: R(w), h: R(h) } : null;
    }
    if (f.modo === 'circ') { const r = Math.hypot(b.x - a.x, b.y - a.y); return r > 6 ? { t, k: 'circ', x: R(a.x), y: R(a.y), r: R(r) } : null; }
    const passo = Math.max(1, Math.ceil(pts.length / 380));
    const p = pts.filter((_, i) => i % passo === 0 || i === pts.length - 1).map((q) => [R(q.x), R(q.y)]);
    return { t, k: 'path', r: f.raio, p };
  }
  cancelaAcao() { this.previa = null; this.pw = null; this.acao = null; }
  medePinca() {
    const [a, b] = [...this.ptrs.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  /* ---------- névoa: operações em ordem (revelar/esconder), bordas suaves e visão dos tokens ---------- */
  renderNevoa() {
    const { w, h, grade } = this.cena, f = Math.min(1, 1400 / Math.max(w, h));
    const bl = Math.max(1.5, grade.size * 0.14 * f), pad = Math.ceil(bl * 3) + 2;
    const FW = Math.ceil(w * f) + pad * 2, FH = Math.ceil(h * f) + pad * 2;
    const A = this.fogA, B = this.fogB; A.width = B.width = FW; A.height = B.height = FH;
    const x = A.getContext('2d'); x.fillStyle = NEVOA_COR; x.strokeStyle = NEVOA_COR; x.fillRect(0, 0, FW, FH);
    const X = (v) => v * f + pad;
    for (const raw of this.nevoa) {
      const o = normOp(raw); if (!o) continue;
      x.globalCompositeOperation = o.t === 'h' ? 'source-over' : 'destination-out';
      if (o.k === 'rect') x.fillRect(X(o.x), X(o.y), o.w * f, o.h * f);
      else if (o.k === 'circ') { x.beginPath(); x.arc(X(o.x), X(o.y), o.r * f, 0, 7); x.fill(); }
      else if (o.k === 'path' && o.p && o.p.length) {
        x.lineWidth = o.r * 2 * f; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(X(o.p[0][0]), X(o.p[0][1]));
        if (o.p.length === 1) x.lineTo(X(o.p[0][0]) + 0.01, X(o.p[0][1]));
        for (const q of o.p) x.lineTo(X(q[0]), X(q[1]));
        x.stroke();
      }
    }
    x.globalCompositeOperation = 'destination-out'; // visão dos tokens: clareia em volta com borda suave
    for (const t of this.tokens) {
      if (!(t.visao > 0) || t.vis === false) continue;
      const R = t.visao * grade.size, r = R * f, cx = X(t.x), cy = X(t.y), gr = x.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.beginPath();
      // névoa dinâmica: paredes e portas fechadas cortam a luz do token (polígono de visão); sem paredes por perto, é o círculo de sempre
      const pol = this.bloq.length ? visibilidade(t.x, t.y, R, this.bloq) : [];
      if (pol.length > 2) { pol.forEach((q, i) => (i ? x.lineTo(X(q[0]), X(q[1])) : x.moveTo(X(q[0]), X(q[1])))); x.closePath(); }
      else x.arc(cx, cy, r, 0, 7);
      x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    const y = B.getContext('2d'); y.clearRect(0, 0, FW, FH);
    if (SUPORTA_FILTRO) y.filter = `blur(${bl}px)`;
    y.drawImage(A, 0, 0); y.filter = 'none';
    this.fogInfo = { f, pad, FW, FH }; this.fogSujo = false;
  }

  /* ---------- desenho ---------- */
  tokImg(t) {
    const url = this.cb.urlToken ? this.cb.urlToken(t) : null; if (!url) return null;
    let e = this.imgs.get(url);
    if (!e) { e = { im: new Image(), ok: false }; e.im.onload = () => { e.ok = true; this.sujo = true; }; e.im.src = url; this.imgs.set(url, e); }
    return e.ok ? e.im : null;
  }
  desenha() {
    const g = this.g, { w, h, grade } = this.cena, v = this.view, d = this.dpr, k = 1 / v.s;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0b0a09'; g.fillRect(0, 0, this.c.width, this.c.height);
    g.setTransform(d * v.s, 0, 0, d * v.s, d * v.x, d * v.y);
    g.fillStyle = '#2b241c'; g.fillRect(0, 0, w, h);
    if (this.img) g.drawImage(this.img, 0, 0, w, h);
    if (grade.on) {
      g.beginPath();
      for (let x = 0; x <= w; x += grade.size) { g.moveTo(x, 0); g.lineTo(x, h); }
      for (let y = 0; y <= h; y += grade.size) { g.moveTo(0, y); g.lineTo(w, y); }
      g.lineWidth = k; g.strokeStyle = 'rgba(255,255,255,.28)'; g.stroke();
    }
    const fog = () => {
      if (!this.cena.nevoa) return;
      if (this.fogSujo) this.renderNevoa();
      const { f, pad, FW, FH } = this.fogInfo; g.globalAlpha = this.mestre ? 0.5 : 1;
      g.drawImage(this.fogB, 0, 0, FW, FH, -pad / f, -pad / f, FW / f, FH / f); g.globalAlpha = 1;
    };
    if (this.mestre) { fog(); this.desenhaTokens(); this.desenhaParedes(); } else { this.desenhaParedes(); this.desenhaTokens(); fog(); }
    if (this.previa) this.desenhaPrevia();
    if (this.regua) {
      const { a, b } = this.regua, dist = Math.hypot(b.x - a.x, b.y - a.y) / grade.size;
      g.strokeStyle = '#ffd34d'; g.fillStyle = '#ffd34d'; g.lineWidth = 3 * k; g.setLineDash([10 * k, 6 * k]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(a.x, a.y, 5 * k, 0, 7); g.fill(); g.beginPath(); g.arc(b.x, b.y, 5 * k, 0, 7); g.fill();
      const txt = `${dist.toFixed(1).replace('.', ',')} casas · ${(dist * grade.m).toFixed(1).replace('.', ',')} m`;
      g.font = `bold ${15 * k}px system-ui,sans-serif`; const tw = g.measureText(txt).width;
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(b.x + 10 * k, b.y + 8 * k, tw + 12 * k, 24 * k);
      g.fillStyle = '#ffd34d'; g.textBaseline = 'middle'; g.fillText(txt, b.x + 16 * k, b.y + 20 * k);
    }
  }
  // mestre vê tudo (paredes fracas; fortes com a ferramenta ligada); jogadores só veem portas fechadas, por baixo da névoa
  desenhaParedes() {
    const g = this.g, k = 1 / this.view.s, gm = this.mestre, edit = gm && this.ferr === 'parede';
    g.lineCap = 'round';
    for (const s of this.cena.paredes || []) {
      const [x1, y1, x2, y2] = s.p;
      if (!s.t) { if (!gm) continue; g.strokeStyle = edit ? 'rgba(255,170,60,.95)' : 'rgba(255,170,60,.4)'; g.lineWidth = (edit ? 4 : 2.5) * k; g.setLineDash([]); }
      else if (s.a) { if (!gm) continue; g.strokeStyle = 'rgba(90,205,115,.9)'; g.lineWidth = 3 * k; g.setLineDash([6 * k, 5 * k]); }
      else { g.strokeStyle = gm ? '#e0654f' : '#8a5a2b'; g.lineWidth = 5 * k; g.setLineDash([]); }
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
      if (edit) { g.fillStyle = '#fff'; for (const [px, py] of [[x1, y1], [x2, y2]]) { g.beginPath(); g.arc(px, py, 3.5 * k, 0, 7); g.fill(); } }
    }
    if (edit && this.pw) {
      const { a, b } = this.pw; g.strokeStyle = this.parede.modo === 'porta' ? '#e0654f' : '#ffaa3c'; g.lineWidth = 4 * k; g.setLineDash([8 * k, 6 * k]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    }
  }
  desenhaPrevia() {
    const g = this.g, k = 1 / this.view.s, { a, b, pts } = this.previa, f = this.nevoaFerr, esconde = f.acao === 'h';
    g.fillStyle = esconde ? 'rgba(255,90,60,.25)' : 'rgba(255,255,255,.22)'; g.strokeStyle = esconde ? '#ff7a5c' : '#fff'; g.lineWidth = 2 * k; g.setLineDash([8 * k, 6 * k]);
    if (f.modo === 'rect') { g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    else if (f.modo === 'circ') { g.beginPath(); g.arc(a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y), 0, 7); g.fill(); g.stroke(); }
    else {
      g.setLineDash([]); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = f.raio * 2; g.strokeStyle = esconde ? 'rgba(255,90,60,.3)' : 'rgba(255,255,255,.3)';
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (const q of pts) g.lineTo(q.x, q.y); g.lineTo(b.x, b.y); if (pts.length === 1) g.lineTo(pts[0].x + 0.01, pts[0].y); g.stroke();
    }
    g.setLineDash([]);
  }
  desenhaTokens() {
    const g = this.g, k = 1 / this.view.s;
    for (const t of this.tokens) {
      const r = this.raio(t), oculto = t.vis === false, im = this.tokImg(t);
      g.globalAlpha = oculto ? 0.45 : 1;
      g.beginPath(); g.arc(t.x, t.y + 2 * k, r, 0, 7); g.fillStyle = 'rgba(0,0,0,.45)'; g.fill();
      g.beginPath(); g.arc(t.x, t.y, r, 0, 7); g.fillStyle = t.cor || '#c0392b'; g.fill();
      if (im) {
        g.save(); g.beginPath(); g.arc(t.x, t.y, r, 0, 7); g.clip();
        const lado = Math.min(im.width, im.height); // recorte quadrado central
        g.drawImage(im, (im.width - lado) / 2, (im.height - lado) / 2, lado, lado, t.x - r, t.y - r, r * 2, r * 2); g.restore();
      }
      g.beginPath(); g.arc(t.x, t.y, r, 0, 7); g.lineWidth = 3 * k; g.strokeStyle = this.sel === t.id ? '#ffd34d' : (t.cor || '#fff');
      if (oculto) g.setLineDash([6 * k, 4 * k]); g.stroke(); g.setLineDash([]);
      if (this.sel !== t.id && !im) { g.strokeStyle = '#fff'; g.stroke(); }
      g.textAlign = 'center';
      if (!im) { g.fillStyle = '#fff'; g.font = `bold ${r * 0.85}px system-ui,sans-serif`; g.textBaseline = 'middle'; g.fillText((t.nome || '?').slice(0, 2).toUpperCase(), t.x, t.y + r * 0.04); }
      g.fillStyle = '#fff'; g.font = `bold ${Math.max(11 * k, r * 0.34)}px system-ui,sans-serif`; g.textBaseline = 'top';
      g.lineWidth = 3 * k; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(t.nome || '', t.x, t.y + r + 3 * k); g.fillText(t.nome || '', t.x, t.y + r + 3 * k);
      g.globalAlpha = 1;
    }
    g.textAlign = 'start';
  }
}
