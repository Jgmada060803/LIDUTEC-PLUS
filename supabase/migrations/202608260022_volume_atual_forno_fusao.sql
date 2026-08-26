begin;

-- Uma linha por forno com o volume atual de metal (carregado + recebido -
-- transferido) — sempre calculado na hora a partir dos dados, nunca
-- guardado à parte, pra não correr risco de ficar desatualizado.
create or replace view public.fornos_fusao_volume_atual as
select forno.id as forno_id, public.volume_atual_forno_fusao(forno.id) as volume_atual_kg
from public.fornos_fusao forno;

grant select on public.fornos_fusao_volume_atual to authenticated;

notify pgrst, 'reload schema';

commit;
