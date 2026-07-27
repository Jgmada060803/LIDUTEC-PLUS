begin;

create or replace function public.usuario_tem_permissao_sistema(
  p_codigo text
)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  individual_permission boolean;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.usuarios usuario
    where usuario.id=auth.uid() and usuario.status='ATIVO'
  ) then
    return false;
  end if;

  select usuario_permissao.permitido
    into individual_permission
  from public.usuario_permissoes usuario_permissao
  join public.permissoes permissao
    on permissao.id=usuario_permissao.permissao_id
  where usuario_permissao.usuario_id=auth.uid()
    and permissao.codigo=p_codigo
  limit 1;

  if found then
    return coalesce(individual_permission,false);
  end if;

  return exists (
    select 1
    from public.usuario_perfis usuario_perfil
    join public.perfil_permissoes perfil_permissao
      on perfil_permissao.perfil_id=usuario_perfil.perfil_id
    join public.permissoes permissao
      on permissao.id=perfil_permissao.permissao_id
    where usuario_perfil.usuario_id=auth.uid()
      and permissao.codigo=p_codigo
  );
end;
$$;

revoke all on function public.usuario_tem_permissao_sistema(text)
  from public,anon;
grant execute on function public.usuario_tem_permissao_sistema(text)
  to authenticated;

drop policy if exists usuarios_ler_gestao_acessos
  on public.usuarios;
create policy usuarios_ler_gestao_acessos
  on public.usuarios
  for select
  to authenticated
  using (
    public.usuario_tem_permissao_sistema('usuarios.visualizar')
    or public.usuario_tem_permissao_sistema(
      'usuarios.gerenciar_acessos'
    )
  );

drop policy if exists usuario_perfis_ler_gestao_acessos
  on public.usuario_perfis;
create policy usuario_perfis_ler_gestao_acessos
  on public.usuario_perfis
  for select
  to authenticated
  using (
    public.usuario_tem_permissao_sistema(
      'usuarios.gerenciar_acessos'
    )
  );

drop policy if exists usuario_permissoes_ler_gestao_acessos
  on public.usuario_permissoes;
create policy usuario_permissoes_ler_gestao_acessos
  on public.usuario_permissoes
  for select
  to authenticated
  using (
    public.usuario_tem_permissao_sistema(
      'usuarios.gerenciar_acessos'
    )
  );

commit;
