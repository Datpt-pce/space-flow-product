import sys
import os
import json

# Security-corpus fixture (Python track) — deliberately forks without bound or reaping, the
# textbook fork-bomb shape. Left UNCAUGHT on purpose: py_adapter.py's resource.setrlimit()
# RLIMIT_NPROC makes the kernel refuse the fork once this (namespaced) UID's process count hits
# the cap, raising BlockingIOError (EAGAIN) — this script does not catch it, so the process
# exits nonzero almost immediately instead of spinning up thousands of processes. That fast,
# deterministic kernel-level refusal (not a timeout racing against runaway fork growth) is
# exactly what's under test.


def main():
    json.loads(sys.stdin.read())
    children = []
    while True:
        pid = os.fork()
        if pid == 0:
            os._exit(0)
        children.append(pid)


if __name__ == "__main__":
    main()
