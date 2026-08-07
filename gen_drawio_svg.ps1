$drawio = Get-Content 'c:\AI_WEB_LAB\meshlog.camal.eu\Meshlog-App\meshlog-flow-diagram.drawio' -Raw -Encoding UTF8
$escaped = [System.Security.SecurityElement]::Escape($drawio)
$svg = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="2300px" height="2400px" viewBox="-0.5 -0.5 2300 2400" content="$escaped"><defs/><g/></svg>
"@
[System.IO.File]::WriteAllText('c:\AI_WEB_LAB\meshlog.camal.eu\Meshlog-App\meshlog-flow-diagram.drawio.svg', $svg, [System.Text.Encoding]::UTF8)
Write-Host "Generated meshlog-flow-diagram.drawio.svg"
