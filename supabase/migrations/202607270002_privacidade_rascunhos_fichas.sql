begin;

alter table public.aprovacoes_ficha
  add column if not exists usuario_id uuid
    references public.usuarios(id);

-- O rascunho pertence exclusivamente ao usuário que o criou.
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
      where usuario.id=auth.uid()
        and usuario.status='ATIVO'
    )
    and (
      (
        status='RASCUNHO'
        and elaborado_por=auth.uid()
        and (
          public.usuario_tem_permissao_ficha('ficha.criar')
          or public.usuario_tem_permissao_ficha('ficha.editar_rascunho')
          or public.usuario_tem_permissao_ficha('ficha.visualizar_rascunho')
        )
      )
      or (
        status<>'RASCUNHO'
        and public.usuario_tem_permissao_ficha('ficha.visualizar')
      )
    )
  );

-- Os valores seguem exatamente a visibilidade da ficha à qual pertencem.
drop policy if exists valores_parametros_select_fichas
  on public.valores_parametros;

create policy valores_parametros_select_fichas
  on public.valores_parametros
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.fichas_tecnicas ficha
      where ficha.id=valores_parametros.ficha_tecnica_id
    )
  );

-- A função pública antiga não pode contornar a validação de propriedade.
revoke execute on function public.salvar_rascunho_ficha_tecnica(
  bigint,text,bigint,text,date,jsonb
) from authenticated;

create or replace function public.salvar_rascunho_ficha_tecnica_v2(
  p_produto_id bigint,
  p_tipo text,
  p_ficha_id bigint default null,
  p_motivo_revisao text default null,
  p_data_emissao date default null,
  p_valores jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_ficha_id bigint;
begin
  if p_ficha_id is not null and not exists (
    select 1
    from public.fichas_tecnicas ficha
    where ficha.id=p_ficha_id
      and ficha.status='RASCUNHO'
      and ficha.elaborado_por=auth.uid()
  ) then
    raise exception 'Somente o criador pode alterar este rascunho.'
      using errcode='42501';
  end if;

  v_ficha_id:=public.salvar_rascunho_ficha_tecnica(
    p_produto_id,
    p_tipo,
    p_ficha_id,
    p_motivo_revisao,
    p_data_emissao,
    p_valores
  );

  update public.valores_parametros valor
  set valor_inicial=recebido.valor_inicial,
      valor_final=recebido.valor_final,
      nao_aplicavel=coalesce(recebido.nao_aplicavel,false)
  from jsonb_to_recordset(coalesce(p_valores,'[]'::jsonb))
    as recebido(
      parametro_id bigint,
      valor_inicial numeric,
      valor_final numeric,
      nao_aplicavel boolean
    )
  where valor.ficha_tecnica_id=v_ficha_id
    and valor.parametro_id=recebido.parametro_id;

  return v_ficha_id;
end;
$$;

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
  next_revision integer;
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

  select coalesce(max(ficha.numero_revisao),-1)+1
    into next_revision
  from public.fichas_tecnicas ficha
  where ficha.produto_id=sheet.produto_id
    and ficha.tipo=sheet.tipo
    and ficha.id<>sheet.id
    and ficha.status<>'RASCUNHO';

  update public.fichas_tecnicas
  set numero_revisao=greatest(next_revision,0),
      status='PENDENTE_APROVACAO',
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

create or replace function public.decidir_aprovacao_ficha(
  p_ficha_id bigint,
  p_resultado text,
  p_observacao text,
  p_tornar_vigente boolean default true
)
returns bigint
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  sheet public.fichas_tecnicas;
  user_name text;
  required_permission text;
begin
  if p_resultado not in ('APROVADA','REJEITADA') then
    raise exception 'Decisão inválida.';
  end if;
  if p_resultado='REJEITADA'
    and nullif(trim(p_observacao),'') is null then
    raise exception 'A justificativa da rejeição é obrigatória.';
  end if;

  select * into sheet
  from public.fichas_tecnicas
  where id=p_ficha_id and status='PENDENTE_APROVACAO'
  for update;
  if sheet.id is null then
    raise exception 'A ficha não está aguardando aprovação.';
  end if;

  required_permission:=case sheet.etapa_aprovacao
    when 'ENGENHARIA' then 'ficha.aprovar_engenharia'
    when 'PRODUCAO' then 'ficha.aprovar_producao'
    else null
  end;
  if required_permission is null
    or not public.usuario_tem_permissao_ficha(required_permission) then
    raise exception 'Usuário sem permissão para a etapa %.',
      coalesce(sheet.etapa_aprovacao,'não definida');
  end if;

  select nome into user_name
  from public.usuarios
  where id=auth.uid() and status='ATIVO';
  if user_name is null then
    raise exception 'Usuário inativo.';
  end if;

  update public.aprovacoes_ficha
  set status=p_resultado,
      usuario_id=auth.uid(),
      nome_responsavel=user_name,
      observacao=nullif(trim(p_observacao),''),
      assinatura_eletronica=true
  where id=(
    select id
    from public.aprovacoes_ficha
    where ficha_tecnica_id=p_ficha_id
      and status='PENDENTE'
      and tipo_aprovacao=sheet.etapa_aprovacao
    order by ordem desc,id desc
    limit 1
  );

  if p_resultado='REJEITADA' then
    update public.fichas_tecnicas
    set status='REJEITADA',
        vigente=false,
        etapa_aprovacao=null,
        decidido_por=auth.uid(),
        decidido_em=now(),
        observacao_decisao=nullif(trim(p_observacao),'')
    where id=sheet.id;
    return sheet.id;
  end if;

  if sheet.etapa_aprovacao='ENGENHARIA' then
    update public.fichas_tecnicas
    set etapa_aprovacao='PRODUCAO'
    where id=sheet.id;

    insert into public.aprovacoes_ficha(
      ficha_tecnica_id,tipo_aprovacao,status,usuario_id,solicitante_id,
      nome_responsavel,observacao,ordem,assinatura_eletronica
    ) values (
      sheet.id,'PRODUCAO','PENDENTE',auth.uid(),auth.uid(),
      user_name,'Aguardando aprovação da Produção.',2,false
    );
    return sheet.id;
  end if;

  if p_tornar_vigente then
    update public.fichas_tecnicas
    set vigente=false,
        status=case
          when status in ('APROVADA','IMPORTADA') then 'OBSOLETA'
          else status
        end
    where produto_id=sheet.produto_id
      and tipo=sheet.tipo
      and id<>sheet.id
      and vigente=true;
  end if;

  update public.fichas_tecnicas
  set status='APROVADA',
      vigente=p_tornar_vigente,
      etapa_aprovacao=null,
      decidido_por=auth.uid(),
      decidido_em=now(),
      observacao_decisao=nullif(trim(p_observacao),'')
  where id=sheet.id;

  return sheet.id;
end;
$$;

revoke all on function public.salvar_rascunho_ficha_tecnica_v2(
  bigint,text,bigint,text,date,jsonb
) from public,anon;
grant execute on function public.salvar_rascunho_ficha_tecnica_v2(
  bigint,text,bigint,text,date,jsonb
) to authenticated;

revoke all on function public.enviar_ficha_aprovacao(bigint)
  from public,anon;
grant execute on function public.enviar_ficha_aprovacao(bigint)
  to authenticated;

revoke all on function public.decidir_aprovacao_ficha(
  bigint,text,text,boolean
) from public,anon;
grant execute on function public.decidir_aprovacao_ficha(
  bigint,text,text,boolean
) to authenticated;

commit;
