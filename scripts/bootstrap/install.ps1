# PaperBridge Windows bootstrap. The root install.ps1 is an ASCII-safe wrapper.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $SavedEnv = @{}
  foreach ($Key in @('Path', 'PAPERBRIDGE_HOME', 'npm_config_cache', 'npm_config_update_notifier', 'npm_config_fund', 'npm_config_audit')) {
    $SavedEnv[$Key] = [Environment]::GetEnvironmentVariable($Key, 'Process')
  }
  $NodeVersion = 'v24.22.0'
  $AppHome = if ($env:PAPERBRIDGE_HOME) { [IO.Path]::GetFullPath($env:PAPERBRIDGE_HOME) } else { Join-Path $HOME '.paperbridge' }
  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ('paperbridge-' + [guid]::NewGuid().ToString('N'))
  function Test-Node($Exe) {
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $false }
    try { return [int](& $Exe -p 'process.versions.node.split(".")[0]' 2>$null) -ge 20 } catch { return $false }
  }
  function Get-File($Url, $Destination) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 180; return $true } catch { return $false }
  }
  try {
    New-Item -ItemType Directory -Path $Tmp | Out-Null
    Write-Host 'PaperBridge · 一键安装'
    $Browsers = @(
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")
    if (-not ($Browsers | Where-Object { Test-Path -LiteralPath $_ })) { throw '请先安装 Chrome 或 Edge，再重新运行同一行命令。' }

    $Node = (Get-Command node -ErrorAction SilentlyContinue).Source
    $NpmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    $NpmEntry = if ($NpmCommand) { Join-Path (Split-Path $NpmCommand) 'node_modules/npm/bin/npm-cli.js' } else { $null }
    if (-not ((Test-Node $Node) -and $NpmEntry -and (Test-Path -LiteralPath $NpmEntry))) {
      $Node = Join-Path $AppHome 'node/node.exe'
      $NpmEntry = Join-Path $AppHome 'node/node_modules/npm/bin/npm-cli.js'
      if (-not ((Test-Node $Node) -and (Test-Path -LiteralPath $NpmEntry))) {
        $Architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        switch ($Architecture) {
          'ARM64' { $Arch = 'arm64'; $ExpectedSha = '3a5c209a5bc59e65b3bc0fa13ed5e166a26bd3d55332847f498b76b037408d61' }
          'AMD64' { $Arch = 'x64'; $ExpectedSha = 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3' }
          default { throw '暂不支持此 Windows 处理器架构。' }
        }
        $Name = "node-$NodeVersion-win-$Arch"
        $Archive = Join-Path $Tmp 'node.zip'
        Write-Host "① 正在安装 Node.js $($NodeVersion.TrimStart('v')) 到 PaperBridge 的独立目录…"
        $Downloaded = $false
        foreach ($Mirror in @('https://nodejs.org/dist', 'https://cdn.npmmirror.com/binaries/node')) {
          if (Get-File "$Mirror/$NodeVersion/$Name.zip" $Archive) {
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash.ToLower() -eq $ExpectedSha) { $Downloaded = $true; break }
            Write-Host '  SHA-256 不匹配，未运行下载内容；尝试另一个来源。'
          }
        }
        if (-not $Downloaded) { throw 'Node.js 下载或校验失败。请检查网络后重试。' }
        Expand-Archive -LiteralPath $Archive -DestinationPath $Tmp
        $Extracted = Join-Path $Tmp $Name
        if (-not (Test-Node (Join-Path $Extracted 'node.exe'))) { throw '这份 Node.js 无法在当前系统运行，请检查 Windows 版本。' }
        New-Item -ItemType Directory -Force -Path $AppHome | Out-Null
        $Private = Join-Path $AppHome 'node'
        if (Test-Path -LiteralPath $Private) { Move-Item -LiteralPath $Private -Destination (Join-Path $Tmp 'previous-node') }
        Move-Item -LiteralPath $Extracted -Destination $Private
      }
    }
    $env:Path = (Split-Path $Node) + ';' + $env:Path
    $env:PAPERBRIDGE_HOME = $AppHome
    $env:npm_config_cache = Join-Path $AppHome 'npm-cache'
    $env:npm_config_update_notifier = 'false'; $env:npm_config_fund = 'false'; $env:npm_config_audit = 'false'

    Write-Host '② 正在下载 PaperBridge 和运行依赖…'
    $Registry = $null
    foreach ($Candidate in @('https://registry.npmjs.org', 'https://registry.npmmirror.com')) {
      $ErrorActionPreference = 'Continue'
      & $Node $NpmEntry exec --yes --ignore-scripts "--registry=$Candidate" --package=xjtlu-paperbridge@latest -- paperbridge --help *> (Join-Path $Tmp 'npm-prepare.log')
      $PrepareCode = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
      if ($PrepareCode -eq 0) { $Registry = $Candidate; break }
      Write-Host '  这个 npm 来源暂时不可用，尝试另一个来源。'
    }
    if (-not $Registry) { throw 'PaperBridge 下载失败。请检查网络后重新运行同一行命令。' }
    Write-Host '③ 正在接入 Codex / DeepSeek Harness，随后会打开本人登录窗口。'
    $Clients = if ($env:PAPERBRIDGE_CLIENTS) { $env:PAPERBRIDGE_CLIENTS } else { 'codex,deepseek-harness' }
    $SetupArgs = @('--yes', '--clients', $Clients)
    if ($env:PAPERBRIDGE_NO_LOGIN -eq '1') { $SetupArgs += '--no-login' }
    $ErrorActionPreference = 'Continue'
    & $Node $NpmEntry exec --yes --ignore-scripts --prefer-offline "--registry=$Registry" --package=xjtlu-paperbridge@latest -- paperbridge setup @SetupArgs
    $SetupCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($SetupCode -ne 0) { throw '安装尚未完成，请按上方提示处理后重试。' }
  } catch {
    Write-Host ('✗ ' + $_.Exception.Message) -ForegroundColor Red
  } finally {
    foreach ($Key in $SavedEnv.Keys) { [Environment]::SetEnvironmentVariable($Key, $SavedEnv[$Key], 'Process') }
    if (Test-Path -LiteralPath $Tmp) { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
