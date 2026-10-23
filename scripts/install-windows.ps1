$ErrorActionPreference = 'Stop'
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Command failed: $LASTEXITCODE" } }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(2)'
Check-Exit
$installTemp = Join-Path ([IO.Path]::GetTempPath()) ('wowidea-install-' + [guid]::NewGuid())
$repo = if ($env:EASYAI_CLI_REPO) { $env:EASYAI_CLI_REPO } else { 'https://github.com/Salvatore0104/wowidea-cli.git' }
$ref = if ($env:EASYAI_CLI_REF) { $env:EASYAI_CLI_REF } else { 'master' }
git clone --depth 1 --branch $ref $repo $installTemp
Check-Exit
Push-Location $installTemp
try {
  npm ci
  Check-Exit
  npm run build
  Check-Exit
  $packageFile = npm pack --silent
  Check-Exit
  npm install --global (Join-Path $installTemp $packageFile)
  Check-Exit
  $globalModules = npm root --global
  Check-Exit
  node (Join-Path $globalModules '@easyai/cli/scripts/install-skills.mjs')
  Check-Exit
} finally {
  Pop-Location
  $resolvedTemp = [IO.Path]::GetFullPath($installTemp)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $resolvedTemp -Leaf).StartsWith('wowidea-install-')) { throw 'Unexpected cleanup target' }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
Write-Host 'Wowidea installed. In Codex use $wowidea and provide your API key for automatic setup. Optional terminal input: wowidea auth use-key --prompt.'
$promptPath = Join-Path (npm root --global) '@easyai/cli\docs\prompts\首次安装.txt'
Write-Host "首次安装完成。新开一个 AI 对话，把下面这段贴进去："
Write-Host "文件：$promptPath"
Write-Host "-----"
if (Test-Path -LiteralPath $promptPath) {
  & node -e "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))" $promptPath
  Write-Host ""
} else {
  [Console]::Error.WriteLine("未找到话术提示词：$promptPath")
}
Write-Host "-----"
