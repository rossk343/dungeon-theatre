$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$client = Join-Path $root 'client'
$project = Join-Path $root 'server\DungeonTheatre.Api\DungeonTheatre.Api.csproj'
$output = Join-Path $root 'artifacts\windows-x64'

Push-Location $client
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}
finally {
    Pop-Location
}

dotnet publish $project --configuration Release --runtime win-x64 --self-contained true --output $output
if ($LASTEXITCODE -ne 0) { throw 'API publish failed.' }

$webRoot = Join-Path $output 'wwwroot'
New-Item -ItemType Directory -Force -Path $webRoot | Out-Null
Copy-Item -Path (Join-Path $client 'dist\*') -Destination $webRoot -Recurse -Force
Set-Content -LiteralPath (Join-Path $output 'dungeon-theatre-portable') -Value 'portable'
Write-Host "Portable app ready in $output"
