#!/bin/sh
set -eu
cd "$(dirname "$0")"
clang -O2 -arch arm64 -mmacosx-version-min=13.0 -Wall -Werror -o alia-box-sensors alia-box-sensors.c \
  -framework CoreFoundation -framework IOKit -lIOReport
digest=$(shasum -a 256 alia-box-sensors | cut -d" " -f1)
{
  printf 'export const MAC_SENSORS_DIGEST = "%s";\n' "$digest"
  printf 'export const MAC_SENSORS_BINARY = "'
  base64 < alia-box-sensors | tr -d '\n'
  printf '";\n'
} > ../../src/monitor/mac-sensors-binary.ts
rm alia-box-sensors
echo "wrote src/monitor/mac-sensors-binary.ts"
