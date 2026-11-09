#!/usr/bin/env bash
# weibo.sh — 便携入口：有仓库时用 bun 直接跑源码，没有仓库时回退到已安装的 weibo-cli。
#
#   ./weibo.sh whoami --guest
#   ./weibo.sh tweet context <mblogId> --comments 5
#   ./weibo.sh --doctor
#
# 入口查找顺序：
#   1. 仓库 + node_modules → bun src/cli.ts
#   2. bun 全局安装的包 → bun dist/cli-bin.mjs（绕开系统 node 版本）
#   3. PATH / ~/.bun/bin 里的 weibo-cli
#   4. bun x -p @chilfish/weibo-sdk weibo-cli
#
# 平台：Linux / macOS / Windows(Git Bash、MSYS2)。只用 bash 3.2+ 与 coreutils，
# 不依赖 readlink -f、npm。
#
# 环境变量：
#   WEIBO_SDK_HOME   仓库根目录（含 src/cli.ts）。不设则自动探测。
#   WEIBO_BUN        bun 可执行文件路径。不设则从 PATH / ~/.bun/bin / 常见目录找。
#   WEIBO_ENV_FILE   默认 --env-file；不传时等价于 <pwd>/.env（与 weibo-cli 一致）。
#
# 退出码：CLI 自身的退出码原样透传；脚本自身找不到可用入口时用 64。
set -uo pipefail

# Git Bash / MSYS2 / Cygwin：用 .exe 后缀找 bun，并把控制台切到 UTF-8，
# 否则中文输出会按 GBK 代码页打出来变成乱码。
case "${OSTYPE:-}" in
  msys* | cygwin* | win32*)
    IS_WINDOWS_SH=1
    BUN_NAMES="bun.exe bun"
    CLI_NAMES="weibo-cli.cmd weibo-cli.exe weibo-cli"
    if command -v chcp.com >/dev/null 2>&1; then chcp.com 65001 >/dev/null 2>&1 || true; fi
    ;;
  *)
    IS_WINDOWS_SH=0
    BUN_NAMES="bun"
    CLI_NAMES="weibo-cli"
    ;;
esac

BUN_HOME="${BUN_INSTALL:-${HOME:-}/.bun}"
BUN_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$BUN_HOME/install/cache}"

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SELF_DIR="${SELF_DIR%/}"

msg() { printf 'weibo: %s\n' "$*" >&2; }
die() { msg "$1"; exit "${2:-64}"; }

# ---------- 定位仓库 ----------
is_repo() {
  [[ -n "${1:-}" && -f "$1/src/cli.ts" && -f "$1/package.json" ]]
}

# 从脚本自身位置向上找（仓库内 .agents/skills/weibo-sdk/scripts/ → 三级父目录）
self_ancestors() {
  local dir="$SELF_DIR" i=0
  while (( i < 5 )); do
    dir="${dir%/*}"
    if [[ -n "$dir" && "$dir" != "$SELF_DIR" ]]; then printf '%s\n' "$dir"; fi
    i=$(( i + 1 ))
  done
}

find_repo() {
  local c
  {
    if [[ -n "${WEIBO_SDK_HOME:-}" ]]; then printf '%s\n' "$WEIBO_SDK_HOME"; fi
    self_ancestors
    printf '%s\n' "$PWD" "${HOME:-}/projects/weibo-sdk" "${HOME:-}/weibo-sdk"
    printf '%s\n' "/workspace/projects/weibo-sdk"
  } | while IFS= read -r c; do
    if is_repo "$c"; then (cd -- "$c" && pwd -P); return 0; fi
  done
}

# ---------- 定位 bun ----------
find_bun() {
  local name c
  if [[ -n "${WEIBO_BUN:-}" ]]; then
    [[ -x "$WEIBO_BUN" ]] || die "WEIBO_BUN 不可执行：$WEIBO_BUN"
    printf '%s' "$WEIBO_BUN"; return 0
  fi
  for name in $BUN_NAMES; do
    c="$(command -v "$name" 2>/dev/null || true)"
    if [[ -n "$c" && -x "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  for name in $BUN_NAMES; do
    for c in \
      "${HOME:-}/.bun/bin/$name" \
      "${LOCALAPPDATA:-}/Microsoft/WinGet/Links/$name" \
      /usr/local/bin/bun \
      /usr/bin/bun \
      /opt/homebrew/bin/bun \
      "${HOME:-}/.local/bin/bun"
    do
      if [[ -n "$c" && -x "$c" ]]; then printf '%s' "$c"; return 0; fi
    done
  done
  return 1
}

# ---------- 定位已安装的包 ----------
find_installed_dist() {
  local c
  for c in \
    "$BUN_HOME/install/global/node_modules/@chilfish/weibo-sdk/dist/cli-bin.mjs" \
    "${HOME:-}/.bun/install/global/node_modules/@chilfish/weibo-sdk/dist/cli-bin.mjs"
  do
    if [[ -f "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

find_installed_cli() {
  local name c
  for name in $CLI_NAMES; do
    c="$(command -v "$name" 2>/dev/null || true)"
    if [[ -n "$c" && -x "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  for name in $CLI_NAMES; do
    for c in \
      "$BUN_HOME/bin/$name" \
      "${HOME:-}/.bun/bin/$name" \
      "${PNPM_HOME:-}/$name" \
      "${APPDATA:-}/npm/$name" \
      "${LOCALAPPDATA:-}/Microsoft/WinGet/Links/$name" \
      "${HOME:-}/.local/bin/weibo-cli" \
      /usr/local/bin/weibo-cli \
      /usr/bin/weibo-cli
    do
      if [[ -n "$c" && -x "$c" ]]; then printf '%s' "$c"; return 0; fi
    done
  done
  return 1
}

if [[ -n "${WEIBO_SDK_HOME:-}" ]] && ! is_repo "$WEIBO_SDK_HOME"; then
  die "WEIBO_SDK_HOME=$WEIBO_SDK_HOME 不是 weibo-sdk 仓库（缺 src/cli.ts 或 package.json）"
fi

# ---------- 选择入口 ----------
REPO="$(find_repo || true)"
BUN="$(find_bun || true)"
INSTALLED_DIST=""
INSTALLED_CLI=""
MODE=none

if [[ -n "$REPO" && -d "$REPO/node_modules" ]]; then
  MODE=source
else
  if [[ -n "$BUN" ]]; then INSTALLED_DIST="$(find_installed_dist || true)"; fi
  if [[ -n "$INSTALLED_DIST" ]]; then
    MODE=dist
  elif INSTALLED_CLI="$(find_installed_cli)"; then
    MODE=bin
  elif [[ -n "$BUN" ]]; then
    MODE=bunx
  fi
fi

if [[ "$MODE" == source ]]; then
  BUN="$(find_bun)" || die "找不到 bun。安装：curl -fsSL https://bun.sh/install | bash（Windows: irm bun.sh/install.ps1 | iex），或用 WEIBO_BUN 指定路径。"
fi

mode_label() {
  case "$MODE" in
    source) printf 'source（bun 直跑仓库源码）' ;;
    dist) printf 'dist（bun 跑全局安装的 cli-bin.mjs）' ;;
    bin) printf 'bin（已安装的 weibo-cli）' ;;
    bunx) printf 'bunx（临时下载运行）' ;;
    *) printf 'none（没有可用入口）' ;;
  esac
}

run_cli() {
  case "$MODE" in
    source) "$BUN" "$REPO/src/cli.ts" "$@" ;;
    dist) "$BUN" "$INSTALLED_DIST" "$@" ;;
    bin) "$INSTALLED_CLI" "$@" ;;
    bunx) "$BUN" x -p @chilfish/weibo-sdk weibo-cli "$@" ;;
  esac
}

# ---------- 自检 ----------
doctor() {
  local code=0 probe env_file cli_label version cache_hit
  printf 'mode      : %s\n' "$(mode_label)"
  printf 'repo      : %s\n' "${REPO:-未找到}"
  if [[ -n "$BUN" ]]; then
    printf 'bun       : %s (%s)\n' "$BUN" "$("$BUN" --version 2>/dev/null || echo '?')"
  else
    printf 'bun       : 未找到\n'
  fi
  printf 'node      : %s\n' "$(node --version 2>/dev/null || echo '未找到')"
  printf 'bash      : %s (%s)\n' "${BASH_VERSION}" "${OSTYPE:-unknown}"
  if [[ "$IS_WINDOWS_SH" == 1 ]]; then
    printf 'platform  : Windows shell（路径经 MSYS 转换）\n'
  else
    printf 'platform  : %s\n' "$(uname -s 2>/dev/null || echo unknown)"
  fi

  if [[ -z "$REPO" ]]; then
    printf 'deps      : 跳过（没有本地仓库）\n'
  elif [[ -d "$REPO/node_modules" ]]; then
    printf 'deps      : ok（node_modules 存在）\n'
  else
    printf 'deps      : MISSING，源码模式需要 pnpm install --frozen-lockfile\n'
    printf '            当前回退到已安装的 weibo-cli；要跑仓库源码就补上依赖\n'
  fi

  case "$MODE" in
    source) cli_label="$REPO/src/cli.ts"; version="$("$BUN" "$cli_label" --version 2>/dev/null || echo '?')" ;;
    dist) cli_label="$INSTALLED_DIST"; version="$("$BUN" "$cli_label" --version 2>/dev/null || echo '?')" ;;
    bin) cli_label="$INSTALLED_CLI"; version="$("$cli_label" --version 2>/dev/null || echo '?')" ;;
    bunx) cli_label="bun x -p @chilfish/weibo-sdk weibo-cli"; version='?' ;;
    *) cli_label='（无）'; version='' ;;
  esac
  printf 'cli       : %s%s\n' "$cli_label" "${version:+ ($version)}"

  if [[ -d "$BUN_CACHE_DIR" ]]; then
    cache_hit="$(find "$BUN_CACHE_DIR" -name '*.l2s*' -print 2>/dev/null | head -n 1 || true)"
    if [[ -n "$cache_hit" ]]; then
      printf 'bun cache : 发现 .l2s.* 残留（%s）\n' "$BUN_CACHE_DIR"
      printf '            修复：rm -rf "%s" && bun install --backend=copyfile\n' "$BUN_CACHE_DIR"
      code=1
    else
      printf 'bun cache : ok（%s）\n' "$BUN_CACHE_DIR"
    fi
  else
    printf 'bun cache : 未创建（%s）\n' "$BUN_CACHE_DIR"
  fi

  env_file="${WEIBO_ENV_FILE:-$PWD/.env}"
  if [[ -f "$env_file" ]]; then
    if grep -qs '^[[:space:]]*WEIBO_COOKIE[[:space:]]*=' "$env_file"; then
      printf 'cookie    : .env 里有 WEIBO_COOKIE（%s）\n' "$env_file"
    else
      printf 'cookie    : .env 存在但没有 WEIBO_COOKIE，会走访客（%s）\n' "$env_file"
    fi
  else
    printf 'cookie    : 没有 .env（%s），默认走访客；要登录态就建 .env 或传 --cookie\n' "$env_file"
  fi

  if [[ "${WEIBO_DOCTOR_NET:-0}" == "1" ]]; then
    if [[ "$MODE" == none ]]; then
      printf 'guest     : 跳过（没有可用入口）\n'
    else
      probe="$(run_cli whoami --guest 2>&1 | tr -d '\r' | tr '\n' ' ')"
      if [[ "$probe" == *'"auth": "guest"'* ]]; then
        printf 'guest     : ok %s\n' "${probe:0:160}"
      else
        printf 'guest     : FAIL %s\n' "${probe:0:400}"
        code=1
      fi
    fi
  else
    printf 'guest     : 未探测（WEIBO_DOCTOR_NET=1 可联网自检）\n'
  fi
  if [[ "$MODE" == none ]]; then code=1; fi
  return "$code"
}

# ---------- 脚本自带命令 ----------
case "${1:-}" in
  doctor | --doctor) doctor; exit $? ;;
  --where | -where)
    case "$MODE" in
      source) cli="$REPO/src/cli.ts" ;;
      dist) cli="$INSTALLED_DIST" ;;
      bin) cli="$INSTALLED_CLI" ;;
      bunx) cli="bun x -p @chilfish/weibo-sdk weibo-cli" ;;
      *) cli='' ;;
    esac
    printf 'mode=%s\nrepo=%s\nbun=%s\ncli=%s\n' "$(mode_label)" "${REPO:-}" "${BUN:-}" "$cli"
    exit 0
    ;;
  '')
    printf 'weibo — 读取微博数据的便携入口（源码与全局 bin 自动切换）\n\n'
    printf '  weibo <命令> [参数...]     透传给 weibo-cli，例如 weibo tweet context <mblogId> --guest\n'
    printf '  weibo --doctor             环境自检（模式 / 依赖 / bun 缓存 / 登录态）\n'
    printf '  weibo --where              打印实际使用的入口\n'
    printf '  weibo --help               完整命令树\n'
    exit 0
    ;;
esac

if [[ "$MODE" == none ]]; then
  die "没有可用的 weibo-cli 入口。任选一种：
  1) 全局安装（推荐）
     npm i -g @chilfish/weibo-sdk
     bun add -g --backend=copyfile @chilfish/weibo-sdk
  2) 临时运行
     npx -p @chilfish/weibo-sdk weibo-cli whoami --guest
     bunx -p @chilfish/weibo-sdk weibo-cli whoami --guest
  3) 源码直跑
     gh repo clone Chilfish/weibo-sdk \"\$HOME/projects/weibo-sdk\"
     cd \"\$HOME/projects/weibo-sdk\" && pnpm install --frozen-lockfile"
fi

# WEIBO_ENV_FILE 只在用户没显式传 --env-file 时补上，保留 CLI 的默认 <pwd>/.env
ARGS=("$@")
if [[ -n "${WEIBO_ENV_FILE:-}" ]]; then
  has_env_file=0
  for a in "${ARGS[@]}"; do
    if [[ "$a" == --env-file* ]]; then has_env_file=1; fi
  done
  if (( has_env_file == 0 )); then ARGS+=(--env-file "$WEIBO_ENV_FILE"); fi
fi

# 关键：不 cd 进仓库。CLI 的默认 .env 是 <pwd>/.env，
# bun 从 src/cli.ts 的位置向上解析 node_modules，所以两件事互不影响。
case "$MODE" in
  source) exec "$BUN" "$REPO/src/cli.ts" "${ARGS[@]}" ;;
  dist) exec "$BUN" "$INSTALLED_DIST" "${ARGS[@]}" ;;
  bin) exec "$INSTALLED_CLI" "${ARGS[@]}" ;;
  bunx) exec "$BUN" x -p @chilfish/weibo-sdk weibo-cli "${ARGS[@]}" ;;
esac
