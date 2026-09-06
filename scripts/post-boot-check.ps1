<#
.SYNOPSIS
  Verify that the unattended deployment came back by itself after a reboot.

.DESCRIPTION
  The app is meant to survive a restart with no human involvement:

      Windows login -> Rancher Desktop (autoStart, startInBackground)
                    -> dockerd
                    -> spotify-now-playing (restart: unless-stopped)

  Nothing in that chain reports failure anywhere the user would notice. A silent failure looks
  exactly like a quiet listening day, and the corpus simply stops growing -- which is the one
  outcome that matters, because the hypothesis gate is waiting on live plays.

  Run with -Baseline BEFORE rebooting, then with no arguments afterwards.

.EXAMPLE
  powershell -File scripts/post-boot-check.ps1 -Baseline    # before the reboot
  powershell -File scripts/post-boot-check.ps1              # after logging back in
#>
[CmdletBinding()]
param(
  [switch]$Baseline,
  # ⚠️ NOT defaulted to a $PSScriptRoot expression: in PowerShell 5.1 $PSScriptRoot is empty
  # during parameter binding, which silently wrote the baseline to the root of the drive.
  # Found by running this, not by reading it.
  [string]$BaselinePath,
  [string]$Container = 'spotify-now-playing',
  [int]$Port = 3010
)

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSCommandPath
if (-not $BaselinePath) { $BaselinePath = Join-Path $root '..\.boot-check-baseline.json' }

function Get-DockerCli {
  $cmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = 'C:\Program Files\Rancher Desktop\resources\resources\win32\bin\docker.exe'
  if (Test-Path $fallback) { return $fallback }
  return $null
}

function Get-BootTime {
  return (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
}

function Get-PlayStats {
  # Read-only; never interferes with the container's writer.
  $db = Join-Path $root '..\data\history.db'
  if (-not (Test-Path $db)) { return $null }
  # argv[0] is node, argv[1] is this script, argv[2] is the database path.
  $js = @'
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const o={
  plays: db.prepare('select count(*) c from play').get().c,
  observations: db.prepare('select count(*) c from observation').get().c,
  latestPlay: db.prepare('select max(started_at) m from play').get().m,
  integrity: db.prepare('pragma integrity_check').get().integrity_check,
};
console.log(JSON.stringify(o));
'@
  $tmp = Join-Path $env:TEMP 'spotify-playstats.cjs'
  Set-Content -Path $tmp -Value $js -Encoding utf8
  $out = & node $tmp (Resolve-Path $db).Path 2>$null
  Remove-Item $tmp -ErrorAction SilentlyContinue
  if (-not $out) { return $null }
  return ($out | ConvertFrom-Json)
}

function Get-WsHandshakeStatus {
  <#
    The WebSocket handshake, done with a raw socket so it works on PowerShell 5.1 without
    async plumbing. Returns the HTTP status code from the response line, or $null.

    Why this exists: on 2026-09-05 the upgrade handler in server.ts held a SECOND copy of the
    local-access rule, which never learned about TRUST_PUBLISHED_PORT. In the container every
    page load returned 200 and every handshake returned 403, so the UI loaded and sat on
    "Disconnected - reconnecting..." forever -- and this script reported all-green, because
    a 200 on / does not prove the browser can open its socket. Check the surface the UI uses.
  #>
  param(
    [int]$Port,
    [string]$Path = '/ws',
    [string]$Origin = ''
  )
  $client = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', $Port)
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000
    $req  = "GET $Path HTTP/1.1`r`n"
    $req += "Host: localhost:$Port`r`n"
    $req += "Upgrade: websocket`r`n"
    $req += "Connection: Upgrade`r`n"
    $req += "Sec-WebSocket-Version: 13`r`n"
    $req += "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==`r`n"
    if ($Origin) { $req += "Origin: $Origin`r`n" }
    $req += "`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $buf = New-Object byte[] 256
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $head = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    if ($head -match 'HTTP/1\.1 (\d{3})') { return [int]$Matches[1] }
    return $null
  } catch {
    return $null
  } finally {
    if ($client) { $client.Close() }
  }
}

$docker = Get-DockerCli

# ---------------------------------------------------------------- baseline ---
if ($Baseline) {
  $stats = Get-PlayStats
  $startedAt = $null
  if ($docker) { $startedAt = & $docker inspect $Container --format '{{.State.StartedAt}}' 2>$null }

  $record = [ordered]@{
    capturedAt       = (Get-Date).ToUniversalTime().ToString('o')
    bootTimeBefore   = (Get-BootTime).ToUniversalTime().ToString('o')
    containerStarted = $startedAt
    plays            = $null
    observations     = $null
    latestPlay       = $null
  }
  if ($stats) {
    $record.plays        = $stats.plays
    $record.observations = $stats.observations
    $record.latestPlay   = $stats.latestPlay
  }

  $record | ConvertTo-Json | Set-Content -Path $BaselinePath -Encoding utf8
  Write-Output "BASELINE CAPTURED -> $BaselinePath"
  $record.GetEnumerator() | ForEach-Object { Write-Output ("  {0,-16} {1}" -f $_.Key, $_.Value) }
  Write-Output ""
  Write-Output "Safe to reboot. Afterwards run:  powershell -File scripts/post-boot-check.ps1"
  return
}

# ------------------------------------------------------------------ verify ---
Write-Output "POST-BOOT VERIFICATION - $Container"
Write-Output ("=" * 62)

$pass = @()
$fail = @()
$info = @()
# Kept apart from $fail so the problem count stays a count of problems, not of printed lines.
$logDetail = @()

# The two things this script exists to establish. Everything else can pass while the actual
# question -- "did the chain restore itself?" -- remains unanswered, so they are tracked
# separately and the verdict refuses to claim success without them.
$rebooted = $false
$autoStarted = $false

$boot = Get-BootTime
Write-Output ("Host booted        : {0}  ({1:n1} min ago)" -f $boot, ((Get-Date) - $boot).TotalMinutes)

$base = $null
if (Test-Path $BaselinePath) {
  $base = Get-Content $BaselinePath -Raw | ConvertFrom-Json
  $prevBoot = [datetime]::Parse($base.bootTimeBefore)
  if ($boot -gt $prevBoot) {
    $rebooted = $true
    $pass += "A reboot did occur since the baseline was taken"
  } else {
    $info += "NO REBOOT DETECTED since the baseline - the machine has not restarted yet"
  }
} else {
  $info += "No baseline file at $BaselinePath - comparisons will be skipped"
}

# 1. Rancher Desktop -----------------------------------------------------------
$rd = Get-Process 'Rancher Desktop' -ErrorAction SilentlyContinue
if ($rd) { $pass += "Rancher Desktop is running (started automatically)" }
else     { $fail += "Rancher Desktop is NOT running - application.autoStart did not take effect" }

# 2. Container engine ----------------------------------------------------------
if (-not $docker) {
  $fail += "docker CLI not found - cannot check the container"
} else {
  & $docker info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -eq 0) { $pass += "Container engine (dockerd) is up and responding" }
  else { $fail += "dockerd is not responding - Rancher Desktop may still be starting" }
}

# 3. The container itself ------------------------------------------------------
$startedAt = $null
if ($docker) {
  $running = & $docker inspect $Container --format '{{.State.Running}}' 2>$null
  if ($LASTEXITCODE -ne 0) {
    $fail += "Container '$Container' does not exist on this engine"
  } elseif ($running -eq 'true') {
    $pass += "Container is running"
    $startedAt = [datetime]::Parse((& $docker inspect $Container --format '{{.State.StartedAt}}'))
    $health = & $docker inspect $Container --format '{{.State.Health.Status}}' 2>$null
    if ($health -eq 'healthy') { $pass += "Healthcheck reports healthy" }
    else { $info += "Healthcheck status is '$health' (may still be in its start period)" }

    if ($startedAt -gt $boot) {
      $lag = ($startedAt - $boot).TotalSeconds
      if ($lag -gt 600) {
        # Long after boot means a human almost certainly started it -- which proves nothing
        # about the automatic chain. Say so rather than banking an unearned PASS.
        $info += ("Container started {0:n0}s after boot - too long to be the autostart chain; was it started by hand?" -f $lag)
      } else {
        $autoStarted = $true
        $pass += ("Container started AFTER boot, by itself - {0:n0}s after boot" -f $lag)
      }
    } else {
      $info += "Container start time precedes boot - it did not restart with the machine"
    }
  } else {
    $exit = & $docker inspect $Container --format '{{.State.ExitCode}}' 2>$null
    $fail += "Container is NOT running (last exit code $exit)"
    # `unless-stopped` deliberately does not restart a container that was explicitly stopped.
    $fail += "  If it was stopped with 'docker stop' before the reboot, that is expected - run 'docker compose up -d'"
  }
}

# 4. Startup errors in the logs since this boot --------------------------------
if ($docker -and $startedAt) {
  $since = $startedAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

  # ⚠️ Do NOT use `2>&1` on a native exe here. PowerShell 5.1 wraps each stderr line in an
  # ErrorRecord (NativeCommandError), and those wrapper lines contain the word "Error" -- so the
  # scan below flagged PowerShell's own plumbing as an application error. A false positive in a
  # health check is worse than no check: it trains you to ignore the output. Redirecting both
  # streams to files keeps them as plain text. The app logs to BOTH streams, so both are read.
  $outFile = Join-Path $env:TEMP 'spotify-boot-logs.out.txt'
  $errFile = Join-Path $env:TEMP 'spotify-boot-logs.err.txt'
  Start-Process -FilePath $docker `
    -ArgumentList @('logs', $Container, '--since', $since) `
    -NoNewWindow -Wait -RedirectStandardOutput $outFile -RedirectStandardError $errFile

  $logs = ''
  foreach ($f in @($outFile, $errFile)) {
    if (Test-Path $f) {
      $c = Get-Content $f -Raw
      if ($c) { $logs += $c + "`n" }
    }
  }
  Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
  $lines = $logs -split "`r?`n" | Where-Object { $_.Trim() -ne '' }

  # "0 error(s)" is a SUCCESS line from the label sweep - do not let it read as a failure.
  $bad = $lines | Where-Object {
    ($_ -match '(?i)error|failed|unable|denied|EACCES|ECONN|degraded') -and
    ($_ -notmatch '(?i)0 error\(s\)') -and
    ($_ -notmatch '(?i)ExperimentalWarning|trace-warnings')
  }

  if ($bad) {
    $fail += ("Errors in the startup logs ({0} line(s)):" -f @($bad).Count)
    $bad | Select-Object -First 12 | ForEach-Object { $logDetail += "        $_" }
  } else {
    $pass += "No errors in the startup logs"
  }

  # The bind mount is the fragile part of a boot: /mnt/d may not be ready when dockerd starts.
  if ($logs -match 'History: .*schema v(\d+)') {
    $pass += "Database opened through the bind mount (schema v$($Matches[1]))"
  } else {
    $fail += "No 'History:' line - the app may not have opened the database"
  }
}

# 5. The app answers, and is still guarded -------------------------------------
try {
  $r = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 10
  if ($r.StatusCode -eq 200) { $pass += "UI responds on http://localhost:$Port" }
} catch {
  $fail += "UI did not respond on port $Port : $($_.Exception.Message)"
}

try {
  Invoke-WebRequest -Uri "http://localhost:$Port/" -Headers @{ 'Origin' = 'http://evil.com' } -UseBasicParsing -TimeoutSec 10 | Out-Null
  $fail += "SECURITY: a cross-site Origin was ACCEPTED - the DNS-rebinding defence is not in force"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 403) {
    $pass += "Cross-site Origin still rejected with 403 (guard intact)"
  } else {
    $info += "Cross-site Origin check returned $($_.Exception.Response.StatusCode.value__), expected 403"
  }
}

# The socket the UI actually depends on. A 200 on / does NOT imply this works -- see
# Get-WsHandshakeStatus for the defect that taught us so.
$wsStatus = Get-WsHandshakeStatus -Port $Port -Origin "http://localhost:$Port"
if ($wsStatus -eq 101) {
  $pass += "WebSocket handshake accepted (101) - the live display updates, not just the page load"
} elseif ($null -eq $wsStatus) {
  $fail += "WebSocket handshake got no response - the UI will sit on 'Disconnected - reconnecting...'"
} else {
  $fail += "WebSocket handshake refused with $wsStatus - the UI loads but never updates. Check that the upgrade handler in server.ts still routes through decideAccess"
}

$wsCrossSite = Get-WsHandshakeStatus -Port $Port -Origin 'http://evil.com'
if ($wsCrossSite -eq 403) {
  $pass += "Cross-site Origin rejected on the WebSocket too (403)"
} elseif ($wsCrossSite -eq 101) {
  $fail += "SECURITY: a cross-site Origin was ACCEPTED on the WebSocket upgrade"
} else {
  $info += "WebSocket cross-site Origin check returned '$wsCrossSite', expected 403"
}

# 6. The data ------------------------------------------------------------------
$stats = Get-PlayStats
if ($stats) {
  if ($stats.integrity -eq 'ok') { $pass += "Database integrity_check: ok" }
  else { $fail += "DATABASE INTEGRITY: $($stats.integrity)" }

  if ($base -and $base.plays) {
    $delta = $stats.plays - $base.plays
    $info += "Plays: $($base.plays) -> $($stats.plays)  (+$delta since the baseline)"
  } else {
    $info += "Plays: $($stats.plays), observations: $($stats.observations)"
  }
  $info += "Most recent play started: $($stats.latestPlay)"
}

# ------------------------------------------------------------------ verdict ---
Write-Output ""
foreach ($p in $pass) { Write-Output "  [PASS] $p" }
foreach ($i in $info) { Write-Output "  [INFO] $i" }
foreach ($f in $fail) { Write-Output "  [FAIL] $f" }
foreach ($d in $logDetail) { Write-Output $d }

Write-Output ""
Write-Output ("=" * 62)
if ($fail.Count -gt 0) {
  Write-Output "VERDICT: $($fail.Count) problem(s) above. The chain did not fully self-restore."
  exit 1
} elseif (-not $rebooted) {
  Write-Output "VERDICT: INCONCLUSIVE - the app is healthy, but no reboot has happened since the"
  Write-Output "         baseline, so the autostart chain has not actually been tested yet."
  exit 2
} elseif (-not $autoStarted) {
  Write-Output "VERDICT: INCONCLUSIVE - the machine rebooted and the app is healthy, but the"
  Write-Output "         container did not start close enough to boot to credit the autostart"
  Write-Output "         chain. If you started it by hand, the chain is still unproven."
  exit 2
} else {
  Write-Output "VERDICT: CONFIRMED - the machine rebooted and the whole chain restored itself"
  Write-Output "         with no intervention. Nothing to do."
  exit 0
}
