begin;

update public.modelos_checklist
set equipamento_obrigatorio = false,
    atualizado_em = now()
where codigo = 'M02'
  and frequencia_tipo = 'INTERVALO'
  and intervalo_minutos = 30;

do $$
begin
  if not exists (
    select 1
    from public.modelos_checklist modelo
    join public.areas_checklist area on area.id = modelo.area_id
    where modelo.codigo = 'M02'
      and area.codigo = 'MOLDAGEM'
      and modelo.frequencia_tipo = 'INTERVALO'
      and modelo.intervalo_minutos = 30
      and modelo.equipamento_obrigatorio = false
  ) then
    raise exception 'Modelo M02 de liberação periódica de moldes não encontrado.';
  end if;
end $$;

commit;
