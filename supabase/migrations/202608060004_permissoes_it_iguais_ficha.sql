begin;

create or replace function public.usuario_tem_permissao_checklist(p_codigo text)
returns boolean language plpgsql stable security definer
set search_path=pg_catalog,public as $$
begin
  if p_codigo='it.visualizar' then
    return public.usuario_tem_permissao_ficha('ficha.visualizar');
  elsif p_codigo='it.gerenciar' then
    return public.usuario_tem_permissao_ficha('ficha.criar')
      or public.usuario_tem_permissao_ficha('ficha.editar_rascunho');
  end if;
  return auth.uid() is not null and coalesce(
    (select up.permitido from public.usuario_permissoes up
     join public.permissoes p on p.id=up.permissao_id
     where up.usuario_id=auth.uid() and p.codigo=p_codigo limit 1),
    exists(select 1 from public.usuario_perfis uf
      join public.perfil_permissoes pp on pp.perfil_id=uf.perfil_id
      join public.permissoes p on p.id=pp.permissao_id
      where uf.usuario_id=auth.uid() and p.codigo=p_codigo),false);
end $$;

update public.permissoes set ativo=false where codigo in('it.visualizar','it.gerenciar');
grant execute on function public.usuario_tem_permissao_checklist(text) to authenticated;

commit;
