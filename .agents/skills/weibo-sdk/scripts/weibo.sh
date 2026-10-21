#!/usr/bin/env bash
# weibo.sh — 便携入口：用 bun 直接跑 weibo-sdk 源码，不装 npm 包、不 build dist/。
#
#   ./weibo.sh whoami --guest
#   ./weibo.sh tweet context <mblogId> --comments 5
#   ./weibo.sh --doctor
#
# 平台：Linux / macOS / Windows(Git Bash、MSYS2)。只用 bash 3.2+ 与 coreutils，
# 不依赖 readlink -f、node、npm。
#
# 环境变量：
#   WEIBO_SDK_HOME   仓库根目录（含 src/cli.ts）。不设则自动探测。
#   WEIBO_BUN        bun 可执行文件路径。不设则从 PATH / ~/.bun/bin / 常见目录找。
#   WEIBO_ENV_FILE   默认 --env-file；不传时等价于 <pwd>/.env（与 weibo-cli 一致）。
#
# 退出码：CLI 自身的退出码原样透传；脚本自身环境错误用 64（缺 repo/bun）、78（缺依赖）。
set -uo pipefail

# Git Bash / MSYS2 / Cygwin：用 .exe 后缀找 bun，并把控制台切到 UTF-8，
# 否则中文输出会按 GBK 代码页打出来变成乱码。
case "${OSTYPE:-}" in
  msys* | cygwin* | win32*)
    IS_WINDOWS_SH=1
    BUN_NAMES="bun.exe bun"
    if command -v chcp.com >/dev/null 2>&1; then chcp.com 65001 >/dev/null 2>&1 || true; fi
    ;;
  *)
    IS_WINDOWS_SH=0
    BUN_NAMES="bun"
    ;;
esac

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

if [[ -n "${WEIBO_SDK_HOME:-}" ]] && ! is_repo "$WEIBO_SDK_HOME"; then
  die "WEIBO_SDK_HOME=$WEIBO_SDK_HOME 不是 weibo-sdk 仓库（缺 src/cli.ts 或 package.json）"
fi
REPO="$(find_repo)" || die "找不到 weibo-sdk 仓库（需要含 src/cli.ts）。设置 WEIBO_SDK_HOME 指向仓库根目录。已查找：
  \$WEIBO_SDK_HOME, $SELF_DIR 的上级目录, $PWD, ~/projects/weibo-sdk
没有 clone 过就先：
  gh repo clone Chilfish/weibo-sdk \"\$HOME/projects/weibo-sdk\"
  cd \"\$HOME/projects/weibo-sdk\" && pnpm install --frozen-lockfile"
BUN="$(find_bun)" || die "找不到 bun。安装：curl -fsSL https://bun.sh/install | bash（Windows: irm bun.sh/install.ps1 | iex），或用 WEIBO_BUN 指定路径。"
CLI="$REPO/src/cli.ts"

# ---------- 自检 ----------
doctor() {
  local code=0 probe env_file
  printf 'repo      : %s\n' "$REPO"
  printf 'bun       : %s (%s)\n' "$BUN" "$("$BUN" --version 2>/dev/null || echo '?')"
  printf 'bash      : %s (%s)\n' "${BASH_VERSION}" "${OSTYPE:-unknown}"
  if [[ "$IS_WINDOWS_SH" == 1 ]]; then
    printf 'platform  : Windows shell（路径经 MSYS 转换）\n'
  else
    printf 'platform  : %s\n' "$(uname -s 2>/dev/null || echo unknown)"
  fi

  if [[ -d "$REPO/node_modules" ]]; then
    printf 'deps      : ok（node_modules 存在）\n'
  else
    printf 'deps      : MISSING —— 在仓库里运行 pnpm install --frozen-lockfile\n'
    printf '            （bun install 会装出坏缓存，node 侧 import 报 .0002 扩展名错误；两者别混用）\n'
    code=1
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
    probe="$("$BUN" "$CLI" whoami --guest 2>&1 | tr -d '\r' | tr '\n' ' ')"
    if [[ "$probe" == *'"auth": "guest"'* ]]; then
      printf 'guest     : ok %s\n' "${probe:0:160}"
    else
      printf 'guest     : FAIL %s\n' "${probe:0:400}"
      code=1
    fi
  else
    printf 'guest     : 未探测（WEIBO_DOCTOR_NET=1 可联网自检）\n'
  fi
  return "$code"
}

# ---------- 脚本自带命令 ----------
case "${1:-}" in
  doctor | --doctor) doctor; exit $? ;;
  --where | -where) printf 'repo=%s\nbun=%s\ncli=%s\n' "$REPO" "$BUN" "$CLI"; exit 0 ;;
  '')
    printf 'weibo — 用 bun 直跑 weibo-sdk 源码\n\n'
    printf '  weibo <命令> [参数...]     透传给 weibo-cli，例如 weibo tweet context <mblogId> --guest\n'
    printf '  weibo --doctor             环境自检\n'
    printf '  weibo --where              打印实际使用的 repo / bun\n'
    printf '  weibo --help               完整命令树\n'
    exit 0
    ;;
esac

if [[ ! -d "$REPO/node_modules" ]]; then
  die "仓库缺少 node_modules：cd \"$REPO\"
  pnpm install --frozen-lockfile
（不要用 bun install：它装的 axios 缓存会让 import 报错。两者别混用。）" 78
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
exec "$BUN" "$CLI" "${ARGS[@]}"
