import sys
import json

# Security-corpus fixture (Python track) — a CPU-bound infinite loop with no I/O, so it can only
# be stopped by py-runtime.js's wall-clock SIGKILL timeout or py_adapter.py's RLIMIT_CPU
# backstop (whichever fires first), not by anything the script itself does.


def main():
    json.loads(sys.stdin.read())
    x = 0
    while True:
        x += 1


if __name__ == "__main__":
    main()
