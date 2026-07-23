begin;

-- O índice é necessário para que o upsert da RPC seja determinístico.
-- Se já houver uma chave única equivalente, nenhuma alteração é feita.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    where index_definition.indrelid =
      'public.valores_parametros'::regclass
      and index_definition.indisunique
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and (
        select array_agg(attribute.attname order by attribute.attname)
        from unnest(index_definition.indkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
          and attribute.attnum = key_column.attnum
      ) = array['ficha_tecnica_id', 'parametro_id']::name[]
  ) then
    create unique index valores_parametros_ficha_parametro_uidx
      on public.valores_parametros (
        ficha_tecnica_id,
        parametro_id
      );
  end if;
end;
$$;

create or replace function public.salvar_rascunho_ficha_tecnica(
  p_produto_id uuid,
  p_tipo text,
  p_ficha_id uuid default null,
  p_motivo_revisao text default null,
  p_data_emissao date default null,
  p_valores jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_ficha_id uuid;
  v_status text;
  v_permissao_necessaria text;
  v_permissao_individual boolean;
  v_tem_permissao boolean;
  v_quantidade_parametros integer;
begin
  if v_usuario_id is null then
    raise exception 'Usuário não autenticado.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.usuarios usuario
    where usuario.id = v_usuario_id
      and usuario.status = 'ATIVO'
  ) then
    raise exception 'Usuário inativo.'
      using errcode = '42501';
  end if;

  if p_produto_id is null or nullif(trim(p_tipo), '') is null then
    raise exception 'Produto e tipo da ficha são obrigatórios.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_valores, '[]'::jsonb)) <> 'array' then
    raise exception 'Os valores da ficha devem ser um array JSON.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_produto_id::text || ':' || p_tipo,
      0
    )
  );

  v_permissao_necessaria := case
    when p_ficha_id is null then 'ficha.criar'
    else 'ficha.editar_rascunho'
  end;

  select usuario_permissao.permitido
    into v_permissao_individual
  from public.usuario_permissoes usuario_permissao
  join public.permissoes permissao
    on permissao.id = usuario_permissao.permissao_id
  where usuario_permissao.usuario_id = v_usuario_id
    and permissao.codigo = v_permissao_necessaria
  limit 1;

  if found then
    v_tem_permissao := v_permissao_individual;
  else
    select exists (
      select 1
      from public.usuario_perfis usuario_perfil
      join public.perfil_permissoes perfil_permissao
        on perfil_permissao.perfil_id = usuario_perfil.perfil_id
      join public.permissoes permissao
        on permissao.id = perfil_permissao.permissao_id
      where usuario_perfil.usuario_id = v_usuario_id
        and permissao.codigo = v_permissao_necessaria
    )
      into v_tem_permissao;
  end if;

  if not coalesce(v_tem_permissao, false) then
    raise exception 'Usuário sem a permissão %.',
      v_permissao_necessaria
      using errcode = '42501';
  end if;

  if p_ficha_id is null then
    if exists (
      select 1
      from public.fichas_tecnicas ficha
      where ficha.produto_id = p_produto_id
        and ficha.tipo = p_tipo
        and ficha.status = 'RASCUNHO'
    ) then
      raise exception 'Já existe um rascunho para este produto e tipo.'
        using errcode = '23505';
    end if;

    insert into public.fichas_tecnicas (
      produto_id,
      tipo,
      numero_revisao,
      status,
      vigente,
      elaborado_por,
      motivo_revisao,
      data_emissao
    )
    values (
      p_produto_id,
      p_tipo,
      0,
      'RASCUNHO',
      false,
      v_usuario_id,
      p_motivo_revisao,
      p_data_emissao
    )
    returning id into v_ficha_id;
  else
    select ficha.status
      into v_status
    from public.fichas_tecnicas ficha
    where ficha.id = p_ficha_id
      and ficha.produto_id = p_produto_id
      and ficha.tipo = p_tipo
    for update;

    if not found then
      raise exception 'Ficha técnica não encontrada para o produto e tipo informados.'
        using errcode = 'P0002';
    end if;

    if v_status <> 'RASCUNHO' then
      raise exception 'Somente fichas em RASCUNHO podem ser alteradas.'
        using errcode = '42501';
    end if;

    update public.fichas_tecnicas ficha
    set motivo_revisao = p_motivo_revisao,
        data_emissao = p_data_emissao
    where ficha.id = p_ficha_id;

    v_ficha_id := p_ficha_id;
  end if;

  select count(distinct valor.parametro_id)
    into v_quantidade_parametros
  from jsonb_to_recordset(coalesce(p_valores, '[]'::jsonb))
    as valor(parametro_id uuid);

  if v_quantidade_parametros <> jsonb_array_length(
    coalesce(p_valores, '[]'::jsonb)
  ) then
    raise exception 'A lista contém parâmetros ausentes ou duplicados.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_valores, '[]'::jsonb))
      as valor(parametro_id uuid)
    where not exists (
      select 1
      from public.parametros parametro
      join public.grupos_parametros grupo
        on grupo.id = parametro.grupo_id
      where parametro.id = valor.parametro_id
        and grupo.tipo_ficha = p_tipo
    )
  ) then
    raise exception 'A lista contém parâmetro incompatível com o tipo da ficha.'
      using errcode = '22023';
  end if;

  insert into public.valores_parametros (
    ficha_tecnica_id,
    parametro_id,
    valor_texto,
    valor_numerico,
    valor_minimo,
    valor_alvo,
    valor_maximo,
    valor_booleano,
    valor_data,
    observacao
  )
  select
    v_ficha_id,
    valor.parametro_id,
    valor.valor_texto,
    valor.valor_numerico,
    valor.valor_minimo,
    valor.valor_alvo,
    valor.valor_maximo,
    valor.valor_booleano,
    valor.valor_data,
    valor.observacao
  from jsonb_to_recordset(coalesce(p_valores, '[]'::jsonb))
    as valor(
      parametro_id uuid,
      valor_texto text,
      valor_numerico numeric,
      valor_minimo numeric,
      valor_alvo numeric,
      valor_maximo numeric,
      valor_booleano boolean,
      valor_data date,
      observacao text
    )
  on conflict (ficha_tecnica_id, parametro_id)
  do update set
    valor_texto = excluded.valor_texto,
    valor_numerico = excluded.valor_numerico,
    valor_minimo = excluded.valor_minimo,
    valor_alvo = excluded.valor_alvo,
    valor_maximo = excluded.valor_maximo,
    valor_booleano = excluded.valor_booleano,
    valor_data = excluded.valor_data,
    observacao = excluded.observacao;

  return v_ficha_id;
end;
$$;

revoke all on function public.salvar_rascunho_ficha_tecnica(
  uuid,
  text,
  uuid,
  text,
  date,
  jsonb
) from public;

grant execute on function public.salvar_rascunho_ficha_tecnica(
  uuid,
  text,
  uuid,
  text,
  date,
  jsonb
) to authenticated;

commit;
