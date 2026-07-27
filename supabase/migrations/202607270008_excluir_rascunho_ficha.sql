begin;

insert into public.permissoes (
  codigo, nome, descricao, modulo, ativo
)
select
  'ficha.excluir_rascunho',
  'Excluir rascunho de ficha',
  'Exclui definitivamente uma ficha que ainda não entrou no fluxo de aprovação.',
  'FICHAS_TECNICAS',
  true
where not exists (
  select 1
  from public.permissoes
  where codigo = 'ficha.excluir_rascunho'
);

insert into public.perfil_permissoes (perfil_id, permissao_id)
select perfil.id, permissao.id
from public.perfis perfil
cross join public.permissoes permissao
where upper(perfil.codigo) in (
    'ADMIN',
    'ADMINISTRADOR',
    'GERENTE_GERAL',
    'GERENTE_ENGENHARIA'
  )
  and permissao.codigo = 'ficha.excluir_rascunho'
  and perfil.ativo = true
  and permissao.ativo = true
  and not exists (
    select 1
    from public.perfil_permissoes perfil_permissao
    where perfil_permissao.perfil_id = perfil.id
      and perfil_permissao.permissao_id = permissao.id
  );

create or replace function public.excluir_rascunho_ficha(
  p_ficha_id bigint
)
returns bigint
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_ficha public.fichas_tecnicas;
  v_importacao_id bigint;
  v_importacao_estado text;
begin
  if not public.usuario_tem_permissao_ficha(
    'ficha.excluir_rascunho'
  ) then
    raise exception 'Usuário sem permissão para excluir rascunhos.'
      using errcode='42501';
  end if;

  select *
  into v_ficha
  from public.fichas_tecnicas
  where id=p_ficha_id
  for update;

  if v_ficha.id is null then
    raise exception 'Ficha não encontrada.';
  end if;
  if v_ficha.elaborado_por <> auth.uid() then
    raise exception 'Somente o criador pode excluir este rascunho.'
      using errcode='42501';
  end if;

  select id,estado
  into v_importacao_id,v_importacao_estado
  from public.importacoes_ficha
  where ficha_tecnica_id=v_ficha.id;

  if v_ficha.status <> 'RASCUNHO'
    and not (
      v_ficha.status = 'IMPORTADA'
      and v_importacao_estado in (
        'IMPORTACAO_RASCUNHO',
        'REJEITADA'
      )
    ) then
    raise exception 'Somente rascunhos que ainda não foram enviados podem ser excluídos.';
  end if;
  if exists (
    select 1
    from public.aprovacoes_ficha
    where ficha_tecnica_id=v_ficha.id
  ) then
    raise exception 'Este rascunho já possui registros de aprovação e não pode ser excluído.';
  end if;
  if exists (
    select 1
    from public.fichas_tecnicas
    where revisao_origem_id=v_ficha.id
  ) then
    raise exception 'Este rascunho é referência de outra revisão e não pode ser excluído.';
  end if;

  if v_importacao_id is not null then
    delete from public.validacoes_importacao_ficha
    where importacao_id=v_importacao_id
       or ficha_tecnica_id=v_ficha.id;

    delete from public.auditoria_importacao_ficha
    where importacao_id=v_importacao_id
       or ficha_tecnica_id=v_ficha.id;

    delete from public.importacoes_ficha
    where id=v_importacao_id;
  end if;

  delete from public.valores_parametros
  where ficha_tecnica_id=v_ficha.id;

  delete from public.historico_fichas
  where ficha_tecnica_id=v_ficha.id;

  delete from public.fichas_tecnicas
  where id=v_ficha.id;

  return v_ficha.id;
end;
$$;

revoke all on function public.excluir_rascunho_ficha(bigint)
  from public,anon;
grant execute on function public.excluir_rascunho_ficha(bigint)
  to authenticated;

commit;
