create or replace function public.salvar_historico_importacao_ficha(
  p_importacao_id bigint,
  p_historico jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_ficha_id bigint;
  v_estado text;
begin
  if v_usuario_id is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if not (
    public.usuario_tem_permissao_ficha('ficha.importar')
    or public.usuario_tem_permissao_ficha('ficha.conferir_importacao')
  ) then
    raise exception 'Usuário sem permissão para salvar o histórico.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_historico, '[]'::jsonb)) <> 'array' then
    raise exception 'O histórico deve ser um array JSON.'
      using errcode = '22023';
  end if;

  select importacao.ficha_tecnica_id, importacao.estado
    into v_ficha_id, v_estado
  from public.importacoes_ficha importacao
  where importacao.id = p_importacao_id
  for update;

  if not found then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;

  if v_estado not in ('IMPORTACAO_RASCUNHO', 'REJEITADA') then
    raise exception 'O histórico desta importação não pode mais ser alterado.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_historico, '[]'::jsonb))
      as item(numero_revisao integer)
    where item.numero_revisao is null or item.numero_revisao < 0
  ) then
    raise exception 'O histórico contém uma revisão inválida.'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(coalesce(p_historico, '[]'::jsonb))
      as item(numero_revisao integer)
  ) <> (
    select count(distinct item.numero_revisao)
    from jsonb_to_recordset(coalesce(p_historico, '[]'::jsonb))
      as item(numero_revisao integer)
  ) then
    raise exception 'O histórico contém revisões duplicadas.'
      using errcode = '22023';
  end if;

  delete from public.historico_fichas
  where ficha_tecnica_id = v_ficha_id;

  insert into public.historico_fichas (
    ficha_tecnica_id,
    numero_revisao,
    data_revisao,
    descricao,
    responsavel,
    usuario_id
  )
  select
    v_ficha_id,
    item.numero_revisao,
    item.data_revisao,
    nullif(trim(item.descricao), ''),
    nullif(trim(item.responsavel), ''),
    v_usuario_id
  from jsonb_to_recordset(coalesce(p_historico, '[]'::jsonb))
    as item(
      numero_revisao integer,
      data_revisao date,
      descricao text,
      responsavel text
    );
end;
$$;

revoke all on function public.salvar_historico_importacao_ficha(
  bigint,
  jsonb
) from public;

grant execute on function public.salvar_historico_importacao_ficha(
  bigint,
  jsonb
) to authenticated;
