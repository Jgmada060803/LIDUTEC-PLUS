# Importação histórica de fichas por PDF

## Separação dos fluxos

A importação histórica é controlada por `importacoes_ficha.estado`:

`IMPORTACAO_RASCUNHO → IMPORTACAO_PENDENTE_VALIDACAO → IMPORTADA`

Uma rejeição administrativa leva a `REJEITADA` e devolve o documento para
conferência. A validação declara somente que os dados cadastrados correspondem
ao PDF original. Ela não cria registros em `aprovacoes_ficha`.

O fluxo técnico continua em `fichas_tecnicas.status`. A etapa específica fica
em `fichas_tecnicas.etapa_aprovacao`, com `ENGENHARIA` ou `PRODUCAO`, para
preservar compatibilidade com o status existente `EM_APROVACAO`.

## Extração

`ficha-pdf-extractor.js` expõe:

```js
extrairFichaPdf({
  arquivo,
  tipoFicha,
  versaoTemplate,
  dadosReferencia
})
```

PDFs com camada de texto são processados no modo `PDF_TEXTO` com PDF.js. O
extrator identifica cabeçalho, parâmetros de Moldagem, parâmetros de
Fusão/Vazamento e histórico de revisões, mantendo a página e a linha de origem,
além de uma confiança por campo.

Nas fichas de Fusão/Vazamento, as matrizes de composição química são lidas por
seção e coordenada de coluna para diferenciar os valores de forno e vazamento.
Especificações de processo, propriedades mecânicas, inoculação, nodularização,
temperaturas e análise térmica usam regras próprias do layout da ficha.
PDFs digitalizados, sem camada de texto suficiente, informam explicitamente
que precisam de OCR. A conferência humana permanece obrigatória em todos os
modos.

O histórico reconhecido pode ser corrigido na tela antes de salvar e é gravado
em `historico_fichas` pela função
`salvar_historico_importacao_ficha`.

## PDF original

Os PDFs ficam no bucket privado `fichas-tecnicas-pdf`. O banco guarda somente
o caminho privado e seus metadados. A visualização usa URL assinada temporária.
Não há política de exclusão nem URL pública permanente.

## Nova revisão

`criar_nova_revisao_ficha` cria uma ficha `RASCUNHO`, não vigente, vinculada
por `revisao_origem_id`. Os valores são copiados. Aprovações técnicas,
validações administrativas e o PDF histórico não são copiados.

## Permissões

- `ficha.importar`
- `ficha.conferir_importacao`
- `ficha.validar_importacao`
- `ficha.criar`
- `ficha.editar_rascunho`
- `ficha.aprovar_engenharia`
- `ficha.aprovar_producao`
- `ficha.visualizar`

O perfil Administrador recebe apenas as três permissões administrativas novas.
As aprovações técnicas continuam dependendo de concessão explícita.
