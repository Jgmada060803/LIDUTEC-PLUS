-- Cadastro dos 5 indicadores do dashboard mensal da Fusão em
-- indicadores_metas — sem isso eles não aparecem no seletor da tela de
-- Metas Gerenciais (área Fusão), e ninguém consegue configurar a meta.
insert into public.indicadores_metas (codigo, nome, unidade, area_id, ativo) values
  ('FUSAO_ENERGIA_KWH_T', 'Consumo de energia (KWH/t fundido nos Fusores)', 'KWH/t', 3, true),
  ('FUSAO_GUSA_LIQUIDO_PCT', 'Gusa líquido / Gusa sólido', '%', 3, true),
  ('FUSAO_FESIMG_PCT', 'Consumo de FeSiMg (sobre metal Nodular vazado)', '%', 3, true),
  ('FUSAO_GUSA_SIDER_T_CORRIDA', 'Gusa Siderurgia / corrida Cinzento (Fusores)', 't/corrida', 3, true),
  ('FUSAO_GUSA_UTG_T_CORRIDA', 'Gusa UTG / corrida Nodular (Fusores)', 't/corrida', 3, true);
