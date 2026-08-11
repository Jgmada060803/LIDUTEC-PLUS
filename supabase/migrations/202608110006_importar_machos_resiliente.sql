begin;

-- A importação em lote da ficha de macho não pode travar o lote inteiro só
-- porque um produto referenciado ainda não existe no cadastro (comum: a
-- planilha de engenharia sempre está um passo à frente do cadastro de
-- produtos). Agora cada linha é processada de forma resiliente: a ficha é
-- criada mesmo que algum produto vinculado não seja encontrado, e o relatório
-- final informa quais produtos/linhas precisam de atenção.
drop function if exists public.importar_machos_macharia(jsonb);

create or replace function public.importar_machos_macharia(p_linhas jsonb)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public as $$
declare
  v_linha record;
  v_existente public.machos_macharia%rowtype;
  v_macho_id bigint;
  v_importadas integer := 0;
  v_linhas_invalidas integer := 0;
  v_produtos_nao_encontrados text[] := '{}';
begin
  if not public.usuario_tem_permissao_produto('produto.editar') then
    raise exception 'Usuário sem permissão para editar a ficha de macho.';
  end if;
  if jsonb_typeof(coalesce(p_linhas,'[]'::jsonb))<>'array' then raise exception 'Importação inválida.'; end if;

  for v_linha in
    select * from jsonb_to_recordset(p_linhas) as item(
      caixa text,macho text,machos_por_sopro integer,peso_macho_kg numeric,
      kg_areia_por_sopro numeric,sopro_por_hora numeric,produtos jsonb
    )
  loop
    if nullif(trim(coalesce(v_linha.caixa,'')),'') is null or nullif(trim(coalesce(v_linha.macho,'')),'') is null
      or coalesce(v_linha.machos_por_sopro,0)<=0 then
      v_linhas_invalidas := v_linhas_invalidas + 1;
      continue;
    end if;

    select * into v_existente from public.machos_macharia
    where status='APROVADO' and upper(trim(caixa))=upper(trim(v_linha.caixa)) and upper(trim(macho))=upper(trim(v_linha.macho))
    order by criado_em desc limit 1;

    if v_existente.id is not null then
      insert into public.machos_macharia(
        caixa,macho,machos_por_sopro,peso_macho_kg,kg_areia_por_sopro,sopro_por_hora,
        status,ativo,substitui_id,criado_por
      ) values (
        trim(v_linha.caixa),trim(v_linha.macho),v_linha.machos_por_sopro,v_linha.peso_macho_kg,
        v_linha.kg_areia_por_sopro,v_linha.sopro_por_hora,'RASCUNHO',false,v_existente.id,auth.uid()
      ) returning id into v_macho_id;
    else
      insert into public.machos_macharia(
        caixa,macho,machos_por_sopro,peso_macho_kg,kg_areia_por_sopro,sopro_por_hora,status,ativo,criado_por
      ) values (
        trim(v_linha.caixa),trim(v_linha.macho),v_linha.machos_por_sopro,v_linha.peso_macho_kg,
        v_linha.kg_areia_por_sopro,v_linha.sopro_por_hora,'RASCUNHO',false,auth.uid()
      ) returning id into v_macho_id;
    end if;

    insert into public.machos_macharia_produtos(macho_id,produto_id,machos_por_peca)
    select v_macho_id,produto.id,item.machos_por_peca
    from jsonb_to_recordset(coalesce(v_linha.produtos,'[]'::jsonb)) as item(produto_codigo text,machos_por_peca integer)
    join public.produtos produto on upper(trim(produto.codigo))=upper(trim(item.produto_codigo))
    where coalesce(item.machos_por_peca,0)>0;

    v_produtos_nao_encontrados := v_produtos_nao_encontrados || array(
      select upper(trim(item.produto_codigo))
      from jsonb_to_recordset(coalesce(v_linha.produtos,'[]'::jsonb)) as item(produto_codigo text,machos_por_peca integer)
      where nullif(trim(coalesce(item.produto_codigo,'')),'') is not null
        and not exists(select 1 from public.produtos produto where upper(trim(produto.codigo))=upper(trim(item.produto_codigo)))
    );

    v_importadas := v_importadas + 1;
  end loop;

  return jsonb_build_object(
    'importadas', v_importadas,
    'linhas_invalidas', v_linhas_invalidas,
    'produtos_nao_encontrados', coalesce(
      (select array_agg(codigo order by codigo) from (select distinct unnest(v_produtos_nao_encontrados) as codigo) distinct_codes),
      '{}'::text[]
    )
  );
end;
$$;
revoke all on function public.importar_machos_macharia(jsonb) from public,anon;
grant execute on function public.importar_machos_macharia(jsonb) to authenticated;

notify pgrst,'reload schema';

commit;
