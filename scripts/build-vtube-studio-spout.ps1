$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeRoot = Join-Path $repositoryRoot 'native\vtube-studio-spout'
$spoutRoot = Join-Path $nativeRoot 'vendor\spout2'
$outputDirectory = Join-Path $nativeRoot 'bin'
$outputPath = Join-Path $outputDirectory 'FpnfVTubeStudioSpout.exe'

$zigPath = $env:FPNF_ZIG_PATH
if ([string]::IsNullOrWhiteSpace($zigPath)) {
  $zigCommand = Get-Command zig -ErrorAction SilentlyContinue
  if ($null -eq $zigCommand) {
    throw 'Zig 0.15 or newer is required. Set FPNF_ZIG_PATH to the absolute zig.exe path.'
  }
  $zigPath = $zigCommand.Source
}
$zigPath = [IO.Path]::GetFullPath($zigPath)
if (-not (Test-Path -LiteralPath $zigPath -PathType Leaf)) {
  throw 'FPNF_ZIG_PATH does not point to a file.'
}

$spoutSources = @(
  'Spout.cpp',
  'SpoutCopy.cpp',
  'SpoutDirectX.cpp',
  'SpoutFrameCount.cpp',
  'SpoutGL.cpp',
  'SpoutGLextensions.cpp',
  'SpoutReceiver.cpp',
  'SpoutSender.cpp',
  'SpoutSenderNames.cpp',
  'SpoutSharedMemory.cpp',
  'SpoutUtils.cpp'
) | ForEach-Object { Join-Path $spoutRoot $_ }

$requiredFiles = @(
  (Join-Path $nativeRoot 'SpoutOverlay.cpp'),
  (Join-Path $spoutRoot 'Spout.h')
) + $spoutSources
foreach ($requiredFile in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
    throw "Missing native overlay source: $requiredFile"
  }
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$arguments = @(
  'c++',
  (Join-Path $nativeRoot 'SpoutOverlay.cpp')
) + $spoutSources + @(
  '-std=c++17',
  '-O2',
  '-mssse3',
  '-DSPOUT_BUILD_STATIC',
  '-target',
  'x86_64-windows-gnu',
  '-I',
  $spoutRoot,
  '-municode',
  '-Wl,--subsystem,windows',
  '-luser32',
  '-lgdi32',
  '-lopengl32',
  '-lkernel32',
  '-lwinspool',
  '-lcomdlg32',
  '-lcomctl32',
  '-ladvapi32',
  '-lshell32',
  '-lole32',
  '-loleaut32',
  '-luuid',
  '-lodbc32',
  '-lodbccp32',
  '-ld3d9',
  '-ld3d11',
  '-ldxgi',
  '-lversion',
  '-lwinmm',
  '-o',
  $outputPath
)

& $zigPath @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Native VTube Studio overlay build failed with exit code $LASTEXITCODE."
}

Write-Output $outputPath
