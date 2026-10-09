# Tiny static web server for Windows (no Python needed), then opens the game.
param([int]$Port = 8642)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\') + '\'

$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host "Couldn't start a local web server."; Read-Host "Press Enter to close"; exit 1 }

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  Elf on the Shelf: Hollow Hill is running at $url"
Write-Host "  Close this window when you're done playing."
Write-Host ""
# Edge ships with Windows; app mode gives a clean window without tabs
try { Start-Process 'msedge' "--app=$url --start-fullscreen" -ErrorAction Stop } catch { Start-Process $url }

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $file.StartsWith($root) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
    } else {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $ctx.Response.Close()
  } catch { }
}
