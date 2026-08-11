begin;

-- A migration anterior abriu ordem 4-13 pros novos itens de amperagem/mix do
-- A02, mas esqueceu de empurrar "Porão, coletor e entorno limpos" (A02/06),
-- que ficou colidindo em ordem 6 com o novo item de amperagem.
update public.itens_checklist item
set ordem = 14
from public.modelos_checklist modelo
where item.modelo_id = modelo.id
  and modelo.codigo = 'A02'
  and item.codigo = '06';

commit;
