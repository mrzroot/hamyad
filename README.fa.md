<div dir="rtl">

# هم‌یاد (hamyad)

**یک «مغز» مشترک برای همه‌ی هوش‌های مصنوعی‌ای که روی یک پروژه کار می‌کنند.**
ChatGPT · Claude (Code، Desktop، claude.ai) · Codex · Gemini (CLI و اپ) · Grok · Perplexity · Cursor · Copilot · Windsurf · Zed · Cline/Roo · JetBrains · aider · و هر ابزاری که MCP یا REST یا آپلود فایل را بفهمد.

[![CI](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml/badge.svg)](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[سایت و دموی زنده](https://mrzroot.github.io/hamyad/) · [English](README.md) · [پژوهش](RESEARCH.md) · [تغییرات](CHANGELOG.md)

## مشکل چیست؟

یک پروژه را هم‌زمان با چند ابزار جلو می‌برید: در ChatGPT یا Claude.ai درباره‌ی معماری بحث و تصمیم‌گیری می‌کنید، و Codex و Claude Code و Cursor و Gemini CLI کد می‌نویسند. هر کدام **حافظه‌ی جدای خودش** را دارد: تصمیمی که در چت گرفتید به ایجنت‌های کدنویس نمی‌رسد، و کاری که Codex دیروز کرد را Claude Code امروز نمی‌داند. بدتر از همه، وقتی تصمیمی عوض می‌شود، ایجنت‌ها هنوز با تصمیم قدیمی کار می‌کنند.

## هم‌یاد چه می‌کند؟

یک پوشه‌ی `.brain/` (Markdown ساده، داخل مخزن یا در یک پوشه‌ی همگام مثل Dropbox/Google Drive، یا حتی **فقط یک فایل MEMORY.md**) که همه‌ی ابزارها آن را می‌خوانند و می‌نویسند:

- **ایجنت‌های کدنویس** (Claude Code، Codex، Gemini CLI، Cursor، Copilot، Windsurf) با **هوک** و **MCP**: در شروع هر جلسه خلاصه‌ی پروژه و بخش «⚠ تصمیم‌ها از آخرین جلسه‌ی شما عوض شده‌اند» را می‌بینند؛ در پایان، خلاصه‌ی گفت‌وگو و **git diff** همان جلسه با نام ابزار ثبت می‌شود.
- **اپ‌های چت** (ChatGPT، Claude.ai، Grok، Perplexity، اپ Gemini) با **کانکتور MCP راه‌دور**، یا برای ChatGPT با **GPT Action** (OpenAPI)، یا با آپلود `MEMORY.md`.
- **aider، Zed، Cline/Roo، JetBrains** با MCP و `AGENTS.md`؛ گفت‌وگوهای aider با هر کامیت وارد مغز می‌شوند.
- `hamyad timeline`: همه‌ی گفت‌وگوها، تغییرات کد، تصمیم‌ها و جایگزینی‌ها از همه‌ی ابزارها روی یک خط زمانی.

## اتصال هر هوش مصنوعی

| ابزار | روش اتصال | راه‌اندازی |
|---|---|---|
| Claude Code · Codex · Cursor · Copilot · Gemini CLI · Windsurf · aider | هوک + MCP + `CLAUDE.md`/`AGENTS.md` | خودکار با `hamyad init --all` |
| Zed · Roo · Junie (JetBrains) | MCP پروژه | خودکار با `hamyad init --all` |
| Cline · JetBrains AI Assistant · Claude Desktop | MCP محلی | یک دقیقه (`hamyad connect cline` …) |
| **ChatGPT** | کانکتور MCP (Developer mode) **یا** Custom GPT Action از `/openapi.json` **یا** فایل MEMORY.md | دو دقیقه (`hamyad connect chatgpt`) |
| **Claude.ai** · **Grok** · **Perplexity** · **اپ Gemini** | کانکتور MCP راه‌دور (یا MEMORY.md) | دو دقیقه (`hamyad connect grok` …) |
| هر ابزار دیگر | MCP محلی/راه‌دور، REST + OpenAPI، یا MEMORY.md | `hamyad connect any` |

اپ‌های چت از سرورهای خودشان وصل می‌شوند، پس آدرس عمومی لازم است: یا Worker رایگان Cloudflare روی مخزن گیت‌هاب، یا بدون گیت‌هاب `hamyad serve --host 0.0.0.0 --token …` به‌همراه `cloudflared tunnel`. (چون درخواست از سمت OpenAI/Anthropic/xAI می‌آید، فیلترشدن احتمالی `workers.dev` در ایران مانع کار کانکتور نیست؛ فقط برای دیپلوی ممکن است اینترنت آزاد لازم باشد.)

## شروع سریع

```bash
npm i -g https://github.com/mrzroot/hamyad/releases/download/v0.2.0/hamyad-0.2.0.tgz
cd my-project
hamyad init --all          # مغز + تنظیمات MCP و هوک برای همه‌ی ابزارها
git add -A && git commit -m "Add hamyad brain" && git push
hamyad import              # گفت‌وگوهای قبلی ابزارها را از لاگ‌های محلی وارد می‌کند
hamyad connect chatgpt     # دستور دقیق برای هر ابزار
hamyad status              # کدام ابزار وصل است و آخرین جلسه‌ی هر کدام
```

**بدون گیت‌هاب:**

```bash
hamyad init --all --store ~/Dropbox/brains/shop/MEMORY.md     # کل مغز در یک فایل
hamyad init --all --store "~/Google Drive/brains/shop"         # یا یک پوشه
```

## وقتی تصمیم عوض می‌شود

در چت می‌گویید «به‌جای Flask از FastAPI استفاده کنیم». مدل `brain_remember` را با `supersedes: [شناسه‌ی تصمیم قدیمی]` صدا می‌زند (یا `hamyad supersede old new`). تصمیم قدیمی «جایگزین‌شده» علامت می‌خورد و در بخش «Superseded — do NOT follow» قرار می‌گیرد. هر ابزار زمان «آخرین بازدید» خودش را دارد؛ پس جلسه‌ی بعدی Codex یا Cursor یا Claude Code با این پیام شروع می‌شود:

```
⚠ DECISIONS CHANGED since your last Codex session …
- REPLACED: "Use Flask for the API" → "Use FastAPI for the API" (ChatGPT)
```

اگر تصمیم جدید به‌نظر با تصمیم فعال دیگری تعارض داشته باشد، هم‌یاد به مدل هشدار می‌دهد تا از شما بپرسد، نه این‌که خودش حدس بزند.

## حافظه کی به‌روز می‌شود؟

| رویداد | چه اتفاقی می‌افتد |
|---|---|
| شروع جلسه | کامیت باقی‌مانده‌ها، pull، به‌روزکردن CLAUDE.md/AGENTS.md/MEMORY.md، تزریق خلاصه و «تصمیم‌های عوض‌شده» |
| هر پیام | ثبت درخواست (با حذف اسرار)؛ هشدار اگر ابزار دیگری وسط کار تصمیمی را عوض کرده |
| پایان هر نوبت / جلسه | خلاصه‌ی جلسه و git diff، کامیت و push در پس‌زمینه |
| نوشتن از MCP یا REST | ذخیره و بازسازی فوری MEMORY.md (در Worker هم روی گیت‌هاب) |
| کامیت گیت | وارد کردن گفت‌وگوی aider و به‌روزکردن خروجی‌ها |
| زمان‌سنج | `hamyad watch --interval 300` یا cron با `hamyad sync --import` |

## حریم خصوصی

- همه‌ی متن‌ها از فیلتر **حذف اسرار** می‌گذرند (کلیدهای OpenAI/Anthropic/GitHub/AWS/Google، توکن‌ها، JWT، کلید خصوصی، رمز داخل URL …).
- پیش‌فرض فقط **خلاصه** ذخیره می‌شود؛ متن کامل گفت‌وگو اختیاری است (`--capture full`) و حجمش محدود است. `--capture off` همه را خاموش می‌کند؛ برای هر ابزار جداگانه هم می‌شود خاموشش کرد.
- مسیرهای `.env` و `secrets/` هرگز در diff نمی‌آیند.

## چه چیزهایی واقعاً تست شده؟

- با **باینری‌های واقعی** Claude Code، Codex، Gemini CLI، Copilot CLI و aider در برابر یک سرور مدل ساختگی (۴۶ بررسی در `scripts/e2e`): هوک‌ها اجرا می‌شوند، جلسه و diff با نام درست ثبت می‌شوند، ابزارهای MCP هم‌یاد به مدل عرضه می‌شوند، و پیام «DECISIONS CHANGED» بعد از تغییر تصمیم از طریق HTTP (شبیه ChatGPT) به مدل همه‌ی ابزارها می‌رسد.
- فقط با بررسی تنظیمات/تست واحد: Cursor، Windsurf، Zed، Roo، Junie، VS Code، REST/OpenAPI.
- نیازمند حساب واقعی: کانکتورهای ChatGPT، Claude.ai، Grok، Perplexity و اپ Gemini.

## محدودیت‌ها (صادقانه)

- حافظه‌ی داخلی اپ‌های چت API ندارد؛ گفت‌وگوی چت فقط وقتی ثبت می‌شود که مدل `brain_log_session` را صدا بزند (دستورالعمل‌ها این را می‌خواهند).
- فعلاً OAuth ندارد و با توکن مشترک کار می‌کند.
- جست‌وجو کلیدواژه‌ای (و فارسی‌فهم) است، نه برداری.

## توسعه

```bash
npm ci && npm test                                            # ۵۴ تست
python3 scripts/e2e/mock.py & python3 scripts/e2e/run.py      # تست با ابزارهای واقعی
```

مجوز MIT © [محمدرضا زارع (M-R-Z)](https://github.com/mrzroot)

</div>
