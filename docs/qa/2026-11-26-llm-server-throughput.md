# Local LLM server throughput — measurements and required fixes (2026-11-26)

MiChat does not start, stop, select or tune a model. The numbers below are from the
external `llama-server` on `127.0.0.1:8080`; MiChat only sends OpenAI-compatible
requests. The current server configuration does **not** meet the requested minimum
of 10 generated tokens/second.

## Measured on this machine

| Model | Backend / layers / threads | Prompt eval | Generation | Notes |
| --- | --- | ---: | ---: | --- |
| Qwen3.5-4B Q4_K_M | Vulkan, `-ngl 18`, `-t 4`, 16k | ~30 t/s | **6.02 t/s** | 320-token answer took 55.6s wall |
| Gemma 4 E2B Q4_K_M | Vulkan, `-ngl 18`, `-t 4`, 16k | ~300–500 t/s | **7.0–7.7 t/s** | 2B model; prompt eval is fast, generation is still below 10 |

Source: `llama-server` `print_timing` lines in
`D:\Agentic-AI\Doing\New folder\llama-service\logs\chat.err.log`.

## Reliability finding: Gemma 4 E2B is not safe as the default

Gemma 4 E2B answered most list questions quickly and completely, but in a fresh
session it fell into a special-token loop on the “hệ thống thông tin quan trọng về
an ninh quốc gia” question: it emitted **18,432 characters of `<unused8>`** over
190 seconds. A definition question also looped before the prompt was reduced to the
self-contained definition block. Qwen3.5-4B answered the same questions without
this failure. Gemma is therefore not recommended as the stable production default
until the server/model template bug is fixed.

## Why it is below 10 t/s

- Only 18 layers are offloaded to Vulkan (`-ngl 18`). The rest runs on 4 CPU threads.
  For a 4B Q4 model this is the limiting factor.
- The GPU may not have enough free VRAM for all layers, or the Vulkan backend may be
  slower than the CUDA build on this machine.
- `-t 4` is low for CPU fallback. Use the number of physical performance cores.
- KV cache for 16k context competes with model layers for VRAM.

## Recommended fixes in the external LLM server project (do not patch in MiChat)

1. **Offload all layers** — set `-ngl 99` (or the highest value that fits). Check
   `llama-server` startup/logs and GPU memory. A 4B Q4_K_M model needs roughly
   2.5 GB for weights plus KV cache.
2. **Use the CUDA build** if the GPU is NVIDIA. Vulkan is convenient but often has
   lower token generation throughput than CUDA on the same card.
3. **Set threads to physical cores** (for example `-t 8` or `-t 12`) for any layers
   that still run on CPU. Do not use logical-thread count blindly.
4. **Enable flash attention** if the build supports it (`-fa` / `--flash-attn`) and
   tune batch sizes (`-b 2048 -ub 512`).
5. **Quantize the KV cache** (`--cache-type-k q8_0 --cache-type-v q8_0`) to free VRAM
   for more GPU layers.
6. **If the GPU cannot hold the model**, use a smaller chat model/quant for the
   ≥10 t/s target (for example a 2B instruct model or a Q3/Q4_K_S 4B variant).
7. **Measure with `llama-bench`** before and after each change; target ≥10 t/s
   generation, not just fast prompt processing.

## MiChat-side status

- Retrieval and prompt assembly are local and fast (typically well under 1s for
  1,160 chunks), so they are not the throughput bottleneck.
- MiChat now disables chat-template thinking (`enable_thinking: false`) and sends a
  compact RAG prompt, which removes wasted reasoning tokens and keeps answers direct.
- MiChat cannot raise the server's tokens/second; that must be fixed in the server
  configuration/model selection.
