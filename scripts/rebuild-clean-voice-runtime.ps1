[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BertAssetRoot,
    [string]$OutputRoot = 'release\voice-runtime-clean',
    [string]$PythonLauncher = 'py'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = (Resolve-Path (Join-Path $repositoryRoot 'release')).Path
$outputPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputRoot))
$releasePrefix = $releaseRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $outputPath.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The clean voice runtime output must stay inside the repository release directory.'
}

$bertPath = (Resolve-Path -LiteralPath $BertAssetRoot).Path
$bertModel = Join-Path $bertPath 'deberta-v2-large-japanese-char-wwm-onnx\model_fp16.onnx'
if (-not (Test-Path -LiteralPath $bertModel -PathType Leaf)) {
    throw 'The supplied Japanese BERT asset root is incomplete.'
}

$downloadRoot = Join-Path $outputPath '.downloads'
$pythonRoot = Join-Path $outputPath 'python'
$sitePackages = Join-Path $pythonRoot 'Lib\site-packages'
$pythonArchive = Join-Path $downloadRoot 'python-3.12.10-embed-amd64.zip'
$dictionaryArchive = Join-Path $downloadRoot 'open_jtalk_dic_utf_8-1.11.tar.gz'
$pythonSha256 = '4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3'
$dictionarySha256 = 'FE6BA0E43542CEF98339ABDFFD903E062008EA170B04E7E2A35DA805902F382A'

if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Recurse -Force
}
New-Item -ItemType Directory -Path $downloadRoot, $sitePackages | Out-Null

Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $pythonArchive
Invoke-WebRequest -Uri 'https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz' -OutFile $dictionaryArchive
if ((Get-FileHash -LiteralPath $pythonArchive -Algorithm SHA256).Hash -ne $pythonSha256) {
    throw 'The Python embeddable archive hash did not match the pinned value.'
}
if ((Get-FileHash -LiteralPath $dictionaryArchive -Algorithm SHA256).Hash -ne $dictionarySha256) {
    throw 'The Open JTalk dictionary archive hash did not match the pinned value.'
}

Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonRoot
$pthPath = Join-Path $pythonRoot 'python312._pth'
$pth = Get-Content -LiteralPath $pthPath
$pth = @($pth | Where-Object { $_ -ne '#import site' }) + 'Lib/site-packages' + 'import site'
Set-Content -LiteralPath $pthPath -Value $pth -Encoding ascii

$lockPath = Join-Path $repositoryRoot 'resources\voice-runtime\requirements.lock'
& $PythonLauncher -3.12 -m pip install --disable-pip-version-check --no-deps --target $sitePackages -r $lockPath
if ($LASTEXITCODE -ne 0) { throw "pip failed with exit code $LASTEXITCODE" }

Copy-Item -LiteralPath $bertPath -Destination (Join-Path $sitePackages 'bert') -Recurse -Force
$dictionaryTarget = Join-Path $sitePackages 'pyopenjtalk\open_jtalk_dic_utf_8-1.11'
New-Item -ItemType Directory -Path $dictionaryTarget | Out-Null
& tar.exe -xzf $dictionaryArchive -C (Join-Path $sitePackages 'pyopenjtalk')
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }

Copy-Item -LiteralPath (Join-Path $repositoryRoot 'resources\voice-runtime\ireina_tts_service.py') -Destination $outputPath
Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'release\speech-slim-prototype\voice-runtime') -File -Filter 'LICENSE.*' -ErrorAction SilentlyContinue |
    Copy-Item -Destination $outputPath

Get-ChildItem -LiteralPath $sitePackages -Directory -Recurse -Force |
    Where-Object { $_.Name -in @('__pycache__', 'tests', 'test') } |
    Sort-Object FullName -Descending |
    Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $sitePackages -File -Recurse -Force |
    Where-Object { $_.Extension -in @('.pyc', '.pyo', '.pyi', '.whl') } |
    Remove-Item -Force
foreach ($unwanted in @('build', 'src')) {
    $candidate = Join-Path $sitePackages $unwanted
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Recurse -Force }
}
Remove-Item -LiteralPath $downloadRoot -Recurse -Force

$forbidden = @(
    'aliyunsdkkms', 'oss2', 'modelscope', 'tensorboardX', 'tiktoken', 'pydevd_plugins',
    'torch', 'torchaudio', 'scipy', 'numba', 'librosa', 'sklearn'
)
foreach ($name in $forbidden) {
    if (Test-Path -LiteralPath (Join-Path $sitePackages $name)) {
        throw "Forbidden package remained in the clean runtime: $name"
    }
}
$onnxMetadata = @(Get-ChildItem -LiteralPath $sitePackages -Directory -Filter 'onnxruntime*.dist-info')
if ($onnxMetadata.Count -ne 1 -or $onnxMetadata[0].Name -notlike 'onnxruntime_directml-*') {
    throw 'The clean runtime must contain exactly one onnxruntime-directml distribution.'
}
$duplicateMetadata = Get-ChildItem -LiteralPath $sitePackages -Directory -Filter '*.dist-info' |
    ForEach-Object { $_.Name -replace '-\d.*$', '' } |
    Group-Object |
    Where-Object Count -gt 1
if ($duplicateMetadata) { throw 'Duplicate dist-info entries remain in the clean runtime.' }

$totalBytes = (Get-ChildItem -LiteralPath $outputPath -File -Recurse | Measure-Object Length -Sum).Sum
[pscustomobject]@{
    Output = $outputPath
    Bytes = $totalBytes
    MiB = [math]::Round($totalBytes / 1MB, 1)
    Python = (& (Join-Path $pythonRoot 'python.exe') --version)
}
