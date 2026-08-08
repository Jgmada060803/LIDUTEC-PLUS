begin;

insert into public.permissoes(codigo,nome,descricao,modulo,ativo)
select 'ficha.exportar_especificacoes','Exportar especificações técnicas',
  'Baixa em Excel todas as especificações de todas as fichas técnicas de todos os produtos.',
  'FICHAS_TECNICAS',true
where not exists(select 1 from public.permissoes where codigo='ficha.exportar_especificacoes');

insert into public.perfil_permissoes(perfil_id,permissao_id)
select perfil.id,permissao.id from public.perfis perfil
join public.permissoes permissao on permissao.codigo='ficha.exportar_especificacoes'
where upper(coalesce(perfil.codigo,'')) in ('ADMIN','ADMINISTRADOR','GERENTE_ENGENHARIA')
   or upper(coalesce(perfil.nome,'')) in ('ADMINISTRADOR','GERENTE DE ENGENHARIA','GERENTE ENGENHARIA')
on conflict do nothing;

-- A view em si não tem RLS própria (views comuns não suportam policy); a restrição
-- de acesso é feita explicitamente no WHERE, chamando a mesma função de checagem de
-- permissão usada pelo resto do módulo de fichas técnicas. Quem não tiver a
-- permissão simplesmente recebe zero linhas.
create or replace view public.export_especificacoes_tecnicas as
select
  produto.codigo as produto_codigo,
  produto.nome as produto_nome,
  ficha.tipo as ficha_tipo,
  ficha.numero_revisao,
  ficha.status as ficha_status,
  ficha.vigente,
  grupo.nome as grupo_nome,
  parametro.codigo as parametro_codigo,
  parametro.nome as parametro_nome,
  parametro.unidade,
  parametro.critico,
  valor.valor_texto,
  valor.valor_numerico,
  valor.valor_booleano,
  valor.valor_data,
  valor.valor_alvo,
  valor.valor_minimo,
  valor.valor_maximo,
  valor.nao_aplicavel,
  valor.observacao as valor_observacao
from public.valores_parametros valor
join public.parametros parametro on parametro.id = valor.parametro_id
join public.grupos_parametros grupo on grupo.id = parametro.grupo_id
join public.fichas_tecnicas ficha on ficha.id = valor.ficha_tecnica_id
join public.produtos produto on produto.id = ficha.produto_id
where public.usuario_tem_permissao_ficha('ficha.exportar_especificacoes');

grant select on public.export_especificacoes_tecnicas to authenticated;

notify pgrst,'reload schema';

commit;
