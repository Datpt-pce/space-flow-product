#!/bin/sh
set -eu
# Carry the proposed upstream bounds fix only after reproducing the old overflow.
cp gzwrite.c /tmp/gzwrite-original.c
git apply /tmp/zlib-stall.patch
cp gzwrite.c /tmp/gzwrite-fixed.c
cp /tmp/gzwrite-original.c gzwrite.c
CFLAGS='-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer -fno-pie -no-pie' ./configure --static
make -j2
if ASAN_OPTIONS=detect_leaks=0 timeout -k 2 30 ./example > /tmp/zlib-negative-control.log 2>&1; then
    echo 'Unpatched zlib unexpectedly passed the regression' >&2
    exit 1
fi
cat /tmp/zlib-negative-control.log
grep -q 'heap-buffer-overflow' /tmp/zlib-negative-control.log
echo 'Confirmed: unpatched zlib fails with an ASan heap-buffer-overflow'
cp /tmp/gzwrite-fixed.c gzwrite.c
make clean
CFLAGS='-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer -fno-pie -no-pie' ./configure --static
make -j2
ASAN_OPTIONS=detect_leaks=0 timeout -k 2 30 make test
make clean
CFLAGS='-O2 -ffile-prefix-map=/zlib=.' ./configure --prefix=/usr
make -j2
timeout -k 2 30 make test
sha256sum libz.so.1.3.2
