-- Mesa Leve: tabelas e bucket de imagens.
-- Cole TUDO isto no Supabase: menu "SQL Editor" -> "New query" -> Run.
-- Pode rodar de novo sem problema (não apaga nada que já existe).

create table if not exists public.mesas (
  id     text primary key,
  nome   text not null,
  h      text not null,                 -- hash da chave do mestre (a chave em si nunca é guardada)
  cena   jsonb not null,                -- imagem, tamanho, grade, névoa ligada/desligada
  v      bigint not null default 1,     -- muda a cada alteração; os clientes comparam para saber se precisam atualizar
  criado timestamptz not null default now(),
  usado  timestamptz not null default now()
);

create table if not exists public.tokens (
  mesa  text not null references public.mesas(id) on delete cascade,
  id    text not null,
  dados jsonb not null,
  primary key (mesa, id)
);

create table if not exists public.jogadores (
  mesa  text not null references public.mesas(id) on delete cascade,
  id    text not null,
  dados jsonb not null,
  primary key (mesa, id)
);

create table if not exists public.nevoa (
  id   bigint generated always as identity primary key,
  mesa text not null references public.mesas(id) on delete cascade,
  rect jsonb not null
);
create index if not exists nevoa_mesa_idx on public.nevoa (mesa, id);

create table if not exists public.rolagens (
  id    bigint generated always as identity primary key,
  mesa  text not null references public.mesas(id) on delete cascade,
  dados jsonb not null
);
create index if not exists rolagens_mesa_idx on public.rolagens (mesa, id);

-- Segurança: RLS ligada e SEM políticas = ninguém acessa pelo navegador.
-- Só o servidor (função do Vercel, com a chave secreta) lê e escreve.
alter table public.mesas      enable row level security;
alter table public.tokens     enable row level security;
alter table public.jogadores  enable row level security;
alter table public.nevoa      enable row level security;
alter table public.rolagens   enable row level security;

-- Bucket público para as imagens dos mapas (até 5 MB, só imagem).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mapas', 'mapas', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
