import sys
import json

# Security-corpus fixture (Python track) — Custom Node Platform Phase 9
# (specs/space-flow-master-plan/01-custom-node-platform.md). Unboundedly grows a list of large
# byte chunks, the textbook memory-hog shape. Left UNCAUGHT on purpose: py_adapter.py's
# resource.setrlimit(RLIMIT_AS, ...) makes the kernel refuse further address-space growth once
# this process hits limits.memoryMB, raising MemoryError — this script does not catch it, so the
# process exits nonzero deterministically instead of actually consuming host memory unbounded.


def main():
    json.loads(sys.stdin.read())
    chunks = []
    while True:
        chunks.append(bytearray(10 * 1024 * 1024))  # 10MB per iteration


if __name__ == "__main__":
    main()
