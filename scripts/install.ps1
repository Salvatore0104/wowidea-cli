# Idempotent Wowidea CLI installer for Windows PowerShell 5.1 and 7.
# Re-run upgrades %USERPROFILE%\.wowidea-cli. Never prints WOWIDEA_API_KEY.
#
#   irm https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.ps1 | iex
#   $env:WOWIDEA_API_KEY="sk-..."; irm .../scripts/install.ps1 | iex
#
# Key persistence: wowidea auth use-key (OS keychain) when it succeeds.
# Otherwise setx WOWIDEA_API_KEY at user scope. Set WOWIDEA_INSTALL_SKIP_KEYCHAIN=1
# to force the setx path.

$script:ApiKey = ''

function Write-Err([string]$Message) {
  if ($script:ApiKey -and $Message.Contains($script:ApiKey)) {
    $Message = $Message.Replace($script:ApiKey, '[REDACTED]')
  }
  [Console]::Error.WriteLine($Message)
}

# iex runs this file in the caller's scope. exit would close that window.
$script:FileInvocation = -not [string]::IsNullOrEmpty($PSCommandPath)

function Fail([string]$Message, [int]$Code = 2) {
  Write-Err $Message
  if ($script:FileInvocation) { exit $Code }
  throw $Message
}

function Assert-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Fail "未检测到 Node.js。需要 20.3 或更新（package.json engines >=20；sharp 需要 ^20.3 或 >=21）。请从 https://nodejs.org/ 安装后重试。"
  }
  $ver = & node -p "process.versions.node"
  if ($LASTEXITCODE -ne 0) { Fail "无法读取 Node.js 版本。" }
  $parts = $ver.Trim().Split('.')
  $maj = [int]$parts[0]
  $min = [int]$parts[1]
  if ($maj -lt 20 -or ($maj -eq 20 -and $min -lt 3)) {
    Fail "当前 Node.js 是 v$ver，需要 20.3 或更新。请从 https://nodejs.org/ 安装后重试。"
  }
  foreach ($name in @('npm', 'git')) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
      Fail "未检测到 $name。请先安装后重试。"
    }
  }
}

function Assert-Git {
  param([string]$Action)
  if ($LASTEXITCODE -ne 0) { Fail "$Action 失败（退出码 $LASTEXITCODE）。" 1 }
}

function Sync-Repo([string]$Dest, [string]$Repo, [string]$Ref) {
  $env:GIT_TERMINAL_PROMPT = '0'
  $gitDir = Join-Path $Dest '.git'
  if (Test-Path -LiteralPath $gitDir) {
    Write-Host "正在更新 $Dest（$Ref）..."
    & git -C $Dest remote set-url origin $Repo
    Assert-Git "git remote set-url"
    & git -C $Dest fetch --depth 1 origin $Ref
    Assert-Git "git fetch"
    & git -C $Dest checkout --detach --force FETCH_HEAD
    Assert-Git "git checkout"
    return
  }
  if (Test-Path -LiteralPath $Dest) {
    $items = @(Get-ChildItem -Force -LiteralPath $Dest)
    if ($items.Count -eq 0) {
      Remove-Item -LiteralPath $Dest -Force
    } else {
      Fail "$Dest 已存在，但不是 git 仓库。请移走该目录后重试。" 1
    }
  }
  Write-Host "正在克隆 $Repo 到 $Dest ..."
  & git clone --depth 1 --branch $Ref $Repo $Dest
  Assert-Git "git clone"
}

function Test-GlobalPrefixWritable {
  $prefix = (& npm prefix -g).Trim()
  if (-not $prefix) { return $false }
  if ($prefix -eq '/' -or $prefix -eq '\') { return $false }
  if ($prefix -match '^[A-Za-z]:\\$') { return $false }
  $mod = Join-Path $prefix 'node_modules'
  $target = if (Test-Path -LiteralPath $mod) { $mod } else { $prefix }
  if (-not (Test-Path -LiteralPath $target)) { return $false }
  $probe = Join-Path $target ('.wowidea-probe-' + [guid]::NewGuid().ToString('n'))
  try {
    [System.IO.File]::WriteAllText($probe, '')
    Remove-Item -LiteralPath $probe -Force
    return $true
  } catch {
    return $false
  }
}

function Add-UserPath([string]$Dir) {
  if (-not (Test-Path -LiteralPath $Dir)) { return }
  $env:Path = $Dir + ';' + $env:Path
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  $needle = $Dir.TrimEnd('\')
  $parts = @($userPath.Split(';') | Where-Object { $_ -ne '' })
  foreach ($part in $parts) {
    if ($part.TrimEnd('\') -eq $needle) { return }
  }
  $updated = if ($userPath) { $Dir + ';' + $userPath } else { $Dir }
  [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
  Write-Host "已把 $Dir 加入用户 Path。新开终端后生效。"
}

function Install-UserPrefix {
  $prefix = Join-Path $env:USERPROFILE '.local'
  Write-Host "全局 npm 目录不可写，改为安装到 $prefix（不使用管理员权限）。"
  $packed = & npm pack --silent
  if ($LASTEXITCODE -ne 0) { Fail "npm pack 失败（退出码 $LASTEXITCODE）。" 1 }
  $tgz = @($packed | Where-Object { $_ -and $_.ToString().Trim() -ne '' } | Select-Object -Last 1)
  if (-not $tgz) { Fail "npm pack 没有生成安装包。" 1 }
  $tgzPath = Join-Path (Get-Location) $tgz.ToString().Trim()
  New-Item -ItemType Directory -Force -Path $prefix | Out-Null
  & npm install -g $tgzPath --prefix $prefix
  if ($LASTEXITCODE -ne 0) { Fail "安装到用户目录失败（退出码 $LASTEXITCODE）。" 1 }
  Remove-Item -LiteralPath $tgzPath -Force -ErrorAction SilentlyContinue
  $script:InstallPrefix = $prefix
  foreach ($candidate in @($prefix, (Join-Path $prefix 'bin'))) {
    $shim = @(
      (Join-Path $candidate 'wowidea.cmd'),
      (Join-Path $candidate 'wowidea.ps1'),
      (Join-Path $candidate 'wowidea')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($shim) { Add-UserPath $candidate }
  }
}

function Install-Cli {
  Write-Host "正在安装依赖并构建（npm ci && npm run build）..."
  & npm ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci 失败（退出码 $LASTEXITCODE）。" 1 }
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail "npm run build 失败（退出码 $LASTEXITCODE）。" 1 }
  if (Test-GlobalPrefixWritable) {
    & npm link
    if ($LASTEXITCODE -eq 0) {
      $prefix = (& npm prefix -g).Trim()
      $script:InstallPrefix = $prefix
      $bin = $prefix
      if (-not (Test-Path -LiteralPath (Join-Path $bin 'wowidea.cmd')) -and (Test-Path -LiteralPath (Join-Path $bin 'bin'))) {
        $bin = Join-Path $bin 'bin'
      }
      Add-UserPath $bin
    } else {
      Write-Host "npm link 失败，改为安装到用户目录。"
      Install-UserPrefix
    }
  } else {
    Install-UserPrefix
  }
  $wowidea = Get-Command wowidea -ErrorAction SilentlyContinue
  if (-not $wowidea) { Fail "安装结束但找不到 wowidea。请新开终端，或把 npm 全局目录加入 Path 后重试。" 1 }
  $version = & wowidea --version
  Write-Host ("已安装：" + $wowidea.Source + "（" + $version.Trim() + "）")
}

function Read-WowideaKey {
  # Agents have no TTY. A set WOWIDEA_API_KEY must not call Read-Host.
  if ($env:WOWIDEA_API_KEY) { return $env:WOWIDEA_API_KEY }
  $redirected = $false
  try { $redirected = [Console]::IsInputRedirected } catch { $redirected = $false }
  if ($redirected) {
    Fail "未设置 WOWIDEA_API_KEY，且当前没有交互终端。请先设置 `$env:WOWIDEA_API_KEY 再运行。"
  }
  try {
    Write-Host "请输入 WOWIDEA_API_KEY（输入不回显）：" -NoNewline
    $secure = Read-Host -AsSecureString
  } catch {
    Fail "未设置 WOWIDEA_API_KEY，且当前没有交互终端。请先设置 `$env:WOWIDEA_API_KEY 再运行。"
  }
  if ($null -eq $secure -or $secure.Length -eq 0) { Fail "密钥为空。" }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $secure.Dispose()
  }
  if ([string]::IsNullOrEmpty($plain)) { Fail "密钥为空。" }
  if ($plain.Contains("`n") -or $plain.Contains("`r")) { Fail "密钥不能包含换行。" }
  return $plain
}

function Find-CliJs {
  $roots = New-Object System.Collections.Generic.List[string]
  $globalRoot = & npm root -g 2>$null
  if ($LASTEXITCODE -eq 0 -and $globalRoot) { $roots.Add($globalRoot.Trim()) }
  if ($script:InstallPrefix) {
    $roots.Add((Join-Path $script:InstallPrefix 'lib\node_modules'))
    $roots.Add((Join-Path $script:InstallPrefix 'node_modules'))
  }
  $roots.Add((Join-Path $env:USERPROFILE '.local\lib\node_modules'))
  $roots.Add((Join-Path $env:USERPROFILE '.local\node_modules'))
  foreach ($root in $roots) {
    $cli = Join-Path $root '@easyai\cli\dist\cli.js'
    if (Test-Path -LiteralPath $cli) { return $cli }
  }
  return $null
}

function Try-Keychain([string]$Key) {
  if ($env:WOWIDEA_INSTALL_SKIP_KEYCHAIN -eq '1') {
    Write-Host "已跳过钥匙串（WOWIDEA_INSTALL_SKIP_KEYCHAIN=1），改为 setx。"
    return $false
  }
  $cli = Find-CliJs
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cli -or -not $node) {
    Write-Err "找不到 CLI 入口，跳过钥匙串。"
    return $false
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node.Source
  $psi.Arguments = '"' + $cli.Replace('"', '\"') + '" auth use-key --key-stdin'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $bytes = $utf8.GetBytes($Key)
  $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $proc.StandardInput.Close()
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit(20000)) {
    try { $proc.Kill() } catch { }
    try { $proc.WaitForExit() } catch { }
    Write-Err "钥匙串写入超时，改为 setx。"
    return $false
  }
  $null = $outTask.Result
  $stderr = $errTask.Result
  if ($proc.ExitCode -eq 0) {
    Write-Host "密钥已写入系统钥匙串（wowidea auth use-key）。"
    return $true
  }
  if ($stderr) {
    if ($stderr.Contains($Key)) { $stderr = $stderr.Replace($Key, '[REDACTED]') }
    [Console]::Error.WriteLine($stderr.TrimEnd())
  }
  Write-Err ("系统钥匙串不可用（退出码 " + $proc.ExitCode + "）。改为 setx 写入用户环境变量。")
  return $false
}

function Save-WithSetx([string]$Key) {
  $unsafe = $Key.Contains('"') -or $Key.Contains('%') -or $Key.Length -gt 1024
  if ($unsafe) {
    [Environment]::SetEnvironmentVariable('WOWIDEA_API_KEY', $Key, 'User')
    Write-Host "密钥含有 setx 会改写或截断的字符，已用用户环境变量 API 保存。请新开一个窗口。"
    return
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'setx.exe'
  $psi.Arguments = 'WOWIDEA_API_KEY "' + $Key + '"'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) {
    if ($stderr.Contains($Key)) { $stderr = $stderr.Replace($Key, '[REDACTED]') }
    Write-Err $stderr.TrimEnd()
    Fail "setx 保存 WOWIDEA_API_KEY 失败（退出码 $($proc.ExitCode)）。" 1
  }
  if ($stdout.Contains($Key) -or $stderr.Contains($Key)) {
    Write-Host "已用 setx 保存用户环境变量 WOWIDEA_API_KEY。"
  } else {
    Write-Host "已用 setx 保存用户环境变量 WOWIDEA_API_KEY。请新开一个 PowerShell 窗口后再用。"
  }
}

function Invoke-Balance([string]$Key) {
  Write-Host "正在运行 wowidea balance 检查密钥..."
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/d /c wowidea balance'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $psi.StandardOutputEncoding = $utf8
  $psi.StandardErrorEncoding = $utf8
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  $text = $stdout + $stderr
  if ($Key -and $text.Contains($Key)) { $text = $text.Replace($Key, '[REDACTED]') }
  if ($text.Trim()) { Write-Host $text.TrimEnd() }
  $code = $proc.ExitCode
  if ($code -eq 0) {
    Write-Host "密钥可用。"
    return
  }
  Write-Err "安装已完成，但 wowidea balance 退出码为 $code。"
  if ($code -eq 3) {
    Write-Err "退出码 3 表示认证失败。请到 https://wowidea.top/user/api-key 检查密钥后重新运行本脚本。"
  } else {
    Write-Err "命令行本身已装好。余额检查没有完成（网络或服务异常）。"
  }
}

function Invoke-Capabilities([string]$Key) {
  Write-Host "正在运行 wowidea capabilities --brief ..."
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/d /c wowidea capabilities --brief'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $psi.StandardOutputEncoding = $utf8
  $psi.StandardErrorEncoding = $utf8
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  $text = $stdout + $stderr
  if ($Key -and $text.Contains($Key)) { $text = $text.Replace($Key, '[REDACTED]') }
  if ($text.Trim()) { Write-Host $text.TrimEnd() }
  if ($proc.ExitCode -ne 0) {
    Fail "wowidea capabilities --brief 失败（退出码 $($proc.ExitCode)）。命令行未就绪。" 1
  }
}

$repo = if ($env:WOWIDEA_CLI_REPO) { $env:WOWIDEA_CLI_REPO } elseif ($env:EASYAI_CLI_REPO) { $env:EASYAI_CLI_REPO } else { 'https://github.com/Salvatore0104/wowidea-cli.git' }
$ref = if ($env:WOWIDEA_CLI_REF) { $env:WOWIDEA_CLI_REF } elseif ($env:EASYAI_CLI_REF) { $env:EASYAI_CLI_REF } else { 'master' }
$dest = if ($env:WOWIDEA_CLI_HOME) { $env:WOWIDEA_CLI_HOME } else { Join-Path $env:USERPROFILE '.wowidea-cli' }
$script:InstallPrefix = ''
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Stop'
try {
  Assert-Node
  Sync-Repo $dest $repo $ref
  Push-Location $dest
  try {
    Install-Cli
  } finally {
    Pop-Location
  }
  $script:ApiKey = Read-WowideaKey
  $env:WOWIDEA_API_KEY = $script:ApiKey
  if (-not (Try-Keychain $script:ApiKey)) {
    Save-WithSetx $script:ApiKey
    Write-Host "这次安装会在当前窗口用该密钥检查余额。setx 要新开窗口才对其他程序可见。"
  }
  Invoke-Balance $script:ApiKey
  Invoke-Capabilities $script:ApiKey
  Write-Host "安装完成。"
  Write-Host "把下面这段提示词复制给 AI 助手。每个项目在使用前都要先初始化："
  Write-Host "-----"
  $promptPath = Join-Path $dest 'docs\init-prompt.zh.txt'
  if (Test-Path -LiteralPath $promptPath) {
    & node -e "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))" $promptPath
    Write-Host ""
  } else {
    Write-Err "未找到初始化提示词：$promptPath"
  }
  Write-Host "-----"
} finally {
  $script:ApiKey = $null
  $ErrorActionPreference = $previousErrorAction
}
