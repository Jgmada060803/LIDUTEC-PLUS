begin;

create or replace function public.enviar_ficha_aprovacao(
  p_ficha_id bigint
)
returns bigint
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  sheet public.fichas_tecnicas;
  user_name text;
begin
  if not (
    public.usuario_tem_permissao_ficha('ficha.editar_rascunho')
    or public.usuario_tem_permissao_ficha('ficha.criar')
  ) then
    raise exception 'Usuário sem permissão para enviar a ficha.';
  end if;

  select nome into user_name
  from public.usuarios
  where id=auth.uid() and status='ATIVO';
  if user_name is null then
    raise exception 'Usuário inativo.';
  end if;

  select * into sheet
  from public.fichas_tecnicas
  where id=p_ficha_id
    and status='RASCUNHO'
    and elaborado_por=auth.uid()
  for update;

  if sheet.id is null then
    raise exception 'Somente o criador pode enviar este rascunho para aprovação.';
  end if;

  -- O número já foi validado pela restrição única quando o rascunho foi
  -- criado. Recalculá-lo no envio podia escolher um número ocupado e também
  -- alterava indevidamente a revisão escolhida pelo usuário.
  update public.fichas_tecnicas
  set status='PENDENTE_APROVACAO',
      etapa_aprovacao='ENGENHARIA',
      submetido_por=auth.uid(),
      submetido_em=now(),
      decidido_por=null,
      decidido_em=null,
      observacao_decisao=null
  where id=sheet.id;

  insert into public.aprovacoes_ficha(
    ficha_tecnica_id,tipo_aprovacao,status,usuario_id,solicitante_id,
    nome_responsavel,observacao,ordem,assinatura_eletronica
  ) values (
    sheet.id,'ENGENHARIA','PENDENTE',auth.uid(),auth.uid(),
    user_name,'Enviada para aprovação.',1,false
  );

  return sheet.id;
end;
$$;

revoke all on function public.enviar_ficha_aprovacao(bigint)
  from public,anon;
grant execute on function public.enviar_ficha_aprovacao(bigint)
  to authenticated;

commit;
