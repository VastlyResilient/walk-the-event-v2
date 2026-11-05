"""One device of the QA suite (qa_run.device_suite) against a URL, printing only the guide sanity checks (bisecting).

  .venv/bin/python qa/tools/qa_dev.py <base url incl. ?off=...> <mobile|desktop>
"""
import asyncio, sys
from playwright.async_api import async_playwright
sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2]]
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

Q.BASE = sys.argv[1]


async def main():
    async with async_playwright() as p:
        try:
            await Q.device_suite(p, sys.argv[2])
        except Exception as e:  # (other checks may break on the query string; the sweep is what we want)
            print("suite stopped:", type(e).__name__, str(e)[:120])
    for r in Q.RESULTS if hasattr(Q, "RESULTS") else []:
        pass


asyncio.run(main())
