-- Mesa Leve v0.3 (cenas, imagens nos tokens, névoa nova).
-- PARA QUEM JÁ TEM O BANCO DA v0.2: cole tudo no SQL Editor e clique em Run. Pode rodar mais de uma vez.
-- (Quem está começando do zero usa só o schema.sql, que já inclui isto.)

create table if not exists public.cenas (
  id    text not null,
  mesa  text not null references public.mesas(id) on delete cascade,
  nome  text not null,
  cena  jsonb not null,          -- imagem, tamanho, grade, névoa ligada/desligada
  ordem int  not null default 0,
  primary key (mesa, id)
);
alter table public.cenas enable row level security;
grant all on public.cenas to service_role;

alter table public.mesas  add column if not exists ativa text;   -- cena em que os jogadores estão
alter table public.tokens add column if not exists cena  text;
alter table public.nevoa  add column if not exists cena  text;
create index if not exists tokens_cena_idx on public.tokens (mesa, cena);
create index if not exists nevoa_cena_idx  on public.nevoa  (mesa, cena, id);

-- a coluna antiga mesas.cena deixa de ser usada; precisa aceitar valor padrão
alter table public.mesas alter column cena set default '{}'::jsonb;

-- converte as mesas que já existem: cada uma ganha a "Cena 1" com o mapa que já tinha
insert into public.cenas (id, mesa, nome, cena, ordem)
  select 'c1', id, 'Cena 1', cena, 0 from public.mesas
  on conflict (mesa, id) do nothing;
update public.mesas  set ativa = 'c1' where ativa is null;
update public.tokens set cena  = 'c1' where cena  is null;
update public.nevoa  set cena  = 'c1' where cena  is null;
