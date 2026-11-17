#!/usr/bin/env bash
# pgtune host collector — runs on YOUR machine only.
# Prints a pgtune URL with query params. Nothing is uploaded.
# Usage:
#   curl -fsSL https://pgtune.dmosk.net/collect.sh | bash
#   curl -fsSL https://pgtune.dmosk.net/collect.sh | bash -s -- ru
# Env: PGTUNE_ORIGIN (default https://pgtune.dmosk.net), PGTUNE_LANG

set -euo pipefail

ORIGIN="${PGTUNE_ORIGIN:-https://pgtune.dmosk.net}"
ORIGIN="${ORIGIN%/}"
LANG_CODE="${1:-${PGTUNE_LANG:-en}}"

os_type="linux"
uname_s="$(uname -s 2>/dev/null || echo unknown)"
case "$uname_s" in
  Darwin) os_type="mac" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) os_type="windows" ;;
  *) os_type="linux" ;;
esac

ram_gb=""
if [ -r /proc/meminfo ]; then
  kb="$(awk '/MemTotal:/ {print $2; exit}' /proc/meminfo)"
  if [ -n "${kb:-}" ]; then
    ram_gb=$(( (kb + 1048575) / 1048576 ))
  fi
elif command -v sysctl >/dev/null 2>&1; then
  bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
  if [ -n "${bytes:-}" ]; then
    ram_gb=$(( (bytes + 1073741823) / 1073741824 ))
  fi
fi
if [ -z "${ram_gb:-}" ] || [ "$ram_gb" -lt 1 ]; then
  ram_gb=16
fi

cpu=""
if command -v nproc >/dev/null 2>&1; then
  cpu="$(nproc 2>/dev/null || true)"
elif command -v sysctl >/dev/null 2>&1; then
  cpu="$(sysctl -n hw.ncpu 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || true)"
elif [ -r /proc/cpuinfo ]; then
  cpu="$(grep -c ^processor /proc/cpuinfo 2>/dev/null || true)"
fi
if [ -z "${cpu:-}" ] || [ "$cpu" -lt 1 ]; then
  cpu=""
fi

hd="ssd"
if command -v lsblk >/dev/null 2>&1; then
  rota="$(lsblk -ndo ROTA 2>/dev/null | awk 'NR==1 {print $1}')"
  name="$(lsblk -ndo NAME 2>/dev/null | awk 'NR==1 {print $1}')"
  if [ "${rota:-1}" = "1" ]; then
    hd="hdd"
  elif echo "${name:-}" | grep -qi 'nvme'; then
    hd="nvme"
  else
    hd="ssd"
  fi
elif [ "$os_type" = "mac" ]; then
  hd="ssd"
fi

db_ver=""
if command -v psql >/dev/null 2>&1; then
  db_ver="$(psql -Atqc "show server_version_num" 2>/dev/null | head -n1 || true)"
  if [ -n "${db_ver:-}" ]; then
    db_ver=$(( db_ver / 10000 ))
  fi
fi
if [ -z "${db_ver:-}" ] && command -v postgres >/dev/null 2>&1; then
  db_ver="$(postgres -V 2>/dev/null | grep -oE '[0-9]+' | head -n1 || true)"
fi
case "${db_ver:-}" in
  14|15|16|17|18|19) ;;
  *) db_ver="16" ;;
esac

qs="v=${db_ver}&os=${os_type}&ram=${ram_gb}&unit=GB&hd=${hd}&db=web"
if [ -n "${cpu:-}" ]; then
  qs="${qs}&cpu=${cpu}"
fi

url="${ORIGIN}/${LANG_CODE}/?${qs}"

echo "pgtune collector (local only — nothing uploaded)"
echo "  os=${os_type} ram=${ram_gb}GB cpu=${cpu:-?} hd=${hd} pg=${db_ver}"
echo
echo "$url"
echo
echo "Open the link, review values, then press Generate."
