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
    out = [html.unescape(x) for x in re.findall(r'(?:href|data-href|data-url|action)\s*=\s*["\']([^"\']+)["\']', text, flags=re.I)]
    out += [html.unescape(x.replace('\\/', '/')) for x in re.findall(r'(https?:\\?/\\?/[^"\'<>\s]+)', text, flags=re.I)]
    return out


def get(session, url, **kwargs):
    headers = {"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9", **kwargs.pop("headers", {})}
    r = session.get(url, headers=headers, timeout=45, allow_redirects=True, **kwargs)
    r.raise_for_status()
    return r


def candidate_score(url: str):
    u = url.lower()
    score = 0
    if "downloadr" in u and "apkmirror.com" in u:
        score += 100
    if "/wp-content/uploads/" in u:
        score += 80
    if re.search(r"\.(?:apkm|apk|xapk)(?:\?|$)", u):
        score += 70
    if "forcebaseapk" in u:
        score += 30
    if "key=" in u:
        score += 20
    if "download" in u:
        score += 10
    return score


def next_download_candidate(text: str, base: str):
    cands = []
    for raw in hrefs(text):
        try:
            u = urljoin(base, raw)
        except Exception:
            continue
        if not u.startswith("http"):
            continue
        score = candidate_score(u)
        if score:
            cands.append((score, u))
    if not cands:
        return None
    cands.sort(key=lambda x: x[0], reverse=True)
    return cands[0][1]


def resolve_apkmirror(session: requests.Session):
    r1 = get(session, VARIANT, headers={"Accept": "text/html,application/xhtml+xml,*/*"})
    gates = [urljoin(r1.url, h) for h in hrefs(r1.text) if "/download/?key=" in h]
    if not gates:
        time.sleep(16)
        r1 = get(session, VARIANT, headers={"Accept": "text/html,application/xhtml+xml,*/*"})
        gates = [urljoin(r1.url, h) for h in hrefs(r1.text) if "/download/?key=" in h]
    if not gates:
        raise RuntimeError("APKMirror download gate not found")

    current = gates[0]
    referer = r1.url
    time.sleep(16)
    for hop in range(6):
        r = session.get(
            current,
            headers={"User-Agent": UA, "Referer": referer, "Accept": "*/*", "Accept-Language": "de-DE,de;q=0.9"},
            timeout=60,
            allow_redirects=True,
            stream=True,
        )
        r.raise_for_status()
        ctype = (r.headers.get("content-type") or "").lower()
        disp = (r.headers.get("content-disposition") or "").lower()
        if "text/html" not in ctype and ("application/" in ctype or "attachment" in disp or re.search(r"\.(?:apkm|apk|xapk)(?:\?|$)", r.url, re.I)):
            r.close()
            return r.url, referer
        text = r.text
        r.close()
        (ROOT / f"apkmirror-hop-{hop}.html").write_text(text, encoding="utf-8", errors="ignore")
        nxt = next_download_candidate(text, r.url)
        if not nxt or nxt == current:
            snippets = [line.strip()[:500] for line in text.splitlines() if "download" in line.lower() or "wp-content/uploads" in line.lower()]
            debug = "\n".join(snippets[:200])
            (ROOT / "apkmirror-debug.txt").write_text(debug, encoding="utf-8")
            print("APKMirror debug snippets:", file=sys.stderr)
            print(debug[:12000], file=sys.stderr)
            raise RuntimeError(f"APKMirror binary link not found at hop {hop}")
        referer, current = r.url, nxt
        if "apkmirror.com" in current:
            time.sleep(2)
    raise RuntimeError("APKMirror download chain too deep")


def download_bundle(session: requests.Session, url: str, referer: str, dst: Path):
    with session.get(url, headers={"User-Agent": UA, "Referer": referer, "Accept": "*/*"}, timeout=120, allow_redirects=True, stream=True) as r:
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


def hash_file(path: Path):
    h = hashlib.sha256()
    total = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
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
    seen = set()
    for term in TERMS:
        t = term.lower()
        start = 0
        while len(hits) < 300:
            i = low.find(t, start)
            if i < 0:
                break
            ctx = ascii_context(data, i, term)
            if ctx and ctx not in seen:
                seen.add(ctx)
                hits.append((path.name, term.decode("ascii", errors="ignore"), ctx))
            start = i + len(t)
    return hits


def main():
    s = requests.Session()
    bundle_override = os.environ.get("KA_BUNDLE_PATH", "").strip()
    bundle = Path(bundle_override) if bundle_override else ROOT / "kleinanzeigen-2026.37.1.apkm"
    if bundle_override:
        if not bundle.exists():
            raise RuntimeError(f"bundle override not found: {bundle}")
        size, sha = hash_file(bundle)
    else:
        direct, referer = resolve_apkmirror(s)
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
