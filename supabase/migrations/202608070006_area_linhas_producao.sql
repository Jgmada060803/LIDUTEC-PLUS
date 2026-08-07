begin;

alter table public.linhas_maquinas_producao
  add column if not exists area_id bigint references public.areas_checklist(id);

-- Linhas já cadastradas pertencem hoje exclusivamente à Moldagem.
update public.linhas_maquinas_producao linha
set area_id = area.id
from public.areas_checklist area
where area.codigo = 'MOLDAGEM'
  and linha.area_id is null;

insert into public.linhas_maquinas_producao(codigo,nome,area_id)
select codigo,nome,area.id from (values
  ('ACABAMENTO_L1','Linha 1'),
  ('ACABAMENTO_L2','Linha 2')
) linha(codigo,nome)
cross join (select id from public.areas_checklist where codigo='ACABAMENTO') area
on conflict(codigo) do nothing;

commit;
