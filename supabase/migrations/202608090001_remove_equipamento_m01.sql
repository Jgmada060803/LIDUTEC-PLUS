begin;

update public.modelos_checklist
set equipamento_obrigatorio = false,
    atualizado_em = now()
where codigo = 'M01'
  and frequencia_tipo = 'SETUP';

do $$
begin
  if not exists (
    select 1
    from public.modelos_checklist modelo
    join public.areas_checklist area on area.id = modelo.area_id
    where modelo.codigo = 'M01'
      and area.codigo = 'MOLDAGEM'
      and modelo.frequencia_tipo = 'SETUP'
      and modelo.equipamento_obrigatorio = false
  ) then
    raise exception 'Modelo M01 de liberação de setup da DISA não encontrado.';
  end if;
end $$;

commit;
