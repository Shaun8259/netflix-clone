$port = 8085
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$lanIP = "localhost"
try {
    $ipList = Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -ExpandProperty IPAddress
    if ($ipList) {
        if ($ipList -is [array]) { $lanIP = $ipList[0] } else { $lanIP = $ipList }
    }
} catch {}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
} catch {
    Write-Host "Listener already running on port $port"
}

$localUrl = "http://localhost:" + $port + "/login.html"
$lanUrl = "http://" + $lanIP + ":" + $port + "/login.html"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Red
Write-Host "  HODISHAUNFLIX DEV SERVER RUNNING" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Red
Write-Host "  Local PC URL   : $localUrl" -ForegroundColor Green
Write-Host "  Mobile/LAN URL : $lanUrl" -ForegroundColor Yellow
Write-Host "--------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Share $lanUrl with any phone/device on Wi-Fi" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Red
Write-Host ""

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".gif"  = "image/gif"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".mp4"  = "video/mp4"
    ".webm" = "video/webm"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $localPath = $request.Url.LocalPath

        # REAL-TIME CATALOG API ENDPOINT FOR INSTANT LOCAL & LAN SYNC
        if ($localPath -eq "/api/catalog") {
            $catalogFile = Join-Path $root "catalog.json"
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

            if ($request.HttpMethod -eq "OPTIONS") {
                $response.StatusCode = 200
                $response.OutputStream.Close()
                continue
            }

            if ($request.HttpMethod -eq "POST" -or $request.HttpMethod -eq "PUT") {
                $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                $body = $reader.ReadToEnd()
                [System.IO.File]::WriteAllText($catalogFile, $body, [System.Text.Encoding]::UTF8)
                $response.ContentType = "application/json"
                $response.StatusCode = 200
                $resBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $response.ContentLength64 = $resBytes.Length
                $response.OutputStream.Write($resBytes, 0, $resBytes.Length)
            } else {
                if (Test-Path $catalogFile) {
                    $bytes = [System.IO.File]::ReadAllBytes($catalogFile)
                } else {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{}')
                }
                $response.ContentType = "application/json"
                $response.StatusCode = 200
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $response.OutputStream.Close()
            continue
        }

        if ($localPath -eq "/") { $localPath = "/login.html" }

        $filePath = Join-Path $root ($localPath -replace '/', '\')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = $mimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }

            $response.ContentType = $contentType
            $response.StatusCode = 200
            $response.Headers.Add("Access-Control-Allow-Origin", "*")

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentType = "text/plain"
            $response.ContentLength64 = $msg.Length
            $response.OutputStream.Write($msg, 0, $msg.Length)
        }

        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
