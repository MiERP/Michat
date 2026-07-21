import sys, json, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
d = r"D:\PROJECT\Agentic-AI\MiChat\MiChat-1.1-know\Michat-michat-0.1.3-legal\tests\rag-behavior-eval\results"
for fname in ["E2B_result.json", "Qwen3.5-4B_result.json"]:
    p = os.path.join(d, fname)
    if not os.path.exists(p): continue
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    s = data.get("scores", {})
    print("")
    print(fname)
    print(f"  Citation:   {s['citation']['pct']}%  ({s['citation']['pass']}/{s['citation']['total']})")
    print(f"  Abstention: {s['abstention']['pct']}% ({s['abstention']['pass']}/{s['abstention']['total']})")
    print(f"  Format:     {s['format']['pct']}% ({s['format']['pass']}/{s['format']['total']})")
    print(f"  Overall:    {s['overall']['pct']}%")
    print("  Details:")
    for item in data.get("details", []):
        c = item.get("citation","?")
        a = item.get("abstention","?")
        f = item.get("format","?")
        r = (item.get("response") or "(empty)")[:100]
        print(f"    [{item['id']}] {item['scenario']:20s} C:{c} A:{a} F:{f} | {r}")
