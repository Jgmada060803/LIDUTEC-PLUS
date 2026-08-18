-- Espelha materiais_produtos_producao() (usada no gráfico de material da
-- Moldagem), só trocando a permissão exigida pra producao_acabamento.visualizar
-- — a original exige producao_moldes.visualizar e quebraria a tela de
-- indicadores do Acabamento pra quem não tem acesso à Moldagem também.
create or replace function public.materiais_produtos_producao_acabamento()
returns table(produto_id bigint, tipo_material text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not public.usuario_tem_permissao_producao_acabamento('producao_acabamento.visualizar') then
    raise exception 'Usuário sem permissão para visualizar indicadores de produção.';
  end if;

  return query
  select produto.id,
    coalesce(nullif(trim(material.valor_texto),''),'Não especificado')
  from public.produtos produto
  left join lateral (
    select valor.valor_texto
    from public.fichas_tecnicas ficha
    join public.valores_parametros valor
      on valor.ficha_tecnica_id=ficha.id
    join public.parametros parametro
      on parametro.id=valor.parametro_id
    where ficha.produto_id=produto.id
      and ficha.tipo='FUSAO_VAZAMENTO'
      and ficha.vigente=true
      and parametro.codigo='FV_TIPO_MATERIAL'
    order by ficha.numero_revisao desc,ficha.id desc
    limit 1
  ) material on true
  where produto.status='ATIVO';
end;
$function$;

revoke all on function public.materiais_produtos_producao_acabamento() from public;
grant execute on function public.materiais_produtos_producao_acabamento() to authenticated;
