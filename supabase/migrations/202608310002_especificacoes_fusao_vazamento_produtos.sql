begin;

-- Descoberta na auditoria: a ficha técnica JÁ suporta mínimo/alvo/máximo
-- por parâmetro numérico (colunas valor_minimo/valor_alvo/valor_maximo em
-- valores_parametros, habilitadas por parametros.permite_faixa) — "Ceq",
-- "CE Líquido" e "Liberação Panela de Vazamento" já têm isso preenchido
-- pra quase todos os 87 produtos. Não precisa de parâmetro novo pra CE e
-- temperatura.
--
-- "Peso metálico por molde" também já existe: é o "Peso do cacho"
-- (produtos.peso_cacho_kg, mostrado na aba Geral do produto — confirmado
-- 70,50 kg no MS0032, batendo com a tela). Não é parâmetro de ficha
-- técnica, é coluna direta do produto — não cria nada novo.
create or replace function public.especificacoes_fusao_vazamento_produtos()
returns table(
  produto_id bigint,
  ce_minimo numeric, ce_maximo numeric,
  temp_liberacao_minima numeric, temp_liberacao_maxima numeric,
  peso_cacho_kg numeric, peso_peca_kg numeric, cavidades_molde integer
) language sql stable security definer set search_path = pg_catalog, public as $$
  select
    ft.produto_id,
    ce.valor_minimo, ce.valor_maximo,
    temp.valor_minimo, temp.valor_maximo,
    pr.peso_cacho_kg, pr.peso_peca_kg, pr.cavidades_molde
  from public.fichas_tecnicas ft
  join public.produtos pr on pr.id = ft.produto_id
  left join public.valores_parametros ce on ce.ficha_tecnica_id = ft.id and ce.parametro_id = 173
  left join public.valores_parametros temp on temp.ficha_tecnica_id = ft.id and temp.parametro_id = 188
  where ft.vigente = true and ft.tipo = 'FUSAO_VAZAMENTO';
$$;

notify pgrst, 'reload schema';

commit;
