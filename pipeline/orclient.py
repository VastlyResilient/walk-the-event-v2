"""Tiny OpenRouter client with hard budget caps and spend logging to docs/SPEND.md."""
import base64
import json
import os
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEND = ROOT / "docs" / "SPEND.md"
LEDGER = ROOT / "data" / "spend_ledger.json"
KEY = os.environ["OPENROUTER_API_KEY"]
# The key had ~$46 of credit left when the build started, so caps sit below the brief's numbers.
TOTAL_BUDGET = float(os.environ.get("TOTAL_BUDGET_USD", 40))
VIDEO_BUDGET = float(os.environ.get("VIDEO_BUDGET_USD", 25))


def _ledger():
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else []


def spent(kind=None):
    return sum(e["usd"] for e in _ledger() if kind is None or e["kind"] == kind)


def log_spend(kind, model, usd, note):
    led = _ledger()
    led.append({"t": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": kind, "model": model, "usd": round(usd, 4), "note": note})
    LEDGER.write_text(json.dumps(led, indent=1))
    lines = ["# Spend ledger", "", f"Caps: total ${TOTAL_BUDGET:.2f} · video ${VIDEO_BUDGET:.2f} "
             "(the OpenRouter key had ~$46 of credit at start, so caps were set below the brief's $120/$60).", "",
             f"**Spent so far: ${spent():.2f} total · ${spent('video'):.2f} video · ${spent('image'):.2f} image · ${spent('llm'):.2f} LLM**", "",
             "| time | kind | model | USD | note |", "|---|---|---|---|---|"]
    lines += [f"| {e['t']} | {e['kind']} | {e['model']} | {e['usd']:.4f} | {e['note']} |" for e in led]
    # keep hand-kept sections below the ledger (e.g. the Meshy credits table)
    old = SPEND.read_text() if SPEND.exists() else ""
    keep = old[old.index("## Meshy credits"):] if "## Meshy credits" in old else ""
    SPEND.write_text("\n".join(lines) + "\n" + ("\n" + keep if keep else ""))


def guard(kind, est):
    if spent() + est > TOTAL_BUDGET:
        raise RuntimeError(f"total budget would be exceeded ({spent():.2f}+{est:.2f}>{TOTAL_BUDGET})")
    if kind == "video" and spent("video") + est > VIDEO_BUDGET:
        raise RuntimeError(f"video budget would be exceeded ({spent('video'):.2f}+{est:.2f}>{VIDEO_BUDGET})")


def req(method, url, body=None, timeout=600):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/walk-the-event", "X-Title": "Walk the Event"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read())


def data_url(path, mime=None):
    p = pathlib.Path(path)
    mime = mime or {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[p.suffix[1:].lower()]
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


def chat(model, messages, kind="llm", est=0.05, note="", **kw):
    guard(kind, est)
    body = {"model": model, "messages": messages, "usage": {"include": True}, **kw}
    out = req("POST", "https://openrouter.ai/api/v1/chat/completions", body)
    cost = (out.get("usage") or {}).get("cost") or est
    log_spend(kind, model, cost, note)
    return out


def image(model, prompt, refs=(), out_path=None, note="", est=0.15, **kw):
    content = [{"type": "text", "text": prompt}] + [{"type": "image_url", "image_url": {"url": data_url(r)}} for r in refs]
    out = chat(model, [{"role": "user", "content": content}], kind="image", est=est, note=note,
               modalities=["image", "text"], **kw)
    msg = out["choices"][0]["message"]
    imgs = msg.get("images") or []
    if not imgs:
        raise RuntimeError(f"no image returned: {str(msg)[:300]}")
    url = imgs[0]["image_url"]["url"]
    raw = base64.b64decode(url.split(",", 1)[1])
    if out_path:
        pathlib.Path(out_path).write_bytes(raw)
    return raw
