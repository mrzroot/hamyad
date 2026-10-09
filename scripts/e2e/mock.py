"""Scripted mock LLM server for Anthropic Messages, OpenAI Responses/Chat, and Gemini APIs.

Main-agent requests (ones that offer file-edit tools) consume steps from SCRIPT (a JSON file);
everything else gets a short text answer. Every request is logged to LOG.
"""
import json, os, sys, time, uuid, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MOCK_PORT", "18800"))
DIR = os.environ.get("MOCK_DIR", "/tmp/mock")
os.makedirs(DIR, exist_ok=True)
LOG = os.path.join(DIR, "log.jsonl")
lock = threading.Lock()

def next_step(kind):
    with lock:
        path = os.path.join(DIR, "script.json")
        try:
            steps = json.load(open(path))
        except Exception:
            steps = []
        if not steps:
            return {"text": "done"}
        st = steps.pop(0)
        json.dump(steps, open(path, "w"))
        return st

def log(entry):
    with lock:
        with open(LOG, "a") as fh:
            fh.write(json.dumps(entry) + "\n")

EDIT_NAMES = {"Edit", "Write", "apply_patch", "write_file", "replace", "shell", "exec_command", "Bash", "run_shell_command", "create", "edit", "bash", "str_replace_editor"}

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass

    def _body(self):
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw or b"{}")
        except Exception:
            return {"_raw": raw.decode("utf-8", "replace")}

    def _send(self, code, obj, ctype="application/json"):
        data = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _sse_start(self):
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("connection", "close")
        self.end_headers()
        self.close_connection = True

    def _sse(self, event, data):
        s = (f"event: {event}\n" if event else "") + "data: " + json.dumps(data) + "\n\n"
        self.wfile.write(s.encode()); self.wfile.flush()

    def do_GET(self):
        log({"t": time.time(), "method": "GET", "path": self.path})
        if "/models" in self.path:
            return self._send(200, {"object": "list", "data": [{"id": "mock", "object": "model"}], "models": []})
        self._send(200, {})

    def do_HEAD(self):
        self.send_response(200); self.send_header("content-length", "0"); self.end_headers()

    def do_POST(self):
        b = self._body()
        tools = b.get("tools") or []
        names = set()
        for t in tools:
            if isinstance(t, dict):
                names.add(t.get("name") or (t.get("function") or {}).get("name") or "")
                for fd in t.get("functionDeclarations") or t.get("function_declarations") or []:
                    names.add(fd.get("name", ""))
        main = bool(names & EDIT_NAMES)
        if "/chat/completions" in self.path and (os.environ.get("MOCK_MAIN_ALWAYS") == "1" or b.get("model") == "mock"):
            main = True  # aider sends no tool schema; it asks for model "mock"
        step = next_step(self.path) if main else {"text": "ok"}
        log({"t": time.time(), "path": self.path, "main": main, "tools": sorted(n for n in names if n)[:80], "step": step, "body": b})
        p = self.path
        if p.startswith("/v1/messages") and "count_tokens" in p:
            return self._send(200, {"input_tokens": 10})
        if p.startswith("/v1/messages"):
            return self.anthropic(b, step)
        if p.endswith("/responses"):
            return self.oai_responses(b, step)
        if p.endswith("/chat/completions"):
            return self.chat(b, step)
        if ":generateContent" in p or ":streamGenerateContent" in p:
            return self.gemini(b, step, stream="stream" in p)
        if ":countTokens" in p:
            return self._send(200, {"totalTokens": 10})
        self._send(404, {"error": "unknown " + p})

    # ---------------- Anthropic
    def anthropic(self, b, step):
        mid = "msg_" + uuid.uuid4().hex[:20]
        if "tool" in step:
            block = {"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:20], "name": step["tool"], "input": step["input"]}
            stop = "tool_use"
        else:
            block = {"type": "text", "text": step["text"]}
            stop = "end_turn"
        usage = {"input_tokens": 10, "output_tokens": 5}
        msg = {"id": mid, "type": "message", "role": "assistant", "model": b.get("model", "mock"), "content": [block],
               "stop_reason": stop, "stop_sequence": None, "usage": usage}
        if not b.get("stream"):
            return self._send(200, msg)
        self._sse_start()
        self._sse("message_start", {"type": "message_start", "message": dict(msg, content=[], stop_reason=None)})
        if block["type"] == "text":
            self._sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
            self._sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": block["text"]}})
        else:
            self._sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": dict(block, input={})})
            self._sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": json.dumps(block["input"])}})
        self._sse("content_block_stop", {"type": "content_block_stop", "index": 0})
        self._sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 5}})
        self._sse("message_stop", {"type": "message_stop"})

    # ---------------- OpenAI Responses (Codex)
    def oai_responses(self, b, step):
        rid = "resp_" + uuid.uuid4().hex[:16]
        if "tool" in step:
            if step.get("custom"):
                item = {"type": "custom_tool_call", "id": "ctc_" + uuid.uuid4().hex[:12], "status": "completed",
                        "call_id": "call_" + uuid.uuid4().hex[:12], "name": step["tool"], "input": step["input"]}
            else:
                item = {"type": "function_call", "id": "fc_" + uuid.uuid4().hex[:12], "status": "completed",
                        "call_id": "call_" + uuid.uuid4().hex[:12], "name": step["tool"], "arguments": json.dumps(step["input"])}
        else:
            item = {"type": "message", "id": "msg_" + uuid.uuid4().hex[:12], "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": step["text"], "annotations": []}]}
        resp = {"id": rid, "object": "response", "status": "completed", "model": b.get("model", "mock"), "output": [item],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15,
                          "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}}}
        if not b.get("stream"):
            return self._send(200, resp)
        self._sse_start()
        self._sse("response.created", {"type": "response.created", "response": dict(resp, status="in_progress", output=[])})
        self._sse("response.output_item.added", {"type": "response.output_item.added", "output_index": 0, "item": item})
        self._sse("response.output_item.done", {"type": "response.output_item.done", "output_index": 0, "item": item})
        self._sse("response.completed", {"type": "response.completed", "response": resp})

    # ---------------- OpenAI Chat Completions (aider, Copilot CLI BYOK)
    def chat(self, b, step):
        text = step.get("text", "")
        cid = "chatcmpl-" + uuid.uuid4().hex[:12]
        call = None
        if "tool" in step:
            call = {"index": 0, "id": "call_" + uuid.uuid4().hex[:12], "type": "function",
                    "function": {"name": step["tool"], "arguments": json.dumps(step["input"])}}
        finish = "tool_calls" if call else "stop"
        usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        if not b.get("stream"):
            msg = {"role": "assistant", "content": None if call else text}
            if call:
                msg["tool_calls"] = [{k: v for k, v in call.items() if k != "index"}]
            return self._send(200, {"id": cid, "object": "chat.completion", "created": int(time.time()), "model": "mock",
                                    "choices": [{"index": 0, "message": msg, "finish_reason": finish}], "usage": usage})
        self._sse_start()
        delta = {"role": "assistant", "tool_calls": [call]} if call else {"role": "assistant", "content": text}
        self._sse(None, {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": "mock",
                         "choices": [{"index": 0, "delta": delta, "finish_reason": None}]})
        self._sse(None, {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": "mock",
                         "choices": [{"index": 0, "delta": {}, "finish_reason": finish}], "usage": usage})
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

    # ---------------- Gemini
    def gemini(self, b, step, stream):
        if "tool" in step:
            part = {"functionCall": {"name": step["tool"], "args": step["input"]}}
        else:
            part = {"text": step["text"]}
        resp = {"candidates": [{"content": {"role": "model", "parts": [part]}, "finishReason": "STOP", "index": 0}],
                "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15}, "modelVersion": "mock"}
        if not stream:
            return self._send(200, resp)
        self._sse_start()
        self._sse(None, resp)

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
