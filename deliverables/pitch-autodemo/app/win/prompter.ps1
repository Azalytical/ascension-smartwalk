# Aidem pitch: the prompter window on Windows (always on top, hidden from screen capture). Started by show.mjs.
# Compiles Prompter.cs with the C# compiler that comes with Windows (.NET Framework 4) and shows the window.
param([string]$State)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$log = Join-Path $env:TEMP 'aidem-pitch-prompter.log'
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'AidemPitchPrompterWindow', [ref]$created)
if (-not $created) { exit 0 }  # already open
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions
  $src = Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'Prompter.cs')
  Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions
  if (-not $State) { $State = Join-Path $env:TEMP 'aidem-pitch-prompter.json' }
  [AidemPrompter.PrompterForm]::Run($dir, $State)
} catch {
  ($_ | Out-String) | Out-File -Encoding UTF8 $log
  exit 1
} finally { $mutex.ReleaseMutex() }
