import json, time, subprocess, sys, os
import requests

MODEL_DIR = r"D:\PROJECT\Agentic-AI\MiChat\MiChat-1.1-know\Michat-michat-0.1.3-legal\resources\models"
LLAMA_SERVER = r"D:\PROJECT\Agentic-AI\MiChat\MiChat-1.1-know\Michat-michat-0.1.3-legal\resources\llama-bin\llama-server.exe"
TEST_FILE = r"D:\PROJECT\Agentic-AI\MiChat\MiChat-1.1-know\Michat-michat-0.1.3-legal\tests\rag-behavior-eval\test_cases.json"
OUT_DIR = r"D:\PROJECT\Agentic-AI\MiChat\MiChat-1.1-know\Michat-michat-0.1.3-legal\tests\rag-behavior-eval\results"
PORT = 8080
BASE_URL = f"http://127.0.0.1:{PORT}"

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SYSTEM_PROMPT = "Bạn là trợ lý pháp lý AI. CHỈ trả lời dựa trên <sources>. KHÔNG dùng kiến thức bên ngoài. Nếu không đủ thông tin: trả JSON với status=\"insufficient_evidence\". Nếu đủ: trả JSON status=\"answered\", answer (tiếng Việt), citations (mảng source_id). Chỉ cite source_id có trong <sources>."

MODELS = [
    ("E2B", "gemma-4-E2B-it-Q4_K_M.gguf", 4096),
    ("Qwen3.5-4B", "Qwen3.5-4B-Q4_K_M.gguf", 4096),
    ("26B-A4B", "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf", 2048),
]

os.makedirs(OUT_DIR, exist_ok=True)

with open(TEST_FILE, "r", encoding="utf-8") as f:
    test_cases = json.load(f)

def build_user_msg(tc):
    src_parts = []
    for s in tc.get("sources", []):
        src_parts.append(f"[source_id: {s['source_id']} | hieu_luc: {s['status']} | dieu: {s['dieu']}]\n{s['text']}")
    src_block = "\n\n".join(src_parts) if src_parts else "(Khong co nguon)"
    graph_status = tc.get("graph_status", "ready")
    return f"<question>\n{tc['question']}\n</question>\n<graph_status>{graph_status}</graph_status>\n<sources>\n{src_block}\n</sources>"

def check_citation(resp, tc):
    r = resp.lower()
    expected = tc.get("expect_sources", [])
    forbidden = tc.get("forbid_sources", [])
    if tc["expect_status"] == "insufficient_evidence" and len(expected) == 0:
        kw = ["insufficient_evidence","khong du","can them","khong tim thay","khong the tra loi","khong co thong tin","khong lien quan","khong duoc cung cap","khong co nguon"]
        if not any(k in r for k in kw): return "FAIL"
        for fid in forbidden:
            if fid.lower() in r: return "FAIL"
        return "PASS"
    if expected:
        if not any(eid.lower() in r for eid in expected): return "FAIL"
    for fid in forbidden:
        if fid.lower() in r: return "FAIL"
    return "PASS"

def check_abstention(resp, tc):
    r = resp.lower()
    if tc["expect_status"] == "insufficient_evidence":
        kw = ["insufficient_evidence","khong du","can them","khong tim thay","khong the tra loi","khong co thong tin","khong lien quan","khong duoc cung cap","khong co nguon"]
        return "PASS" if any(k in r for k in kw) else "FAIL"
    return "PASS"

def check_format(resp, tc):
    return "PASS" if '"status"' in resp.lower() else "FAIL"

def call_chat(messages, timeout=120):
    body = {"messages": messages, "temperature": 0.0, "max_tokens": 1024}
    try:
        r = requests.post(f"{BASE_URL}/v1/chat/completions", json=body, timeout=timeout)
        r.encoding = "utf-8"
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"]
        return f"[HTTP_{r.status_code}] {r.text[:100]}"
    except Exception as e:
        return f"[ERR] {e}"

def wait_server(timeout=90):
    for i in range(timeout // 2):
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=2)
            return True
        except:
            time.sleep(2)
    return False

def warmup(timeout=120):
    """Keep retrying until model actually loads (not 503)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.post(f"{BASE_URL}/v1/chat/completions", json={
                "messages": [{"role":"user","content":"ok"}],
                "temperature": 0, "max_tokens": 8,
            }, timeout=30)
            if r.status_code == 200:
                print("  Model loaded, ready")
                return True
            if r.status_code == 503:
                print(f"  Model loading... (waiting)")
                time.sleep(5)
                continue
        except:
            time.sleep(3)
    return False

def stop_server():
    try: subprocess.run(["taskkill","/F","/IM","llama-server.exe"], capture_output=True)
    except: pass
    time.sleep(3)

# === MAIN ===
all_results = []

for model_name, model_file, ctx_size in MODELS:
    model_path = os.path.join(MODEL_DIR, model_file)
    if not os.path.exists(model_path):
        print(f"SKIP {model_name}: not found")
        continue

    print(f"\n{'='*50}")
    print(f"  MODEL: {model_name}")
    print(f"{'='*50}")

    stop_server()
    proc = subprocess.Popen(
        [LLAMA_SERVER, "-m", model_path, "--host", "127.0.0.1",
         "--port", str(PORT), "-ngl", "0", "-c", str(ctx_size), "--jinja"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW)
    
    if not wait_server():
        print("ERROR: Server health timeout")
        stop_server(); continue
    
    print("Health OK, waiting for model load...")
    if not warmup():
        print("ERROR: Model load timeout")
        stop_server(); continue

    details = []
    pass_c = pass_a = pass_f = 0
    total = len(test_cases)

    for tc in test_cases:
        user_msg = build_user_msg(tc)
        resp = call_chat([
            {"role":"system","content":SYSTEM_PROMPT},
            {"role":"user","content":user_msg}
        ])

        c = check_citation(resp, tc)
        a = check_abstention(resp, tc)
        f = check_format(resp, tc)
        if c == "PASS": pass_c += 1
        if a == "PASS": pass_a += 1
        if f == "PASS": pass_f += 1

        ok = (c=="PASS" and a=="PASS" and f=="PASS")
        icon = "[OK]" if ok else "[XX]"
        print(f"  [{tc['id']}] {tc['scenario']:20s} {icon} C:{c} A:{a} F:{f}")
        if not ok and "[HTTP" not in resp:
            print(f"    R: {resp[:120]}")

        details.append({
            "id":tc["id"],"scenario":tc["scenario"],
            "question":tc["question"],"expect_status":tc["expect_status"],
            "response":resp,"citation":c,"abstention":a,"format":f,
        })
        time.sleep(0.5)

    cp = round(pass_c/total*100,1)
    ap = round(pass_a/total*100,1)
    fp = round(pass_f/total*100,1)
    op = round((pass_c+pass_a+pass_f)/(total*3)*100,1)

    print(f"\n  CIT={cp}% ABS={ap}% FMT={fp}% OVR={op}%")

    all_results.append({
        "model":model_name,"file":model_file,
        "citation_pct":cp,"citation_pass":pass_c,
        "abstention_pct":ap,"abstention_pass":pass_a,
        "format_pct":fp,"format_pass":pass_f,
        "overall_pct":op,"total":total,"details":details,
    })

    with open(os.path.join(OUT_DIR, f"{model_name}_result.json"),"w",encoding="utf-8") as f:
        json.dump({"model":model_name,"scores":{"citation":{"pct":cp,"pass":pass_c,"total":total},"abstention":{"pct":ap,"pass":pass_a,"total":total},"format":{"pct":fp,"pass":pass_f,"total":total},"overall":{"pct":op}},"details":details}, f, ensure_ascii=False, indent=2)
    
    stop_server()

# Summary
print(f"\n{'='*50}")
print("  FINAL COMPARISON")
print(f"{'='*50}")
print(f"{'Model':<15} {'Citation':>14} {'Abstention':>14} {'Format':>14} {'Overall':>14}")
print(f"{'-'*15} {'-'*14} {'-'*14} {'-'*14} {'-'*14}")
for r in all_results:
    print(f"{r['model']:<15} {r['citation_pct']:>5}% ({r['citation_pass']:>2}/{r['total']:>2})   {r['abstention_pct']:>5}% ({r['abstention_pass']:>2}/{r['total']:>2})   {r['format_pct']:>5}% ({r['format_pass']:>2}/{r['total']:>2})   {r['overall_pct']:>5}%")

with open(os.path.join(OUT_DIR, "summary_comparison.json"), "w", encoding="utf-8") as f:
    json.dump(all_results, f, ensure_ascii=False, indent=2)
print(f"\nResults: {OUT_DIR}")
