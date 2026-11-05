"""Fill live URL, station table and spend into the launch docs."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = "https://vastlyresilient.github.io/walk-the-event-v2/"
REPO = "https://github.com/VastlyResilient/walk-the-event-v2"
st = json.load(open(ROOT / "app/public/data/stations.json"))["stations"]
led = json.load(open(ROOT / "data/spend_ledger.json"))
spent = sum(e["usd"] for e in led)
vid = sum(e["usd"] for e in led if e["kind"] == "video")
rows = "\n".join(
    f"| {s['title']} ({s['id']}) | {s['video_timestamp']:.1f} s | {s['visibility_window_s'][0]:.1f}–{s['visibility_window_s'][1]:.1f} s | "
    f"{'AI camera move (' + s['transition']['model'].split('/')[1] + ')' if s.get('transition') else '2.5D depth dolly'} |" for s in st)
for name in ("docs/HANDOFF.md", "docs/X_DRAFTS.md", "skills/venue-guide/SKILL.md"):
    p = ROOT / name
    t = p.read_text()
    t = t.replace("{URL}", URL).replace("{REPO}", REPO).replace("{STATION_TABLE}", rows)
    t = t.replace("{SPEND_LINE}", f"Total **${spent:.2f}** of the $40 cap (video ${vid:.2f} of $25). The key had ~$46 of credit at the start.")
    t = t.replace("`{BASE}`", f"`{URL}`").replace("{BASE}", URL)
    p.write_text(t)
r = ROOT / "README.md"
t = r.read_text()
if "**Live:**" not in t:
    t = t.replace("# Walk the Event: NousCon NYC 2026\n", f"# Walk the Event: NousCon NYC 2026\n\n**Live:** {URL}\n")
r.write_text(t)
print("filled", URL, f"${spent:.2f}")
