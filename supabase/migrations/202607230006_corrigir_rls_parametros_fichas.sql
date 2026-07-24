begin;

alter table public.grupos_parametros enable row level security;
alter table public.parametros enable row level security;
alter table public.valores_parametros enable row level security;

drop policy if exists grupos_parametros_select_fichas
  on public.grupos_parametros;

create policy grupos_parametros_select_fichas
  on public.grupos_parametros
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.usuarios usuario
      where usuario.id = auth.uid()
        and usuario.status = 'ATIVO'
    )
    and (
      public.usuario_tem_permissao_ficha('ficha.visualizar')
      or public.usuario_tem_permissao_ficha('ficha.criar')
      or public.usuario_tem_permissao_ficha(
        'ficha.editar_rascunho'
      )
    )
  );

drop policy if exists parametros_select_fichas
  on public.parametros;

create policy parametros_select_fichas
  on public.parametros
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.usuarios usuario
      where usuario.id = auth.uid()
        and usuario.status = 'ATIVO'
    )
    and (
      public.usuario_tem_permissao_ficha('ficha.visualizar')
      or public.usuario_tem_permissao_ficha('ficha.criar')
      or public.usuario_tem_permissao_ficha(
        'ficha.editar_rascunho'
      )
    )
  );

drop policy if exists valores_parametros_select_fichas
  on public.valores_parametros;

create policy valores_parametros_select_fichas
  on public.valores_parametros
  for select
  to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1
      from public.usuarios usuario
      where usuario.id = auth.uid()
        and usuario.status = 'ATIVO'
    )
    and (
      public.usuario_tem_permissao_ficha('ficha.visualizar')
      or public.usuario_tem_permissao_ficha(
        'ficha.editar_rascunho'
      )
    )
  );

commit;
