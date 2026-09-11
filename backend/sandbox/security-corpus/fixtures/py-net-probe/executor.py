import sys
import json
import socket

# Security-corpus fixture (Python track) — attempts a raw TCP connection to a public host.
# Under py-runtime.js's default (no capabilities.network granted -> --unshare-net), this fails
# fast with a network-unreachable-shaped error because the sandboxed process has no network
# namespace connectivity at all, not because of DNS/firewall specifics.


def main():
    json.loads(sys.stdin.read())  # payload not used, just drains stdin per the shared contract
    try:
        sock = socket.create_connection(("8.8.8.8", 53), timeout=3)
        sock.close()
        print(json.dumps({"connected": True}))
    except OSError as e:
        print(json.dumps({"connected": False, "errorCode": e.__class__.__name__}))


if __name__ == "__main__":
    main()
