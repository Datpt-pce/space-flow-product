import sys, json
from PIL import Image

def main():
    payload = json.loads(sys.stdin.read())
    with Image.open(payload["path"]) as img:
        w, h = img.size
    print(json.dumps({"width": w, "height": h}))

if __name__ == "__main__":
    main()
