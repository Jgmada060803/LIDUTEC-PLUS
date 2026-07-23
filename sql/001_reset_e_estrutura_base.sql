
-- LIDUTEC+ | Estrutura base do banco
-- Arquivo: 001_reset_e_estrutura_base.sql
-- ATENÇÃO: este script apaga as tabelas públicas listadas abaixo e todos os dados nelas.
-- Ele NÃO apaga os usuários do Supabase Auth (auth.users).

begin;

-- =========================================================
-- 1. REMOÇÃO DA ESTRUTURA ANTIGA
-- =========================================================
drop table if exists public.alteracoes_revisao cascade;
drop table if exists public.aprovacoes_ficha cascade;
drop table if exists public.valores_parametros cascade;
drop table if exists public.parametros cascade;
drop table if exists public.grupos_parametros cascade;
drop table if exists public.especificacoes_embalagem cascade;
drop table if exists public.documentos_produto cascade;
drop table if exists public.fichas_tecnicas cascade;
drop table if exists public.registros_ce cascade;
drop table if exists public.panelas cascade;
drop table if exists public.maquinas cascade;
drop table if exists public.produtos cascade;
drop table if exists public.familias_produto cascade;
drop table if exists public.clientes cascade;
drop table if exists public.notificacoes cascade;
drop table if exists public.auditoria cascade;
drop table if exists public.solicitacoes_produto cascade;
drop table if exists public.produtos_historico cascade;
drop table if exists public.usuarios cascade;

drop function if exists public.atualizar_atualizado_em() cascade;

-- =========================================================
-- 2. FUNÇÃO PADRÃO DE ATUALIZAÇÃO
-- =========================================================
create or replace function public.atualizar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

-- =========================================================
-- 3. USUÁRIOS E ACESSOS
-- =========================================================
create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  perfil text not null default 'VISUALIZADOR'
    check (perfil in ('ADMINISTRADOR','ENGENHARIA','QUALIDADE','OPERADOR','VISUALIZADOR')),
  status text not null default 'PENDENTE'
    check (status in ('PENDENTE','ATIVO','BLOQUEADO','INATIVO')),
  autorizado_por uuid references public.usuarios(id),
  data_autorizacao timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger trg_usuarios_atualizado
before update on public.usuarios
for each row execute function public.atualizar_atualizado_em();

-- =========================================================
-- 4. CADASTROS MESTRES
-- =========================================================
create table public.clientes (
  id bigint generated always as identity primary key,
  nome text not null unique,
  codigo text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger trg_clientes_atualizado
before update on public.clientes
for each row execute function public.atualizar_atualizado_em();

create table public.familias_produto (
  id bigint generated always as identity primary key,
  nome text not null unique,
  descricao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger trg_familias_atualizado
before update on public.familias_produto
for each row execute function public.atualizar_atualizado_em();

create table public.maquinas (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  nome text not null,
  setor text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger trg_maquinas_atualizado
before update on public.maquinas
for each row execute function public.atualizar_atualizado_em();

create table public.panelas (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  descricao text,
  capacidade_kg numeric(12,3),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger trg_panelas_atualizado
before update on public.panelas
for each row execute function public.atualizar_atualizado_em();

-- =========================================================
-- 5. PRODUTOS
-- =========================================================
create table public.produtos (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  nome text not null,
  cliente_id bigint references public.clientes(id),
  familia_id bigint references public.familias_produto(id),
  codigo_cliente text,
  part_number text,
  codigo_ferramental text,
  peca_seguranca boolean not null default false,
  peso_peca_kg numeric(12,3),
  peso_cacho_kg numeric(12,3),
  cavidades_molde integer check (cavidades_molde is null or cavidades_molde > 0),
  rendimento_metalico_pct numeric(7,3)
    check (rendimento_metalico_pct is null or rendimento_metalico_pct between 0 and 100),
  status text not null default 'ATIVO'
    check (status in ('ATIVO','INATIVO','EM_DESENVOLVIMENTO','OBSOLETO')),
  imagem_principal_url text,
  criado_por uuid references public.usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index idx_produtos_cliente on public.produtos(cliente_id);
create index idx_produtos_familia on public.produtos(familia_id);
create index idx_produtos_status on public.produtos(status);

create trigger trg_produtos_atualizado
before update on public.produtos
for each row execute function public.atualizar_atualizado_em();

-- =========================================================
-- 6. FICHAS TÉCNICAS E REVISÕES
-- Cada revisão é uma linha independente.
-- A revisão vigente é marcada com vigente = true.
-- =========================================================
create table public.fichas_tecnicas (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.produtos(id) on delete cascade,
  tipo text not null
    check (tipo in ('MOLDAGEM','FUSAO_VAZAMENTO','METALURGIA','EMBALAGEM','QUALIDADE','OUTRA')),
  codigo_documento text,
  numero_revisao integer not null default 0 check (numero_revisao >= 0),
  status text not null default 'RASCUNHO'
    check (status in ('RASCUNHO','EM_APROVACAO','APROVADA','REPROVADA','OBSOLETA')),
  vigente boolean not null default false,
  data_emissao date,
  descricao_revisao text,
  motivo_revisao text,
  ficha_anterior_id bigint references public.fichas_tecnicas(id),
  elaborado_por uuid references public.usuarios(id),
  aprovado_por uuid references public.usuarios(id),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (produto_id, tipo, numero_revisao)
);

create unique index uq_ficha_vigente_por_tipo
on public.fichas_tecnicas(produto_id, tipo)
where vigente = true;

create index idx_fichas_produto on public.fichas_tecnicas(produto_id);
create index idx_fichas_tipo on public.fichas_tecnicas(tipo);
create index idx_fichas_status on public.fichas_tecnicas(status);

create trigger trg_fichas_atualizado
before update on public.fichas_tecnicas
for each row execute function public.atualizar_atualizado_em();

-- =========================================================
-- 7. CATÁLOGO FLEXÍVEL DE PARÂMETROS
-- =========================================================
create table public.grupos_parametros (
  id bigint generated always as identity primary key,
  tipo_ficha text not null
    check (tipo_ficha in ('MOLDAGEM','FUSAO_VAZAMENTO','METALURGIA','EMBALAGEM','QUALIDADE','OUTRA')),
  nome text not null,
  ordem_exibicao integer not null default 0,
  ativo boolean not null default true,
  unique (tipo_ficha, nome)
);

create table public.parametros (
  id bigint generated always as identity primary key,
  grupo_id bigint not null references public.grupos_parametros(id) on delete cascade,
  codigo_parametro text,
  nome text not null,
  unidade text,
  tipo_dado text not null default 'NUMERO'
    check (tipo_dado in ('NUMERO','TEXTO','BOOLEANO','LISTA','DATA','IMAGEM')),
  permite_faixa boolean not null default false,
  lista_opcoes jsonb,
  obrigatorio boolean not null default false,
  ordem_exibicao integer not null default 0,
  ativo boolean not null default true,
  unique (grupo_id, nome)
);

create index idx_parametros_grupo on public.parametros(grupo_id);
create index idx_parametros_codigo on public.parametros(codigo_parametro);

create table public.valores_parametros (
  id bigint generated always as identity primary key,
  ficha_tecnica_id bigint not null references public.fichas_tecnicas(id) on delete cascade,
  parametro_id bigint not null references public.parametros(id),
  valor_texto text,
  valor_numerico numeric(18,6),
  valor_minimo numeric(18,6),
  valor_alvo numeric(18,6),
  valor_maximo numeric(18,6),
  valor_booleano boolean,
  valor_data date,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (ficha_tecnica_id, parametro_id)
);

create index idx_valores_ficha on public.valores_parametros(ficha_tecnica_id);
create index idx_valores_parametro on public.valores_parametros(parametro_id);

create trigger trg_valores_atualizado
before update on public.valores_parametros
for each row execute function public.atualizar_atualizado_em();

-- =========================================================
-- 8. APROVAÇÕES E ALTERAÇÕES DE REVISÃO
-- =========================================================
create table public.aprovacoes_ficha (
  id bigint generated always as identity primary key,
  ficha_tecnica_id bigint not null references public.fichas_tecnicas(id) on delete cascade,
  solicitante_id uuid not null references public.usuarios(id),
  aprovador_id uuid references public.usuarios(id),
  status text not null default 'PENDENTE'
    check (status in ('PENDENTE','APROVADA','REPROVADA','CANCELADA')),
  comentario_solicitante text,
  comentario_aprovador text,
  solicitado_em timestamptz not null default now(),
  decidido_em timestamptz
);

create index idx_aprovacoes_ficha on public.aprovacoes_ficha(ficha_tecnica_id);
create index idx_aprovacoes_status on public.aprovacoes_ficha(status);

create table public.alteracoes_revisao (
  id bigint generated always as identity primary key,
  ficha_tecnica_id bigint not null references public.fichas_tecnicas(id) on delete cascade,
  parametro_id bigint references public.parametros(id),
  campo text,
  valor_anterior jsonb,
  valor_novo jsonb,
  alterado_por uuid references public.usuarios(id),
  alterado_em timestamptz not null default now()
);

create index idx_alteracoes_ficha on public.alteracoes_revisao(ficha_tecnica_id);

-- =========================================================
-- 9. EMBALAGEM
-- Campos próprios para cálculos e imagens.
-- =========================================================
create table public.especificacoes_embalagem (
  id bigint generated always as identity primary key,
  ficha_tecnica_id bigint not null unique references public.fichas_tecnicas(id) on delete cascade,
  padrao_embalagem text,
  tipo_embalagem text,
  documento_etm text,
  quantidade_pecas integer check (quantidade_pecas is null or quantidade_pecas > 0),
  peso_embalagem_kg numeric(12,3),
  protecao text,
  requisitos_cliente text,
  identificacao text,
  imagem_disposicao_url text,
  imagem_embalagem_url text,
  imagem_etiqueta_url text,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger trg_embalagem_atualizado
before update on public.especificacoes_embalagem
for each row execute function public.atualizar_atualizado_em();

-- =========================================================
-- 10. DOCUMENTOS E ARQUIVOS
-- =========================================================
create table public.documentos_produto (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.produtos(id) on delete cascade,
  ficha_tecnica_id bigint references public.fichas_tecnicas(id) on delete set null,
  tipo text not null
    check (tipo in ('PDF','DESENHO','FOTO','STEP','DWG','DXF','VIDEO','OUTRO')),
  titulo text not null,
  url_arquivo text not null,
  versao text,
  observacao text,
  enviado_por uuid references public.usuarios(id),
  criado_em timestamptz not null default now()
);

create index idx_documentos_produto on public.documentos_produto(produto_id);
create index idx_documentos_ficha on public.documentos_produto(ficha_tecnica_id);

-- =========================================================
-- 11. REGISTROS DE CARBONO EQUIVALENTE
-- Mantém a funcionalidade original do projeto.
-- =========================================================
create table public.registros_ce (
  id bigint generated always as identity primary key,
  produto_id bigint references public.produtos(id),
  maquina_id bigint references public.maquinas(id),
  panela_id bigint references public.panelas(id),
  corrida text,
  forno text,
  turno text,
  operador_id uuid references public.usuarios(id),
  carbono numeric(8,4),
  silicio numeric(8,4),
  carbono_equivalente numeric(8,4) not null,
  temperatura_c integer,
  tl numeric(10,3),
  tse numeric(10,3),
  ter numeric(10,3),
  tf numeric(10,3),
  observacao text,
  registrado_em timestamptz not null default now()
);

create index idx_registros_ce_data on public.registros_ce(registrado_em);
create index idx_registros_ce_produto on public.registros_ce(produto_id);

-- =========================================================
-- 12. AUDITORIA E NOTIFICAÇÕES
-- =========================================================
create table public.auditoria (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.usuarios(id),
  acao text not null,
  tabela text not null,
  registro_id text,
  dados_anteriores jsonb,
  dados_novos jsonb,
  criado_em timestamptz not null default now()
);

create index idx_auditoria_usuario on public.auditoria(usuario_id);
create index idx_auditoria_data on public.auditoria(criado_em);

create table public.notificacoes (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  titulo text not null,
  mensagem text not null,
  tipo text not null default 'INFORMACAO'
    check (tipo in ('INFORMACAO','APROVACAO','ALERTA','ERRO')),
  link text,
  lida boolean not null default false,
  criada_em timestamptz not null default now(),
  lida_em timestamptz
);

create index idx_notificacoes_usuario on public.notificacoes(usuario_id, lida);

commit;
