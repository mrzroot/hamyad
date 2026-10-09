#!/usr/bin/env python3
"""Drive `curl … | sh` through a real pseudo-terminal and answer the installer's questions.

usage: installer_tty.py <install.sh> <project-dir> [answers as regex=answer …]
Environment is inherited (set HOME, PATH, HAMYAD_TARBALL … before calling).
Exits non-zero if the installer fails or a prompt is never answered.
"""
import os, re, select, sys, time

script, proj, *pairs = sys.argv[1:]
answers = [(re.compile(p.split("=", 1)[0]), p.split("=", 1)[1]) for p in pairs]
pid, fd = os.forkpty()
if pid == 0:
    os.chdir(proj)
    # stdin is a pipe (like curl | sh); questions must come from /dev/tty
    os.execvp("sh", ["sh", "-c", f"cat {script!r} | sh"])

buf, seen, used = b"", "", set()
deadline = time.time() + float(os.environ.get("TTY_TIMEOUT", "300"))
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.5)
    if r:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        sys.stdout.write(chunk.decode("utf8", "replace")); sys.stdout.flush()
        seen += chunk.decode("utf8", "replace")
        for i, (rx, ans) in enumerate(answers):
            if i not in used and rx.search(seen):
                used.add(i)
                seen = ""
                os.write(fd, (ans + "\r").encode())
                break
    else:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            break
_, status = os.waitpid(pid, 0)
code = os.waitstatus_to_exitcode(status)
missing = [answers[i][0].pattern for i in range(len(answers)) if i not in used]
print(f"\n[installer_tty] exit={code} unanswered={missing}")
sys.exit(code or (3 if missing else 0))
