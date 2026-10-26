"""Fetch the website's self-hosted fonts from Google Fonts (all SIL OFL).

The two Chinese faces are subset to exactly the characters the site sets in them,
read from site/strings.js and site/privacy-strings.js, so rerun this after changing any display line or proof note:

    python3 -I scripts/fetch-site-fonts.py

Display face (Noto Sans SC Black): every key in DISPLAY_KEYS, plus any key ending in ".title".
Hand face (Long Cang): every key in HAND_KEYS, the instructions of HAND_WORK entries, plus ASCII.
"""
import json
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fonts")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
DISPLAY_KEYS = {
    "context.honestyTitle", "footer.line", "local.folder.title", "local.trash.title",
    "download.ext.title", "download.first.title",
}
HAND_KEYS = {"hero.note", "versions.note"}
# Work entries whose recorded instruction is set in the hand (the key round in the versions demo).
HAND_WORK = {"signal-3"}
SKIP_KEYS = {"meta.title"}


STRING_FILES = ("strings.js", "privacy-strings.js")


def strings():
    text = "".join(open(os.path.join(ROOT, "site", f), encoding="utf-8").read() for f in STRING_FILES)
    pairs = re.findall(r'"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"', text)
    return [(k, json.loads(f'"{v}"')) for k, v in pairs]


def collect():
    display, hand = set("0123456789，。、：？！（）"), set()
    for key, value in strings():
        plain = re.sub(r"<[^>]+>", "", value)
        if key in SKIP_KEYS:
            continue
        if key.endswith(".title") or key in DISPLAY_KEYS:
            display.update(ch for ch in plain if ord(ch) > 0x2E7F)
        if key in HAND_KEYS:
            hand.update(plain)
    work_js = open(os.path.join(ROOT, "assets", "work", "work.js"), encoding="utf-8").read()
    work = json.loads(work_js.split("window.GP_WORK = ", 1)[1].rstrip().rstrip(";"))
    for slug in HAND_WORK:
        hand.update(work[slug]["instruction"])
    hand.update(chr(c) for c in range(0x20, 0x7F))
    hand.update("“”‘’—–·…")
    return "".join(sorted(display)), "".join(sorted(hand))


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=30).read()


def faces(css):
    for block in re.finditer(r"(/\* ([\w-]+) \*/\s*)?@font-face\s*{([^}]*)}", css):
        m = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", block.group(3))
        if m:
            yield block.group(2) or "subset", m.group(1)


def main():
    display, hand = collect()
    jobs = [
        ("archivo", "family=Archivo:wdth,wght@62..125,100..900", {"latin", "latin-ext"}),
        ("fragment-mono", "family=Fragment+Mono", {"latin", "latin-ext"}),
        ("noto-sans-sc-900", "family=Noto+Sans+SC:wght@900&text=" + urllib.parse.quote(display), None),
        ("long-cang", "family=Long+Cang&text=" + urllib.parse.quote(hand), None),
    ]
    os.makedirs(OUT, exist_ok=True)
    for name, query, wanted in jobs:
        css = fetch("https://fonts.googleapis.com/css2?" + query + "&display=swap").decode()
        for subset, url in faces(css):
            if wanted and subset not in wanted:
                continue
            fname = f"{name}-{subset}.woff2" if wanted else f"{name}.woff2"
            data = fetch(url)
            with open(os.path.join(OUT, fname), "wb") as f:
                f.write(data)
            print(f"{fname}: {len(data)} bytes")
    print(f"display glyphs: {len(display)}, hand glyphs: {len(hand)}")


if __name__ == "__main__":
    main()
