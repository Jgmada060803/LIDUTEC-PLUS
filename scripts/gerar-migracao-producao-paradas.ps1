param(
  [string]$WorkbookPath = "docs/modelos/modelo_importacao_producao_paradas.xlsx",
  [string]$OutputPath = "supabase/migrations/202608060013_importar_producao_paradas.sql"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$invariant = [Globalization.CultureInfo]::InvariantCulture

function SqlText([string]$value) {
  if ($null -eq $value) { return "null" }
  return "'" + $value.Replace("'", "''") + "'"
}

function Normalize-Shift([string]$value) {
  $normalized = $value.Trim().Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
  switch ($normalized.ToUpperInvariant()) {
    "MANHA" { return "MANHA" }
    "TARDE" { return "TARDE" }
    "NOITE" { return "NOITE" }
    default { throw "Turno invalido: $value" }
  }
}

function Parse-Date([string]$value, [int]$row) {
  $number = 0.0
  if ([double]::TryParse($value, [Globalization.NumberStyles]::Float, $invariant, [ref]$number)) {
    return [DateTime]::FromOADate($number).Date
  }
  $date = [DateTime]::MinValue
  foreach ($format in @("dd/MM/yyyy", "yyyy-MM-dd")) {
    if ([DateTime]::TryParseExact($value.Trim(), $format, $invariant, [Globalization.DateTimeStyles]::None, [ref]$date)) { return $date.Date }
  }
  throw "Data invalida na linha $row`: $value"
}

function Parse-Time([string]$value, [int]$row, [string]$field) {
  $trimmed = $value.Trim().Replace(';', ':')
  $number = 0.0
  if ([double]::TryParse($trimmed, [Globalization.NumberStyles]::Float, $invariant, [ref]$number)) {
    $minutes = [int][Math]::Round(($number - [Math]::Floor($number)) * 1440)
    if ($minutes -eq 1440) { $minutes = 0 }
    return [TimeSpan]::FromMinutes($minutes)
  }
  if ($trimmed -eq ':00') { $trimmed = '00:00' }
  if ($trimmed -match '^(?<hour>\d{1,2}):(?<minute>\d{2})$') {
    $hour = [int]$Matches.hour
    $minute = [int]$Matches.minute
    if ($hour -ge 0 -and $hour -le 23 -and $minute -ge 0 -and $minute -le 59) {
      return [TimeSpan]::FromMinutes($hour * 60 + $minute)
    }
  }
  throw "$field invalida na linha $row`: $value"
}

function Operational-DateTime([DateTime]$date, [TimeSpan]$time, [string]$shift) {
  $result = $date.Add($time)
  if ($shift -eq 'NOITE' -and $time -lt [TimeSpan]::FromHours(12)) { $result = $result.AddDays(1) }
  return $result
}

$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $WorkbookPath))
try {
  function Read-ArchiveText([string]$name) {
    $entry = $archive.GetEntry($name)
    if (-not $entry) { throw "Arquivo interno ausente: $name" }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  }

  [xml]$sharedXml = Read-ArchiveText 'xl/sharedStrings.xml'
  $sharedNs = [Xml.XmlNamespaceManager]::new($sharedXml.NameTable)
  $sharedNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $sharedStrings = @($sharedXml.SelectNodes('//x:si', $sharedNs) | ForEach-Object {
    ($_.SelectNodes('.//x:t', $sharedNs) | ForEach-Object { $_.InnerText }) -join ''
  })

  function Read-Sheet([string]$name) {
    [xml]$sheetXml = Read-ArchiveText $name
    $sheetNs = [Xml.XmlNamespaceManager]::new($sheetXml.NameTable)
    $sheetNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    foreach ($row in $sheetXml.SelectNodes('//x:sheetData/x:row[position()>1]', $sheetNs)) {
      $cells = [ordered]@{ A=''; B=''; C=''; D=''; E=''; F=''; G='' }
      foreach ($cell in $row.SelectNodes('./x:c', $sheetNs)) {
        $column = ([regex]::Match($cell.r, '^[A-Z]+')).Value
        $raw = $cell.SelectSingleNode('./x:v', $sheetNs)
        if ($raw) { $cells[$column] = if ($cell.t -eq 's') { $sharedStrings[[int]$raw.InnerText] } else { $raw.InnerText } }
      }
      [pscustomobject]@{ Row=[int]$row.r; Cells=$cells }
    }
  }

  $productionRows = @(Read-Sheet 'xl/worksheets/sheet1.xml')
  $stopRows = @(Read-Sheet 'xl/worksheets/sheet2.xml')
} finally { $archive.Dispose() }

if ($productionRows.Count -ne 1324) { throw "Esperadas 1324 producoes; encontradas $($productionRows.Count)." }
if ($stopRows.Count -ne 3943) { throw "Esperadas 3943 paradas; encontradas $($stopRows.Count)." }

$invalidBrokenAsZero = 0
$promotedStopReasons = 0
$productions = foreach ($row in $productionRows) {
  $c = $row.Cells
  $date = Parse-Date $c.A $row.Row
  $shift = Normalize-Shift $c.B
  $start = Operational-DateTime $date (Parse-Time $c.C $row.Row 'Hora inicial') $shift
  $end = Operational-DateTime $date (Parse-Time $c.D $row.Row 'Hora final') $shift
  if ($end -lt $start) { $end = $end.AddDays(1) }
  $code = $c.E.Trim().ToUpperInvariant()
  if (-not $code) { throw "Produto vazio na linha $($row.Row)." }
  $poured = 0
  if (-not [int]::TryParse($c.F.Trim(), [Globalization.NumberStyles]::Integer, $invariant, [ref]$poured) -or $poured -lt 0) { throw "Moldes vazados invalidos na linha $($row.Row)." }
  $broken = 0
  if ($c.G.Trim() -and -not [int]::TryParse($c.G.Trim(), [Globalization.NumberStyles]::Integer, $invariant, [ref]$broken)) {
    $broken = 0
    $invalidBrokenAsZero++
  }
  if ($broken -lt 0) { throw "Moldes quebrados invalidos na linha $($row.Row)." }
  [pscustomobject]@{ SourceRow=$row.Row; Date=$date; Shift=$shift; Start=$start; End=$end; Code=$code; Poured=$poured; Broken=$broken }
}

$stops = foreach ($row in $stopRows) {
  $c = $row.Cells
  $date = Parse-Date $c.A $row.Row
  $shift = Normalize-Shift $c.B
  $start = Operational-DateTime $date (Parse-Time $c.C $row.Row 'Hora inicial') $shift
  $end = Operational-DateTime $date (Parse-Time $c.D $row.Row 'Hora final') $shift
  if ($end -lt $start) { $end = $end.AddDays(1) }
  $sector = $c.E.Trim()
  if ($sector.ToUpperInvariant() -eq 'MANUTEMÇÃO') { $sector = 'MANUTENÇÃO' }
  $reason = $c.F.Trim()
  $observation = $c.G.Trim()
  if (-not $reason -and $observation) { $reason = $observation; $observation = ''; $promotedStopReasons++ }
  if (-not $sector -or -not $reason) { throw "Setor ou motivo vazio na linha $($row.Row)." }
  if ($observation.Length -gt 500) { throw "Observacao excede 500 caracteres na linha $($row.Row)." }
  [pscustomobject]@{ SourceRow=$row.Row; Date=$date; Shift=$shift; Start=$start; End=$end; Sector=$sector; Reason=$reason; Observation=$observation }
}

foreach ($item in @($productions) + @($stops)) {
  if ($item.End -lt $item.Start) { throw "Intervalo negativo na linha $($item.SourceRow)." }
}
$productionShifts = [Collections.Generic.HashSet[string]]::new()
$productions | ForEach-Object { [void]$productionShifts.Add("$($_.Date.ToString('yyyy-MM-dd'))|$($_.Shift)") }
$stopOnlyShifts = @($stops | Where-Object { -not $productionShifts.Contains("$($_.Date.ToString('yyyy-MM-dd'))|$($_.Shift)") })
$duplicateStopKeys = @($stops | Group-Object { "$($_.Start.ToString('o'))|$($_.End.ToString('o'))|$($_.Reason)" } | Where-Object Count -gt 1)

function Is-OutsideShift($item) {
  $startTime = switch ($item.Shift) { 'MANHA' { [TimeSpan]::FromHours(6) }; 'TARDE' { [TimeSpan]::FromMinutes(800) }; 'NOITE' { [TimeSpan]::FromMinutes(1290) } }
  $endTime = switch ($item.Shift) { 'MANHA' { [TimeSpan]::FromMinutes(800) }; 'TARDE' { [TimeSpan]::FromMinutes(1290) }; 'NOITE' { [TimeSpan]::FromHours(6) } }
  $shiftStart = $item.Date.Add($startTime)
  $shiftEnd = $item.Date.Add($(if ($item.Shift -eq 'NOITE') { [TimeSpan]::FromDays(1) } else { [TimeSpan]::Zero })).Add($endTime)
  return $item.Start -lt $shiftStart -or $item.End -gt $shiftEnd
}
$outsideProductions = @($productions | Where-Object { Is-OutsideShift $_ })
$outsideStops = @($stops | Where-Object { Is-OutsideShift $_ })

$productionValues = $productions | ForEach-Object {
  "  ($($_.SourceRow), $(SqlText $_.Date.ToString('yyyy-MM-dd')), $(SqlText $_.Shift), $(SqlText ($_.Start.ToString('yyyy-MM-dd HH:mm:ss') + '-03')), $(SqlText ($_.End.ToString('yyyy-MM-dd HH:mm:ss') + '-03')), $(SqlText $_.Code), $($_.Poured), $($_.Broken))"
}
$stopValues = $stops | ForEach-Object {
  $observation = if ($_.Observation) { SqlText $_.Observation } else { 'null' }
  "  ($($_.SourceRow), $(SqlText $_.Date.ToString('yyyy-MM-dd')), $(SqlText $_.Shift), $(SqlText ($_.Start.ToString('yyyy-MM-dd HH:mm:ss') + '-03')), $(SqlText ($_.End.ToString('yyyy-MM-dd HH:mm:ss') + '-03')), $(SqlText $_.Sector), $(SqlText $_.Reason), $observation)"
}

$migration = @"
begin;

-- Gerado de docs/modelos/modelo_importacao_producao_paradas.xlsx.
-- Origem: 1.324 producoes e 3.943 paradas. A carga substitui os turnos coincidentes.
create table if not exists public.backup_producao_paradas_202608060013 (
  id bigint generated by default as identity primary key,
  turno_producao_id bigint not null,
  data_operacional date not null,
  turno text not null,
  dados jsonb not null,
  criado_em timestamptz not null default now(),
  unique (turno_producao_id)
);
revoke all on public.backup_producao_paradas_202608060013 from anon, authenticated;

-- A origem possui ocorrencias repetidas legitimas; o indice anterior impedia preserva-las.
drop index if exists public.paradas_producao_evidente_idx;
create index paradas_producao_evidente_idx on public.paradas_producao_moldes(
  inicio,fim,categoria_id,coalesce(linha_maquina_id,0)
);

create temp table carga_202608060013_producoes (
  linha_origem integer primary key, data_operacional date not null, turno text not null,
  inicio timestamptz not null, fim timestamptz not null, codigo_produto text not null,
  moldes_vazados integer not null, moldes_quebrados integer not null
) on commit drop;
insert into carga_202608060013_producoes values
$($productionValues -join ",`r`n");

create temp table carga_202608060013_paradas (
  linha_origem integer primary key, data_operacional date not null, turno text not null,
  inicio timestamptz not null, fim timestamptz not null, setor text not null,
  motivo text not null, observacao text
) on commit drop;
insert into carga_202608060013_paradas values
$($stopValues -join ",`r`n");
create temp table carga_202608060013_turnos on commit drop as
select data_operacional,turno from carga_202608060013_producoes
union select data_operacional,turno from carga_202608060013_paradas;

-- Codigos incompletos na Lista Mestra permanecem identificados para saneamento,
-- mas nao impedem a preservacao dos apontamentos historicos de moldes.
do `$`$
declare v_usuario uuid;
begin
  select u.id into v_usuario from public.usuarios u where u.status='ATIVO' and (
    exists(select 1 from public.usuario_perfis up join public.perfis pf on pf.id=up.perfil_id
      where up.usuario_id=u.id and upper(pf.codigo) in('ADMIN','ADMINISTRADOR','GERENTE_GERAL','GERENTE_PRODUCAO','COORDENADOR_PRODUCAO'))
    or exists(select 1 from public.usuario_areas_operacionais ua join public.areas_checklist a on a.id=ua.area_id
      where ua.usuario_id=u.id and upper(a.codigo)='MOLDAGEM'))
  order by case when u.perfil in ('ADMIN','ADMINISTRADOR') then 0 else 1 end,u.criado_em limit 1;
  if v_usuario is null then raise exception 'Nao existe usuario ativo para registrar produtos pendentes.'; end if;
  insert into public.produtos(codigo,nome,status,criado_por,cadastro_pendente,importacao_lote,importado_em)
  select o.codigo_produto,'Produto pendente '||o.codigo_produto,'ATIVO',v_usuario,true,'PRODUCAO_202608060013',now()
  from (select distinct codigo_produto from carga_202608060013_producoes where codigo_produto<>'MS0018/19') o
  where not exists(select 1 from public.produtos p where upper(trim(p.codigo))=o.codigo_produto);
end `$`$;

do `$`$
declare v_faltantes text;
begin
  if (select count(*) from carga_202608060013_producoes) <> 1324 then raise exception 'Contagem de producoes da origem divergente.'; end if;
  if (select count(*) from carga_202608060013_paradas) <> 3943 then raise exception 'Contagem de paradas da origem divergente.'; end if;
  select string_agg(codigo_produto, ', ' order by codigo_produto) into v_faltantes
  from (select distinct codigo_produto from carga_202608060013_producoes where codigo_produto <> 'MS0018/19') origem
  where not exists (select 1 from public.produtos p where upper(trim(p.codigo))=origem.codigo_produto);
  if v_faltantes is not null then raise exception 'Produtos nao cadastrados: %', v_faltantes; end if;
  if (select count(*) from public.composicoes_producao_itens i join public.composicoes_producao c on c.id=i.composicao_id where c.codigo='MS0018/19' and i.percentual=50) <> 2 then
    raise exception 'A composicao MS0018/19 deve conter MS0018 e MS0019 a 50%%.';
  end if;
end `$`$;

insert into public.setores_responsaveis_parada(codigo,nome,ativo)
select 'IMP_'||upper(substr(md5(setor),1,20)), setor, true from (select distinct setor from carga_202608060013_paradas) s
on conflict(codigo) do update set nome=excluded.nome,ativo=true;
insert into public.categorias_parada_producao(codigo,nome,ativo)
select 'IMP_'||upper(substr(md5(motivo),1,20)), motivo, true from (select distinct motivo from carga_202608060013_paradas) m
on conflict(codigo) do update set nome=excluded.nome,ativo=true;

insert into public.backup_producao_paradas_202608060013(turno_producao_id,data_operacional,turno,dados)
select t.id,t.data_operacional,t.turno,jsonb_build_object(
  'turno',to_jsonb(t),
  'producoes',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.registros_producao_moldes p where p.turno_producao_id=t.id),'[]'::jsonb),
  'paradas',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.paradas_producao_moldes s where s.turno_producao_id=t.id),'[]'::jsonb),
  'historico',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.historico_edicoes_turno_producao h where h.turno_producao_id=t.id),'[]'::jsonb)
)
from public.turnos_producao_moldes t
where exists (
  select 1 from carga_202608060013_turnos origem
  where origem.data_operacional=t.data_operacional and origem.turno=t.turno
)
on conflict(turno_producao_id) do nothing;

delete from public.paradas_producao_moldes s using public.turnos_producao_moldes t
where s.turno_producao_id=t.id and exists(select 1 from carga_202608060013_turnos o where o.data_operacional=t.data_operacional and o.turno=t.turno);
delete from public.registros_producao_moldes p using public.turnos_producao_moldes t
where p.turno_producao_id=t.id and exists(select 1 from carga_202608060013_turnos o where o.data_operacional=t.data_operacional and o.turno=t.turno);
delete from public.historico_edicoes_turno_producao h using public.turnos_producao_moldes t
where h.turno_producao_id=t.id and exists(select 1 from carga_202608060013_turnos o where o.data_operacional=t.data_operacional and o.turno=t.turno);
delete from public.turnos_producao_moldes t
where exists(select 1 from carga_202608060013_turnos o where o.data_operacional=t.data_operacional and o.turno=t.turno);

-- Excecoes historicas da planilha sao carregadas sem alterar a validacao usada pela aplicacao.
alter table public.registros_producao_moldes disable trigger validar_horario_registro_producao;
alter table public.paradas_producao_moldes disable trigger validar_horario_parada_producao;
do `$`$
declare v_usuario uuid;
begin
  select u.id into v_usuario from public.usuarios u where u.status='ATIVO' and (
    exists(select 1 from public.usuario_perfis up join public.perfis pf on pf.id=up.perfil_id
      where up.usuario_id=u.id and upper(pf.codigo) in('ADMIN','ADMINISTRADOR','GERENTE_GERAL','GERENTE_PRODUCAO','COORDENADOR_PRODUCAO'))
    or exists(select 1 from public.usuario_areas_operacionais ua join public.areas_checklist a on a.id=ua.area_id
      where ua.usuario_id=u.id and upper(a.codigo)='MOLDAGEM'))
  order by case when u.perfil in ('ADMIN','ADMINISTRADOR') then 0 else 1 end,u.criado_em limit 1;
  if v_usuario is null then raise exception 'Nao existe usuario ativo com acesso a Moldagem para registrar a importacao.'; end if;
  perform set_config('request.jwt.claim.sub',v_usuario::text,true);
  insert into public.turnos_producao_moldes(data_operacional,turno,status,fechado_por,fechado_em,criado_por)
  select data_operacional,turno,'FECHADO',v_usuario,now(),v_usuario
  from carga_202608060013_turnos o;

  insert into public.registros_producao_moldes(
    turno_producao_id,data_operacional,turno,produto_id,inicio,fim,
    quantidade_planejada,quantidade_produzida,quantidade_aprovada,quantidade_refugada,
    moldes_vazados,moldes_quebrados,pecas_por_molde,peso_peca_kg,total_pecas,
    toneladas_produzidas,observacao,criado_por,composicao_producao_id,grupo_producao
  )
  select t.id,o.data_operacional,o.turno,p.id,o.inicio,o.fim,0,o.moldes_vazados+o.moldes_quebrados,
    o.moldes_vazados,o.moldes_quebrados,o.moldes_vazados,o.moldes_quebrados,coalesce(p.cavidades_molde,0),coalesce(p.peso_peca_kg,0),
    o.moldes_vazados*coalesce(p.cavidades_molde,0),o.moldes_vazados*coalesce(p.cavidades_molde,0)*coalesce(p.peso_peca_kg,0)/1000,
    null,v_usuario,null,null
  from carga_202608060013_producoes o
  join public.turnos_producao_moldes t using(data_operacional,turno)
  join public.produtos p on upper(trim(p.codigo))=o.codigo_produto
  where o.codigo_produto<>'MS0018/19';

  insert into public.registros_producao_moldes(
    turno_producao_id,data_operacional,turno,produto_id,inicio,fim,
    quantidade_planejada,quantidade_produzida,quantidade_aprovada,quantidade_refugada,
    moldes_vazados,moldes_quebrados,pecas_por_molde,peso_peca_kg,total_pecas,
    toneladas_produzidas,observacao,criado_por,composicao_producao_id,grupo_producao
  )
  select t.id,o.data_operacional,o.turno,p.id,o.inicio,o.fim,0,o.moldes_vazados+o.moldes_quebrados,
    o.moldes_vazados,o.moldes_quebrados,o.moldes_vazados,o.moldes_quebrados,p.cavidades_molde,p.peso_peca_kg,
    o.moldes_vazados*p.cavidades_molde,o.moldes_vazados*p.cavidades_molde*p.peso_peca_kg/1000,
    'Composicao MS0018/19: 50% '||p.codigo,v_usuario,c.id,'IMPORT-202608060013-'||o.linha_origem
  from carga_202608060013_producoes o
  join public.turnos_producao_moldes t using(data_operacional,turno)
  join public.composicoes_producao c on c.codigo='MS0018/19'
  join public.composicoes_producao_itens ci on ci.composicao_id=c.id and ci.percentual=50
  join public.produtos p on p.id=ci.produto_id
  where o.codigo_produto='MS0018/19';

  insert into public.paradas_producao_moldes(
    turno_producao_id,data_operacional,turno,categoria_id,setor_responsavel_id,
    motivo,inicio,fim,duracao_minutos,observacao,criado_por
  )
  select t.id,o.data_operacional,o.turno,c.id,s.id,o.motivo,o.inicio,o.fim,
    round(extract(epoch from(o.fim-o.inicio))/60)::integer,o.observacao,v_usuario
  from carga_202608060013_paradas o
  join public.turnos_producao_moldes t using(data_operacional,turno)
  join public.setores_responsaveis_parada s on s.codigo='IMP_'||upper(substr(md5(o.setor),1,20))
  join public.categorias_parada_producao c on c.codigo='IMP_'||upper(substr(md5(o.motivo),1,20));
end `$`$;
alter table public.registros_producao_moldes enable trigger validar_horario_registro_producao;
alter table public.paradas_producao_moldes enable trigger validar_horario_parada_producao;

do `$`$
declare v_turnos integer;v_producoes integer;v_paradas integer;v_composicoes integer;
begin
  select count(distinct t.id),count(distinct p.id),count(distinct s.id) into v_turnos,v_producoes,v_paradas
  from public.turnos_producao_moldes t
  left join public.registros_producao_moldes p on p.turno_producao_id=t.id
  left join public.paradas_producao_moldes s on s.turno_producao_id=t.id
  where exists(select 1 from carga_202608060013_turnos o where o.data_operacional=t.data_operacional and o.turno=t.turno);
  select count(*) into v_composicoes from public.registros_producao_moldes where grupo_producao like 'IMPORT-202608060013-%';
  if v_producoes<>1331 or v_paradas<>3943 or v_composicoes<>14 then
    raise exception 'Validacao final falhou: turnos %, producoes %, paradas %, itens composicao %',v_turnos,v_producoes,v_paradas,v_composicoes;
  end if;
  if exists(select 1 from public.registros_producao_moldes p join public.turnos_producao_moldes t on t.id=p.turno_producao_id where exists(select 1 from carga_202608060013_turnos o where o.data_operacional=t.data_operacional and o.turno=t.turno) and p.moldes_quebrados is null) then
    raise exception 'Existem moldes quebrados nulos apos a carga.';
  end if;
end `$`$;

commit;
"@

$directory = Split-Path -Parent $OutputPath
if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
[IO.File]::WriteAllText((Join-Path (Resolve-Path $directory) (Split-Path -Leaf $OutputPath)), $migration, [Text.UTF8Encoding]::new($false))
Write-Output "Producoes de origem: $($productions.Count)"
Write-Output "Paradas de origem: $($stops.Count)"
Write-Output "Composicoes MS0018/19: $(($productions | Where-Object Code -eq 'MS0018/19').Count)"
Write-Output "Moldes quebrados vazios convertidos para zero: $(($productionRows | Where-Object { -not $_.Cells.G.Trim() }).Count)"
Write-Output "Marcadores nao numericos de moldes quebrados convertidos para zero: $invalidBrokenAsZero"
Write-Output "Motivos recuperados da coluna de observacao: $promotedStopReasons"
Write-Output "Paradas em turnos sem producao: $($stopOnlyShifts.Count)"
Write-Output "Chaves repetidas de parada preservadas: $($duplicateStopKeys.Count)"
Write-Output "Producoes historicas fora da janela atual do turno: $($outsideProductions.Count)"
Write-Output "Paradas historicas fora da janela atual do turno: $($outsideStops.Count)"
Write-Output "Migracao: $OutputPath"
