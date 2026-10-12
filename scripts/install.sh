#!/usr/bin/env bash
# Idempotent Wowidea CLI installer for macOS and Linux.
# Re-run upgrades ~/.wowidea-cli. Never prints WOWIDEA_API_KEY.
#
#   curl -fsSL .../scripts/install.sh | bash
#   curl -fsSL .../scripts/install.sh | WOWIDEA_API_KEY=sk-... bash
#
# The brace group is intentional: bash reads the whole group before running it,
# so a curl | bash pipe cannot be eaten by git, npm, or node.

{
set +x
set -euo pipefail

REPO="${WOWIDEA_CLI_REPO:-${EASYAI_CLI_REPO:-https://github.com/Salvatore0104/wowidea-cli.git}}"
REF="${WOWIDEA_CLI_REF:-${EASYAI_CLI_REF:-master}}"
DEST="${WOWIDEA_CLI_HOME:-$HOME/.wowidea-cli}"
KEY=""
# shellcheck disable=SC2034
tmps=()
ORIGINAL_PATH="${PATH}"

die() {
  printf '%s\n' "$1" >&2
  exit "${2:-2}"
}

mktmp() {
  local f
  f="$(mktemp "${TMPDIR:-/tmp}/wowidea-install.XXXXXX")"
  chmod 600 "$f"
  tmps[${#tmps[@]}]="$f"
  printf '%s\n' "$f"
}

cleanup() {
  local f
  if [[ "${#tmps[@]}" -eq 0 ]]; then
    return 0
  fi
  for f in "${tmps[@]}"; do
    rm -f "$f"
  done
  tmps=()
}
trap cleanup EXIT

need_node_msg() {
  cat >&2 <<'EOF'
需要 Node.js 20.3 或更新。
package.json 的 engines 是 >=20；sharp 需要 ^20.3 或 >=21。
请从 https://nodejs.org/ 安装后重新运行。
EOF
  exit 2
}

require_tools() {
  if ! command -v node >/dev/null 2>&1; then
    printf '%s\n' "未检测到 Node.js。" >&2
    need_node_msg
  fi
  if ! command -v npm >/dev/null 2>&1; then
    die "未检测到 npm。请安装随 Node.js 提供的 npm 后重试。"
  fi
  if ! command -v git >/dev/null 2>&1; then
    die "未检测到 git。请先安装 git 后重试。"
  fi
  local current
  current="$(node -p "process.versions.node" </dev/null)" || die "无法读取 Node.js 版本。"
  if ! node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if(!(maj>20||(maj===20&&min>=3))) process.exit(1)' </dev/null; then
    printf '%s\n' "当前 Node.js 是 v${current}，需要 20.3 或更新。" >&2
    need_node_msg
  fi
}

sync_repo() {
  export GIT_TERMINAL_PROMPT=0
  if [[ -d "${DEST}/.git" ]]; then
    printf '%s\n' "正在更新 ${DEST}（${REF}）..."
    git -C "$DEST" remote set-url origin "$REPO" </dev/null
    git -C "$DEST" fetch --depth 1 origin "$REF" </dev/null
    git -C "$DEST" checkout --detach --force FETCH_HEAD </dev/null
    return 0
  fi
  if [[ -d "$DEST" ]] && [[ -z "$(ls -A "$DEST")" ]]; then
    rmdir "$DEST"
  fi
  if [[ -e "$DEST" ]]; then
    die "${DEST} 已存在，但不是 git 仓库。请移走该目录后重试。" 1
  fi
  printf '%s\n' "正在克隆 ${REPO} 到 ${DEST} ..."
  git clone --depth 1 --branch "$REF" "$REPO" "$DEST" </dev/null
}

global_prefix_writable() {
  local prefix mod bin
  prefix="$(npm prefix -g </dev/null)" || return 1
  [[ -n "$prefix" && "$prefix" != "/" ]] || return 1
  mod="${prefix}/lib/node_modules"
  bin="${prefix}/bin"
  if [[ -d "$mod" ]]; then
    [[ -w "$mod" ]] || return 1
  else
    [[ -w "$prefix" ]] || return 1
  fi
  if [[ -d "$bin" ]]; then
    [[ -w "$bin" ]] || return 1
  else
    [[ -w "$prefix" ]] || return 1
  fi
}

prepend_path() {
  local dir="$1"
  [[ -n "$dir" && -d "$dir" ]] || return 0
  case ":${PATH}:" in
    *":${dir}:"*) ;;
    *) export PATH="${dir}:${PATH}" ;;
  esac
}

quote_single() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

# Append a non-secret PATH export. Creates ~/.bashrc and ~/.zshrc when missing.
# Updates an existing ~/.bash_profile, and does not create one (a new
# ~/.bash_profile would stop bash from reading ~/.profile).
persist_path_line() {
  local bin_dir="$1"
  local file line quoted old_umask changed
  changed=0
  [[ -n "$bin_dir" ]] || return 0
  case ":${ORIGINAL_PATH}:" in
    *":${bin_dir}:"*) return 0 ;;
  esac
  quoted="$(quote_single "$bin_dir")"
  line="export PATH=${quoted}:\"\$PATH\""
  for file in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.bash_profile"; do
    if [[ -L "$file" ]]; then
      printf '%s\n' "跳过 ${file}（符号链接），未改 PATH。" >&2
      continue
    fi
    if [[ "$file" == "${HOME}/.bash_profile" && ! -e "$file" ]]; then
      continue
    fi
    if [[ ! -e "$file" ]]; then
      old_umask="$(umask)"
      umask 077
      printf '%s\n%s\n' "# wowidea-cli: PATH (managed by scripts/install.sh)" "$line" >"$file"
      umask "$old_umask"
      changed=1
      continue
    fi
    if [[ -f "$file" ]] && grep -F -q -- "$bin_dir" "$file"; then
      continue
    fi
    if [[ -f "$file" ]]; then
      printf '\n%s\n%s\n' "# wowidea-cli: PATH (managed by scripts/install.sh)" "$line" >>"$file"
      changed=1
    fi
  done
  if [[ "$changed" -eq 1 ]]; then
    printf '%s\n' "已把 ${bin_dir} 加入 shell 启动文件的 PATH。新开终端后生效。"
  fi
}

install_user_prefix() {
  local tgz prefix bin_dir
  prefix="${HOME}/.local"
  printf '%s\n' "全局 npm 目录不可写，改为安装到 ${prefix}（不使用 sudo）。"
  tgz="$(npm pack --silent </dev/null | tail -n 1)"
  tgz="${tgz//$'\r'/}"
  [[ -n "$tgz" && -f "$tgz" ]] || die "npm pack 没有生成安装包。" 1
  mkdir -p "$prefix"
  npm install -g "${PWD}/${tgz}" --prefix "$prefix" </dev/null
  rm -f "$tgz"
  bin_dir="${prefix}/bin"
  prepend_path "$bin_dir"
  persist_path_line "$bin_dir"
}

install_cli() {
  local log status prefix
  printf '%s\n' "正在安装依赖并构建（npm ci && npm run build）..."
  npm ci </dev/null
  npm run build </dev/null
  if global_prefix_writable; then
    log="$(mktmp)"
    status=0
    npm link </dev/null >"$log" 2>&1 || status=$?
    if [[ "$status" -eq 0 ]]; then
      cat "$log"
      prefix="$(npm prefix -g </dev/null)"
      prepend_path "${prefix}/bin"
      persist_path_line "${prefix}/bin"
    elif grep -Eq 'EACCES|EPERM|permission denied' "$log"; then
      cat "$log" >&2
      install_user_prefix
    else
      cat "$log" >&2
      die "npm link 失败（退出码 ${status}）。" 1
    fi
  else
    install_user_prefix
  fi
  hash -r 2>/dev/null || true
  command -v wowidea >/dev/null 2>&1 || die "安装结束但找不到 wowidea。请把 npm 的全局 bin 加入 PATH 后重试。" 1
  printf '%s\n' "已安装：$(command -v wowidea)（$(wowidea --version </dev/null)）"
}

# -r /dev/tty stays true when the device node exists but this process has no
# controlling terminal. Opening it is the check that matches the later prompt.
tty_ok() {
  { : >/dev/tty; } 2>/dev/null
}

read_key() {
  if [[ -n "${WOWIDEA_API_KEY:-}" ]]; then
    KEY="${WOWIDEA_API_KEY}"
  elif tty_ok; then
    printf '%s' "请输入 WOWIDEA_API_KEY（输入不回显）：" >/dev/tty
    IFS= read -r -s KEY </dev/tty || true
    printf '\n' >/dev/tty
  else
    die "未设置 WOWIDEA_API_KEY，且当前没有终端可以提示输入。请在命令前加上 WOWIDEA_API_KEY=sk-... ，或在终端里重新运行。"
  fi
  if [[ -z "$KEY" ]]; then
    die "密钥为空。"
  fi
  case "$KEY" in
    *$'\n'*|*$'\r'*) die "密钥不能包含换行。" ;;
  esac
  export WOWIDEA_API_KEY="$KEY"
}

redact_stream() {
  local line
  if [[ -z "${KEY}" ]]; then
    cat
    return 0
  fi
  while IFS= read -r line || [[ -n "${line}" ]]; do
    printf '%s\n' "${line//"$KEY"/[REDACTED]}"
  done
}

try_keychain() {
  local bin err status
  if [[ "${WOWIDEA_INSTALL_SKIP_KEYCHAIN:-}" == "1" ]]; then
    printf '%s\n' "已跳过钥匙串（WOWIDEA_INSTALL_SKIP_KEYCHAIN=1），改为写入 shell 启动文件。"
    return 1
  fi
  bin="$(command -v wowidea || true)"
  [[ -n "$bin" ]] || return 1
  err="$(mktmp)"
  status=0
  if command -v timeout >/dev/null 2>&1; then
    printf '%s' "$KEY" | timeout 20s "$bin" auth use-key --key-stdin >/dev/null 2>"$err" || status=$?
  else
    printf '%s' "$KEY" | "$bin" auth use-key --key-stdin >/dev/null 2>"$err" || status=$?
  fi
  if [[ "$status" -eq 0 ]]; then
    printf '%s\n' "密钥已写入系统钥匙串（wowidea auth use-key）。"
    return 0
  fi
  if [[ -s "$err" ]]; then
    redact_stream <"$err" >&2 || true
  fi
  printf '%s\n' "系统钥匙串不可用（wowidea auth use-key 退出码 ${status}）。改为写入 shell 启动文件。" >&2
  return 1
}

# Reads the key on stdin. Exit 0 written or already present, 10 skipped, 1 refused.
persist_rc() {
  local file="$1"
  local helper status
  helper="$(mktmp)"
  cat >"$helper" <<'ENDJS'
const fs = require("node:fs");
const file = process.argv[2];
const key = fs.readFileSync(0, "utf8");
if (!key || /[\r\n\0]/.test(key)) {
  console.error("密钥为空或包含换行。");
  process.exit(2);
}
const quoted = "'" + key.replace(/'/g, "'\\''") + "'";
const marker = "# wowidea-cli: WOWIDEA_API_KEY (managed by scripts/install.sh)";
const exportLine = "export WOWIDEA_API_KEY=" + quoted;
const nofollow = fs.constants.O_NOFOLLOW || 0;
if (!nofollow) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) {
      console.error("跳过 " + file + "（符号链接，拒绝写入密钥）。");
      process.exit(10);
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      console.error("无法检查 " + file + "。");
      process.exit(1);
    }
  }
}
let fd;
try {
  fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | nofollow, 0o600);
} catch (error) {
  if (error && (error.code === "ELOOP" || error.code === "EMLINK")) {
    console.error("跳过 " + file + "（符号链接，拒绝写入密钥）。");
    process.exit(10);
  }
  console.error("无法打开 " + file + "。");
  process.exit(1);
}
try {
  const st = fs.fstatSync(fd);
  if (!st.isFile()) {
    console.error("拒绝写入 " + file + "：不是普通文件。");
    process.exit(1);
  }
  if (st.mode & 0o022) {
    console.error("拒绝把密钥写入组或其他用户可写的文件 " + file + "（mode " + (st.mode & 0o777).toString(8) + "）。");
    process.exit(1);
  }
  const text = fs.readFileSync(fd, "utf8");
  const managed = text.includes(marker);
  const hasAssignment = /(^|\n)\s*(export\s+)?WOWIDEA_API_KEY=/.test(text);
  if (hasAssignment && !managed) {
    console.log("WOWIDEA_API_KEY 已在 " + file + " 中设置，保留原有行。");
    if (st.mode & 0o044) process.stderr.write(file + " 对组或其他用户可读。脚本没有改这条已有配置，也没有放宽权限。\n");
    process.exit(0);
  }
  let next;
  if (managed) {
    let replaced = false;
    const mapped = text.split("\n").map((line) => {
      if (/^\s*export\s+WOWIDEA_API_KEY=/.test(line)) {
        replaced = true;
        return exportLine;
      }
      return line;
    });
    if (!replaced) mapped.push(exportLine);
    next = mapped.join("\n");
    if (!next.endsWith("\n")) next += "\n";
    console.log("已更新 " + file + " 中的 WOWIDEA_API_KEY。");
  } else {
    const gap = text.length === 0 ? "" : (text.endsWith("\n") ? "\n" : "\n\n");
    next = text + gap + marker + "\n" + exportLine + "\n";
    console.log("已把 WOWIDEA_API_KEY 写入 " + file + "。");
  }
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, next, 0, "utf8");
  } catch (error) {
    try {
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, text, 0, "utf8");
    } catch (restoreError) { /* leave the OS to close fd */ }
    console.error("写入 " + file + " 失败，已尽量恢复原内容。");
    process.exit(1);
  }
  const mode = st.mode & 0o777;
  let tightened = mode & ~0o077;
  if (tightened === 0) tightened = 0o600;
  if ((mode & 0o077) !== 0) {
    fs.fchmodSync(fd, tightened);
    console.log("已收紧 " + file + " 的权限（mode " + tightened.toString(8) + "），避免密钥被其他用户读到。");
  }
} finally {
  fs.closeSync(fd);
}
ENDJS
  status=0
  printf '%s' "$KEY" | node "$helper" "$file" || status=$?
  return "$status"
}

configure_key() {
  local ok status file
  read_key
  if try_keychain; then
    return 0
  fi
  ok=0
  for file in "${HOME}/.bashrc" "${HOME}/.zshrc"; do
    status=0
    persist_rc "$file" || status=$?
    if [[ "$status" -eq 0 ]]; then
      ok=1
    fi
  done
  if [[ -e "${HOME}/.bash_profile" && ! -L "${HOME}/.bash_profile" ]]; then
    status=0
    persist_rc "${HOME}/.bash_profile" || status=$?
    if [[ "$status" -eq 0 ]]; then
      ok=1
    fi
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    printf '%s\n' "macOS 的 bash 登录壳读 ~/.bash_profile，不读 ~/.bashrc。若新终端没有密钥，在 ~/.bash_profile 加上：[ -f ~/.bashrc ] && . ~/.bashrc" >&2
  fi
  [[ "$ok" -eq 1 ]] || die "没能把密钥保存到钥匙串或 shell 启动文件。" 1
  printf '%s\n' "新开一个终端后 WOWIDEA_API_KEY 会生效。这次安装会直接用它检查余额。"
}

verify_balance() {
  local out status
  out="$(mktmp)"
  printf '%s\n' "正在运行 wowidea balance 检查密钥..."
  status=0
  wowidea balance </dev/null >"$out" 2>&1 || status=$?
  redact_stream <"$out"
  if [[ "$status" -eq 0 ]]; then
    printf '%s\n' "密钥可用。"
    return 0
  fi
  printf '%s\n' "安装已完成，但 wowidea balance 退出码为 ${status}。" >&2
  if [[ "$status" -eq 3 ]]; then
    printf '%s\n' "退出码 3 表示认证失败。请到 https://wowidea.top/user/api-key 检查密钥后重新运行本脚本。" >&2
  else
    printf '%s\n' "命令行本身已装好。余额检查没有完成（网络或服务异常）。" >&2
  fi
  return 0
}

main() {
  require_tools
  sync_repo
  cd "$DEST" || die "无法进入 ${DEST}。" 1
  install_cli
  configure_key
  verify_balance
  printf '%s\n' "下一步：wowidea capabilities --brief"
  cleanup
}

main
exit 0
}
