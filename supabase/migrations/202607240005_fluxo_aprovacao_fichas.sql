begin;

alter table public.fichas_tecnicas
  add column if not exists submetido_por uuid references public.usuarios(id),
  add column if not exists submetido_em timestamptz,
  add column if not exists decidido_por uuid references public.usuarios(id),
  add column if not exists decidido_em timestamptz,
  add column if not exists observacao_decisao text;

do $$
declare
  item record;
  definition text;
begin
  for item in
    select constraint_definition.conname,
      pg_catalog.pg_get_constraintdef(constraint_definition.oid,true) definition
    from pg_catalog.pg_constraint constraint_definition
    join pg_catalog.pg_attribute status_attribute
      on status_attribute.attrelid=constraint_definition.conrelid
      and status_attribute.attname='status'
      and status_attribute.attnum=any(constraint_definition.conkey)
    where constraint_definition.conrelid='public.fichas_tecnicas'::regclass
      and constraint_definition.contype='c'
  loop
    definition:=substring(item.definition from 7);
    execute format('alter table public.fichas_tecnicas drop constraint %I',item.conname);
    execute format(
      'alter table public.fichas_tecnicas add constraint %I check ((%s) or status in (''PENDENTE_APROVACAO'',''REJEITADA'',''APROVADA'',''OBSOLETA''))',
      item.conname,definition
    );
  end loop;
end;
$$;

create or replace function public.enviar_ficha_aprovacao(p_ficha_id bigint)
returns bigint language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  sheet public.fichas_tecnicas;
  user_name text;
begin
  if not (public.usuario_tem_permissao_ficha('ficha.editar_rascunho')
    or public.usuario_tem_permissao_ficha('ficha.criar')) then
    raise exception 'Usuário sem permissão para enviar a ficha.';
  end if;
  select nome into user_name from public.usuarios
  where id=auth.uid() and status='ATIVO';
  if user_name is null then raise exception 'Usuário inativo.'; end if;
  update public.fichas_tecnicas
  set status='PENDENTE_APROVACAO',etapa_aprovacao='ENGENHARIA',
      submetido_por=auth.uid(),submetido_em=now(),
      decidido_por=null,decidido_em=null,observacao_decisao=null
  where id=p_ficha_id and status='RASCUNHO'
  returning * into sheet;
  if sheet.id is null then
    raise exception 'Somente um rascunho pode ser enviado para aprovação.';
  end if;
  insert into public.aprovacoes_ficha(
    ficha_tecnica_id,tipo_aprovacao,status,usuario_id,
    nome_responsavel,observacao,ordem,assinatura_eletronica
  ) values (
    p_ficha_id,'ENGENHARIA','PENDENTE',auth.uid(),
    user_name,'Enviada para aprovação.',1,false
  );
  return sheet.id;
end;
$$;

create or replace function public.decidir_aprovacao_ficha(
  p_ficha_id bigint,p_resultado text,p_observacao text,
  p_tornar_vigente boolean default true
)
returns bigint language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  sheet public.fichas_tecnicas;
  user_name text;
begin
  if p_resultado not in ('APROVADA','REJEITADA') then
    raise exception 'Decisão inválida.';
  end if;
  if p_resultado='REJEITADA' and nullif(trim(p_observacao),'') is null then
    raise exception 'A justificativa da rejeição é obrigatória.';
  end if;
  if not (public.usuario_tem_permissao_ficha('ficha.aprovar_engenharia')
    or public.usuario_tem_permissao_ficha('ficha.aprovar_producao')) then
    raise exception 'Usuário sem permissão para decidir a aprovação.';
  end if;
  select nome into user_name from public.usuarios
  where id=auth.uid() and status='ATIVO';
  if user_name is null then raise exception 'Usuário inativo.'; end if;
  select * into sheet from public.fichas_tecnicas
  where id=p_ficha_id and status='PENDENTE_APROVACAO' for update;
  if sheet.id is null then raise exception 'A ficha não está aguardando aprovação.'; end if;
  if p_resultado='APROVADA' and p_tornar_vigente then
    update public.fichas_tecnicas
    set vigente=false,
      status=case when status in ('APROVADA','IMPORTADA') then 'OBSOLETA' else status end
    where produto_id=sheet.produto_id and tipo=sheet.tipo
      and id<>sheet.id and vigente=true;
  end if;
  update public.fichas_tecnicas
  set status=p_resultado,
      vigente=(p_resultado='APROVADA' and p_tornar_vigente),
      etapa_aprovacao=null,decidido_por=auth.uid(),decidido_em=now(),
      observacao_decisao=nullif(trim(p_observacao),'')
  where id=p_ficha_id;
  update public.aprovacoes_ficha
  set status=p_resultado,usuario_id=auth.uid(),
      nome_responsavel=user_name,observacao=nullif(trim(p_observacao),''),
      assinatura_eletronica=true
  where id=(select id from public.aprovacoes_ficha
    where ficha_tecnica_id=p_ficha_id and status='PENDENTE'
    order by ordem desc,id desc limit 1);
  return sheet.id;
end;
$$;

revoke all on function public.enviar_ficha_aprovacao(bigint) from public,anon;
revoke all on function public.decidir_aprovacao_ficha(bigint,text,text,boolean)
  from public,anon;
grant execute on function public.enviar_ficha_aprovacao(bigint) to authenticated;
grant execute on function public.decidir_aprovacao_ficha(bigint,text,text,boolean)
  to authenticated;

commit;
