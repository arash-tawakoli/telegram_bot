#!/usr/bin/env python3
import hashlib
import html
import os
import re
import sys
import time
import zipfile
from pathlib import Path
from urllib.parse import urljoin

import requests

VERSION = "2026.37.1"
VARIANT = "https://www.apkmirror.com/apk/kleinanzeigen-de-gmbh/ebay-kleinanzeigen-for-germany/kleinanzeigen-marketplace-2026-37-1-release/kleinanzeigen-marketplace-2026-37-1-3-android-apk-download/"
EXPECTED_SHA256 = "ebc40294eb9e9568ef3c0eb5e29b38bcbeb103c8af40573ad07495aa867dafd0"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
TERMS = [
    b"create-conversation", b"messagebox/api/users", b"warnPhoneNumber", b"contentWarnings",
    b"contactName", b"inquiry", b"first-contact", b"firstContact", b"contact-form",
    b"lead-generation", b"household", b"haushalt", b"monthlyNetIncome", b"income",
    b"einkommen", b"realestate", b"requiredFields", b"required", b"mandatory",
    b"X-EBAYK-APP", b"X-ECG-IN", b"conversation", b"send-message",
]

ROOT = Path(os.environ.get("KA_ANALYSIS_DIR", "tmp/ka-analysis"))
ROOT.mkdir(parents=True, exist_ok=True)


def hrefs(text: str):
    return [html.unescape(x) for x in re.findall(r'href\s*=\s*["\']([^"\']+)["\']', text, flags=re.I)]


def get(session, url, **kwargs):
    headers = {"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9", **kwargs.pop("headers", {})}
    r = session.get(url, headers=headers, timeout=45, allow_redirects=True, **kwargs)
    r.raise_for_status()
    return r


def resolve_apkmirror(session: requests.Session):
    r1 = get(session, VARIANT, headers={"Accept": "text/html,application/xhtml+xml,*/*"})
    gates = [urljoin(r1.url, h) for h in hrefs(r1.text) if "/download/?key=" in h]
    if not gates:
        # APKMirror occasionally delays the generated gate. Re-fetch once after the advertised wait.
        time.sleep(16)
        r1 = get(session, VARIANT, headers={"Accept": "text/html,application/xhtml+xml,*/*"})
        gates = [urljoin(r1.url, h) for h in hrefs(r1.text) if "/download/?key=" in h]
    if not gates:
        raise RuntimeError("APKMirror download gate not found")
    gate = gates[0]
    time.sleep(16)
    r2 = get(session, gate, headers={"Referer": r1.url, "Accept": "text/html,application/xhtml+xml,*/*"})
    cands = []
    for h in hrefs(r2.text):
        u = urljoin(r2.url, h)
        if re.search(r"downloadr\d*\.apkmirror\.com", u, re.I) or re.search(r"\.(?:apkm|apk)(?:\?|$)", u, re.I):
            cands.append(u)
    direct = next((u for u in cands if "downloadr" in u), cands[0] if cands else None)
    if not direct:
        raise RuntimeError("APKMirror binary link not found")
    return direct, r2.url


def download_bundle(session: requests.Session, url: str, referer: str, dst: Path):
    with session.get(url, headers={"User-Agent": UA, "Referer": referer, "Accept": "*/*"}, timeout=90, allow_redirects=True, stream=True) as r:
        r.raise_for_status()
        h = hashlib.sha256()
        total = 0
        with dst.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                f.write(chunk)
                h.update(chunk)
                total += len(chunk)
    return total, h.hexdigest()


def ascii_context(data: bytes, pos: int, term: bytes, radius=220):
    part = data[max(0, pos-radius): min(len(data), pos+len(term)+radius)]
    s = ''.join(chr(b) if 32 <= b < 127 else ' ' for b in part)
    return re.sub(r"\s+", " ", s).strip()


def scan_binary(path: Path):
    data = path.read_bytes()
    low = data.lower()
    hits = []
    for term in TERMS:
        t = term.lower()
        start = 0
        while len(hits) < 240:
            i = low.find(t, start)
            if i < 0:
                break
            ctx = ascii_context(data, i, term)
            if ctx and ctx not in {h[2] for h in hits}:
                hits.append((path.name, term.decode("ascii", errors="ignore"), ctx))
            start = i + len(t)
    return hits


def main():
    s = requests.Session()
    direct, referer = resolve_apkmirror(s)
    bundle = ROOT / "kleinanzeigen-2026.37.1.apkm"
    size, sha = download_bundle(s, direct, referer, bundle)
    print(f"bundle_size={size}")
    print(f"bundle_sha256={sha}")
    if sha != EXPECTED_SHA256:
        raise RuntimeError(f"unexpected bundle hash: {sha}")

    bundle_dir = ROOT / "bundle"
    bundle_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(bundle) as z:
        names = z.namelist()
        base_name = next((n for n in names if n.endswith("base.apk")), None)
        if not base_name:
            apk_names = [n for n in names if n.endswith(".apk")]
            if not apk_names:
                raise RuntimeError("base APK not found")
            base_name = max(apk_names, key=lambda n: z.getinfo(n).file_size)
        z.extract(base_name, bundle_dir)
    base = bundle_dir / base_name
    if not base.exists():
        raise RuntimeError("base APK extraction failed")
    canonical = ROOT / "base.apk"
    canonical.write_bytes(base.read_bytes())

    dex_dir = ROOT / "dex"
    dex_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(canonical) as z:
        dex_names = [n for n in z.namelist() if re.fullmatch(r"classes\d*\.dex", Path(n).name)]
        for n in dex_names:
            target = dex_dir / Path(n).name
            target.write_bytes(z.read(n))

    out = ROOT / "analysis.txt"
    all_hits = []
    for p in sorted(dex_dir.glob("classes*.dex")):
        all_hits.extend(scan_binary(p))
    with out.open("w", encoding="utf-8") as f:
        f.write(f"Kleinanzeigen {VERSION}\n")
        f.write(f"bundle_sha256={sha}\n")
        f.write(f"base_apk_bytes={canonical.stat().st_size}\n")
        f.write(f"dex_count={len(list(dex_dir.glob('classes*.dex')))}\n\n")
        for fn, term, ctx in all_hits:
            f.write(f"[{fn}] term={term}\n{ctx}\n\n")
    print(f"analysis_file={out}")
    print(f"hits={len(all_hits)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise
