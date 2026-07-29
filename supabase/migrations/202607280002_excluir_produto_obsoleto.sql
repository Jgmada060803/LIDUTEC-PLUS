begin;

insert into public.permissoes (
  codigo,
  nome,
  descricao,
  modulo,
  ativo
)
select
  'produto.excluir_obsoleto',
  'Excluir produto obsoleto',
  'Exclui definitivamente um produto obsoleto e todos os seus registros relacionados.',
  'PRODUTOS',
  true
where not exists (
  select 1
  from public.permissoes
  where codigo = 'produto.excluir_obsoleto'
);

insert into public.perfil_permissoes (perfil_id, permissao_id)
select perfil.id, permissao.id
from public.perfis perfil
cross join public.permissoes permissao
where (
    upper(perfil.codigo) in (
      'ADMIN',
      'ADMINISTRADOR',
      'GERENTE_GERAL'
    )
    or upper(perfil.nome) in (
      'ADMINISTRADOR',
      'GERENTE GERAL'
    )
  )
  and permissao.codigo = 'produto.excluir_obsoleto'
  and perfil.ativo = true
  and permissao.ativo = true
  and not exists (
    select 1
    from public.perfil_permissoes perfil_permissao
    where perfil_permissao.perfil_id = perfil.id
      and perfil_permissao.permissao_id = permissao.id
  );

create or replace function public.excluir_produto_obsoleto(
  p_produto_id bigint,
  p_confirmacao_codigo text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_produto public.produtos;
  v_ficha_ids bigint[];
  v_reclamacao_ids bigint[];
  v_pdf_paths jsonb := '[]'::jsonb;
  v_anexo_paths jsonb := '[]'::jsonb;
  v_fichas integer := 0;
  v_reclamacoes integer := 0;
  v_producoes integer := 0;
  v_paradas integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.'
      using errcode = '42501';
  end if;

  if not public.usuario_tem_permissao_ficha(
    'produto.excluir_obsoleto'
  ) then
    raise exception 'Usuário sem permissão para excluir produtos obsoletos.'
      using errcode = '42501';
  end if;

  select *
    into v_produto
  from public.produtos produto
  where produto.id = p_produto_id
  for update;

  if v_produto.id is null then
    raise exception 'Produto não encontrado.'
      using errcode = 'P0002';
  end if;

  if v_produto.status <> 'OBSOLETO' then
    raise exception 'Somente produtos obsoletos podem ser excluídos.'
      using errcode = '22023';
  end if;

  if nullif(trim(p_confirmacao_codigo), '') is null
    or upper(trim(p_confirmacao_codigo)) <> upper(trim(v_produto.codigo))
  then
    raise exception 'O código de confirmação não corresponde ao produto.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'excluir-produto:' || v_produto.id::text,
      0
    )
  );

  select coalesce(array_agg(ficha.id), '{}'::bigint[])
    into v_ficha_ids
  from public.fichas_tecnicas ficha
  where ficha.produto_id = v_produto.id;

  select coalesce(array_agg(reclamacao.id), '{}'::bigint[])
    into v_reclamacao_ids
  from public.reclamacoes_cliente reclamacao
  where reclamacao.produto_id = v_produto.id;

  select coalesce(jsonb_agg(importacao.pdf_storage_path), '[]'::jsonb)
    into v_pdf_paths
  from public.importacoes_ficha importacao
  where importacao.ficha_tecnica_id = any(v_ficha_ids)
    and importacao.pdf_storage_path is not null;

  select coalesce(jsonb_agg(anexo.storage_path), '[]'::jsonb)
    into v_anexo_paths
  from public.reclamacoes_anexos anexo
  where anexo.reclamacao_id = any(v_reclamacao_ids)
    and anexo.storage_path is not null;

  v_fichas := cardinality(v_ficha_ids);
  v_reclamacoes := cardinality(v_reclamacao_ids);

  delete from public.validacoes_importacao_ficha
  where ficha_tecnica_id = any(v_ficha_ids)
     or importacao_id in (
       select importacao.id
       from public.importacoes_ficha importacao
       where importacao.ficha_tecnica_id = any(v_ficha_ids)
     );

  delete from public.auditoria_importacao_ficha
  where ficha_tecnica_id = any(v_ficha_ids)
     or importacao_id in (
       select importacao.id
       from public.importacoes_ficha importacao
       where importacao.ficha_tecnica_id = any(v_ficha_ids)
     );

  delete from public.importacoes_ficha
  where ficha_tecnica_id = any(v_ficha_ids);

  delete from public.aprovacoes_ficha
  where ficha_tecnica_id = any(v_ficha_ids);

  delete from public.valores_parametros
  where ficha_tecnica_id = any(v_ficha_ids);

  delete from public.historico_fichas
  where ficha_tecnica_id = any(v_ficha_ids);

  delete from public.fichas_tecnicas
  where produto_id = v_produto.id;

  delete from public.reclamacoes_cliente
  where produto_id = v_produto.id;

  delete from public.registros_producao_moldes
  where produto_id = v_produto.id;
  get diagnostics v_producoes = row_count;

  delete from public.paradas_producao_moldes
  where produto_id = v_produto.id;
  get diagnostics v_paradas = row_count;

  delete from public.produtos
  where id = v_produto.id;

  return jsonb_build_object(
    'produto_id', v_produto.id,
    'produto_codigo', v_produto.codigo,
    'fichas_excluidas', v_fichas,
    'reclamacoes_excluidas', v_reclamacoes,
    'registros_producao_excluidos', v_producoes,
    'paradas_excluidas', v_paradas,
    'pdf_storage_paths', v_pdf_paths,
    'anexo_storage_paths', v_anexo_paths
  );
end;
$$;

revoke all on function public.excluir_produto_obsoleto(bigint, text)
  from public, anon;

grant execute on function public.excluir_produto_obsoleto(bigint, text)
  to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'produto_obsoleto_storage_delete'
  ) then
    create policy produto_obsoleto_storage_delete
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id in (
          'fichas-tecnicas-pdf',
          'reclamacoes-cliente'
        )
        and public.usuario_tem_permissao_ficha(
          'produto.excluir_obsoleto'
        )
      );
  end if;
end;
$$;

commit;
