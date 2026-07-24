# Produção de Moldes e Aprovação de Fichas

## Aprovação

`enviar_ficha_aprovacao` envia somente uma ficha `RASCUNHO` e registra autor e
data. `decidir_aprovacao_ficha` aceita `APROVADA` ou `REJEITADA`; rejeição
exige justificativa. Quando uma ficha aprovada se torna vigente, a vigente
anterior do mesmo produto e tipo perde a vigência e passa a `OBSOLETA` quando
aplicável. Nenhuma revisão é apagada.

## Turnos

A regra está centralizada em `assets/js/turnos.js`:

- manhã: 06:00–13:20, 440 minutos;
- tarde: 13:20–21:30, 490 minutos;
- noite: 21:30–06:00, 510 minutos.

No turno noturno, horários antes das 06:00 pertencem à data operacional
anterior.

## Produção e paradas

As entidades são criadas pela migration
`202607240006_producao_moldes_paradas.sql`. Durações são armazenadas em
minutos, timestamps usam timezone e as políticas RLS distinguem visualização,
lançamento e edição.

Os indicadores não permitem horas efetivas negativas. O percentual de
atendimento usa realizado/planejado e o percentual de refugo usa
refugado/produzido, retornando zero quando o denominador é zero.

## Aplicação

As migrations 005 e 006 precisam ser revisadas e aplicadas ao Supabase antes
dos testes autenticados desses fluxos. Este repositório não contém o schema
inicial completo do banco, portanto a aplicação deve ocorrer primeiro em
ambiente de homologação.
