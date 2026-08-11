begin;

-- As 4 máquinas HV3 são carrossel de 3 estações (3 caixas soprando ao mesmo
-- tempo); a SPM-20 tem 1 estação só. Linhas já existentes (Moldagem/
-- Acabamento) continuam com 1 estação, sem mudança de comportamento.
alter table public.linhas_maquinas_producao
  add column if not exists numero_estacoes integer not null default 1 check (numero_estacoes > 0);

insert into public.linhas_maquinas_producao(codigo,nome,area_id,numero_estacoes)
select codigo,nome,area.id,numero_estacoes from (values
  ('HV3-1','HV3-1',3),
  ('HV3-2','HV3-2',3),
  ('HV3-3','HV3-3',3),
  ('HV3-4','HV3-4',3),
  ('SPM-20','SPM-20',1)
) linha(codigo,nome,numero_estacoes)
cross join (select id from public.areas_checklist where codigo='MACHARIA') area
on conflict(codigo) do update set numero_estacoes=excluded.numero_estacoes,area_id=excluded.area_id;

commit;
