begin;

update public.parametros
set tipo_dado='NUMERO', permite_faixa=true, observacao=null
where codigo in ('FV_VAZ_MG','FV_VAZ_MO');

update public.valores_parametros valor
set valor_texto=null, nao_aplicavel=false
from public.parametros parametro
where parametro.id=valor.parametro_id
  and parametro.codigo in ('FV_VAZ_MG','FV_VAZ_MO');

update public.grupos_parametros grupo
set ativo=false
where grupo.tipo_ficha='MOLDAGEM'
  and upper(trim(grupo.nome))='DADOS DO MODELO'
  and grupo.id<>(
    select oficial.id from public.grupos_parametros oficial
    where oficial.tipo_ficha='MOLDAGEM'
      and oficial.codigo='MOLD_DADOS_MODELO'
    order by oficial.id limit 1
  );

commit;
