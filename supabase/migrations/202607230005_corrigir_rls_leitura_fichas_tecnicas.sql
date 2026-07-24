begin;

create or replace function public.usuario_tem_permissao_ficha(
  p_codigo text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_permitido_individual boolean;
begin
  if v_usuario_id is null then
    return false;
  end if;

  select usuario_permissao.permitido
    into v_permitido_individual
  from public.usuario_permissoes usuario_permissao
  join public.permissoes permissao
    on permissao.id = usuario_permissao.permissao_id
  where usuario_permissao.usuario_id = v_usuario_id
    and permissao.codigo = p_codigo
  limit 1;

  if found then
    return coalesce(v_permitido_individual, false);
  end if;

  return exists (
    select 1
    from public.usuario_perfis usuario_perfil
    join public.perfil_permissoes perfil_permissao
      on perfil_permissao.perfil_id = usuario_perfil.perfil_id
    join public.permissoes permissao
      on permissao.id = perfil_permissao.permissao_id
    where usuario_perfil.usuario_id = v_usuario_id
      and permissao.codigo = p_codigo
  );
end;
$$;

revoke all on function public.usuario_tem_permissao_ficha(text)
  from public;
grant execute on function public.usuario_tem_permissao_ficha(text)
  to authenticated;

alter table public.fichas_tecnicas enable row level security;

drop policy if exists fichas_tecnicas_select_permissao
  on public.fichas_tecnicas;

create policy fichas_tecnicas_select_permissao
  on public.fichas_tecnicas
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
      or (
        status = 'RASCUNHO'
        and public.usuario_tem_permissao_ficha(
          'ficha.editar_rascunho'
        )
      )
    )
  );

commit;
