$port = 8082
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Servidor web encendido en http://localhost:$port/"
Write-Host "Presiona Ctrl+C para detenerlo."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }
        
        # Eliminar barra inicial si existe
        if ($path.StartsWith("/")) {
            $path = $path.Substring(1)
        }
        
        $fullPath = Join-Path (Get-Location).Path $path

        if (Test-Path $fullPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
            $mimeType = "application/octet-stream"
            switch ($ext) {
                ".html" { $mimeType = "text/html; charset=utf-8" }
                ".css"  { $mimeType = "text/css" }
                ".js"   { $mimeType = "application/javascript; charset=utf-8" }
                ".json" { $mimeType = "application/json" }
                ".png"  { $mimeType = "image/png" }
                ".jpg"  { $mimeType = "image/jpeg" }
                ".jpeg" { $mimeType = "image/jpeg" }
                ".ico"  { $mimeType = "image/x-icon" }
            }

            $response.ContentType = $mimeType
            
            # Read file and write to output
            try {
                $stream = [System.IO.File]::OpenRead($fullPath)
                $response.ContentLength64 = $stream.Length
                $buffer = New-Object Byte[] 65536
                while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $response.OutputStream.Write($buffer, 0, $read)
                }
                $stream.Close()
                $response.StatusCode = 200
                Write-Host "200 OK: $path"
            } catch {
                $response.StatusCode = 500
                Write-Host "500 Error: $path"
            }
        } else {
            $response.StatusCode = 404
            Write-Host "404 No encontrado: $path"
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}
