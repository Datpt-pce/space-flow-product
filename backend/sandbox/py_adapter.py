#!/usr/bin/env python3
# Sandbox Host Python adapter — Custom Node Platform Phase 3
# (specs/space-flow-master-plan/01-custom-node-platform.md), Python track.
#
# Invoked as: python3 py_adapter.py <target_executor_path>
# Applies resource.setrlimit() limits read from the SFPKG_LIMITS env var (JSON), THEN
# os.execv()'s into the target executor.py unmodified — rlimits set on a process are
# inherited across exec(), so the real node code runs under the same limits without this
# adapter needing to parse/relay its stdin/stdout contract at all. Every existing Python
# node (advanced-renamer, capcut-generate, image-batch-resize, resize-upload,
# resize-upload-v2) already reads its own payload straight from stdin and prints its own
# JSON result to stdout (see backend/engine/runner.js's spawnPython) — os.execv() preserves
# the inherited stdin/stdout/stderr file descriptors untouched, so that contract needs zero
# changes to run sandboxed.
#
# WHY rlimit, NOT seccomp: the plan (01-custom-node-platform.md Phase 3 task checklist)
# offers "bwrap --seccomp" as one option for blocking fork bombs, but bwrap's --seccomp flag
# takes a pre-compiled BPF program fd — authoring one by hand (or taking on a libseccomp
# binding dependency) is a materially bigger, separately-scoped task than this Phase needs.
# RLIMIT_NPROC (codejail/edX's proven approach for exactly this problem) is a kernel-enforced
# hard cap on live processes/threads for the calling process's effective UID, and because
# host-bwrap.js's --unshare-user gives this process a fresh user namespace, the kernel scopes
# RLIMIT_NPROC's counter to THAT namespace (per-user-namespace ucounts, Linux >= 4.9) — it
# cannot collide with the backend server's own ambient process/thread count, and a fork bomb
# started here cannot outrun this limit before hitting EAGAIN on every further fork/clone.
# Real syscall-level filtering (blocking network/exec syscalls outright even with process
# capability granted) remains future work — see docs/decisions/0025 follow-up notes.

import sys
import os
import json


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "py_adapter.py: missing target script path argument"}))
        sys.exit(1)
    target = sys.argv[1]

    try:
        limits = json.loads(os.environ.get("SFPKG_LIMITS") or "{}")
    except json.JSONDecodeError:
        limits = {}

    import resource

    # RLIMIT_NPROC: process/thread count cap for this (namespaced) UID — fork-bomb defense.
    if "maxProcesses" in limits:
        n = int(limits["maxProcesses"])
        resource.setrlimit(resource.RLIMIT_NPROC, (n, n))

    # RLIMIT_AS: total virtual address space. Generous floor needed — importing Pillow/
    # rembg's ONNXRuntime alone can reserve a large address-space footprint via mmap before
    # any node logic runs, well above what it actually resident-uses.
    if "memoryMB" in limits:
        b = int(limits["memoryMB"]) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (b, b))

    # RLIMIT_CPU: total CPU-seconds, a kernel-level backstop independent of the wall-clock
    # SIGKILL timeout py-runtime.js already applies from the parent side — catches a process
    # that's CPU-bound but still emitting output/staying alive, which a purely wall-clock
    # timeout can race against.
    if "cpuSeconds" in limits:
        s = int(limits["cpuSeconds"])
        resource.setrlimit(resource.RLIMIT_CPU, (s, s))

    if "maxOpenFiles" in limits:
        n = int(limits["maxOpenFiles"])
        resource.setrlimit(resource.RLIMIT_NOFILE, (n, n))

    os.execv(sys.executable, [sys.executable, target])


if __name__ == "__main__":
    main()
