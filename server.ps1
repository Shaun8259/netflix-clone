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
    ".json" = "application/json; charset=utf-8"
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
                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                [System.IO.File]::WriteAllText($catalogFile, $body, [System.Text.Encoding]::UTF8)
                $resBytes = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $resBytes.Length
                $response.StatusCode = 200
                if ($request.HttpMethod -ne "HEAD") {
                    try { $response.OutputStream.Write($resBytes, 0, $resBytes.Length) } catch {}
                }
            } else {
                if (Test-Path $catalogFile) {
                    $bytes = [System.IO.File]::ReadAllBytes($catalogFile)
                } else {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{}')
                }
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.StatusCode = 200
                if ($request.HttpMethod -ne "HEAD") {
                    try { $response.OutputStream.Write($bytes, 0, $bytes.Length) } catch {}
                }
            }
            try { $response.OutputStream.Close() } catch {}
            continue
        }

        # REAL-TIME VIDEO & MEDIA UPLOAD API ENDPOINT
        if ($localPath -eq "/api/upload") {
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")
            $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

            if ($request.HttpMethod -eq "OPTIONS") {
                $response.StatusCode = 200
                try { $response.OutputStream.Close() } catch {}
                continue
            }

            if ($request.HttpMethod -eq "POST") {
                $uploadsDir = Join-Path $root "uploads"
                if (-not (Test-Path $uploadsDir)) { New-Item -ItemType Directory -Path $uploadsDir | Out-Null }

                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                
                $fileName = "video_" + (Get-Date -Format "yyyyMMddHHmmssfff") + ".mp4"
                if ($body -match '"filename"\s*:\s*"([^"]+)"') {
                    $fileName = $matches[1]
                }
                
                if ($body -match '"base64"\s*:\s*"(?:data:[^;]+;base64,)?([^"]+)"') {
                    $base64Data = $matches[1]
                    $filePath = Join-Path $uploadsDir $fileName
                    $bytes = [System.Convert]::FromBase64String($base64Data)
                    [System.IO.File]::WriteAllBytes($filePath, $bytes)

                    $relUrl = "/uploads/" + $fileName
                    $resObj = @{ success = $true; url = $relUrl } | ConvertTo-Json
                    $resBytes = [System.Text.Encoding]::UTF8.GetBytes($resObj)

                    $response.ContentType = "application/json"
                    $response.ContentLength64 = $resBytes.Length
                    $response.StatusCode = 200
                    if ($request.HttpMethod -ne "HEAD") {
                        try { $response.OutputStream.Write($resBytes, 0, $resBytes.Length) } catch {}
                    }
                } else {
                    $response.StatusCode = 400
                }
            }
            try { $response.OutputStream.Close() } catch {}
            continue
        }

        if ($localPath -eq "/") { $localPath = "/login.html" }

        $filePath = Join-Path $root ($localPath -replace '/', '\')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = $mimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.Headers.Add("Accept-Ranges", "bytes")
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.StatusCode = 200
            if ($request.HttpMethod -ne "HEAD") {
                try {
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } catch {}
            }
            try { $response.OutputStream.Close() } catch {}
            continue
        } else {
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.StatusCode = 404
            $response.ContentType = "text/plain"
            $response.ContentLength64 = $msg.Length
            if ($request.HttpMethod -ne "HEAD") {
                try {
                    $response.OutputStream.Write($msg, 0, $msg.Length)
                } catch {}
            }
            try { $response.OutputStream.Close() } catch {}
            continue
        }
    }
} finally {
    $listener.Stop()
}
