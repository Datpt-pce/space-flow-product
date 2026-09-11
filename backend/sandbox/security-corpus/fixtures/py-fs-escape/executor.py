import sys
import json

# Security-corpus fixture (Python track) — mirrors
# backend/sandbox/security-corpus/fixtures/fs-escape/execute.js for the JS track. Attempts to
# read a file outside every bind-mount py-runtime.js grants. Under real bwrap confinement this
# fails (no such file/permission denied), because nothing besides /usr, /usr/local, the repo
# root read-only, /proc, /dev, /tmp and the approved paths are bound into the mount namespace.


def main():
    payload = json.loads(sys.stdin.read())
    target_path = payload.get("config", {}).get("target_path", "")
    try:
        with open(target_path, "r") as f:
            content = f.read()
        print(json.dumps({"read": True, "content": content}))
    except OSError as e:
        print(json.dumps({"read": False, "errorCode": e.__class__.__name__, "errno": e.errno}))


if __name__ == "__main__":
    main()
