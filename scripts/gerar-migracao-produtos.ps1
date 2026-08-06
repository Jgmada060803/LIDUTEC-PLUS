param(
  [string]$WorkbookPath = "docs/modelos/produtos.xlsx",
  [string]$OutputPath = "supabase/migrations/202608060010_importar_lista_produtos.sql"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Convert-ToSqlText([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Format-SqlNumber([string]$Value) {
  $number = 0.0
  if (-not [double]::TryParse($Value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
    throw "Valor numerico invalido: $Value"
  }
  return $number.ToString("0.####", [Globalization.CultureInfo]::InvariantCulture)
}

$resolvedWorkbook = Resolve-Path $WorkbookPath
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedWorkbook)
try {
  function Read-ArchiveText([string]$Name) {
    $entry = $archive.GetEntry($Name)
    if (-not $entry) { throw "Arquivo interno ausente: $Name" }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  }

  [xml]$sharedXml = Read-ArchiveText "xl/sharedStrings.xml"
  $sharedNs = [Xml.XmlNamespaceManager]::new($sharedXml.NameTable)
  $sharedNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  $sharedStrings = @($sharedXml.SelectNodes("//x:si", $sharedNs) | ForEach-Object {
    ($_.SelectNodes(".//x:t", $sharedNs) | ForEach-Object { $_.InnerText }) -join ""
  })

  [xml]$sheetXml = Read-ArchiveText "xl/worksheets/sheet1.xml"
  $sheetNs = [Xml.XmlNamespaceManager]::new($sheetXml.NameTable)
  $sheetNs.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  $seenCodes = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $valid = [Collections.Generic.List[object]]::new()
  $ignored = [Collections.Generic.List[string]]::new()

  foreach ($row in $sheetXml.SelectNodes("//x:sheetData/x:row[position()>1]", $sheetNs)) {
    $cells = @{}
    foreach ($cell in $row.SelectNodes("./x:c", $sheetNs)) {
      $column = ([regex]::Match($cell.r, "^[A-Z]+")).Value
      $raw = $cell.SelectSingleNode("./x:v", $sheetNs)
      $cells[$column] = if ($cell.t -eq "s" -and $raw) {
        $sharedStrings[[int]$raw.InnerText]
      } elseif ($raw) { $raw.InnerText } else { "" }
    }

    $code = ([string]$cells.A).Trim().ToUpperInvariant()
    $name = ([string]$cells.B).Trim()
    $pieceWeight = ([string]$cells.C).Trim()
    $moldPieces = ([string]$cells.D).Trim()
    $clusterWeight = ([string]$cells.E).Trim()
    if (-not $code) {
      $ignored.Add("linha $($row.r): campos obrigatorios vazios")
      continue
    }
    if (-not $seenCodes.Add($code)) {
      $ignored.Add("linha $($row.r): codigo repetido $code")
      continue
    }
    if ($code -eq "MS0018/19") {
      $ignored.Add("linha $($row.r): composicao de producao, nao e produto da Lista Mestra")
      continue
    }
    if (-not $name -or -not $pieceWeight -or -not $moldPieces -or -not $clusterWeight) {
      $ignored.Add("linha $($row.r): campos obrigatorios vazios")
      continue
    }
    $valid.Add([pscustomobject]@{
      Code = $code
      Name = $name
      PieceWeight = Format-SqlNumber $pieceWeight
      MoldPieces = Format-SqlNumber $moldPieces
      ClusterWeight = Format-SqlNumber $clusterWeight
    })
  }
} finally {
  $archive.Dispose()
}

$values = $valid | ForEach-Object {
  "    ($(Convert-ToSqlText $_.Code), $(Convert-ToSqlText $_.Name), $($_.PieceWeight), $($_.MoldPieces), $($_.ClusterWeight))"
}
$valuesSql = $values -join ",`r`n"
$migration = @"
-- Gerado de docs/modelos/produtos.xlsx.
-- Linhas incompletas sao ignoradas; em codigos repetidos somente a primeira linha e considerada.
alter table public.produtos
  add column if not exists cadastro_pendente boolean not null default false,
  add column if not exists importacao_lote text,
  add column if not exists importado_em timestamptz;

do `$`$
declare
  v_usuario_id uuid;
begin
  select id into v_usuario_id
  from public.usuarios
  where status = 'ATIVO'
  order by case when perfil in ('ADMIN', 'ADMINISTRADOR') then 0 else 1 end, criado_em
  limit 1;

  if v_usuario_id is null then
    raise exception 'Nao existe usuario ativo para registrar a importacao de produtos.';
  end if;

  with origem(codigo, nome, peso_peca_kg, cavidades_molde, peso_cacho_kg) as (
    values
$valuesSql
  )
  insert into public.produtos (
    codigo, nome, peso_peca_kg, cavidades_molde, peso_cacho_kg,
    status, criado_por, cadastro_pendente, importacao_lote, importado_em
  )
  select
    origem.codigo, origem.nome, origem.peso_peca_kg, origem.cavidades_molde,
    origem.peso_cacho_kg, 'ATIVO', v_usuario_id, true,
    'PRODUTOS_20260806', now()
  from origem
  where not exists (
    select 1 from public.produtos existente
    where upper(trim(existente.codigo)) = upper(trim(origem.codigo))
  );
end
`$`$;
"@

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory | Out-Null }
[IO.File]::WriteAllText((Join-Path (Resolve-Path $outputDirectory) (Split-Path -Leaf $OutputPath)), $migration, [Text.UTF8Encoding]::new($false))

Write-Output "Produtos validos: $($valid.Count)"
Write-Output "Linhas ignoradas: $($ignored.Count)"
$ignored | ForEach-Object { Write-Output "- $_" }
