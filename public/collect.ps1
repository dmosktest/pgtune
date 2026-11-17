# pgtune host collector — runs on YOUR machine only.
# Prints a pgtune URL with query params. Nothing is uploaded.
# Usage:
#   irm https://pgtune.dmosk.net/collect.ps1 | iex
#   & ([scriptblock]::Create((irm https://pgtune.dmosk.net/collect.ps1))) -Lang ru
# Env: PGTUNE_ORIGIN, PGTUNE_LANG

param(
  [string]$Lang = $(if ($env:PGTUNE_LANG) { $env:PGTUNE_LANG } else { "en" })
)

$ErrorActionPreference = "Stop"
$Origin = if ($env:PGTUNE_ORIGIN) { $env:PGTUNE_ORIGIN.TrimEnd("/") } else { "https://pgtune.dmosk.net" }

$osType = "windows"
$ramGb = 16
try {
  $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
  $ramGb = [Math]::Max(1, [int][Math]::Round($cs.TotalPhysicalMemory / 1GB))
} catch {}

$cpu = $null
try {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
  if (-not $cpu -or $cpu -lt 1) { $cpu = $null }
} catch {}

$hd = "ssd"
try {
  $disk = Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($disk) {
    switch -Regex ($disk.MediaType) {
      "HDD" { $hd = "hdd" }
      "SSD" { $hd = "ssd" }
      "Unspecified" {
        if ("$($disk.FriendlyName)" -match "NVMe|nvme") { $hd = "nvme" } else { $hd = "ssd" }
      }
      default {
        if ("$($disk.BusType)" -match "NVMe") { $hd = "nvme" }
      }
    }
  }
} catch {}

$dbVer = "16"
try {
  $out = & psql -Atqc "show server_version_num" 2>$null
  if ($out) {
    $n = [int]($out.ToString().Trim())
    $maj = [int]($n / 10000)
    if ($maj -ge 14 -and $maj -le 19) { $dbVer = "$maj" }
  }
} catch {}

$qs = "v=$dbVer&os=$osType&ram=$ramGb&unit=GB&hd=$hd&db=web"
if ($cpu) { $qs += "&cpu=$cpu" }
$url = "$Origin/$Lang/?$qs"

Write-Host "pgtune collector (local only — nothing uploaded)"
Write-Host "  os=$osType ram=${ramGb}GB cpu=$(if ($cpu) { $cpu } else { '?' }) hd=$hd pg=$dbVer"
Write-Host ""
Write-Host $url
Write-Host ""
Write-Host "Open the link, review values, then press Generate."
