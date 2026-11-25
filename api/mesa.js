// API principal da mesa (Supabase). GET = estado. POST = ações. O servidor é quem valida permissões.
import crypto from 'node:crypto';
import { rest, avisa, subirImagem, apagarImagem, listarImagens, apagarImagens } from './_db.js';
import { caminhoLivre } from '../geo.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const AL = 'abcdefghjkmnpqrstuvwxyz23456789';
const rid = (n) => { let o = ''; for (const x of crypto.randomBytes(n)) o += AL[x % AL.length]; return o; };
class Http extends Error { constructor(c, m) { super(m); this.http = c; } }
const num = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const igual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const COR = /^#[0-9a-fA-F]{6}$/;
const MAX_NEVOA = 300, MAX_LOG = 50, MAX_CENAS = 30, MAX_CHAT = 100, MAX_EFEITOS = 16, MAX_ELEMENTOS = 100;
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const novoV = () => Date.now() * 1000 + Math.floor(Math.random() * 1000); // só precisa ser diferente a cada mudança
const idOk = (x, min, max) => new RegExp(`^[a-z0-9]{${min},${max}}$`).test(String(x));
const CENA_PADRAO = () => ({ img: null, w: 1600, h: 1000, grade: { on: true, size: 70, snap: true, m: 1.5 }, nevoa: false });

// grava a nova versão da mesa (e campos extras) e avisa os conectados
async function bump(m, extra = {}) {
  const v = novoV();
  await rest('PATCH', `mesas?id=eq.${m}`, { corpo: { v, usado: new Date().toISOString(), ...extra }, prefer: 'return=minimal' });
  await avisa(m, v);
  return v;
}
async function limita(tabela, filtro, max) {
  const [x] = await rest('GET', `${tabela}?${filtro}&select=id&order=id.desc&offset=${max}&limit=1`);
  if (x) await rest('DELETE', `${tabela}?${filtro}&id=lte.${x.id}`);
}

async function apagaImagemTokenSeOrfa(m, img) {
  if (!img) return;
  try {
    const tokens = await rest('GET', `tokens?mesa=eq.${m}&select=dados`);
    if (!tokens.some((x) => x.dados && x.dados.img === img)) await apagarImagem(`${m}/${img}`);
  } catch { /* preservar a imagem se nao for possivel confirmar que ficou sem uso */ }
}

async function contexto(b) {
  const m = txt(b.m, 16).toLowerCase();
  if (!idOk(m, 4, 16)) throw new Http(400, 'Código de mesa inválido');
  const pid = String(b.pid || '');
  if (!idOk(pid, 6, 32)) throw new Http(400, 'Identificação inválida');
  // select=* de propósito: se a coluna "musica" ainda não existir (migração v4 não rodada), o app continua funcionando
  const [row] = await rest('GET', `mesas?id=eq.${m}&select=*`);
  if (!row) throw new Http(404, 'Mesa não encontrada');
  const mk = String(b.mk || '');
  const mestre = mk.length > 0 && igual(sha(mk), row.h);
  // cena-alvo: o mestre pode estar em qualquer cena; jogadores sempre na ativa
  let alvo = row.ativa, cenaRow = null;
  if (mestre && b.c && idOk(b.c, 2, 8)) {
    const [r] = await rest('GET', `cenas?mesa=eq.${m}&id=eq.${b.c}&select=id,nome,cena`);
    if (r) { alvo = r.id; cenaRow = r; }
  }
  if (!cenaRow) {
    const [r] = await rest('GET', `cenas?mesa=eq.${m}&id=eq.${alvo}&select=id,nome,cena`);
    if (!r) throw new Http(500, 'Mesa sem cena. Rode o migracao-v3.sql no Supabase.');
    cenaRow = r; alvo = r.id;
  }
  return { m, row, mestre, pid, ativa: row.ativa, alvo, cena: cenaRow.cena, cenaNome: cenaRow.nome };
}
const exigeMestre = (c) => { if (!c.mestre) throw new Http(403, 'Só o mestre pode fazer isso'); };

async function estado(req, res) {
  const q = req.query || {};
  const m = txt(q.m, 16).toLowerCase();
  if (!idOk(m, 4, 16)) throw new Http(400, 'Código de mesa inválido');
  const cli = Number(q.v) || 0;
  const [vr] = await rest('GET', `mesas?id=eq.${m}&select=v`);
  if (!vr) throw new Http(404, 'Mesa não encontrada');
  // "agora" = hora do servidor: os clientes usam para acertar o relógio e tocar a música no mesmo ponto
  if (cli && Number(vr.v) === cli) return res.status(200).json({ v: cli, mesmo: true, agora: Date.now() });
  const c = await contexto({ m, mk: req.headers['x-mk'], pid: req.headers['x-pid'], c: q.c });
  const [tk, nv, lg, jg, cs, todosTokens, chat] = await Promise.all([
    rest('GET', `tokens?mesa=eq.${m}&cena=eq.${c.alvo}&select=dados`),
    rest('GET', `nevoa?mesa=eq.${m}&cena=eq.${c.alvo}&select=rect&order=id.asc`),
    rest('GET', `rolagens?mesa=eq.${m}&select=dados&order=id.desc&limit=${MAX_LOG}`),
    rest('GET', `jogadores?mesa=eq.${m}&select=id,dados`),
    c.mestre ? rest('GET', `cenas?mesa=eq.${m}&select=id,nome,ordem&order=ordem.asc,id.asc`) : Promise.resolve(null),
    c.mestre ? rest('GET', `tokens?mesa=eq.${m}&select=cena,dados`) : rest('GET', `tokens?mesa=eq.${m}&dados->>dono=eq.${c.pid}&select=cena,dados`),
    rest('GET', `chat?mesa=eq.${m}&select=id,dados&order=id.desc&limit=${MAX_CHAT}`).catch((e) => { if (/PGRST205|Could not find the table/i.test(e.message)) return []; throw e; }),
  ]);
  let tokens = tk.map((x) => x.dados);
  if (!c.mestre) tokens = tokens.filter((t) => (t.vis !== false || t.dono === c.pid) && (!t.repouso || t.dono === c.pid)); // formas em repouso só aparecem para o dono
  const out = {
    v: Number(c.row.v), agora: Date.now(), musica: c.row.musica || null, efeitos: (c.row.efeitos || []).filter((x) => x.loop || Date.now() < x.t + x.dur * 1000),
    nome: c.row.nome, papel: c.mestre ? 'mestre' : 'jogador', cena: c.cena, tokens,
    elementos: (c.cena.elementos || []).filter((x) => c.mestre || x.vis !== false), iniciativa: c.cena.iniciativa || null,
    chat: chat.reverse().map((x) => ({ id: x.id, ...x.dados })),
    nevoa: nv.map((x) => x.rect), log: lg.map((x) => x.dados).reverse(), jog: jg.map((x) => ({ id: x.id, ...x.dados })),
  };
  if (c.mestre) {
    out.cenas = cs.map((x) => ({ id: x.id, nome: x.nome }));
    out.ativa = c.ativa; out.vendo = c.alvo; out.cenaNome = c.cenaNome;
    out.biblioteca = todosTokens.filter((x) => !x.dados.repouso).map((x) => ({ ...x.dados, cena: x.cena }));
  } else {
    out.cenaId = c.ativa;
    out.biblioteca = todosTokens.filter((x) => !x.dados.repouso).map((x) => ({ ...x.dados, cena: x.cena }));
  } // jogadores só sabem que existe "a cena atual"
  return res.status(200).json(out);
}

function validaToken(b, cena, ant = {}) {
  const t = { ...ant };
  if (b.nome !== undefined) t.nome = txt(b.nome, 12) || ant.nome || 'Token';
  if (b.cor !== undefined && COR.test(b.cor)) t.cor = b.cor;
  if (b.tam !== undefined) t.tam = Math.round(num(b.tam, 1, 6, ant.tam || 1));
  if (b.x !== undefined) t.x = num(b.x, 0, cena.w, ant.x || 0);
  if (b.y !== undefined) t.y = num(b.y, 0, cena.h, ant.y || 0);
  if (b.visao !== undefined) t.visao = Math.round(num(b.visao, 0, 20, ant.visao || 0));
  if (b.bloqueiaPortas !== undefined) t.bloqueiaPortas = !!b.bloqueiaPortas;
  if (b.espelho !== undefined) { if (b.espelho) t.espelho = true; else delete t.espelho; } // imagem virada para o outro lado
  return t;
}

// clima da cena (fica dentro de cenas.cena, sem coluna nova): { tipo, dir: graus do vento (0 = →, 90 = ↓), vento 0-100, cob: intensidade 1-100 }
const TIPOS_CLIMA = ['chuva', 'tempestade', 'neve', 'neblina', 'cinzas'];
function validaClima(c) {
  if (!c || typeof c !== 'object' || !TIPOS_CLIMA.includes(c.tipo)) return null;
  return { tipo: c.tipo, dir: Math.round(num(c.dir, 0, 359, 0)), vento: Math.round(num(c.vento, 0, 100, 0)), cob: Math.round(num(c.cob, 1, 100, 50)) };
}

// uma operação da névoa: { t: 'r' revelar | 'h' esconder, k: 'rect' | 'circ' | 'path', ... }
function validaOp(o, cena) {
  if (Array.isArray(o)) o = { t: 'r', k: 'rect', x: o[0], y: o[1], w: o[2], h: o[3] }; // formato antigo
  if (!o || typeof o !== 'object') return null;
  const t = o.t === 'h' ? 'h' : 'r', W = cena.w, H = cena.h;
  if (o.k === 'rect') return { t, k: 'rect', x: num(o.x, 0, W, 0), y: num(o.y, 0, H, 0), w: num(o.w, 0, W, 0), h: num(o.h, 0, H, 0) };
  if (o.k === 'circ') return { t, k: 'circ', x: num(o.x, 0, W, 0), y: num(o.y, 0, H, 0), r: num(o.r, 1, Math.max(W, H), 1) };
  if (o.k === 'path' && Array.isArray(o.p) && o.p.length) {
    const p = o.p.slice(0, 400).map((q) => [Math.round(num(q[0], 0, W, 0)), Math.round(num(q[1], 0, H, 0))]);
    return { t, k: 'path', r: num(o.r, 2, Math.max(W, H) / 2, 20), p };
  }
  return null;
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

/* ---------- música sincronizada ----------
   Estado guardado em mesas.musica: { id, a: 'p' (tocando) | 'x' (pausada), t: hora do servidor (ms), off: segundos no arquivo
   quando "t" aconteceu, dur: duração em s, url, titulo }. Posição atual = (off + (agora - t)/1000) % dur enquanto toca.
   Só o servidor carimba a hora, então o relógio do mestre não importa. */
const posicaoMusica = (mu, agora) => (mu.a === 'p' ? (mu.off + (agora - mu.t) / 1000) % mu.dur : mu.off);

function urlAudio(v) {
  let u;
  try { u = new URL(String(v || '').trim()); } catch { throw new Http(400, 'Link de áudio inválido'); }
  if (u.protocol !== 'https:' || u.href.length > 800) throw new Http(400, 'O link do áudio precisa ser https:// e curto');
  if (u.hostname === 'drive.google.com') throw new Http(400, 'Links do Google Drive não funcionam. Use Dropbox ou outro link direto.');
  if (u.hostname === 'dropbox.com' || u.hostname.endsWith('.dropbox.com')) { u.searchParams.set('dl', '1'); u.hostname = 'dl.dropboxusercontent.com'; }
  return u.href;
}

async function acaoMusica(c, acao, b) {
  const atual = c.row.musica || null, agora = Date.now();
  let nova = null;
  if (acao === 'musicaTocar') {
    const dur = Number(b.dur);
    if (!(dur >= 1 && dur <= 86400)) throw new Http(400, 'Duração da faixa inválida (de 1 s a 24 h)');
    nova = { id: rid(8), a: 'p', t: agora, off: 0, dur, url: urlAudio(b.url), titulo: txt(b.titulo, 60) || 'Faixa' };
  } else if (acao !== 'musicaParar') {
    if (!atual) throw new Http(400, 'Nenhuma faixa na mesa');
    if (acao === 'musicaPausar') {
      if (atual.a !== 'p') return; // já está pausada
      nova = { ...atual, id: rid(8), a: 'x', t: agora, off: posicaoMusica(atual, agora) };
    } else { // musicaRetomar
      if (atual.a === 'p') return;
      nova = { ...atual, id: rid(8), a: 'p', t: agora };
    }
  }
  try { await bump(c.m, { musica: nova }); } catch (e) {
    if (/musica/i.test(e.message)) throw new Http(500, 'Falta rodar o migracao-v4-musica.sql no Supabase para ligar a música.');
    throw e;
  }
}

// valida e prepara uma imagem enviada em base64
function leImagem(b, maxChars) {
  const mime = EXT[b.mime] ? b.mime : null, dados = String(b.dados || '');
  if (!mime || !dados || dados.length > maxChars || !/^[A-Za-z0-9+/=]+$/.test(dados)) throw new Http(400, 'Imagem inválida ou grande demais');
  return { mime, ext: EXT[mime], buf: Buffer.from(dados, 'base64') };
}

// paredes e portas da névoa dinâmica (ficam em cenas.cena.paredes, sem tabela nova): { id, p: [x1,y1,x2,y2], t: 0 parede | 1 porta, a: 1 aberta }
const MAX_PAREDES = 500;
function validaParede(s, cena) {
  if (!s || !Array.isArray(s.p) || s.p.length !== 4 || !s.p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const p = s.p.map((v, i) => Math.round(num(v, 0, i % 2 ? cena.h : cena.w, 0)));
  if (Math.hypot(p[2] - p[0], p[3] - p[1]) < 4) return null;
  return { id: rid(5), p, t: s.t === 1 ? 1 : 0, a: 0, l: 0 };
}

// uma operação da névoa: { t: 'r' revelar | 'h' esconder, k: 'rect' | 'circ' | 'path', ... }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return await estado(req, res);
    if (req.method !== 'POST') throw new Http(405, 'Método não permitido');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(b.acao || '');

    if (acao === 'criar') {
      const nome = txt(b.nome, 40) || 'Minha mesa';
      const m = rid(6), mk = rid(24), sid = rid(5);
      await rest('POST', 'mesas', { corpo: { id: m, nome, h: sha(mk), ativa: sid, v: novoV() }, prefer: 'return=minimal' });
      await rest('POST', 'cenas', { corpo: { id: sid, mesa: m, nome: 'Cena 1', cena: CENA_PADRAO(), ordem: 0 }, prefer: 'return=minimal' });
      return res.status(200).json({ ok: true, m, mk });
    }

    const c = await contexto(b);
    const { m, cena } = c;
    const filtroCena = `mesa=eq.${m}&cena=eq.${c.alvo}`;

    if (acao === 'entrar') {
      const nome = txt(b.pnome, 20) || 'Jogador';
      await rest('POST', 'jogadores?on_conflict=mesa,id', { corpo: { mesa: m, id: c.pid, dados: { nome, mestre: c.mestre, t: Date.now() } }, prefer: 'resolution=merge-duplicates,return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    /* ---------- tokens ---------- */
    if (acao === 'tokenAdd') {
      if (!c.mestre) {
        const tk = await rest('GET', `tokens?mesa=eq.${m}&select=dados`);
        if (tk.filter((x) => x.dados.dono === c.pid).length >= 3) throw new Http(400, 'Limite de 3 tokens por jogador');
      }
      const dono = c.mestre ? (idOk(b.dono || '', 6, 32) ? b.dono : '') : c.pid;
      const t = validaToken({ nome: b.nome || 'Token', cor: COR.test(b.cor) ? b.cor : '#c0392b', tam: b.tam || 1, x: b.x, y: b.y }, cena);
      t.id = rid(6); t.dono = dono; t.vis = c.mestre ? (dono ? true : b.vis === true) : true; t.img = null; t.visao = 0;
      await rest('POST', 'tokens', { corpo: { mesa: m, id: t.id, cena: c.alvo, dados: t }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true, id: t.id });
    }

    if (['tokenGuardar', 'tokenColocar', 'tokenDuplicar'].includes(acao)) {
      const id = txt(b.id, 12).toLowerCase();
      if (!idOk(id, 1, 12)) throw new Http(404, 'Token não encontrado');
      const [row] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${id}&select=cena,dados`);
      if (!row) throw new Http(404, 'Token não encontrado');
      const t = row.dados;

      if (acao === 'tokenGuardar') {
        if (row.cena === null) return res.status(200).json({ ok: true });
        if (t.par) throw new Http(400, 'Desligue as duas formas antes de guardar este token');
        if (!c.mestre && (t.dono !== c.pid || row.cena !== c.ativa)) throw new Http(403, 'Esse token não é seu');
        if (c.mestre && row.cena !== c.alvo) throw new Http(400, 'Abra a cena do token antes de removê-lo');
        await rest('PATCH', `tokens?mesa=eq.${m}&id=eq.${id}`, { corpo: { cena: null }, prefer: 'return=minimal' });
        await bump(m);
        return res.status(200).json({ ok: true });
      }

      if (acao === 'tokenColocar') {
        if (!c.mestre && t.dono !== c.pid) throw new Http(403, 'Esse token não é seu');
        if (row.cena !== null) throw new Http(400, 'Esse token já está em uma cena');
        const n = validaToken({ x: b.x, y: b.y }, cena, t);
        await rest('PATCH', `tokens?mesa=eq.${m}&id=eq.${id}`, { corpo: { cena: c.alvo, dados: n }, prefer: 'return=minimal' });
        await bump(m);
        return res.status(200).json({ ok: true, id });
      }

      exigeMestre(c);
      if (row.cena === null) throw new Http(400, 'Esse token está guardado; use Colocar nesta cena');
      const cenaId = String(b.cenaId || '');
      if (!idOk(cenaId, 2, 8) || cenaId === row.cena) throw new Http(400, 'Escolha outra cena');
      const [destino] = await rest('GET', `cenas?mesa=eq.${m}&id=eq.${cenaId}&select=id,cena`);
      if (!destino) throw new Http(404, 'Cena não encontrada');
      const novoId = rid(6), copia = { ...t, id: novoId }; delete copia.par; delete copia.repouso;
      copia.x = num(t.x, 0, destino.cena.w, destino.cena.w / 2);
      copia.y = num(t.y, 0, destino.cena.h, destino.cena.h / 2);
      await rest('POST', 'tokens', { corpo: { mesa: m, id: novoId, cena: cenaId, dados: copia }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true, id: novoId });
    }

    /* ---------- formas ligadas (como o "Flip!" do Owlbear): dois tokens ligados, só um aparece; "trocar" revezia entre eles ---------- */
    if (['tokenLigar', 'tokenTrocar', 'tokenDesligar'].includes(acao)) {
      const ida = txt(b.id, 12).toLowerCase(), idb = txt(b.com, 12).toLowerCase();
      if (!idOk(ida, 1, 12)) throw new Http(404, 'Token não encontrado');
      const [ra] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${ida}&select=cena,dados`);
      if (!ra) throw new Http(404, 'Token não encontrado');
      const dono = (r) => c.mestre || (r.dados.dono === c.pid && r.cena === c.ativa);
      if (!dono(ra)) throw new Http(403, 'Esse token não é seu');
      if (!c.mestre && acao !== 'tokenTrocar' && cena.ligJogadores === false) throw new Http(403, 'O mestre desligou a ligação de tokens para jogadores');
      const grava = (id, dados, extra = {}) => rest('PATCH', `tokens?mesa=eq.${m}&id=eq.${id}`, { corpo: { dados, ...extra }, prefer: 'return=minimal' });
      if (acao === 'tokenLigar') {
        if (!idOk(idb, 1, 12) || idb === ida) throw new Http(400, 'Escolha outro token para ligar');
        const [rb] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${idb}&select=cena,dados`);
        if (!rb) throw new Http(404, 'Token não encontrado');
        if (!dono(rb)) throw new Http(403, 'Esse token não é seu');
        if (ra.cena === null || rb.cena === null || ra.cena !== rb.cena) throw new Http(400, 'Os dois tokens precisam estar na mesma cena');
        if (ra.dados.par || rb.dados.par) throw new Http(400, 'Um deles já está ligado a outro token');
        await grava(ida, { ...ra.dados, par: idb });
        await grava(idb, { ...rb.dados, par: ida, repouso: true, x: ra.dados.x, y: ra.dados.y });
      } else {
        if (!ra.dados.par) throw new Http(400, 'Esse token não está ligado a nenhum outro');
        const [rb] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${ra.dados.par}&select=cena,dados`);
        if (!rb) { const d = { ...ra.dados }; delete d.par; delete d.repouso; await grava(ida, d); }
        else if (acao === 'tokenDesligar') {
          const da = { ...ra.dados }, db = { ...rb.dados }; delete da.par; delete db.par;
          const [ativo, rep] = ra.dados.repouso ? [rb, ra] : [ra, rb], dAtivo = ativo === ra ? da : db, dRep = rep === ra ? da : db;
          delete dAtivo.repouso; delete dRep.repouso;
          await grava(ativo === ra ? ida : ra.dados.par, dAtivo);
          await grava(rep === ra ? ida : ra.dados.par, dRep, { cena: null }); // a forma que estava em repouso vai para a biblioteca
        } else { // trocar: a outra forma assume a posição desta
          const [ativo, rep] = ra.dados.repouso ? [rb, ra] : [ra, rb], idAtivo = ativo === ra ? ida : ra.dados.par, idRep = rep === ra ? ida : ra.dados.par;
          const dRep = { ...rep.dados, x: ativo.dados.x, y: ativo.dados.y, vis: ativo.dados.vis };
          delete dRep.repouso;
          await grava(idRep, dRep);
          await grava(idAtivo, { ...ativo.dados, repouso: true });
        }
      }
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    if (['tokenMove', 'tokenEdit', 'tokenDel', 'tokenImg'].includes(acao)) {
      const id = txt(b.id, 12).toLowerCase();
      if (!idOk(id, 1, 12)) throw new Http(404, 'Token não encontrado');
      const [row] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${id}&select=cena,dados`);
      if (!row) throw new Http(404, 'Token não encontrado');
      const t = row.dados;
      if (!c.mestre && (t.dono !== c.pid || row.cena !== c.ativa)) throw new Http(403, 'Esse token não é seu');
      const cenaTk = (await rest('GET', `cenas?mesa=eq.${m}&id=eq.${row.cena}&select=cena`))[0]?.cena || cena;

      if (acao === 'tokenDel') {
        if (t.par) { // a outra forma não pode ficar escondida para sempre: ela assume o lugar deste
          const [irm] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${t.par}&select=cena,dados`);
          if (irm) { const d = { ...irm.dados }; delete d.par; if (d.repouso) { d.x = t.x; d.y = t.y; d.vis = t.vis; } delete d.repouso; await rest('PATCH', `tokens?mesa=eq.${m}&id=eq.${t.par}`, { corpo: { dados: d }, prefer: 'return=minimal' }); }
        }
        await rest('DELETE', `tokens?mesa=eq.${m}&id=eq.${id}`);
        await bump(m);
        await apagaImagemTokenSeOrfa(m, t.img);
        return res.status(200).json({ ok: true });
      }
      if (acao === 'tokenImg') {
        const n = { ...t }; let novo = null;
        if (b.dados) { const im = leImagem(b, 400000); novo = `t-${rid(8)}.${im.ext}`; await subirImagem(`${m}/${novo}`, im.buf, im.mime); }
        n.img = novo;
        await rest('PATCH', `tokens?mesa=eq.${m}&id=eq.${id}`, { corpo: { dados: n }, prefer: 'return=minimal' });
        await bump(m);
        await apagaImagemTokenSeOrfa(m, t.img);
        return res.status(200).json({ ok: true });
      }
      if (t.repouso && (acao === 'tokenMove' || (acao === 'tokenEdit' && (b.x !== undefined || b.y !== undefined)))) throw new Http(400, 'Esta forma está em repouso; troque de forma primeiro');
      const n = acao === 'tokenMove' ? validaToken({ x: b.x, y: b.y }, cenaTk, t) : validaToken(b, cenaTk, t);
      if ((acao === 'tokenMove' || (acao === 'tokenEdit' && (n.x !== t.x || n.y !== t.y))) && cenaTk.bloqueia !== false && !caminhoLivre(cenaTk.paredes, t.x, t.y, n.x, n.y, !t.dono && t.bloqueiaPortas === false)) throw new Http(400, 'Caminho bloqueado por parede ou porta fechada');
      if (acao === 'tokenEdit' && c.mestre) {
        if (b.vis !== undefined) n.vis = !!b.vis;
        if (b.dono !== undefined) n.dono = idOk(b.dono, 6, 32) ? b.dono : '';
      } else if (acao === 'tokenEdit') n.visao = t.visao || 0; // só o mestre mexe na visão
      await rest('PATCH', `tokens?mesa=eq.${m}&id=eq.${id}`, { corpo: { dados: n }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    /* ---------- cena atual: grade, névoa, imagem ---------- */
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
      if (b.bloqueia !== undefined) nova.bloqueia = !!b.bloqueia;
      if (b.ordemY !== undefined) { if (b.ordemY) nova.ordemY = true; else delete nova.ordemY; } // token mais abaixo fica na frente (jogos isométricos)
      if (b.ligJogadores !== undefined) { if (b.ligJogadores) delete nova.ligJogadores; else nova.ligJogadores = false; } // jogadores podem ligar/desligar formas
      if (b.clima !== undefined) { const cl = validaClima(b.clima); if (cl) nova.clima = cl; else delete nova.clima; } // null = sem clima
      await rest('PATCH', `cenas?mesa=eq.${m}&id=eq.${c.alvo}`, { corpo: { cena: nova }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'imagem') {
      exigeMestre(c);
      const im = leImagem(b, 3100000);
      const arq = `${rid(8)}.${im.ext}`;
      await subirImagem(`${m}/${arq}`, im.buf, im.mime);
      const nova = { ...cena, img: arq, w: Math.round(num(b.w, 100, 4096, cena.w)), h: Math.round(num(b.h, 100, 4096, cena.h)) };
      await rest('PATCH', `cenas?mesa=eq.${m}&id=eq.${c.alvo}`, { corpo: { cena: nova }, prefer: 'return=minimal' });
      await bump(m);
      if (cena.img) await apagarImagem(`${m}/${cena.img}`);
      return res.status(200).json({ ok: true, img: arq });
    }

    /* ---------- névoa ---------- */
    /* Recursos sincronizados: elementos graficos, iniciativa, chat e efeitos. */
    if (['elementoAdd', 'elementoMove', 'elementoEdit', 'elementoDel'].includes(acao)) {
      exigeMestre(c);
      const lista = Array.isArray(cena.elementos) ? cena.elementos : [], id = txt(b.id, 12);
      if (acao === 'elementoAdd') {
        if (lista.length >= MAX_ELEMENTOS) throw new Http(400, `Limite de ${MAX_ELEMENTOS} elementos por cena`);
        const im = leImagem(b, 1200000), arq = `e-${rid(8)}.${im.ext}`;
        await subirImagem(`${m}/${arq}`, im.buf, im.mime);
        const razao = num(b.razao, 0.15, 6, 1), altura = Math.min(cena.h, num(b.h, 30, 900, cena.grade.size * 2)), largura = Math.min(cena.w, Math.round(altura * razao));
        const el = { id: rid(6), nome: txt(b.nome, 40), img: arq, x: num(b.x, 0, cena.w, cena.w / 2), y: num(b.y, 0, cena.h, cena.h / 2), w: largura, h: Math.round(largura / razao), vis: false };
        await rest('PATCH', `cenas?mesa=eq.${m}&id=eq.${c.alvo}`, { corpo: { cena: { ...cena, elementos: [...lista, el] } }, prefer: 'return=minimal' });
        await bump(m); return res.status(200).json({ ok: true, id: el.id });
      }
      const alvo = lista.find((x) => x.id === id);
      if (!alvo) throw new Http(404, 'Elemento nao encontrado');
      const nova = acao === 'elementoDel' ? lista.filter((x) => x.id !== id) : lista.map((x) => x.id !== id ? x : acao === 'elementoMove' ? { ...x, x: num(b.x, 0, cena.w, x.x), y: num(b.y, 0, cena.h, x.y) } : { ...x, vis: b.vis === undefined ? x.vis : !!b.vis, w: num(b.w, 30, cena.w, x.w), h: num(b.h, 30, cena.h, x.h) });
      await rest('PATCH', `cenas?mesa=eq.${m}&id=eq.${c.alvo}`, { corpo: { cena: { ...cena, elementos: nova } }, prefer: 'return=minimal' });
      await bump(m);
      if (acao === 'elementoDel') { const cenas = await rest('GET', `cenas?mesa=eq.${m}&select=cena`); if (!cenas.some((x) => (x.cena.elementos || []).some((e) => e.img === alvo.img))) await apagarImagem(`${m}/${alvo.img}`); }
      return res.status(200).json({ ok: true });
    }
    if (['iniciativaSalvar', 'iniciativaAvancar', 'iniciativaLimpar'].includes(acao)) {
      exigeMestre(c); let iniciativa = cena.iniciativa || null;
      if (acao === 'iniciativaLimpar') iniciativa = null;
      else if (acao === 'iniciativaSalvar') {
        const ids = [...new Set((Array.isArray(b.turnos) ? b.turnos : []).map((x) => txt(x.id, 12)))];
        if (!ids.length || ids.length > 40) throw new Http(400, 'Selecione de 1 a 40 tokens');
        const tokens = await rest('GET', `tokens?mesa=eq.${m}&cena=eq.${c.alvo}&select=id,dados`), byId = new Map(tokens.map((x) => [x.id, x.dados]));
        const turnos = ids.map((id) => { if (!byId.has(id)) throw new Http(400, 'Token fora desta cena'); const valor = Number((b.turnos || []).find((x) => x.id === id)?.valor); if (!Number.isFinite(valor) || valor < -9999 || valor > 99999) throw new Http(400, 'Valor de iniciativa invalido'); return { id, nome: txt(byId.get(id).nome, 40) || 'Token', valor }; }).sort((a, b) => b.valor - a.valor);
        iniciativa = { turnos, ativo: 0, rodada: 1, ativa: true };
      } else { if (!iniciativa?.turnos?.length) throw new Http(400, 'Inicie uma iniciativa primeiro'); const ativo = iniciativa.ativo + 1, virou = ativo >= iniciativa.turnos.length; iniciativa = { ...iniciativa, ativo: virou ? 0 : ativo, rodada: iniciativa.rodada + (virou ? 1 : 0) }; }
      await rest('PATCH', `cenas?mesa=eq.${m}&id=eq.${c.alvo}`, { corpo: { cena: { ...cena, iniciativa } }, prefer: 'return=minimal' }); await bump(m); return res.status(200).json({ ok: true });
    }
    if (acao === 'chatEnviar') {
      const texto = txt(b.texto, 600); if (!texto) throw new Http(400, 'Escreva uma mensagem');
      const [jogador] = await rest('GET', `jogadores?mesa=eq.${m}&id=eq.${c.pid}&select=dados`); if (!jogador) throw new Http(403, 'Entre novamente na mesa');
      let nome = jogador.dados.nome || 'Jogador', tokenId = null;
      if (b.tokenId) { tokenId = txt(b.tokenId, 12); const [token] = await rest('GET', `tokens?mesa=eq.${m}&id=eq.${tokenId}&cena=eq.${c.alvo}&select=dados`); if (!token || (!c.mestre && token.dados.dono !== c.pid)) throw new Http(403, 'Voce nao pode falar por esse personagem'); nome = token.dados.nome || nome; }
      else if (b.como === 'mestre') { exigeMestre(c); nome = `${nome} (Mestre)`; }
      await rest('POST', 'chat', { corpo: { mesa: m, dados: { t: Date.now(), pid: c.pid, nome: txt(nome, 40), texto, tokenId } }, prefer: 'return=minimal' }); await limita('chat', `mesa=eq.${m}`, MAX_CHAT); await bump(m); return res.status(200).json({ ok: true });
    }
    if (['efeitoTocar', 'efeitoParar', 'efeitosParar'].includes(acao)) {
      exigeMestre(c); let efeitos = (c.row.efeitos || []).filter((x) => x.loop || Date.now() < x.t + x.dur * 1000);
      if (acao === 'efeitoTocar') { const dur = Number(b.dur); if (!(dur >= 1 && dur <= 86400)) throw new Http(400, 'Duracao invalida'); if (efeitos.length >= MAX_EFEITOS) throw new Http(400, `Limite de ${MAX_EFEITOS} sons`); efeitos.push({ id: rid(8), t: Date.now(), dur, url: urlAudio(b.url), titulo: txt(b.titulo, 60) || 'Efeito', loop: !!b.loop }); }
      else if (acao === 'efeitosParar') efeitos = []; else efeitos = efeitos.filter((x) => x.id !== txt(b.id, 12));
      try { await bump(m, { efeitos }); } catch (e) { if (/efeitos/i.test(e.message)) throw new Http(500, 'Rode migracao-v7-recursos.sql no Supabase.'); throw e; } return res.status(200).json({ ok: true });
    }
    if (acao === 'nevoaAdd') {
      exigeMestre(c);
      const lista = [].concat(Array.isArray(b.ops) ? b.ops : [], Array.isArray(b.rects) ? b.rects : []);
      const ops = lista.slice(0, 20).map((o) => validaOp(o, cena)).filter(Boolean);
      if (!ops.length) throw new Http(400, 'Área inválida');
      await rest('POST', 'nevoa', { corpo: ops.map((o) => ({ mesa: m, cena: c.alvo, rect: o })), prefer: 'return=minimal' });
      await limita('nevoa', filtroCena, MAX_NEVOA);
      await bump(m);
      return res.status(200).json({ ok: true });
    }
    if (acao === 'nevoaDesfazer') {
      exigeMestre(c);
      const [x] = await rest('GET', `nevoa?${filtroCena}&select=id&order=id.desc&limit=1`);
      if (x) await rest('DELETE', `nevoa?mesa=eq.${m}&id=eq.${x.id}`);
      await bump(m);
      return res.status(200).json({ ok: true });
    }
    if (acao === 'nevoaCobrir') {
      exigeMestre(c);
      await rest('DELETE', `nevoa?${filtroCena}`);
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    /* ---------- névoa dinâmica: paredes e portas ---------- */
    if (['paredeAdd', 'paredeDel', 'paredeTipo', 'portaAlterna', 'portaTrancar', 'paredeLimpar'].includes(acao)) {
      exigeMestre(c);
      const lista = Array.isArray(cena.paredes) ? cena.paredes : [], id = String(b.id || '');
      let nova = null;
      if (acao === 'paredeAdd') {
        const novas = (Array.isArray(b.segs) ? b.segs : []).slice(0, 20).map((s) => validaParede(s, cena)).filter(Boolean);
        if (!novas.length) throw new Http(400, 'Parede inválida');
        if (lista.length + novas.length > MAX_PAREDES) throw new Http(400, `Limite de ${MAX_PAREDES} paredes por cena`);
        nova = [...lista, ...novas];
      } else if (acao === 'paredeLimpar') nova = [];
      else {
        if (!idOk(id, 3, 8) || !lista.some((s) => s.id === id)) throw new Http(404, 'Parede não encontrada');
        if (acao === 'paredeDel') nova = lista.filter((s) => s.id !== id);
        else if (acao === 'paredeTipo') nova = lista.map((s) => (s.id === id ? { ...s, t: s.t ? 0 : 1, a: 0, l: 0 } : s));
        else {
          const porta = lista.find((s) => s.id === id);
          if (!porta.t) throw new Http(400, 'Essa parede nao e uma porta');
          if (acao === 'portaTrancar') nova = lista.map((s) => (s.id === id ? { ...s, l: s.l ? 0 : 1, a: 0 } : s));
          else { if (porta.l) throw new Http(409, 'A porta esta trancada'); nova = lista.map((s) => (s.id === id ? { ...s, a: s.a ? 0 : 1 } : s)); }
        }
      }
      const nc = { ...cena }; if (nova.length) nc.paredes = nova; else delete nc.paredes;
      await rest('PATCH', `cenas?mesa=eq.${m}&id=eq.${c.alvo}`, { corpo: { cena: nc }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true });
    }

    /* ---------- cenas ---------- */
    if (acao === 'cenaNova') {
      exigeMestre(c);
      const todas = await rest('GET', `cenas?mesa=eq.${m}&select=id,ordem&order=ordem.desc`);
      if (todas.length >= MAX_CENAS) throw new Http(400, `Limite de ${MAX_CENAS} cenas`);
      const id = rid(5), nome = txt(b.nome, 30) || `Cena ${todas.length + 1}`;
      await rest('POST', 'cenas', { corpo: { id, mesa: m, nome, cena: CENA_PADRAO(), ordem: (todas[0]?.ordem ?? -1) + 1 }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true, id });
    }
    if (acao === 'cenaRenomear') {
      exigeMestre(c);
      const id = String(b.cenaId || '');
      if (!idOk(id, 2, 8)) throw new Http(400, 'Cena inválida');
      await rest('PATCH', `cenas?mesa=eq.${m}&id=eq.${id}`, { corpo: { nome: txt(b.nome, 30) || 'Cena' }, prefer: 'return=minimal' });
      await bump(m);
      return res.status(200).json({ ok: true });
    }
    if (acao === 'cenaPuxar') { // leva os jogadores para a cena
      exigeMestre(c);
      const id = String(b.cenaId || '');
      const [r] = idOk(id, 2, 8) ? await rest('GET', `cenas?mesa=eq.${m}&id=eq.${id}&select=id`) : [];
      if (!r) throw new Http(404, 'Cena não encontrada');
      await bump(m, { ativa: id });
      return res.status(200).json({ ok: true });
    }
    if (acao === 'mesaExcluir') { // apaga tudo da mesa: banco e imagens (libera espaço)
      exigeMestre(c);
      if (String(b.confirmacao || '').trim().toLowerCase() !== 'confirmar') throw new Http(400, 'Digite "confirmar" para excluir a mesa');
      const cenasM = await rest('GET', `cenas?mesa=eq.${m}&select=cena`);
      const tksM = await rest('GET', `tokens?mesa=eq.${m}&select=dados`);
      const imgs = new Set(await listarImagens(m));
      for (const x of cenasM) { if (x.cena.img) imgs.add(x.cena.img); for (const e of x.cena.elementos || []) if (e.img) imgs.add(e.img); }
      for (const t of tksM) if (t.dados && t.dados.img) imgs.add(t.dados.img);
      for (const tab of ['chat', 'rolagens', 'nevoa', 'tokens', 'jogadores', 'cenas']) { try { await rest('DELETE', `${tab}?mesa=eq.${m}`); } catch { /* a exclusão da mesa apaga em cascata */ } }
      await rest('DELETE', `mesas?id=eq.${m}`);
      await avisa(m, 0); // quem está na mesa descobre na hora que ela acabou
      await apagarImagens([...imgs].map((n) => `${m}/${n}`));
      return res.status(200).json({ ok: true });
    }
    if (acao === 'cenaExcluir') {
      exigeMestre(c);
      const id = String(b.cenaId || '');
      if (!idOk(id, 2, 8)) throw new Http(400, 'Cena inválida');
      if (id === c.ativa) throw new Http(400, 'Não dá para excluir a cena em que os jogadores estão. Puxe-os para outra antes.');
      const todas = await rest('GET', `cenas?mesa=eq.${m}&select=id,cena`);
      if (todas.length <= 1) throw new Http(400, 'A mesa precisa ter pelo menos uma cena');
      const alvo = todas.find((x) => x.id === id);
      if (!alvo) throw new Http(404, 'Cena não encontrada');
      const tks = await rest('GET', `tokens?mesa=eq.${m}&cena=eq.${id}&select=dados`);
      await rest('DELETE', `tokens?mesa=eq.${m}&cena=eq.${id}`);
      await rest('DELETE', `nevoa?mesa=eq.${m}&cena=eq.${id}`);
      await rest('DELETE', `cenas?mesa=eq.${m}&id=eq.${id}`);
      await bump(m);
      if (alvo.cena.img) await apagarImagem(`${m}/${alvo.cena.img}`);
      for (const img of new Set(tks.map((t) => t.dados.img).filter(Boolean))) await apagaImagemTokenSeOrfa(m, img);
      const cenasRestantes = await rest('GET', `cenas?mesa=eq.${m}&select=cena`);
      for (const img of new Set((alvo.cena.elementos || []).map((e) => e.img).filter(Boolean))) if (!cenasRestantes.some((x) => (x.cena.elementos || []).some((e) => e.img === img))) await apagarImagem(`${m}/${img}`);
      return res.status(200).json({ ok: true });
    }

    if (['musicaTocar', 'musicaPausar', 'musicaRetomar', 'musicaParar'].includes(acao)) {
      exigeMestre(c);
      await acaoMusica(c, acao, b);
      return res.status(200).json({ ok: true });
    }

    if (acao === 'rolar') {
      const r = rolarDados(b.expr);
      const [jg] = await rest('GET', `jogadores?mesa=eq.${m}&id=eq.${c.pid}&select=dados`);
      const nome = (jg && jg.dados && jg.dados.nome) || 'Jogador';
      await rest('POST', 'rolagens', { corpo: { mesa: m, dados: { t: Date.now(), a: nome, ...r } }, prefer: 'return=minimal' });
      await limita('rolagens', `mesa=eq.${m}`, MAX_LOG);
      await bump(m);
      return res.status(200).json({ ok: true, ...r });
    }

    throw new Http(400, 'Ação desconhecida');
  } catch (e) {
    if (e.http) return res.status(e.http).json({ erro: e.message });
    if (e.message === 'SEM_BANCO') return res.status(500).json({ erro: 'Banco de dados não configurado (veja o README, passo do Supabase).' });
    if (/Supabase.*chat/i.test(e.message)) return res.status(500).json({ erro: 'Rode supabase/migracao-v7-recursos.sql no Supabase para ativar o chat.' });
    console.error(e);
    const bd = /^Supabase/.test(e.message);
    return res.status(500).json({ erro: bd ? 'Erro no banco de dados. Se o projeto Supabase está pausado, reative-o no painel (veja o README). Se atualizou de versão, rode o migracao-v3.sql.' : 'Erro no servidor' });
  }
}
