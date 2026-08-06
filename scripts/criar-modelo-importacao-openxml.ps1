$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\docs\modelos'))
$outputPath = Join-Path $outputDirectory 'modelo_importacao_producao_paradas.xlsx'
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('lidutec-xlsx-' + [guid]::NewGuid())
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[System.IO.Directory]::CreateDirectory((Join-Path $temporary '_rels')) | Out-Null
[System.IO.Directory]::CreateDirectory((Join-Path $temporary 'xl\_rels')) | Out-Null
[System.IO.Directory]::CreateDirectory((Join-Path $temporary 'xl\worksheets')) | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8($relativePath, $content) {
  $path = Join-Path $temporary $relativePath
  [System.IO.File]::WriteAllText($path, $content, $utf8)
}
function Xml($value) { return [System.Security.SecurityElement]::Escape([string]$value) }
function InlineCell($reference, $value, $style = 0) { return "<c r=`"$reference`" s=`"$style`" t=`"inlineStr`"><is><t>$(Xml $value)</t></is></c>" }
function HeaderRow($headers) {
  $cells = for ($index=0; $index -lt $headers.Count; $index++) {
    $column = [char](65 + $index)
    $style = if ($index -lt 6) { 1 } else { 2 }
    InlineCell "$column`1" $headers[$index] $style
  }
  return '<row r="1" ht="30" customHeight="1">' + ($cells -join '') + '</row>'
}
$contentTypes = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>
'@
$rootRels = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>
'@
$workbook = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Producao" sheetId="1" r:id="rId1"/><sheet name="Paradas" sheetId="2" r:id="rId2"/><sheet name="Instrucoes" sheetId="3" r:id="rId3"/></sheets></workbook>
'@
$workbookRels = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>
'@
$styles = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF18718F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF808080"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF18718F"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="4" borderId="1" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>
'@
$productionHeaders = @('Data operacional*','Turno*','Hora inicio*','Codigo do produto*','Moldes vazados*','Moldes quebrados*','Observacoes')
$stopHeaders = @('Data operacional*','Turno*','Hora inicio*','Hora fim*','Setor responsavel*','Motivo da parada*','Observacoes')
$productionSheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="19" customWidth="1" style="3"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="16" customWidth="1" style="4"/><col min="4" max="4" width="23" customWidth="1"/><col min="5" max="6" width="20" customWidth="1"/><col min="7" max="7" width="55" customWidth="1"/></cols><sheetData>' + (HeaderRow $productionHeaders) + '</sheetData><autoFilter ref="A1:G501"/><dataValidations count="1"><dataValidation type="list" allowBlank="0" sqref="B2:B501"><formula1>"MANHA,TARDE,NOITE"</formula1></dataValidation></dataValidations></worksheet>'
$stopSheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="19" customWidth="1" style="3"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="4" width="16" customWidth="1" style="4"/><col min="5" max="5" width="27" customWidth="1"/><col min="6" max="6" width="34" customWidth="1"/><col min="7" max="7" width="55" customWidth="1"/></cols><sheetData>' + (HeaderRow $stopHeaders) + '</sheetData><autoFilter ref="A1:G501"/><dataValidations count="1"><dataValidation type="list" allowBlank="0" sqref="B2:B501"><formula1>"MANHA,TARDE,NOITE"</formula1></dataValidation></dataValidations></worksheet>'
$instructionRows = @(
  @('Regra geral','Nao altere os nomes das abas nem dos cabecalhos. Campos com * sao obrigatorios.'),
  @('Data operacional','Use a data em que o turno comecou. No turno NOITE, horarios entre 00:00 e 06:00 pertencem ao dia seguinte.'),
  @('Turnos validos','MANHA (06:00-13:20), TARDE (13:20-21:30) e NOITE (21:30-06:00).'),
  @('Formato das horas','Informe somente hora e minuto, no formato HH:mm. Nao inclua a data nas colunas de hora.'),
  @('Producao - hora fim','O sistema calcula pela proxima hora de inicio menos 1 minuto. Na ultima linha, usa o limite final do turno.'),
  @('Ordem da producao','Ordene por Data operacional, Turno e Hora inicio.'),
  @('Produto','Use exatamente o codigo cadastrado no sistema, por exemplo MS0095.'),
  @('Quantidades','Moldes vazados e quebrados devem ser inteiros maiores ou iguais a zero.'),
  @('Paradas','Exemplo NOITE: 23:30 ate 00:15 corresponde a 45 minutos.'),
  @('Setor e motivo','Use exatamente os nomes cadastrados no sistema.'),
  @('Observacoes','Campo opcional, limitado a 500 caracteres.'),
  @('Exemplo producao','03/08/2026 | NOITE | 21:30 | MS0095 | 410 | 0 | Sequencia do turno anterior'),
  @('Exemplo parada','03/08/2026 | NOITE | 23:30 | 00:15 | MANUTENCAO | Falha mecanica | Ajuste realizado')
)
$instructionXml = '<row r="1" ht="30" customHeight="1">' + (InlineCell 'A1' 'MODELO DE IMPORTACAO - PRODUCAO E PARADAS' 6) + '</row>'
for ($index=0; $index -lt $instructionRows.Count; $index++) { $row=$index+3; $instructionXml += "<row r=`"$row`">$(InlineCell "A$row" $instructionRows[$index][0] 5)$(InlineCell "B$row" $instructionRows[$index][1] 5)</row>" }
$instructionSheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="105" customWidth="1"/></cols><sheetData>' + $instructionXml + '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>'
try {
  Write-Utf8 '[Content_Types].xml' $contentTypes
  Write-Utf8 '_rels\.rels' $rootRels
  Write-Utf8 'xl\workbook.xml' $workbook
  Write-Utf8 'xl\_rels\workbook.xml.rels' $workbookRels
  Write-Utf8 'xl\styles.xml' $styles
  Write-Utf8 'xl\worksheets\sheet1.xml' $productionSheet
  Write-Utf8 'xl\worksheets\sheet2.xml' $stopSheet
  Write-Utf8 'xl\worksheets\sheet3.xml' $instructionSheet
  if ([System.IO.File]::Exists($outputPath)) { [System.IO.File]::Delete($outputPath) }
  $fileStream = [System.IO.File]::Open($outputPath,[System.IO.FileMode]::CreateNew)
  $archive = New-Object System.IO.Compression.ZipArchive($fileStream,[System.IO.Compression.ZipArchiveMode]::Create,$false)
  try {
    foreach ($file in [System.IO.Directory]::GetFiles($temporary,'*',[System.IO.SearchOption]::AllDirectories)) {
      $entryName = $file.Substring($temporary.Length + 1).Replace('\','/')
      $entry = $archive.CreateEntry($entryName,[System.IO.Compression.CompressionLevel]::Optimal)
      $input = [System.IO.File]::OpenRead($file)
      $output = $entry.Open()
      try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
    }
  }
  finally { $archive.Dispose(); $fileStream.Dispose() }
  Write-Output $outputPath
}
finally { if ([System.IO.Directory]::Exists($temporary)) { [System.IO.Directory]::Delete($temporary,$true) } }
