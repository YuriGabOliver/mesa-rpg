# 🗺️ Mesa Leve

Mesa virtual leve para RPG: **mapa com tokens, névoa de guerra, régua, grade e dados**, sem cadastro.
O mestre cria a mesa, sobe um mapa e manda o link; os jogadores entram pelo celular.

Projeto **independente**. Usa **Supabase** (banco, imagens e tempo real) e **Vercel** (site e API).

## O que tem na versão 0.4

- **Música sincronizada** (aba **Música**): o mestre monta uma biblioteca de links de áudio (Dropbox ou outro link público e direto), com título e tags, busca, importar e exportar CSV (mesmo formato do Tracks do Owlbear). Toca, pausa, retoma e para para todos. Todo mundo ouve o mesmo ponto da faixa, em loop, e quem entra depois já cai no ponto certo. Volume e mudo são de cada pessoa. Nada de áudio passa pela mesa: ela só guarda o link e a hora do servidor, então pesa quase nada.

## O que tem na versão 0.3

- Criar mesa (você vira o mestre) e convidar por link, sem login
- Mapa: subir imagem (comprimida automaticamente), grade ajustável, zoom e pinça no celular
- Tokens: arrastar, encaixar na casa, 1×1 a 4×4, cor e nome, dono (jogador ou mestre), ocultar do jogador
- Névoa de guerra: o mestre revela áreas; os jogadores só veem o revelado
- Régua (em casas e em metros)
- Dados com histórico compartilhado (ex.: `2d6+3`), sorteados no servidor
- **Tempo real** (Supabase Realtime): o que um move aparece para os outros em menos de 1 segundo
- Cada jogador só mexe nos próprios tokens (até 3); o mestre mexe em tudo
- **Cenas:** cada cena tem seu mapa, grade, tokens e névoa. Você abre e prepara qualquer cena; os jogadores só veem a cena em que você clicar em “Puxar jogadores”
- **Imagem nos tokens:** envie uma imagem (recorte quadrado automático) ao criar o token ou depois, tocando na bolinha dele na lista
- **Névoa melhorada:** revelar ou esconder com retângulo, círculo ou pincel; bordas suaves; desfazer; “Visão” por token (revela o entorno sozinho)

## Como funciona

```
Navegador ──(ações e leitura)──▶ Função do Vercel (api/) ──▶ Supabase (Postgres + Storage)
    ▲                                   │ valida permissões
    └──────── aviso "mudou" ◀───────────┴─ Supabase Realtime (broadcast)
```

- O navegador **nunca** fala direto com as tabelas. Só a função do Vercel, com a chave secreta, lê e escreve. É ela que confere quem é mestre e quem pode mexer em qual token.
- O Realtime só avisa "mudou"; o navegador então busca o estado novo. Se o Realtime falhar, o site continua funcionando por consulta periódica (alguns segundos de atraso).
- Imagens dos mapas ficam no Supabase Storage (bucket público `mapas`, nomes aleatórios).

## Atualizando para a v0.4 (música)

1. **Banco:** no Supabase, **SQL Editor → New query**, cole `supabase/migracao-v4-musica.sql` e clique em **Run** (adiciona uma coluna; não apaga nada).
2. **Código:** envie os arquivos novos para o repositório (inclui o novo `musica.js`). O Vercel publica sozinho.
3. Se publicar o código antes de rodar o SQL, a mesa continua funcionando; só a música avisa que falta a migração.

## Atualizando da v0.2 para a v0.3

1. **Primeiro o banco:** no Supabase, **SQL Editor → New query**, cole o conteúdo de `supabase/migracao-v3.sql` e clique em **Run**. Suas mesas atuais viram a “Cena 1”, sem perder nada.
2. **Depois o código:** envie os arquivos novos para o repositório (mesmos nomes, substituindo). O Vercel publica sozinho.
3. Não precisa mexer nas variáveis de ambiente.

Começando do zero? Use só o `schema.sql` (ele já inclui tudo).

## Testar no seu computador (sem Vercel e sem Supabase)

Precisa do Node 18 ou mais novo.

```
node scripts/dev.mjs
```

Abra http://localhost:3000. Usa um Supabase falso em memória; os dados somem ao fechar. (O tempo real fica desligado nesse modo.)

## Publicar

### 1. GitHub
Crie um repositório novo e envie todos os arquivos para a **raiz** (o `index.html` tem que aparecer na primeira tela do repositório).

### 2. Supabase
1. Em supabase.com, **New project**. Escolha um nome, defina uma senha do banco (guarde) e, em região, *South America (São Paulo)*. Plano gratuito. Espere uns 2 minutos até o projeto ficar pronto.
2. No menu da esquerda, abra **SQL Editor → New query**. Abra o arquivo `supabase/schema.sql` deste projeto, copie **tudo**, cole e clique em **Run**. Deve aparecer *Success*. Isso cria as tabelas, liga a segurança, libera o acesso do servidor e cria o bucket `mapas`.
3. Pegue as chaves em **Project Settings → API** (ou **API Keys**):
   - **Project URL** (algo como `https://abcdxyz.supabase.co`)
   - **Publishable key** (ou `anon`): é a chave pública
   - **Secret key** (ou `service_role`): é a chave secreta. **Nunca** coloque no GitHub nem no navegador.
4. Em **Project Settings → Realtime** (ou *Realtime → Settings*), confira se **Allow public access** está ligado. Se estiver desligado, o tempo real não conecta (o site ainda funciona sem ele).

### 3. Vercel
1. **Add New… → Project**, escolha o repositório. *Framework Preset*: **Other**. Ainda não clique em Deploy.
2. Abra **Environment Variables** e crie estas três (marque Production, Preview e Development):

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | o Project URL |
| `SUPABASE_ANON_KEY` | a chave publishable / anon |
| `SUPABASE_SERVICE_ROLE_KEY` | a chave secret / service_role |

3. Clique em **Deploy**. Se já tinha feito o deploy antes das variáveis, vá em **Deployments → ⋯ → Redeploy**.

### 4. Testar
1. Abra o endereço do projeto e crie uma mesa.
2. Em **Mesa**, veja a linha *Sincronização*: deve dizer **tempo real ativo**.
3. Abra o link dos jogadores em outra aba anônima ou no celular.
4. Em **Mapa → Subir imagem**, envie um mapa. Adicione um token e arraste. Do outro lado ele deve se mover na hora.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| “Supabase não configurado” / “Banco de dados não configurado” | Falta alguma das 3 variáveis, ou falta o Redeploy depois de criá-las |
| “Erro no banco de dados” (log do Vercel: `permission denied`, 403) | Rode o `schema.sql` de novo: ele inclui os `grant` para a chave secreta |
| “Erro no banco de dados” (outros) | Rode o `schema.sql` (tabela não existe), ou o projeto gratuito foi **pausado** por ficar 7 dias sem uso: abra o painel do Supabase e clique em *Restore project* |
| Mapa sobe mas não aparece | O bucket `mapas` não existe (rode o `schema.sql` de novo) ou `SUPABASE_URL` está errada |
| Diz “consulta periódica” em vez de tempo real | Confira *Allow public access* no Realtime e se `SUPABASE_ANON_KEY` está preenchida. Funciona assim mesmo, só com atraso |
| Jogador não vê um token | Tokens ocultos só aparecem para o mestre, e cada token pertence a uma cena |
| “Mesa sem cena” ou erro depois de atualizar | Rode o `migracao-v3.sql` no Supabase |
| Perdi o link do mestre | Só o link com `#k=...` dá controle em outro aparelho. No aparelho original ele fica salvo no navegador |

## Limites e cuidados

- Quem tem o link da mesa entra como jogador. O link do mestre (com `#k=`) dá controle total: não envie para jogadores.
- A névoa esconde o mapa na tela, mas a imagem inteira é baixada pelo navegador dos jogadores. É segurança de mesa de amigos.
- Plano gratuito do Supabase: 500 MB de banco, 1 GB de imagens, pausa após 7 dias sem uso. Mesas antigas não são apagadas sozinhas. Para limpar manualmente, rode no SQL Editor: `delete from public.mesas where usado < now() - interval '120 days';` (as imagens dessas mesas continuam no Storage; apague a pasta pelo painel).
- Nunca publique a chave secret/service_role. Se vazar, gere outra em *API Keys*.

## Próximos passos possíveis

Clima (chuva, neblina, etc.), sistema de extensões, fichas por template (sacramento e gaia como sistemas), compêndio de regras, ping, desenho livre, mover token ao vivo durante o arrasto.
