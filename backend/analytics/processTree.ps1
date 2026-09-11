# Resource metadata only. Do not collect command lines, paths or process names.
$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,UserModeTime,KernelModeTime,WorkingSetSize |
  ForEach-Object { [pscustomobject]@{
    pid = [int]$_.ProcessId
    ppid = [int]$_.ParentProcessId
    start = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().Ticks.ToString() } else { '' }
    cpu = ([double]$_.UserModeTime + [double]$_.KernelModeTime) / 10000000
    rss = [double]$_.WorkingSetSize
  } } | ConvertTo-Json -Compress
