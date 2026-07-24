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

Enquanto não houver OCR, o modo é `ASSISTIDO_MANUAL`. Valores só são
pré-preenchidos quando já existem no cadastro usado como referência. Campos
sem valor não são inferidos e a conferência humana permanece obrigatória.

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
