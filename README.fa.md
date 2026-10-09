<div dir="rtl">

# هم‌یاد (hamyad)

**یک «مغز» مشترک برای پروژه، بین Claude Code، چت Claude.ai، Claude Desktop و گیت‌هاب.**

[![CI](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml/badge.svg)](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[سایت و دموی زنده](https://mrzroot.github.io/hamyad/) · [English](README.md) · [پژوهش: امروز چه ابزارهایی هست؟](RESEARCH.md)

## مشکل چیست؟

یک پروژه را در Claude Code (ترمینال، با `CLAUDE.md` و حافظه‌ی خودکار) دارید و همان پروژه را در Projects چت Claude.ai (فایل‌های دانش، دستورالعمل سفارشی، حافظه‌ی چت). این‌ها با هم **همگام نیستند**:

| کجا | چه چیزی را یادش می‌ماند | با بقیه مشترک است؟ |
|---|---|---|
| Claude Code | فایل `CLAUDE.md` و حافظه‌ی خودکار در `~/.claude/projects/…/memory` روی همان کامپیوتر | خیر |
| Projects در Claude.ai | دانش پروژه، دستورالعمل، حافظه‌ی جداگانه‌ی هر پروژه | خیر؛ اتصال گیت‌هاب **فقط‌خواندنی** است و فقط با دکمه‌ی *Sync now* به‌روز می‌شود |
| Claude Desktop | چت‌ها و سرورهای MCP محلی خودش | خیر |

تصمیمی که در چت گرفتید هیچ‌وقت به Claude Code نمی‌رسد و چیزی که Claude Code در یک جلسه فهمید هیچ‌وقت به چت نمی‌رسد.

## هم‌یاد چه می‌کند؟

یک پوشه‌ی `.brain/` داخل خود مخزن (Markdown ساده، یک فایل برای هر تصمیم/کار/یادداشت/زمینه/جلسه) که همه‌ی سطوح Claude آن را می‌خوانند و می‌نویسند:

- **Claude Code** از طریق سرور MCP محلی (stdio) و **هوک‌ها**: در شروع جلسه `git pull` (فقط fast-forward)، به‌روزکردن بلوک خودکار داخل `CLAUDE.md` و گفتن «از جلسه‌ی قبل در چت چه چیزهایی اضافه شده». در پایان جلسه یک خلاصه‌ی بدون LLM (درخواست‌ها، فایل‌های تغییرکرده، کامیت‌ها، نتیجه) ثبت، کامیت و push می‌شود.
- **چت Claude.ai** (وب، موبایل، دسکتاپ) از طریق یک **Custom Connector** (MCP راه‌دور) که رایگان روی Cloudflare Workers اجرا می‌شود و هر نوشتن را مستقیم به‌صورت یک کامیت در گیت‌هاب ثبت می‌کند.
- **Claude Desktop** با همان سرور محلی.
- **گیت‌هاب منبع حقیقت است**: همه‌چیز قابل بازبینی در PR، قابل ویرایش دستی و بدون قفل‌شدن به یک سرویس.

ابزارهای MCP در همه‌جا یکسان‌اند: `brain_context`، `brain_remember`، `brain_search`، `brain_list`، `brain_get`، `brain_update`، `brain_log_session`.

جست‌وجو **فارسی‌فهم** است: «ي/ی»، «ك/ک»، نیم‌فاصله و ارقام «۱۲۳/123» یکسان دیده می‌شوند.

## شروع سریع

```bash
npm i -g https://github.com/mrzroot/hamyad/releases/download/v0.1.0/hamyad-0.1.0.tgz
cd my-project
hamyad init
git add .brain .mcp.json .claude/settings.json CLAUDE.md && git commit -m "Add hamyad brain" && git push
hamyad connect   # تنظیمات دقیق Claude.ai و Claude Desktop و متن دستورالعمل پروژه را چاپ می‌کند
```

### اتصال چت Claude.ai

Claude.ai به کانکتورها **از سرورهای Anthropic** وصل می‌شود، نه از دستگاه شما؛ پس سرور باید عمومی باشد. پلن رایگان Cloudflare Workers کافی است (و چون درخواست از سمت Anthropic می‌آید، فیلترشدن احتمالی `workers.dev` در ایران مانع کار کانکتور نیست؛ فقط برای دیپلوی‌کردن ممکن است به اینترنت آزاد نیاز داشته باشید).

```bash
git clone https://github.com/mrzroot/hamyad && cd hamyad && npm ci && npm run build
cd worker      # در wrangler.toml مقدار GITHUB_REPO را بگذارید
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN    # توکن fine-grained فقط برای همین مخزن با دسترسی Contents: Read and write
npx wrangler secret put HAMYAD_TOKEN    # یک رشته‌ی تصادفی بلند
```

سپس در Claude.ai: **Customize ← Connectors ← Add custom connector** و آدرس
`https://hamyad.<you>.workers.dev/mcp/<HAMYAD_TOKEN>` را با گزینه‌ی *No sign in* وارد کنید (یا آدرس `/mcp` با هدر `Authorization: Bearer …`).
متنی را که `hamyad connect` چاپ می‌کند در **Custom instructions** پروژه بگذارید تا Claude در شروع هر چت `brain_context` را صدا بزند و تصمیم‌ها را با `brain_remember` ثبت کند.

### Claude Desktop

```json
{ "mcpServers": { "hamyad": { "command": "hamyad", "args": ["mcp", "--dir", "/path/to/my-project", "--source", "claude-desktop"] } } }
```

## ایمنی گیت

- pull فقط fast-forward است؛ تاریخچه‌ی شما بازنویسی نمی‌شود.
- push فقط وقتی انجام می‌شود که **همه‌ی** کامیت‌های push‌نشده کامیت‌های `brain:` باشند؛ کار نیمه‌تمام شما هرگز منتشر نمی‌شود.
- اگر خودتان `CLAUDE.md` را ویرایش کرده و کامیت نکرده باشید، هم‌یاد آن را کامیت نمی‌کند.

## محدودیت‌ها (صادقانه)

- حافظه‌ی داخلی و دستورالعمل‌های پروژه در Claude.ai هیچ API عمومی ندارند؛ هم‌یاد کنار آن‌ها یک لایه‌ی مشترک و ماندگار می‌سازد.
- فعلاً OAuth ندارد و با یک توکن مشترک کار می‌کند (برای استفاده‌ی شخصی مناسب است).
- جست‌وجو کلیدواژه‌ای است، نه برداری.

## توسعه

```bash
npm ci && npm test   # ۳۷ تست: واحد، چرخه‌ی کامل گیت با ریموت bare، سازگاری با کلاینت رسمی MCP SDK (stdio و HTTP)، Worker
```

مجوز MIT © [محمدرضا زارع (M-R-Z)](https://github.com/mrzroot)

</div>
