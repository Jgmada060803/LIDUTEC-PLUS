begin;

alter table public.clientes
  add column if not exists nome_fantasia text,
  add column if not exists documento_fiscal text,
  add column if not exists inscricao_estadual text,
  add column if not exists logotipo_url text,
  add column if not exists site text,
  add column if not exists contato_principal text,
  add column if not exists cargo_contato text,
  add column if not exists email text,
  add column if not exists telefone text,
  add column if not exists celular text,
  add column if not exists cep text,
  add column if not exists logradouro text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists cidade text,
  add column if not exists estado text,
  add column if not exists pais text default 'Brasil',
  add column if not exists observacoes text,
  add column if not exists criado_em timestamptz default now(),
  add column if not exists atualizado_em timestamptz default now();

create unique index if not exists clientes_documento_fiscal_uidx
  on public.clientes(documento_fiscal)
  where documento_fiscal is not null and trim(documento_fiscal)<>'';

insert into public.permissoes(codigo,nome,descricao,modulo,ativo)
select permission.codigo,permission.nome,permission.descricao,
  'ENGENHARIA',true
from (values
  ('clientes.visualizar','Visualizar clientes',
    'Consulta o cadastro e os contatos dos clientes.'),
  ('clientes.gerenciar','Gerenciar clientes',
    'Cadastra, edita, ativa e inativa clientes.')
) as permission(codigo,nome,descricao)
where not exists (
  select 1 from public.permissoes current_permission
  where current_permission.codigo=permission.codigo
);

insert into public.perfil_permissoes(perfil_id,permissao_id)
select distinct profile.id,client_permission.id
from public.perfis profile
join public.perfil_permissoes product_profile_permission
  on product_profile_permission.perfil_id=profile.id
join public.permissoes product_permission
  on product_permission.id=product_profile_permission.permissao_id
join public.permissoes client_permission
  on client_permission.codigo=case
    when product_permission.codigo in ('produto.criar','produto.editar')
      then 'clientes.gerenciar'
    else 'clientes.visualizar'
  end
where product_permission.codigo in (
  'produto.visualizar','produto.criar','produto.editar'
)
and not exists (
  select 1 from public.perfil_permissoes existing_permission
  where existing_permission.perfil_id=profile.id
    and existing_permission.permissao_id=client_permission.id
);

alter table public.clientes enable row level security;

drop policy if exists clientes_cadastro_select on public.clientes;
create policy clientes_cadastro_select
  on public.clientes for select to authenticated
  using (
    public.usuario_tem_permissao_sistema('clientes.visualizar')
    or public.usuario_tem_permissao_sistema('clientes.gerenciar')
    or public.usuario_tem_permissao_sistema('produto.visualizar')
  );

drop policy if exists clientes_cadastro_insert on public.clientes;
create policy clientes_cadastro_insert
  on public.clientes for insert to authenticated
  with check (
    public.usuario_tem_permissao_sistema('clientes.gerenciar')
  );

drop policy if exists clientes_cadastro_update on public.clientes;
create policy clientes_cadastro_update
  on public.clientes for update to authenticated
  using (public.usuario_tem_permissao_sistema('clientes.gerenciar'))
  with check (public.usuario_tem_permissao_sistema('clientes.gerenciar'));

grant select,insert,update on public.clientes to authenticated;
grant usage,select on sequence public.clientes_id_seq to authenticated;

commit;
