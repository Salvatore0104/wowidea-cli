# 编程助手安装 Wowidea CLI

用户会说「帮我安装 wowidea-cli，我的 key 是 sk-...」。按下面的顺序做，不要改步骤，不要用 sudo。没有 TTY。密钥已经在用户消息里。

适用 Cursor、Claude Code、Codex、Windsurf 和其他能跑 shell 的助手。

## 不要做

- 不要 `echo`、`printenv`、`Write-Host` 或日志打出 `WOWIDEA_API_KEY` 的值。
- 不要把密钥写进仓库：`.env`、README、AGENTS.md、提交说明、PR、issue 都不行。不要 `git add` 任何含密钥的文件。
- 不要把密钥写进命令的说明文字里再复述给用户。报告结果时只说装好了、版本、余额是否通过。
- 不要执行 `npm install -g github:Salvatore0104/wowidea-cli`。`dist/` 不在 Git 里，这样装完没有 `wowidea`。
- 不要因为全局 npm 目录不可写就改用 sudo。安装脚本会改装到用户目录。
- 密钥缺失时停下来问用户。不要编一把密钥，也不要在没有密钥时等待输入（没有终端会挂住）。

安装脚本自己会把密钥放到系统钥匙串，或用户主目录的 shell 启动文件 / Windows 用户环境变量。那不在仓库里。助手不要再抄一份进项目。

## 1. 判断系统

在 bash / zsh 里：

```bash
uname -s
```

`Darwin` 或 `Linux` 用下面的 bash。命令不存在，或当前就是 PowerShell（`$env:OS` 为 `Windows_NT`）时，用 PowerShell 那一节。

## 2. 检查 Node

需要 Node.js 20.3 或更新、npm、git。`package.json` 的 engines 是 `>=20`；sharp 要求 `^20.3` 或 `>=21`。缺了就停，告诉用户安装 https://nodejs.org/ ，不要用 sudo 装。

bash：

```bash
command -v node >/dev/null 2>&1 || { printf '%s\n' "需要 Node.js 20.3 或更新：https://nodejs.org/"; exit 2; }
command -v npm >/dev/null 2>&1 || { printf '%s\n' "需要 npm。"; exit 2; }
command -v git >/dev/null 2>&1 || { printf '%s\n' "需要 git。"; exit 2; }
node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if(!(maj>20||(maj===20&&min>=3))) { console.error("需要 Node.js 20.3 或更新"); process.exit(2) }'
```

PowerShell：

```powershell
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "需要 Node.js 20.3 或更新：https://nodejs.org/" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "需要 npm。" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "需要 git。" }
& node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if(!(maj>20||(maj===20&&min>=3))) process.exit(2)'
if ($LASTEXITCODE -ne 0) { throw "需要 Node.js 20.3 或更新：https://nodejs.org/" }
```

## 3. 把密钥放进环境变量

用用户消息里的密钥给当前进程赋值。不要打印这条命令的结果，不要把赋值写进仓库文件。下面的引号里换成用户给的值，不要原样留下 `用户消息里的密钥`。

bash：

```bash
export WOWIDEA_API_KEY='用户消息里的密钥'
```

PowerShell：

```powershell
$env:WOWIDEA_API_KEY = '用户消息里的密钥'
```

然后立刻做第 4 步。不要 `echo`、`Write-Output` 或 `Get-ChildItem Env:WOWIDEA_API_KEY`。

## 4. 非交互安装

环境变量已设置时，脚本不读终端、不等待输入。再跑一次是升级。

bash。stdin 关掉，避免助手环境里的管道被当成输入：

```bash
curl -fsSL https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.sh | bash
```

仓库已经在本地时：

```bash
bash scripts/install.sh </dev/null
```

PowerShell：

```powershell
irm https://raw.githubusercontent.com/Salvatore0104/wowidea-cli/master/scripts/install.ps1 | iex
```

仓库已经在本地时：

```powershell
& "$PWD\scripts\install.ps1"
```

脚本会克隆或更新 `~/.wowidea-cli`（Windows 是 `%USERPROFILE%\.wowidea-cli`），然后 `npm ci`、`npm run build`、`npm link`。全局 npm 目录不可写时，它会 `npm pack` 再装进 `~/.local`，并把该 `bin` 写进 shell 启动文件或用户 Path。看到「全局 npm 目录不可写」是正常分支，不要改用 sudo。

脚本结束时会自己跑 `wowidea balance` 和 `wowidea capabilities --brief`。脚本退出码 0 表示命令已经装上。余额认证失败（退出码 3）不会让脚本失败；输出里会说明密钥无效。

## 5. 再验证一次

安装脚本是子进程，当前 shell 的 PATH 可能还没有 `wowidea`。先用脚本打印的「已安装：」绝对路径；没有的话再补用户目录。

bash：

```bash
if ! command -v wowidea >/dev/null 2>&1; then
  export PATH="${HOME}/.local/bin:${PATH}"
fi
wowidea capabilities --brief
wowidea balance
```

PowerShell：

```powershell
if (-not (Get-Command wowidea -ErrorAction SilentlyContinue)) {
  $env:Path = (Join-Path $env:USERPROFILE '.local\bin') + ';' + $env:Path
}
wowidea capabilities --brief
wowidea balance
```

判定：

| 结果 | 怎么报告 |
| --- | --- |
| `capabilities --brief` 退出码 0，输出里有 `豆包Seedance-2.5` | 命令可用。这条不需要密钥。 |
| `balance` 退出码 0 | 密钥可用。只报告余额数字，不要报告密钥。 |
| `balance` 退出码 3 | 命令已装好，密钥被拒绝。让用户到 https://wowidea.top/user/api-key 检查。不要打印密钥。 |
| `wowidea` 仍找不到 | 用「已安装：」后面的绝对路径再跑上面两条。不要 sudo。 |

两条都跑完再告诉用户：版本、`wowidea` 的路径、余额是否通过。不要把密钥复述回去。

安装成功结束时会打印一段简体中文提示词（仓库里的 `docs/init-prompt.zh.txt`，与 README「新建项目与对话时的初始化提示词」相同）。把这段原样给用户。用户新建项目并开启新对话时，把这段粘贴进去。不要改写。每个项目目录在生成前都要先 `wowidea project init`。生成默认走直接接口。

## 6. 脚本下不来时的手动步骤

`curl` / `irm` 失败时，克隆到固定目录再跑同一支脚本。密钥仍然只在环境变量里。

bash：

```bash
git clone --depth 1 --branch master https://github.com/Salvatore0104/wowidea-cli.git "${HOME}/.wowidea-cli"
bash "${HOME}/.wowidea-cli/scripts/install.sh" </dev/null
```

PowerShell：

```powershell
git clone --depth 1 --branch master https://github.com/Salvatore0104/wowidea-cli.git (Join-Path $env:USERPROFILE '.wowidea-cli')
& (Join-Path $env:USERPROFILE '.wowidea-cli\scripts\install.ps1')
```

脚本也失败时，在克隆目录里手动构建。不要 sudo。`npm link` 因权限失败再改用用户目录：

bash：

```bash
cd "${HOME}/.wowidea-cli"
npm ci
npm run build
if ! npm link; then
  tgz="$(npm pack --silent | tail -n 1)"
  mkdir -p "${HOME}/.local"
  npm install -g "${PWD}/${tgz}" --prefix "${HOME}/.local"
  export PATH="${HOME}/.local/bin:${PATH}"
fi
```

PowerShell：

```powershell
Set-Location (Join-Path $env:USERPROFILE '.wowidea-cli')
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci 失败" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
npm link
if ($LASTEXITCODE -ne 0) {
  $tgz = (npm pack --silent | Select-Object -Last 1).ToString().Trim()
  $prefix = Join-Path $env:USERPROFILE '.local'
  New-Item -ItemType Directory -Force -Path $prefix | Out-Null
  npm install -g (Join-Path (Get-Location) $tgz) --prefix $prefix
  if ($LASTEXITCODE -ne 0) { throw "用户目录安装失败" }
  $env:Path = (Join-Path $prefix 'bin') + ';' + $env:Path
}
```

手动构建之后，用环境变量里的密钥保存，不要把值打出来。优先钥匙串：

```bash
printf '%s' "$WOWIDEA_API_KEY" | wowidea auth use-key --key-stdin
```

```powershell
$env:WOWIDEA_API_KEY | wowidea auth use-key --key-stdin
```

钥匙串不可用时，回到第 4 步重跑 `scripts/install.sh` 或 `scripts/install.ps1`。不要自己在仓库里写 `export WOWIDEA_API_KEY=...`。

然后执行第 5 步的 `wowidea capabilities --brief` 和 `wowidea balance`。
