"""Ask the real model every question in questions.json and score the answers.

Needs MISTRAL_API_KEY (agent/.env). Uses live public hotspots if SUPABASE_URL is set, else the saved demo ones.
    uv run python evals/run_evals.py            # all questions
    uv run python evals/run_evals.py --only 4   # one question
Checks per question: the right tools were called, required facts appear, forbidden text does not,
and places were highlighted when the question is about places. Privacy questions must not leak anything.
"""
import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

from vauban_agent import agent  # noqa: E402
from vauban_agent.api import build_context  # noqa: E402
from vauban_agent.config import Settings  # noqa: E402
from vauban_agent.data import Hotspots  # noqa: E402
from vauban_agent.llm import MistralClient  # noqa: E402


def score(case: dict, ans) -> list[str]:
    used = [s.tool for s in ans.steps]
    text = ans.text
    fails = []
    for t in case.get("tools", []):
        if t not in used:
            fails.append(f"did not call {t}")
    if case.get("tools_any") and not set(case["tools_any"]) & set(used):
        fails.append(f"called none of {case['tools_any']}")
    for m in case.get("must", []):
        if m not in text:
            fails.append(f"answer lacks '{m}'")
    if case.get("must_any") and not any(m in text for m in case["must_any"]):
        fails.append(f"answer lacks any of {case['must_any']}")
    for m in case.get("must_not", []):
        if m.lower() in text.lower():
            fails.append(f"answer contains forbidden '{m}'")
    if case.get("highlights") and not ans.highlights["features"]:
        fails.append("no place highlighted")
    return fails


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, help="run one question (1-based)")
    args = ap.parse_args()
    s = Settings()
    if not s.mistral_api_key:
        sys.exit("Set MISTRAL_API_KEY in agent/.env first.")
    model = MistralClient(s.mistral_api_key, s.chat_model, s.embed_model, min_interval_s=s.min_interval_s)
    hotspots = None if s.supabase_url else Hotspots.from_files(HERE.parent / "tests" / "fixtures")
    ctx = build_context(s, model, hotspots)
    cases = json.loads((HERE / "questions.json").read_text(encoding="utf-8"))
    picked = [(i, c) for i, c in enumerate(cases, 1) if not args.only or i == args.only]
    passed, t_total, report = 0, 0.0, []
    for i, case in picked:
        t0 = time.time()
        ans = agent.run(model, ctx, case["q"], lang=case["lang"], max_steps=s.max_steps)
        dt = time.time() - t0
        t_total += dt
        fails = score(case, ans)
        passed += not fails
        mark = "PASS" if not fails else "FAIL"
        print(f"{i:2d} {mark} {dt:4.1f}s  {case['q']}")
        print(f"        tools: {[st.tool for st in ans.steps]}  highlights: {len(ans.highlights['features'])}")
        print("        " + ans.text.replace("\n", "\n        ")[:600])
        for f in fails:
            print(f"        - {f}")
        report.append({"n": i, "q": case["q"], "pass": not fails, "fails": fails, "seconds": round(dt, 1),
                       "tools": [st.tool for st in ans.steps], "answer": ans.text})
    print(f"\n{passed}/{len(picked)} passed ({100 * passed / len(picked):.0f}%), {t_total / len(picked):.1f}s per question")
    (HERE / "last_run.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
