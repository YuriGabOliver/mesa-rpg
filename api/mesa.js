// API principal da mesa (Supabase). GET = estado. POST = ações. O servidor é quem valida permissões.
import crypto from 'node:crypto';
import { rest, avisa, subirImagem, apagarImagem } from './_db.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const AL = 'abcdefghjkmnpqrstuvwxyz23456789';
const rid = (n) => { let o = ''; for (const x of crypto.randomBytes(n)) o += AL[x % AL.length]; return o; };
class Http extends Error { constructor(c, m) { super(m); this.http = c; } }
const num = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const igual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const COR = /^#[0-9a-fA-F]{6}$/;
const MAX_NEVOA = 500, MAX_LOG = 50;
const novoV = () => Date.now() * 1000 + Math.floor(Math.random() * 1000); // só precisa ser diferente a cada mudança
const idOk = (x, min, max) => new RegExp(`^[a-z0-9]{${min},${max}}$`).test(x);
async function limita(tabela, m, max) {
  const [x] = await rest('GET', `${tabela}?mesa=eq.${m}&select=id&order=id.desc&offset=${max}&limit=1`);
  if (x) await rest('DELETE', `${tabela}?mesa=eq.${m}&id=lte.${x.id}`);
}
// grava a nova versão da mesa (e campos extras) e avisa os conectados
async function bump(m, extra = {}) {
  const v = novoV();
  await rest('PATCH', `mesas?id=eq.${m}`, { corpo: { v, usado: new Date().toISOString(), ...extra }, prefer: 'return=minimal' });
  await avisa(m, v);
  return v;
}

async function contexto(b) {
  const m = txt(b.m, 16).toLowerCase();
  if (!idOk(m, 4, 16)) throw new Http(400, 'Código de mesa inválido');
  const pid = String(b.pid || '');
  if (!idOk(pid, 6, 32)) throw new Http(400, 'Identificação inválida');
  const [row] = await rest('GET', `mesas?id=eq.${m}&select=id,nome,h,cena,v`);
  if (!row) throw new Http(404, 'Mesa não encontrada');
  const mk = String(b.mk || '');
  const mestre = mk.length > 0 && igual(sha(mk), row.h);
  return { m, row, mestre, pid };
}
const exigeMestre = (c) => { if (!c.mestre) throw new Http(403, 'Só o mestre pode fazer isso'); };

async function estado(req, res) {
  const q = req.query || {};
  const m = txt(q.m, 16).toLowerCase();
  if (!idOk(m, 4, 16)) throw new Http(400, 'Código de mesa inválido');
  const cli = Number(q.v) || 0;
  const [vr] = await rest('GET', `mesas?id=eq.${m}&select=v`);
  if (!vr) throw new Http(404, 'Mesa não encontrada');
  if (cli && Number(vr.v) === cli) return res.status(200).json({ v: cli, mesmo: true });
  const c = await contexto({ m, mk: req.headers['x-mk'], pid: req.headers['x-pid'] });
  const [tk, nv, lg, jg] = await Promise.all([
    rest('GET', `tokens?mesa=eq.${m}&select=dados`),
    rest('GET', `nevoa?mesa=eq.${m}&select=rect&order=id.asc`),
    rest('GET', `rolagens?mesa=eq.${m}&select=dados&order=id.desc&limit=${MAX_LOG}`),
    rest('GET', `jogadores?mesa=eq.${m}&select=id,dados`),
  ]);
  let tokens = tk.map((x) => x.dados);
  if (!c.mestre) tokens = tokens.filter((t) => t.vis !== false || t.dono === c.pid);
  return res.status(200).json({
    v: Number(c.row.v), nome: c.row.nome, papel: c.mestre ? 'mestre' : 'jogador', cena: c.row.cena, tokens,
    nevoa: nv.map((x) => x.rect), log: lg.map((x) => x.dados).reverse(), jog: jg.map((x) => ({ id: x.id, ...x.dados })),
  });
}

function validaToken(b, cena, ant = {}) {
  const t = { ...ant };
  if (b.nome !== undefined) t.nome = txt(b.nome, 12) || ant.nome || 'Token';
  if (b.cor !== undefined && COR.test(b.cor)) t.cor = b.cor;
  if (b.tam !== undefined) t.tam = Math.round(num(b.tam, 1, 6, ant.tam || 1));
  if (b.x !== undefined) t.x = num(b.x, 0, cena.w, ant.x || 0);
  if (b.y !== undefined) t.y = num(b.y, 0, cena.h, ant.y || 0);
  return t;
}

function rolarDados(expr) {
  const s = String(expr || '').replace(/\s+/g, '').toLowerCase();
  if (!s || s.length > 40) throw new Http(400, 'Expressão de dados inválida');
  const re = /([+-]?)(?:(\d*)d(\d+)|(\d+))/y;
  let i = 0, total = 0, dados = 0; const det = [];
  while (i < s.length) {
    re.lastIndex = i;
    const mm = re.exec(s);
    if (!mm || mm.index !== i) throw new Http(400, 'Expressão de dados inválida. Exemplo: 2d6+3');
    i = re.lastIndex;
    const sinal = mm[1] === '-' ? -1 : 1;
    if (mm[3]) {
      const n = mm[2] === '' ? 1 : +mm[2], f = +mm[3];
      if (n < 1 || n > 50 || f < 2 || f > 1000) throw new Http(400, 'Use de 1 a 50 dados de 2 a 1000 lados');
      dados += n; if (dados > 100) throw new Http(400, 'Dados demais');
      const r = []; for (let k = 0; k < n; k++) r.push(crypto.randomInt(1, f + 1));
      total += sinal * r.reduce((a, b) => a + b, 0);
      det.push({ s: sinal, n, f, r });
    } else { const k = +mm[4]; total += sinal * k; det.push({ s: sinal, k }); }
  }
  return { e: s, d: det, s: total };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return await estado(req, res);
    if (req.method !== 'POST') throw new Http(405, 'Método não permitido');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(b.acao || '');

    if (acao === 'criar') {
      const nome = txt(b.nome, 40) || 'Minha mesa';
      const m = rid(6), mk = rid(24);
      const cena = { img: null, w: 1600, h: 1000, grade: { on: true, size: 70, snap: true, m: 1.5 }, nevoa: false };
      await rest('POST', 'mesas', { corpo: { id: m, nome, h: sha(mk), cena, v: novoV() }, prefer: 'return=minimal' });
      return res.status(200).json({ ok: true, m, mk });
    }

    const c = await contexto(b);
    const { m } = c;
    const cena = c.row.cena;

    if (acao === 'entrar') {
      const nome = txt(b.pnome, 20) || 'Jogador';
      await rest('POST', 'jogadores?on_conflict=mesa,id', { corpo: { mesa: m, id: c.pid, dados: { nome, mestre: c.mestre, t: Date.now() } }, prefer: 'resolution=merge-duplicates,return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'tokenAdd') {
      if (!c.mestre) {
        const tk = await rest('GET', `tokens?mesa=eq.${m}&select=dados`);
        if (tk.filter((x) => x.dados.dono === c.pid).length >= 3) throw new Http(400, 'Limite de 3 tokens por jogador');
      }
      const dono = c.mestre ? (idOk(String(b.dono || ''), 6, 32) ? b.dono : '') : c.pid;
      const t = validaToken({ nome: b.nome || 'Token', cor: COR.test(b.cor) ? b.cor : '#c0392b', tam: b.tam || 1, x: b.x, y: b.y }, cena);
      t.id = rid(6); t.dono = dono; t.vis = c.mestre ? b.vis !== false : true;
      await rest('POST', 'tokens', { corpo: { mesa: m, id: t.id, dados: t }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true, id: t.id });
    }

    if (acao === 'tokenMove' || acao === 'tokenEdit' || acao === 'tokenDel') {
      const id = txt(b.id, 12).toLowerCase();
      if (!idOk(id, 1, 12)) throw new Http(404, 'Token não encontrado');
      const [row] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${id}&select=dados`);
      if (!row) throw new Http(404, 'Token não encontrado');
      const t = row.dados;
      if (!c.mestre && t.dono !== c.pid) throw new Http(403, 'Esse token não é seu');
      if (acao === 'tokenDel') {
        await rest('DELETE', `tokens?mesa=eq.${m}&id=eq.${id}`);
        await bump(m);
        return res.status(200).json({ ok: true });
      }
      const n = acao === 'tokenMove' ? validaToken({ x: b.x, y: b.y }, cena, t) : validaToken(b, cena, t);
      if (acao === 'tokenEdit' && c.mestre) {
        if (b.vis !== undefined) n.vis = !!b.vis;
        if (b.dono !== undefined) n.dono = idOk(String(b.dono), 6, 32) ? b.dono : '';
      }
      await rest('PATCH', `tokens?mesa=eq.${m}&id=eq.${id}`, { corpo: { dados: n }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'cena') {
      exigeMestre(c);
      const g = b.grade || {}, nova = { ...cena };
      nova.grade = {
        on: g.on === undefined ? cena.grade.on : !!g.on,
        size: Math.round(num(g.size, 20, 200, cena.grade.size)),
        snap: g.snap === undefined ? cena.grade.snap : !!g.snap,
        m: num(g.m, 0.1, 1000, cena.grade.m),
      };
      if (b.nevoa !== undefined) nova.nevoa = !!b.nevoa;
      await bump(m, { cena: nova });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'nevoaAdd') {
      exigeMestre(c);
      const rs = (Array.isArray(b.rects) ? b.rects : []).slice(0, 20).map((r) => [
        num(r[0], 0, cena.w, 0), num(r[1], 0, cena.h, 0), num(r[2], 0, cena.w, 0), num(r[3], 0, cena.h, 0)]);
      if (!rs.length) throw new Http(400, 'Área inválida');
      await rest('POST', 'nevoa', { corpo: rs.map((r) => ({ mesa: m, rect: r })), prefer: 'return=minimal' });
      await limita('nevoa', m, MAX_NEVOA);
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'nevoaCobrir') {
      exigeMestre(c);
      await rest('DELETE', `nevoa?mesa=eq.${m}`);
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'rolar') {
      const r = rolarDados(b.expr);
      const [jg] = await rest('GET', `jogadores?mesa=eq.${m}&id=eq.${c.pid}&select=dados`);
      const nome = (jg && jg.dados && jg.dados.nome) || 'Jogador';
      await rest('POST', 'rolagens', { corpo: { mesa: m, dados: { t: Date.now(), a: nome, ...r } }, prefer: 'return=minimal' });
      await limita('rolagens', m, MAX_LOG);
      await bump(m);
      return res.status(200).json({ ok: true, ...r });
    }

    if (acao === 'imagem') {
      exigeMestre(c);
      const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
      const mime = EXT[b.mime] ? b.mime : null;
      const dados = String(b.dados || '');
      if (!mime || !dados || dados.length > 3100000 || !/^[A-Za-z0-9+/=]+$/.test(dados)) throw new Http(400, 'Imagem inválida ou grande demais');
      const arq = `${rid(8)}.${EXT[mime]}`;
      await subirImagem(`${m}/${arq}`, Buffer.from(dados, 'base64'), mime);
      const ant = cena.img;
      const nova = { ...cena, img: arq, w: Math.round(num(b.w, 100, 4096, cena.w)), h: Math.round(num(b.h, 100, 4096, cena.h)) };
      await bump(m, { cena: nova });
      if (ant) await apagarImagem(`${m}/${ant}`);
      return res.status(200).json({ ok: true, img: arq });
    }

    throw new Http(400, 'Ação desconhecida');
  } catch (e) {
    if (e.http) return res.status(e.http).json({ erro: e.message });
    if (e.message === 'SEM_BANCO') return res.status(500).json({ erro: 'Banco de dados não configurado (veja o README, passo do Supabase).' });
    console.error(e);
    const bd = /^Supabase/.test(e.message);
    return res.status(500).json({ erro: bd ? 'Erro no banco de dados. Se o projeto Supabase está pausado, reative-o no painel (veja o README).' : 'Erro no servidor' });
  }
}
