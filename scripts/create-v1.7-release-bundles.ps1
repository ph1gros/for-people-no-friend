[CmdletBinding()]
param(
    [string]$BaseRoot = 'release\win-unpacked',
    [string]$SpeechSourceRoot = 'release\v1.7-slim-speech-source',
    [string]$OutputRoot = 'release\v1.7-artifacts'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-RepositoryPath([string]$Value, [switch]$MustExist) {
    $candidate = if ([IO.Path]::IsPathRooted($Value)) { $Value } else { Join-Path $repositoryRoot $Value }
    if ($MustExist) { return (Resolve-Path -LiteralPath $candidate).Path }
    return [IO.Path]::GetFullPath($candidate)
}

function Assert-Within([string]$Root, [string]$Candidate) {
    $rootPrefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $Candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the release output directory: $Candidate"
    }
}

function New-ZipFromStage([string]$StageRoot, [string]$ArchivePath) {
    if (Test-Path -LiteralPath $ArchivePath) { Remove-Item -LiteralPath $ArchivePath -Force }
    Push-Location $StageRoot
    try {
        & tar.exe -a -cf $ArchivePath 'FPNF'
        if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE" }
    }
    finally { Pop-Location }
}

$baseRootPath = Resolve-RepositoryPath $BaseRoot -MustExist
$speechRootPath = Resolve-RepositoryPath $SpeechSourceRoot -MustExist
$outputRootPath = Resolve-RepositoryPath $OutputRoot
$releaseRootPath = Resolve-RepositoryPath 'release' -MustExist
Assert-Within $releaseRootPath $outputRootPath

if (Test-Path -LiteralPath $outputRootPath) { Remove-Item -LiteralPath $outputRootPath -Recurse -Force }
New-Item -ItemType Directory -Path $outputRootPath | Out-Null

$baseStage = Join-Path $outputRootPath 'stage-base'
$baseApp = Join-Path $baseStage 'FPNF'
New-Item -ItemType Directory -Path $baseApp | Out-Null
Get-ChildItem -LiteralPath $baseRootPath -Force | Copy-Item -Destination $baseApp -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'resources\optional-assets\README-Base.zh-CN.txt') -Destination (Join-Path $baseApp '使用说明.txt')

$speechStage = Join-Path $outputRootPath 'stage-local-speech'
$speechApp = Join-Path $speechStage 'FPNF'
$speechVoiceTarget = Join-Path $speechApp 'resources\voice-runtime'
$speechInputTarget = Join-Path $speechApp 'resources\speech-input-runtime'
New-Item -ItemType Directory -Path $speechVoiceTarget | Out-Null
New-Item -ItemType Directory -Path $speechInputTarget | Out-Null

Copy-Item -LiteralPath (Join-Path $speechRootPath 'resources\voice-runtime\python') -Destination $speechVoiceTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $speechRootPath 'resources\voice-runtime\ireina_tts_service.py') -Destination $speechVoiceTarget -Force
Get-ChildItem -LiteralPath (Join-Path $speechRootPath 'resources\voice-runtime') -File -Filter 'LICENSE.*' | Copy-Item -Destination $speechVoiceTarget -Force
Copy-Item -LiteralPath (Join-Path $speechRootPath 'resources\speech-input-runtime\python') -Destination $speechInputTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $speechRootPath 'resources\speech-input-runtime\models') -Destination $speechInputTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $speechRootPath 'resources\speech-input-runtime\sensevoice_asr_service.py') -Destination $speechInputTarget -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'resources\optional-assets\README-Local-Speech.zh-CN.txt') -Destination (Join-Path $speechApp '安装说明-本地语音.txt')

$privateVoice = Get-ChildItem -LiteralPath $speechStage -Recurse -File | Where-Object {
    $_.FullName -match '[\\/]voice[\\/]ireina[\\/]' -or $_.Name -match 'ireina_e\d+_s\d+\.(?:onnx|safetensors)$'
}
if ($privateVoice) { throw 'Private Ireina voice weights were found in the public local-speech stage.' }

$required = @(
    (Join-Path $baseApp 'For People No Friend.exe'),
    (Join-Path $speechVoiceTarget 'python\python.exe'),
    (Join-Path $speechVoiceTarget 'python\Lib\site-packages\bert\deberta-v2-large-japanese-char-wwm-onnx\model_fp16.onnx'),
    (Join-Path $speechInputTarget 'python\python.exe'),
    (Join-Path $speechInputTarget 'python\Lib\site-packages\sherpa_onnx\__init__.py'),
    (Join-Path $speechInputTarget 'models\sensevoice\model.int8.onnx'),
    (Join-Path $speechInputTarget 'models\sensevoice\tokens.txt')
)
foreach ($requiredPath in $required) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Required release file is missing: $requiredPath" }
}

$baseArchive = Join-Path $outputRootPath 'FPNF-v1.7-Windows-x64.zip'
$speechArchive = Join-Path $outputRootPath 'FPNF-v1.7-Local-Speech-Runtime.zip'
New-ZipFromStage $baseStage $baseArchive
New-ZipFromStage $speechStage $speechArchive

$maximumSpeechArchiveBytes = 800MB
if ((Get-Item -LiteralPath $speechArchive).Length -gt $maximumSpeechArchiveBytes) {
    throw "The optional speech archive exceeded the 800 MiB release budget."
}

$hashLines = foreach ($archive in @($baseArchive, $speechArchive)) {
    $hash = Get-FileHash -LiteralPath $archive -Algorithm SHA256
    "$($hash.Hash)  $([IO.Path]::GetFileName($archive))"
}
Set-Content -LiteralPath (Join-Path $outputRootPath 'SHA256SUMS.txt') -Value $hashLines -Encoding utf8

Remove-Item -LiteralPath $baseStage -Recurse -Force
Remove-Item -LiteralPath $speechStage -Recurse -Force
Get-ChildItem -LiteralPath $outputRootPath -File | Select-Object Name, Length
