#!/usr/bin/env bash
# Hamster private AppImage launcher — FAIL CLOSED on Chromium sandbox support.
#
# Replaces electron-builder legacy fuse2 AppRun which auto-injects --no-sandbox
# when `unshare -Ur` is missing or fails (upstream intentional fail-open).
#
# Policy (packaging security mustfix):
# - Never inject --no-sandbox on probe failure.
# - Never pass --no-sandbox through to BIN (including if present in args).
# - Unsupported user-namespace environment → stderr + non-zero exit (no exec downgrade).
# - Does not chmod/setuid/sysctl; static-regressable; not a substitute for running BIN.
set -euo pipefail

THIS="$0"
args=("$@")
NUMBER_OF_ARGS="$#"

if [ -z "${APPDIR:-}" ] ; then
  path="$(dirname "$(readlink -f "${THIS}")")"
  while [[ "$path" != "" && ! -e "$path/AppRun" ]]; do
    path=${path%/*}
  done
  APPDIR="$path"
fi

if [ -z "${APPDIR:-}" ] ; then
  echo "ERROR: could not locate the AppDir. Ensure this script is run from within a properly structured AppImage." >&2
  exit 1
fi

export PATH="${APPDIR}:${APPDIR}/usr/sbin${PATH:+:${PATH}}"
export XDG_DATA_DIRS="${APPDIR}/usr/share/${XDG_DATA_DIRS:+:${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share/:/usr/share/"
export LD_LIBRARY_PATH="${APPDIR}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export GSETTINGS_SCHEMA_DIR="${APPDIR}/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:${GSETTINGS_SCHEMA_DIR}}"

BIN="$APPDIR/hamster-electron"

# Refuse Chromium sandbox disable flag from any entry (desktop, CLI, or injected).
for arg in "${args[@]}" ; do
  if [ "$arg" = --no-sandbox ] ; then
    echo "ERROR: --no-sandbox is not permitted for this Hamster AppImage entry. Refusing to start." >&2
    exit 1
  fi
done

# Fail closed if user namespaces are unavailable (or unshare missing → 127).
# Do NOT inject --no-sandbox. Do NOT exec BIN without sandbox support.
if ! command -v unshare >/dev/null 2>&1 ; then
  echo "ERROR: 'unshare' is required for Chromium sandbox user namespaces. Unsupported environment; refusing to start." >&2
  exit 1
fi
if ! unshare -Ur true >/dev/null 2>&1 ; then
  echo "ERROR: user namespaces unavailable (unshare -Ur failed). Unsupported environment; refusing to start without Chromium sandbox." >&2
  exit 1
fi

if [ -z "${APPIMAGE_EXIT_AFTER_INSTALL:-}" ] ; then
  trap atexit EXIT
fi

isEulaAccepted=1

atexit()
{
  if [ "$isEulaAccepted" = 1 ] ; then
    if [ "$NUMBER_OF_ARGS" -eq 0 ] ; then
      exec "$BIN"
    else
      exec "$BIN" "${args[@]}"
    fi
  fi
}

if [ -z "${APPIMAGE:-}" ] ; then
  APPIMAGE="$APPDIR/AppRun"
fi
