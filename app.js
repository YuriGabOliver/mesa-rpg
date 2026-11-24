import { Mapa } from './mapa.js';
import { criaMusica } from './musica.js';
import { Clima, TIPOS as TIPOS_CLIMA } from './clima.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};
const AL = 'abcdefghjkmnpqrstuvwxyz23456789';
const novoId = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => AL[b % AL.length]).join('');
const POLL_ATIVO = 1500, POLL_PARADO = 3500, POLL_ESCONDIDO = 8000, JANELA_ATIVA = 20000; // ms
const SB_VERSOES = ['2.45.4', '2.39.7']; // supabase-js (UMD) no jsDelivr; tenta a próxima se a primeira não existir
const CORES = ['#c0392b', '#2e86c1', '#27ae60', '#d4ac0d', '#8e44ad', '#e67e22', '#16a085', '#7f8c8d'];

const E = { m: null, mk: '', pid: ls.get('ml.pid', null) || novoId(16), nome: ls.get('ml.nome', ''), v: 0, est: null, pend: 0,
  vendo: '', polling: false, again: false, timer: null, falhas: 0, aba: 'dados', sel: null, adiaPainel: false, painel: innerWidth >= 800, menuTk: null, menuOrigin: null };
ls.set('ml.pid', E.pid);
window.__E = E; // depuração
let mapa = null, CFG = null, clima = null;
async function carregaConfig() {
  if (CFG) return CFG;
  const r = await fetch('/api/config'); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'Servidor não configurado');
  CFG = j; return CFG;
}
const urlToken = (t) => (t && t.img ? `${CFG.url}/storage/v1/object/public/mapas/${E.m}/${t.img}` : null);
const urlImagem = (img) => (img ? `${CFG.url}/storage/v1/object/public/mapas/${E.m}/${img}` : null);

/* ---------- Realtime (opcional): o servidor avisa quando algo muda; o polling vira só rede de segurança ---------- */
function carregaScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
async function carregaSupabase() {
  if (window.supabase) return true;
  for (const v of SB_VERSOES) { try { await carregaScript(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${v}/dist/umd/supabase.js`); if (window.supabase) return true; } catch { /* tenta a próxima */ } }
  return false;
}
function fechaRealtime() { E.rtOk = false; if (E.canal && E.sb) { try { E.sb.removeChannel(E.canal); } catch { /* ok */ } } E.canal = null; }
async function iniciaRealtime(m) {
  fechaRealtime();
  if (!CFG || !CFG.anon || !(await carregaSupabase()) || E.m !== m) return;
  try {
    E.sb = E.sb || window.supabase.createClient(CFG.url, CFG.anon, { auth: { persistSession: false, autoRefreshToken: false } });
    let deb = null;
    E.canal = E.sb.channel(`mesa-${m}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'mudou' }, () => { clearTimeout(deb); deb = setTimeout(() => poll(true), 30); })
      .subscribe((status) => { E.rtOk = status === 'SUBSCRIBED'; if (E.rtOk) poll(true); atualizaSync(); });
  } catch { E.rtOk = false; }
}
function atualizaSync() { const el = $('#m-sync'); if (el) el.textContent = E.rtOk ? 'Sincronização: tempo real ativo.' : 'Sincronização: consulta periódica (alguns segundos de atraso).'; }

/* ---------- utilidades ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); toast('Link copiado'); }
  catch { const a = document.createElement('textarea'); a.value = texto; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); toast('Link copiado'); } catch { toast('Copie manualmente'); } a.remove(); }
}
async function api(acao, dados = {}) {
  E.pend++;
  try {
    const r = await fetch('/api/mesa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, m: E.m, mk: E.mk, pid: E.pid, c: E.vendo || undefined, ...dados }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
    return j;
  } finally { E.pend--; }
}
const agir = (acao, dados) => { E.ultMud = Date.now(); return api(acao, dados).then((j) => { poll(true); return j; }).catch((e) => { toast(e.message); poll(true); }); };
const souMestre = () => E.est && E.est.papel === 'mestre';
const linkJogador = () => `${location.origin}/?m=${E.m}`;
const linkMestre = () => `${location.origin}/?m=${E.m}#k=${E.mk}`;

/* ---------- música sincronizada (musica.js) ---------- */
const musica = criaMusica({ toast, agir: (a, d) => agir(a, d), souMestre: () => souMestre(), onMudou: () => { atualizaSom(); if (E.aba === 'musica' && E.est) musica.atualiza(souMestre()); } });
function atualizaSom() {
  const b = $('#t-som'), s = musica.resumo();
  if (!b) return;
  b.hidden = !s.ativa;
  b.textContent = s.bloqueado ? '🔇 Ativar som' : s.mudo ? '🔇' : s.tocando ? '🎵' : '⏸';
  b.title = s.bloqueado ? 'O navegador bloqueou o som: toque para ativar' : 'Abrir a música da mesa';
}
$('#t-som').onclick = () => { if (musica.resumo().bloqueado) return musica.desbloquear(); E.aba = 'musica'; desenhaPainel(); alternaPainel(true); };
function recentes(atualiza) {
  let l = ls.get('ml.mesas', []);
  if (atualiza) { l = l.filter((x) => x.m !== atualiza.m); l.unshift({ ...atualiza, t: Date.now() }); l = l.slice(0, 8); ls.set('ml.mesas', l); }
  return l;
}

/* ---------- home ---------- */
function mostraHome(erro) {
  $('#mesa').hidden = true; $('#home').hidden = false;
  history.replaceState(null, '', '/');
  const sp = new URLSearchParams(location.search);
  $('#h-convite').hidden = true; $('#h-principal').hidden = false;
  $('#h-nome').value = E.nome;
  const l = recentes();
  $('#h-recentes').hidden = !l.length;
  $('#h-lista').innerHTML = l.map((x) => `<li><button class="b" data-m="${esc(x.m)}">${esc(x.nome)} <small>(${x.mestre ? 'mestre' : 'jogador'})</small></button></li>`).join('');
  const er = $('#h-erro'); er.hidden = !erro; er.textContent = erro || '';
  sp.delete('m');
}
$('#h-lista').addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b) abreMesa(b.dataset.m, ls.get('ml.mk.' + b.dataset.m, '')); });
$('#h-criar').onclick = async () => {
  const nome = $('#h-nome').value.trim(); if (!nome) return mostraErro('Escreva o seu nome.');
  E.nome = nome; ls.set('ml.nome', nome);
  try {
    const r = await fetch('/api/mesa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'criar', nome: $('#h-mesa').value.trim() || 'Minha mesa' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
    ls.set('ml.mk.' + j.m, j.mk); abreMesa(j.m, j.mk);
  } catch (e) { mostraErro(e.message); }
};
function mostraErro(t) { const er = $('#h-erro'); er.hidden = false; er.textContent = t; }
$('#h-entrar').onclick = () => {
  const nome = $('#h-nome').value.trim(); if (!nome) return mostraErro('Escreva o seu nome.');
  E.nome = nome; ls.set('ml.nome', nome);
  const txt = $('#h-cod').value.trim(); let m = '', mk = '';
  try { const u = new URL(txt); m = u.searchParams.get('m') || ''; mk = new URLSearchParams(u.hash.slice(1)).get('k') || ''; } catch { m = txt; }
  m = m.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!m) return mostraErro('Cole o link ou o código da mesa.');
  if (mk) ls.set('ml.mk.' + m, mk);
  abreMesa(m, mk || ls.get('ml.mk.' + m, ''));
};
$('#hc-entrar').onclick = () => {
  const nome = $('#hc-nome').value.trim(); if (!nome) return mostraErro('Escreva o seu nome.');
  E.nome = nome; ls.set('ml.nome', nome); abreMesa(E.convite, ls.get('ml.mk.' + E.convite, ''));
};

/* ---------- entrar na mesa ---------- */
async function abreMesa(m, mk) {
  E.m = m; E.mk = mk || ''; E.v = 0; E.est = null; E.falhas = 0; E.vendo = ls.get('ml.vendo.' + m, '');
  $('#home').hidden = true; $('#mesa').hidden = false;
  history.replaceState(null, '', `/?m=${m}`);
  if (!mapa) iniciaMapa();
  mapa.setImagem(null); mapa.setTokens([]); mapa.setNevoa([]); musica.estado(null); clima.define(null);
  $('#painel').classList.toggle('fechado', !E.painel);
  try {
    await carregaConfig();
    await api('entrar', { pnome: E.nome });
    await poll(true);
    if (!E.est) return;
    recentes({ m, nome: E.est.nome, mestre: souMestre() });
    agendar(); iniciaRealtime(m);
  } catch (e) { sair(e.message); }
}
function sair(msg) {
  clearTimeout(E.timer); fechaRealtime(); E.m = null; E.est = null; musica.estado(null); musica.fecha(); if (clima) clima.define(null);
  mostraHome(msg);
}

function iniciaMapa() {
  mapa = new Mapa($('#cv'), {
    podeMover: (t) => t.dono === E.pid,
    onMover: (id, x, y) => { api('tokenMove', { id, x, y }).then(() => poll(true)).catch((e) => { toast(e.message); poll(true); }); },
    onNevoa: (op) => agir('nevoaAdd', { ops: [op] }),
    urlToken,
    onSelecionar: (id) => { E.sel = id; marcaSel(); },
    onDuplo: () => { E.aba = 'tokens'; desenhaPainel(); if (!E.painel) alternaPainel(true); },
    onTokenContext: (id, x, y) => abrirMenuToken(id, x, y),
  });
  window.__mapa = mapa; // útil para depuração no console
  clima = new Clima($('#cv-clima'), mapa); clima.ligar(ls.get('ml.clima', true)); window.__clima = clima;
}

/* ---------- sincronização (polling leve) ---------- */
function abrirMenuToken(id, x, y, origem = null) {
  const tk = E.est && E.est.tokens.find((t) => t.id === id);
  if (!tk || (!souMestre() && tk.dono !== E.pid)) return;
  E.menuTk = id; E.menuOrigin = origem;
  $('#tm-titulo').textContent = tk.nome || 'Token';
  const cenas = souMestre() ? (E.est.cenas || []).filter((c) => c.id !== E.est.vendo) : [];
  $('#tm-cena').innerHTML = cenas.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.nome) + '</option>').join('');
  $('#tm-duplicar-wrap').hidden = !cenas.length;
  const menu = $('#token-menu');
  menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(Number(x) || 8, innerWidth - 340)) + 'px';
  menu.style.top = Math.max(8, Math.min(Number(y) || 8, innerHeight - 300)) + 'px';
  requestAnimationFrame(() => {
    const margem = 8, maxX = Math.max(margem, innerWidth - menu.offsetWidth - margem);
    const maxY = Math.max(margem, innerHeight - menu.offsetHeight - margem);
    menu.style.left = Math.max(margem, Math.min(Number(x) || margem, maxX)) + 'px';
    menu.style.top = Math.max(margem, Math.min(Number(y) || margem, maxY)) + 'px';
  });
  $('#tm-fechar').focus({ preventScroll: true });
}
function fechaMenuToken() {
  const menu = $('#token-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true; E.menuTk = null;
  const origem = E.menuOrigin; E.menuOrigin = null;
  if (origem && origem.isConnected) origem.focus({ preventScroll: true });
}
$('#tm-fechar').addEventListener('click', fechaMenuToken);
$('#tm-duplicar').addEventListener('click', () => {
  const id = E.menuTk, cenaId = $('#tm-cena').value;
  if (!id || !cenaId) return;
  fechaMenuToken(); agir('tokenDuplicar', { id, cenaId });
});
$('#tm-guardar').addEventListener('click', () => {
  const id = E.menuTk;
  if (!id) return;
  fechaMenuToken(); agir('tokenGuardar', { id });
});
document.addEventListener('pointerdown', (e) => {
  const menu = $('#token-menu');
  if (!menu.hidden && !menu.contains(e.target)) fechaMenuToken();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechaMenuToken(); });

async function poll(forcar = false) {
  if (!E.m) return;
  if (E.polling) { if (forcar) E.again = true; return; }
  E.polling = true;
  try {
    const t0 = Date.now();
    const r = await fetch(`/api/mesa?m=${E.m}&v=${forcar ? 0 : E.v}&c=${encodeURIComponent(E.vendo || '')}`, { headers: { 'x-mk': E.mk || '', 'x-pid': E.pid }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.agora) musica.relogio(j.agora, t0, Date.now()); // acerta o relógio com o servidor (música no mesmo ponto)
    if (!r.ok) { if (r.status === 404) { sair('Mesa não encontrada. Confira o link.'); return; } throw new Error(j.erro || r.status); }
    E.falhas = 0; $('#t-off').hidden = true;
    if (!j.mesmo && !(E.pend > 0 || mapa.arrastando)) aplica(j);
  } catch { if (++E.falhas >= 3) $('#t-off').hidden = false; }
  finally { E.polling = false; if (E.again) { E.again = false; poll(true); } }
}
function agendar() {
  clearTimeout(E.timer);
  const recente = Date.now() - (E.ultMud || 0) < JANELA_ATIVA;
  E.timer = setTimeout(async () => { await poll(); if (E.m) agendar(); }, document.hidden ? (E.rtOk ? 30000 : POLL_ESCONDIDO) : E.rtOk ? 20000 : recente ? POLL_ATIVO : POLL_PARADO);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && E.m) poll(true); });

function aplica(j) {
  const ant = E.est; E.est = j; E.v = j.v; E.ultMud = Date.now();
  const chave = j.vendo || j.cenaId, antChave = ant && (ant.vendo || ant.cenaId);
  musica.estado(j.musica || null);
  mapa.setMestre(j.papel === 'mestre');
  if (j.papel === 'mestre' && j.vendo !== E.vendo) { E.vendo = j.vendo; ls.set('ml.vendo.' + E.m, j.vendo); }
  if (!ant || ant.cena.img !== j.cena.img || antChave !== chave) mapa.setImagem(urlImagem(j.cena.img));
  mapa.setCena(j.cena); mapa.setTokens(j.tokens); mapa.setNevoa(j.nevoa); clima.define(j.cena.clima || null);
  if (E.menuTk && !j.tokens.some((t) => t.id === E.menuTk)) fechaMenuToken();
  if (antChave && antChave !== chave) {
    E.sel = null; mapa.selecionar(null, false); mapa.centralizar();
    if (j.papel !== 'mestre') toast('O mestre levou a mesa para outra cena');
  }
  if (E.sel) mapa.selecionar(E.sel, false);
  $('#t-nome').textContent = j.nome;
  $('#t-papel').textContent = j.papel === 'mestre' ? 'Mestre' : 'Jogador';
  const tc = $('#t-cena'); tc.hidden = j.papel !== 'mestre'; if (!tc.hidden) tc.textContent = j.cenaNome;
  $('#tool-nevoa').hidden = j.papel !== 'mestre';
  atualizaFaixa();
  if (!ant || ant.papel !== j.papel) desenhaPainel(); else atualizaPainel();
}
function atualizaFaixa() {
  const j = E.est, f = $('#faixa'), longe = !!j && j.papel === 'mestre' && j.vendo !== j.ativa;
  f.hidden = !longe;
  if (longe) { const at = (j.cenas.find((x) => x.id === j.ativa) || {}).nome || '?'; $('#faixa-txt').textContent = `Você está em “${j.cenaNome}”. Os jogadores estão em “${at}” e não veem esta cena.`; }
}
$('#faixa-puxar').onclick = () => agir('cenaPuxar', { cenaId: E.est.vendo });

/* ---------- barra de ferramentas ---------- */
$('#tools').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'tool-centro') return mapa.centralizar();
  mapa.setFerramenta(b.dataset.f);
  document.querySelectorAll('#tools [data-f]').forEach((x) => x.classList.toggle('on', x === b));
  mapa.c.style.cursor = b.dataset.f === 'mover' ? 'grab' : 'crosshair';
  $('#tools-nevoa').hidden = b.dataset.f !== 'nevoa';
});
$('#tools-nevoa').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'n-desfaz') return agir('nevoaDesfazer');
  const g = b.dataset.na ? 'data-na' : 'data-nm'; if (!b.dataset.na && !b.dataset.nm) return;
  document.querySelectorAll(`#tools-nevoa [${g}]`).forEach((x) => x.classList.toggle('on', x === b));
  mapa.setNevoaFerr(b.dataset.na ? { acao: b.dataset.na } : { modo: b.dataset.nm });
});
$('#n-raio').addEventListener('input', (e) => mapa.setNevoaFerr({ raio: +e.target.value }));
function alternaPainel(forca) { E.painel = forca === undefined ? !E.painel : forca; $('#painel').classList.toggle('fechado', !E.painel); }
$('#t-painel').onclick = () => alternaPainel();
$('#t-conv').onclick = () => { E.aba = 'mesa'; desenhaPainel(); alternaPainel(true); };

/* ---------- painel ---------- */
function abas() { return [['dados', 'Dados'], ['tokens', 'Tokens'], ['musica', 'Música'], ...(souMestre() ? [['cenas', 'Cenas'], ['mapa', 'Mapa']] : []), ['mesa', 'Mesa']]; }
function desenhaPainel() {
  if (!abas().some((a) => a[0] === E.aba)) E.aba = 'dados';
  musica.fecha();
  $('#abas').innerHTML = abas().map(([k, n]) => `<button data-a="${k}" class="${k === E.aba ? 'on' : ''}">${n}</button>`).join('');
  const c = $('#conteudo');
  if (E.aba === 'dados') c.innerHTML = `
    <div class="sec"><h3>Rolar dados</h3>
      <div class="dados">${['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '1d100'].map((d) => `<button class="b" data-d="${d}">${d.slice(1)}</button>`).join('')}</div>
      <form id="f-dado"><input id="i-dado" placeholder="Ex.: 2d6+3" autocomplete="off" maxlength="40"><button class="b prim" style="margin:0">Rolar</button></form>
    </div><div class="sec"><h3>Histórico</h3><ul id="log"></ul></div>`;
  else if (E.aba === 'tokens') c.innerHTML = `
    <div class="sec"><h3>Novo token</h3>
      <div class="f-add"><input type="color" id="a-cor" value="${CORES[(E.est ? E.est.tokens.length : 0) % CORES.length]}"><input class="n" id="a-nome" maxlength="12" placeholder="Nome">
        <select id="a-tam"><option value="1">1×1</option><option value="2">2×2</option><option value="3">3×3</option></select>
        <label class="b mini" style="margin:0;display:inline-flex;align-items:center">Imagem<input type="file" id="a-img" accept="image/*" hidden></label><span id="a-img-nome" class="dica" style="margin:0"></span>
        ${souMestre() ? '<select id="a-dono"></select>' : ''}<button class="b prim" id="a-ok">Adicionar</button></div>
      <p class="dica">Aparece no centro da sua tela. Arraste para posicionar. Para trocar a imagem de um token, toque na bolinha dele na lista abaixo.</p>
    </div><div class="sec"><h3>Tokens nesta cena</h3><ul id="lista-tk"></ul></div>
    <div class="sec"><h3>Biblioteca de tokens</h3><p class="dica">Tokens guardados ficam disponíveis para outras cenas. Os ativos em outras cenas podem ser duplicados para esta.</p><ul id="lista-biblioteca"></ul></div>`;
  else if (E.aba === 'musica') c.innerHTML = musica.html(souMestre());
  else if (E.aba === 'cenas') c.innerHTML = `
    <div class="sec"><h3>Cenas</h3>
      <p class="dica">Os jogadores só veem a cena em que você os colocar com “Puxar jogadores”. Você pode abrir e preparar outras cenas sem que eles saibam.</p>
      <ul id="lista-cenas"></ul>
      <div class="f-add"><input class="n" id="cn-nome" maxlength="30" placeholder="Nome da nova cena"><button class="b prim" id="cn-ok">Nova cena</button></div>
    </div>`;
  else if (E.aba === 'mapa') c.innerHTML = `
    <div class="sec"><h3>Imagem do mapa</h3>
      <label class="b" style="display:block;text-align:center;margin:0">Subir imagem<input type="file" id="f-img" accept="image/*" hidden></label>
      <p class="dica" id="img-st">Aceita PNG, JPG ou WebP. É reduzida e comprimida automaticamente (até 2560 px).</p></div>
    <div class="sec"><h3>Grade</h3>
      <label class="linha"><input type="checkbox" id="c-grade"> Mostrar grade</label>
      <label class="linha"><input type="checkbox" id="c-snap"> Encaixar tokens na casa</label>
      <label>Tamanho da casa: <b id="c-size-v"></b> px<input type="range" id="c-size" min="20" max="200"></label>
      <label>Metros por casa<input type="number" id="c-m" min="0.1" step="0.1"></label></div>
    <div class="sec"><h3>Clima</h3>
      <label>Condição<select id="cl-tipo">${TIPOS_CLIMA.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <div id="cl-extra" hidden>
        <label>Direção do vento: <b id="cl-dir-v"></b><input type="range" id="cl-dir" min="0" max="359" value="0"></label>
        <label>Vento: <b id="cl-vento-v"></b><input type="range" id="cl-vento" min="0" max="100" value="20"></label>
        <label>Intensidade: <b id="cl-cob-v"></b><input type="range" id="cl-cob" min="1" max="100" value="50"></label>
      </div>
      <p class="dica">Vale para esta cena e aparece para todos. Cada pessoa pode desligar os efeitos no próprio aparelho (aba Mesa).</p></div>
    <div class="sec"><h3>Névoa de guerra</h3>
      <label class="linha"><input type="checkbox" id="c-nevoa"> Névoa ativa</label>
      <div class="f-add" style="margin-top:8px"><button class="b" id="b-cobrir">Cobrir tudo de novo</button><button class="b" id="b-desfaz">Desfazer última</button></div>
      <p class="dica">Com a névoa ativa, os jogadores só veem o que você revelar com a ferramenta “Revelar” (retângulo, círculo ou pincel; também dá para “Esconder” de novo). Para você ela aparece translúcida. Nos tokens, o campo “Visão” revela sozinho o entorno do token.</p></div>`;
  else c.innerHTML = `
    <div class="sec"><h3>Seu nome</h3><input id="m-nome" maxlength="20" value="${esc(E.nome)}" style="width:100%"></div>
    <div class="sec"><h3>Convidar jogadores</h3>
      <div class="copia"><input readonly id="m-lj" value="${esc(linkJogador())}"><button class="b" data-cp="j">Copiar</button></div>
      <p class="dica">Quem abrir esse link entra como jogador.</p>
      ${souMestre() ? `<h3 style="margin-top:14px">Link do mestre</h3>
      <div class="copia"><input readonly id="m-lm" value="${esc(linkMestre())}"><button class="b" data-cp="m">Copiar</button></div>
      <div class="aviso-box">Guarde este link: ele dá controle total da mesa e é a única forma de voltar como mestre em outro aparelho. Não envie para jogadores.</div>` : ''}
    </div><div class="sec"><h3>Neste aparelho</h3>
      <label class="linha"><input type="checkbox" id="m-clima"> Mostrar efeitos de clima</label>
      <p class="dica">Desligue se a mesa ficar pesada no seu celular. Só afeta você.</p>
    </div><div class="sec"><h3>Na mesa agora</h3><ul id="jogs"></ul><p class="dica" id="m-sync"></p></div>
    <button class="b" id="m-sair">Sair da mesa</button>`;
  atualizaPainel(true);
  if (E.aba === 'musica') musica.abre(souMestre());
}
function podeEditar() { const f = document.activeElement; return !(f && f.closest && f.closest('#lista-tk') && /INPUT|SELECT/.test(f.tagName)); }
function atualizaPainel(forca) {
  const j = E.est; if (!j) return;
  if (!forca && !podeEditar()) { E.adiaPainel = true; return; }
  E.adiaPainel = false;
  if (E.aba === 'dados') {
    $('#log').innerHTML = [...j.log].reverse().map((l) => `<li><b>${esc(l.a)}</b> <small>${esc(l.e)}</small><span class="tot">${l.s}</span><span class="det">${esc(detalhe(l.d))}</span></li>`).join('') || '<li class="dica">Nenhuma rolagem ainda.</li>';
  } else if (E.aba === 'tokens') {
    const dono = $('#a-dono');
    if (dono) { const v = dono.value; dono.innerHTML = '<option value="">Mestre (NPC)</option>' + j.jog.filter((x) => !x.mestre).map((x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join(''); dono.value = v; }
    $('#lista-tk').innerHTML = j.tokens.map((t) => {
      const meu = souMestre() || t.dono === E.pid, nomeDono = t.dono ? (j.jog.find((x) => x.id === t.dono) || {}).nome || '?' : 'Mestre';
      const u = urlToken(t), mini = u ? `<img src="${esc(u)}" alt="">` : `<span class="dot" style="background:${esc(t.cor)}"></span>`;
      return `<li data-id="${esc(t.id)}" class="${E.sel === t.id ? 'sel' : ''}">
        ${meu ? `<label class="thumb" title="Trocar a imagem do token">${mini}<input type="file" class="timg" accept="image/*" hidden></label>
          <input class="n" maxlength="12" value="${esc(t.nome)}">
          <input type="color" class="c" value="${esc(t.cor)}" title="Cor da borda">
          <select class="tam">${[1, 2, 3, 4].map((n) => `<option ${n === t.tam ? 'selected' : ''} value="${n}">${n}×${n}</option>`).join('')}</select>`
        : `<span class="thumb">${mini}</span><span class="ro">${esc(t.nome)}</span>`}
        ${souMestre() ? `<select class="dono"><option value="">Mestre</option>${j.jog.filter((x) => !x.mestre).map((x) => `<option value="${esc(x.id)}" ${x.id === t.dono ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
          <select class="visao" title="Revela a névoa em volta do token">${[[0, 'Sem visão'], [3, 'Visão 3'], [6, 'Visão 6'], [9, 'Visão 9'], [12, 'Visão 12']].map(([n, r]) => `<option value="${n}" ${(t.visao || 0) === n ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <button class="b mini" data-act="vis" title="Mostrar/ocultar para jogadores">${t.vis === false ? 'Oculto' : 'Visível'}</button>` : `<small>${esc(nomeDono)}</small>`}
        <button class="b mini" data-act="ir" title="Ir até o token">Ir</button>
        ${meu && t.img ? '<button class="b mini" data-act="rmimg" title="Tirar a imagem">Sem img</button>' : ''}
        ${meu ? '<button class="b mini" data-act="menu" title="Ações do token">Ações</button>' : ''}</li>`;
    }).join('') || '<li class="dica">Nenhum token nesta cena.</li>';
    const cenaAtual = j.vendo || j.cenaId;
    const nomeCena = (id) => (j.cenas || []).find((x) => x.id === id)?.nome || 'Outra cena';
    $('#lista-biblioteca').innerHTML = (j.biblioteca || []).map((t) => {
      const u = urlToken(t), mini = u ? '<img src="' + esc(u) + '" alt="">' : '<span class="dot" style="background:' + esc(t.cor) + '"></span>';
      const status = t.cena == null ? 'Guardado' : t.cena === cenaAtual ? 'Nesta cena' : (souMestre() ? 'Cena: ' + nomeCena(t.cena) : 'Em outra cena');
      const acao = t.cena == null
        ? '<button class="b mini" data-act="colocar">Colocar aqui</button>'
        : t.cena !== cenaAtual && souMestre()
          ? '<button class="b mini" data-act="dup-cena">Duplicar aqui</button>' : '';
      return '<li data-id="' + esc(t.id) + '"><span class="thumb">' + mini + '</span><span class="lib-nome">' + esc(t.nome) + '</span><small class="tag">' + esc(status) + '</small>' + acao + '</li>';
    }).join('') || '<li class="dica">Biblioteca vazia.</li>';
  } else if (E.aba === 'cenas') {
    $('#lista-cenas').innerHTML = (j.cenas || []).map((x) => `<li data-cid="${esc(x.id)}" class="${x.id === j.vendo ? 'vendo' : ''}">
      <input class="cn" maxlength="30" value="${esc(x.nome)}">
      ${x.id === j.ativa ? '<span class="tag verde">Jogadores aqui</span>' : ''}${x.id === j.vendo ? '<span class="tag azul">Você está aqui</span>' : ''}
      ${x.id === j.vendo ? '' : '<button class="b mini" data-act="ver">Abrir</button>'}
      ${x.id === j.ativa ? '' : '<button class="b mini" data-act="puxar">Puxar jogadores</button><button class="b mini" data-act="cdel" title="Excluir cena">✕</button>'}</li>`).join('');
  } else if (E.aba === 'mapa') {
    const g = j.cena.grade;
    $('#c-grade').checked = g.on; $('#c-snap').checked = g.snap; $('#c-size').value = g.size; $('#c-size-v').textContent = g.size;
    if (document.activeElement !== $('#c-m')) $('#c-m').value = g.m;
    $('#c-nevoa').checked = j.cena.nevoa;
    const cl = j.cena.clima || {}, def = (id, v) => { const e = $(id); if (e && document.activeElement !== e) e.value = v; };
    def('#cl-tipo', cl.tipo || 'nenhum'); def('#cl-dir', cl.dir ?? 0); def('#cl-vento', cl.vento ?? 20); def('#cl-cob', cl.cob ?? 50); climaForm();
  } else if (E.aba === 'musica') {
    musica.atualiza(souMestre());
  } else if (E.aba === 'mesa') {
    atualizaSync(); $('#m-clima').checked = !!ls.get('ml.clima', true);
    $('#jogs').innerHTML = j.jog.map((x) => `<li>${esc(x.nome)} ${x.mestre ? '<span class="tag">Mestre</span>' : ''} ${x.id === E.pid ? '<small>(você)</small>' : ''}</li>`).join('');
  }
}
// lê os controles de clima, atualiza os rótulos e devolve { tipo, dir, vento, cob } (ou null = sem clima)
function climaForm() {
  const tipo = $('#cl-tipo').value, dir = +$('#cl-dir').value, setas = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  $('#cl-extra').hidden = tipo === 'nenhum';
  $('#cl-dir-v').textContent = `${setas[Math.round(dir / 45) % 8]} ${dir}°`;
  $('#cl-vento-v').textContent = $('#cl-vento').value; $('#cl-cob-v').textContent = $('#cl-cob').value;
  return tipo === 'nenhum' ? null : { tipo, dir, vento: +$('#cl-vento').value, cob: +$('#cl-cob').value };
}
function detalhe(d) {
  return (d || []).map((p, i) => {
    const sinal = p.s < 0 ? '−' : (i ? '+' : ''), corpo = p.k !== undefined ? p.k : `[${p.r.join(', ')}]`;
    return (i || p.s < 0 ? ' ' : '') + sinal + (sinal ? ' ' : '') + corpo;
  }).join('').trim();
}
function marcaSel() { document.querySelectorAll('#lista-tk li').forEach((li) => li.classList.toggle('sel', li.dataset.id === E.sel)); }
$('#conteudo').addEventListener('focusout', () => setTimeout(() => { if (E.adiaPainel) atualizaPainel(); }, 50));

/* eventos do painel (delegação) */
$('#abas').addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b) { E.aba = b.dataset.a; desenhaPainel(); } });
const painel = $('#conteudo');
painel.addEventListener('click', (e) => musica.clique(e));
painel.addEventListener('change', (e) => musica.muda(e));
painel.addEventListener('input', (e) => musica.entrada(e));
painel.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.d) return agir('rolar', { expr: t.dataset.d });
  if (t.dataset.cp) return copiar(t.dataset.cp === 'j' ? linkJogador() : linkMestre());
  if (t.id === 'm-sair') return sair();
  if (t.id === 'b-cobrir') return agir('nevoaCobrir');
  if (t.id === 'b-desfaz') return agir('nevoaDesfazer');
  if (t.id === 'cn-ok') {
    const r = await api('cenaNova', { nome: $('#cn-nome').value }).catch((er) => { toast(er.message); });
    if (r && r.id) { E.vendo = r.id; ls.set('ml.vendo.' + E.m, r.id); $('#cn-nome').value = ''; }
    return poll(true);
  }
  const lc = t.closest('li[data-cid]');
  if (lc) {
    const cid = lc.dataset.cid;
    if (t.dataset.act === 'ver') { E.vendo = cid; ls.set('ml.vendo.' + E.m, cid); E.sel = null; return poll(true); }
    if (t.dataset.act === 'puxar') return agir('cenaPuxar', { cenaId: cid });
    if (t.dataset.act === 'cdel' && confirm('Excluir esta cena, com os tokens e a névoa dela?')) return agir('cenaExcluir', { cenaId: cid });
    return;
  }
  if (t.id === 'a-ok') {
    const c = mapa.centro(), tam = +$('#a-tam').value, p = mapa.encaixa({ x: c.x, y: c.y, tam }), arq = $('#a-img').files[0];
    const r = await agir('tokenAdd', { nome: $('#a-nome').value || 'Token', cor: $('#a-cor').value, tam, x: p.x, y: p.y, dono: $('#a-dono') ? $('#a-dono').value : undefined });
    $('#a-nome').value = ''; $('#a-img').value = ''; $('#a-img-nome').textContent = '';
    if (r && r.id && arq) await enviaImgToken(r.id, arq);
    return;
  }
  const li = t.closest('li[data-id]'); if (!li) return;
  const id = li.dataset.id, tk = E.est.tokens.find((x) => x.id === id) || (E.est.biblioteca || []).find((x) => x.id === id);
  if (t.dataset.act === 'menu') {
    const r = t.getBoundingClientRect(); return abrirMenuToken(id, r.right + 8, r.top, t);
  }
  if (t.dataset.act === 'colocar' && tk) {
    const c = mapa.centro(), p = mapa.encaixa({ ...tk, x: c.x, y: c.y });
    return agir('tokenColocar', { id, x: p.x, y: p.y });
  }
  if (t.dataset.act === 'dup-cena' && tk) return agir('tokenDuplicar', { id, cenaId: E.est.vendo });
  if (t.dataset.act === 'del') agir('tokenDel', { id });
  else if (t.dataset.act === 'rmimg') agir('tokenImg', { id, dados: '' });
  else if (t.dataset.act === 'vis') agir('tokenEdit', { id, vis: tk.vis === false });
  else if (t.dataset.act === 'ir' && tk) { mapa.irPara(tk.x, tk.y); mapa.selecionar(id); E.sel = id; marcaSel(); if (innerWidth < 800) alternaPainel(false); }
});
painel.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'f-dado') { const v = $('#i-dado').value.trim(); if (v) { agir('rolar', { expr: v }); $('#i-dado').value = ''; } }
});
painel.addEventListener('change', async (e) => {
  const el = e.target, li = el.closest('li[data-id]'), lc = el.closest('li[data-cid]');
  if (lc && el.classList.contains('cn')) return agir('cenaRenomear', { cenaId: lc.dataset.cid, nome: el.value });
  if (el.id === 'a-img') { $('#a-img-nome').textContent = el.files[0] ? el.files[0].name.slice(0, 18) : ''; return; }
  if (li) {
    const id = li.dataset.id;
    if (el.classList.contains('n')) agir('tokenEdit', { id, nome: el.value });
    else if (el.classList.contains('c')) agir('tokenEdit', { id, cor: el.value });
    else if (el.classList.contains('tam')) agir('tokenEdit', { id, tam: +el.value });
    else if (el.classList.contains('dono')) agir('tokenEdit', { id, dono: el.value });
    else if (el.classList.contains('visao')) agir('tokenEdit', { id, visao: +el.value });
    else if (el.classList.contains('timg')) { const f = el.files[0]; el.value = ''; enviaImgToken(id, f); }
    return;
  }
  if (el.id === 'm-nome') { E.nome = el.value.trim() || E.nome; ls.set('ml.nome', E.nome); return agir('entrar', { pnome: E.nome }); }
  if (el.id === 'f-img') return sobeImagem(el.files[0]);
  if (el.id === 'm-clima') { ls.set('ml.clima', el.checked); return clima.ligar(el.checked); }
  if (el.id && el.id.startsWith('cl-')) return agir('cena', { clima: climaForm() });
  if (['c-grade', 'c-snap', 'c-size', 'c-m'].includes(el.id)) {
    return agir('cena', { grade: { on: $('#c-grade').checked, snap: $('#c-snap').checked, size: +$('#c-size').value, m: +$('#c-m').value || 1.5 } });
  }
  if (el.id === 'c-nevoa') return agir('cena', { nevoa: el.checked, grade: E.est.cena.grade });
});
painel.addEventListener('input', (e) => {
  if (e.target.id === 'c-size') $('#c-size-v').textContent = e.target.value;
  if (e.target.id && e.target.id.startsWith('cl-')) clima.define(climaForm()); // prévia na hora; só envia ao soltar (evento change)
});

/* ---------- imagem do token (recorte quadrado 256×256) ---------- */
async function comprimirToken(file) {
  const bmp = await createImageBitmap(file), lado = Math.min(bmp.width, bmp.height), cv = document.createElement('canvas');
  cv.width = cv.height = 256; cv.getContext('2d').drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  for (let q = 0.88; q > 0.3; q -= 0.2) {
    let blob = await new Promise((r) => cv.toBlob(r, 'image/webp', q));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 280000) return blob;
  }
  throw new Error('Imagem difícil de comprimir');
}
async function enviaImgToken(id, file) {
  if (!file) return;
  try {
    const blob = await comprimirToken(file);
    const dados = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(blob); });
    await api('tokenImg', { id, dados, mime: blob.type });
    poll(true);
  } catch (e) { toast('Imagem do token: ' + e.message); }
}

/* ---------- upload da imagem do mapa ---------- */
async function comprimir(file) {
  const bmp = await createImageBitmap(file);
  let lado = 2560;
  for (let tent = 0; tent < 6; tent++) {
    const k = Math.min(1, lado / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    let q = 0.85;
    for (let i = 0; i < 4; i++) {
      let blob = await new Promise((r) => cv.toBlob(r, 'image/webp', q));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 2200000) return { blob, w, h };
      q -= 0.15;
    }
    lado *= 0.75;
  }
  throw new Error('Imagem grande demais, tente uma menor');
}
async function sobeImagem(file) {
  if (!file) return;
  const st = $('#img-st'); st.textContent = 'Preparando a imagem…';
  try {
    const { blob, w, h } = await comprimir(file);
    st.textContent = `Enviando (${(blob.size / 1024).toFixed(0)} KB)…`;
    const dados = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(blob); });
    await api('imagem', { dados, mime: blob.type, w, h });
    st.textContent = 'Imagem enviada.'; poll(true);
  } catch (e) { st.textContent = 'Falhou: ' + e.message; }
}

/* ---------- início ---------- */
(function inicio() {
  const sp = new URLSearchParams(location.search), m = (sp.get('m') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const k = new URLSearchParams(location.hash.slice(1)).get('k');
  if (m && k) { ls.set('ml.mk.' + m, k); history.replaceState(null, '', `/?m=${m}`); }
  if (!m) return mostraHome();
  if (E.nome) return abreMesa(m, ls.get('ml.mk.' + m, ''));
  E.convite = m;
  $('#h-principal').hidden = true; $('#h-convite').hidden = false; $('#hc-nome').focus();
})();
