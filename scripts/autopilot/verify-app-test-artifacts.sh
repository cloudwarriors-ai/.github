#!/usr/bin/env bash
# Fail closed before upload if an issue-scoped preview credential reached a
# browser trace or any candidate app-test artifact.
set -euo pipefail

value_file="${PREVIEW_THROTTLE_VALUE_FILE:?missing PREVIEW_THROTTLE_VALUE_FILE}"
enabled_marker="${PREVIEW_THROTTLE_ENABLED_MARKER:?missing PREVIEW_THROTTLE_ENABLED_MARKER}"
app_tests_dir="${APP_TESTS_ARTIFACT_DIR:?missing APP_TESTS_ARTIFACT_DIR}"
playwright_report_dir="${PLAYWRIGHT_REPORT_DIR:?missing PLAYWRIGHT_REPORT_DIR}"
playwright_results_dir="${PLAYWRIGHT_TEST_RESULTS_DIR:?missing PLAYWRIGHT_TEST_RESULTS_DIR}"

cleanup_candidates() {
  local target
  for target in "$app_tests_dir" "$playwright_report_dir" "$playwright_results_dir"; do
    case "$target" in
      ""|"/")
        echo "::error::Refusing unsafe artifact cleanup target" >&2
        continue
        ;;
    esac
    rm -rf -- "$target"
  done
}

safe=true
if [ -f "$enabled_marker" ]; then
  if find "$playwright_results_dir" -type f -name 'trace.zip' -print -quit \
    2>/dev/null | grep -q .; then
    echo "::error::Credential-bearing app-test runs must not create browser traces" >&2
    safe=false
  fi

  if [ ! -s "$value_file" ]; then
    echo "::error::Scoped bypass audit value is unavailable; refusing artifact upload" >&2
    safe=false
  else
    derived=$(cat "$value_file")
    for target in "$app_tests_dir" "$playwright_report_dir" "$playwright_results_dir"; do
      if [ -e "$target" ] && grep -R -a -F -q -- "$derived" "$target"; then
        echo "::error::Scoped bypass value detected in app-test artifacts" >&2
        safe=false
        break
      fi
    done
    unset derived
  fi
fi

rm -f -- "$value_file" "$enabled_marker"
if [ "$safe" != "true" ]; then
  cleanup_candidates
  exit 1
fi
