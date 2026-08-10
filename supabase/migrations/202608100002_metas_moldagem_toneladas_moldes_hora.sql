begin;

-- Novos indicadores de meta para a Moldagem: meta mensal de toneladas
-- (acompanhada dia a dia) e meta de moldes vazados por hora disponível
-- (só um valor de referência, sem acompanhamento por enquanto).
insert into public.indicadores_metas(codigo,nome,unidade,area_id)
select 'TONELADAS_PECAS_MES','Toneladas de peças produzidas por mês','t',area.id
from public.areas_checklist area where area.codigo='MOLDAGEM'
union all
select 'MOLDES_HORA_DISPONIVEL','Moldes vazados por hora disponível (descontando paradas)','moldes/h',area.id
from public.areas_checklist area where area.codigo='MOLDAGEM'
on conflict(codigo) do nothing;

notify pgrst,'reload schema';

commit;
