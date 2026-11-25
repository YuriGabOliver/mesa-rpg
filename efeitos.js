// Central de efeitos e ambiencias: varias faixas sincronizadas em paralelo a musica.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
function normalizaUrl(txt) { let u; try { u = new URL(String(txt || '').trim()); } catch { return null; } if (u.protocol !== 'https:' || u.hostname === 'drive.google.com') return null; if (u.hostname === 'dropbox.com' || u.hostname.endsWith('.dropbox.com')) { u.hostname = 'dl.dropboxusercontent.com'; u.searchParams.set('dl', '1'); } return u.href; }
export function criaEfeitos(deps) {
  let ativos = [], skew = 0, expiraTimer = null, vol = Math.min(1, Math.max(0, Number(ls.get('ml.efeitos.vol', .7)))), mudo = !!ls.get('ml.efeitos.mudo', false), bloqueado = false;
  let lib = ls.get('ml.efeitos.lib', []).filter((x) => x?.url && x.titulo), audios = new Map(), finalizados = new Set();
  const salva = () => ls.set('ml.efeitos.lib', lib);
  function relogio(servidor, t0, t1) { skew = servidor + (t1 - t0) / 2 - t1; }
  function posiciona(a, f) { if (a.readyState < 1) return; const pos = Math.max(0, (Date.now() + skew - f.t) / 1000); try { a.currentTime = f.loop ? pos % f.dur : Math.min(pos, f.dur); } catch {} }
  function executa(f) {
    let a = audios.get(f.id);
    if (!f.loop && finalizados.has(f.id)) return;
    if (!a) { a = new Audio(f.url); a.preload = 'auto'; a.loop = !!f.loop; a.volume = vol; a.muted = mudo; audios.set(f.id, a); a.addEventListener('loadedmetadata', () => posiciona(a, f)); a.addEventListener('ended', () => finalizados.add(f.id)); a.addEventListener('error', () => deps.toast(`Não consegui abrir “${f.titulo}”. Confira o link público.`)); }
    if (a.src !== f.url) a.src = f.url;
    if (a.readyState >= 1) { const pos = Math.max(0, (Date.now() + skew - f.t) / 1000), esperado = f.loop ? pos % f.dur : Math.min(pos, f.dur); if (Math.abs(a.currentTime - esperado) > .7) posiciona(a, f); }
    if (a.paused && (f.loop || Date.now() + skew < f.t + f.dur * 1000)) a.play().then(() => { if (bloqueado) { bloqueado = false; deps.onMudou(); } }).catch(() => { bloqueado = true; deps.onMudou(); });
  }
  function estado(lista, servidorAgora) {
    ativos = Array.isArray(lista) ? lista : []; if (Number.isFinite(servidorAgora)) skew = servidorAgora - Date.now();
    clearTimeout(expiraTimer);
    const ids = new Set(ativos.map((x) => x.id));
    for (const [id, a] of audios) if (!ids.has(id)) { a.pause(); a.removeAttribute('src'); a.load(); audios.delete(id); finalizados.delete(id); }
    ativos.forEach((f) => { if (f.loop || Date.now() + skew < f.t + f.dur * 1000) executa(f); });
    const proximo = ativos.filter((f) => !f.loop).reduce((m, f) => Math.min(m, f.t + f.dur * 1000), Infinity);
    if (Number.isFinite(proximo)) expiraTimer = setTimeout(() => estado(ativos.filter((f) => f.loop || Date.now() + skew < f.t + f.dur * 1000)), Math.max(20, proximo - Date.now() - skew + 40));
    atualiza(); deps.onMudou();
  }
  document.addEventListener('pointerdown', () => { if (bloqueado) ativos.forEach(executa); }, { capture: true });
  function html(mestre) { return `<div class="sec"><h3>Sons ativos</h3><div id="ef-ativos"></div><div class="mu-vol"><button class="b mini" data-ef="mudo">${mudo ? 'Ativar' : 'Silenciar'}</button><input type="range" id="ef-vol" min="0" max="100" value="${Math.round(vol * 100)}" aria-label="Volume dos efeitos"></div><p class="dica">Volume e silêncio afetam só este aparelho. Efeitos tocam junto com a música.</p></div>${mestre ? `<div class="sec"><h3>Biblioteca de efeitos</h3><ul id="ef-lista"></ul><div class="f-add"><button class="b" data-ef="novo">Adicionar som</button></div><div id="ef-form" hidden><input id="ef-tit" maxlength="60" placeholder="Nome do som"><input id="ef-url" placeholder="Link público direto (https://…)" autocomplete="off"><label class="linha"><input type="checkbox" id="ef-loop"> Som contínuo / ambiente</label><button class="b prim" data-ef="salvar">Salvar som</button></div><p class="dica">Biblioteca guardada neste navegador. Use links públicos diretos; Dropbox funciona.</p></div>` : ''}`; }
  function atualiza() { const el = $('#ef-ativos'); if (!el) return; el.innerHTML = ativos.length ? ativos.map((f) => `<div class="ef-ativo"><span>${esc(f.titulo)}${f.loop ? ' · contínuo' : ''}</span>${deps.souMestre() ? `<button class="b mini" data-ef="parar" data-id="${esc(f.id)}">Parar</button>` : ''}</div>`).join('') + (deps.souMestre() ? '<button class="b mini" data-ef="parar-todos">Parar todos os sons</button>' : '') : '<p class="dica">Nenhum efeito tocando.</p>'; const ul = $('#ef-lista'); if (ul) ul.innerHTML = lib.map((f, i) => `<li><span class="lib-nome">${esc(f.titulo)}</span><button class="b mini" data-ef="tocar" data-i="${i}">Tocar</button><button class="b mini" data-ef="del" data-i="${i}">Remover</button></li>`).join('') || '<li class="dica">Biblioteca vazia.</li>'; }
  function clique(e) { const b = e.target.closest('[data-ef]'); if (!b) return; const ac = b.dataset.ef; if (ac === 'mudo') { mudo = !mudo; ls.set('ml.efeitos.mudo', mudo); audios.forEach((a) => a.muted = mudo); atualiza(); return; } if (!deps.souMestre()) return; if (ac === 'novo') { $('#ef-form').hidden = !$('#ef-form').hidden; return; } if (ac === 'salvar') { const titulo = $('#ef-tit').value.trim(), url = normalizaUrl($('#ef-url').value); if (!titulo || !url) return deps.toast('Informe um nome e um link HTTPS válido'); lib.unshift({ titulo: titulo.slice(0, 60), url, loop: $('#ef-loop').checked }); lib = lib.slice(0, 100); salva(); $('#ef-tit').value = ''; $('#ef-url').value = ''; $('#ef-form').hidden = true; atualiza(); return; } if (ac === 'del') { lib.splice(+b.dataset.i, 1); salva(); atualiza(); return; } if (ac === 'parar') return deps.agir('efeitoParar', { id: b.dataset.id }); if (ac === 'parar-todos') return deps.agir('efeitosParar'); if (ac === 'tocar') { const f = lib[+b.dataset.i], a = new Audio(); a.onloadedmetadata = () => { if (a.duration > 0 && Number.isFinite(a.duration)) deps.agir('efeitoTocar', { ...f, dur: a.duration }); else deps.toast('Este áudio não informa sua duração.'); }; a.onerror = () => deps.toast('Confira o link público direto do áudio.'); a.src = f.url; } }
  function muda(e) { if (e.target.id !== 'ef-vol') return; vol = +e.target.value / 100; ls.set('ml.efeitos.vol', vol); audios.forEach((a) => a.volume = vol); }
  return { relogio, estado, html, atualiza, clique, muda, desbloquear: () => ativos.forEach(executa), resumo: () => ({ ativos: ativos.length, bloqueado }) };
}
