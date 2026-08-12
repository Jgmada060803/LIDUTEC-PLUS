begin;

-- "Encerrar" fecha a vigência (mantém histórico), mas não corrige um
-- cadastro feito por engano — pra isso é preciso excluir de verdade. Nenhuma
-- outra tabela referencia paradas_programadas por FK, então a exclusão é
-- direta, sem necessidade de cascata.
insert into public.permissoes(codigo,nome,descricao,modulo,ativo)
select codigo,nome,descricao,'PLANEJAMENTO',true from (values
  ('paradas_programadas.excluir','Excluir paradas programadas','Remove definitivamente um cadastro de parada programada.')
) permission(codigo,nome,descricao)
where not exists(select 1 from public.permissoes current_permission
  where current_permission.codigo=permission.codigo);

insert into public.perfil_permissoes(perfil_id,permissao_id)
select profile.id,permission.id from public.perfis profile
cross join public.permissoes permission
where (upper(profile.codigo) in ('ADMIN','ADMINISTRADOR','GERENTE_GERAL','GERENTE_PRODUCAO')
  or upper(profile.nome)='ADMINISTRADOR')
and permission.codigo='paradas_programadas.excluir'
and not exists(select 1 from public.perfil_permissoes relation
  where relation.perfil_id=profile.id and relation.permissao_id=permission.id);

create or replace function public.excluir_parada_programada(p_id bigint)
returns void
language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if not public.usuario_tem_permissao_metas('paradas_programadas.excluir') then
    raise exception 'Usuário sem permissão para excluir paradas programadas.';
  end if;
  if not exists(select 1 from public.paradas_programadas where id=p_id) then
    raise exception 'Parada programada não encontrada.';
  end if;
  delete from public.paradas_programadas where id=p_id;
end;
$$;
revoke all on function public.excluir_parada_programada(bigint) from public,anon;
grant execute on function public.excluir_parada_programada(bigint) to authenticated;

notify pgrst,'reload schema';

commit;
