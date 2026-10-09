/* hamyad site: i18n (EN/FA, RTL), hero orbit, Connect-any-AI matrix, and a live multi-tool demo running the real hamyad core in the browser. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------------ i18n
  var FA = {
    "skip": "رفتن به دموی زنده",
    "nav.demo": "دموی زنده", "nav.connect": "وصل‌کردن هر AI", "nav.how": "چطور کار می‌کند", "nav.setup": "راه‌اندازی", "nav.compare": "مقایسه",
    "hero.kicker": "MIT · MCP + REST · بدون وابستگی",
    "hero.h1": "یک پروژه.<br>یک مغز.<br><em>همه‌ی AIها.</em>",
    "hero.lede": "در ChatGPT برنامه می‌ریزید، با Claude سر معماری بحث می‌کنید، از Grok و Perplexity می‌پرسید و کد را Codex، Claude Code، Cursor، Copilot و Gemini می‌نویسند. هرکدام جدا به خاطر می‌سپارد. <b>هم‌یاد</b> به همه‌شان <b>یک مغز مشترک</b> می‌دهد: هر چت، تصمیم و تغییر کد با نام ابزاری که آن را ساخته، و دفعه‌ی بعد که هر ابزار دیگری شروع می‌کند جلوی چشمش است.",
    "hero.cta1": "ببینید پنج AI یک مغز را شریک می‌شوند", "hero.cta2": "AI خودتان را وصل کنید",
    "problem.h": "ده‌ها AI، ده‌ها جزیره",
    "problem.lede": "در ChatGPT تصمیمی می‌گیرید و Codex هرگز خبردار نمی‌شود. در Claude نظرتان عوض می‌شود و Cursor همچنان طرح قدیمی را می‌سازد. هر ابزار حافظه‌ی خودش را دارد و هیچ‌کدام با هم حرف نمی‌زنند.",
    "problem.chath": "اپ‌های چت", "problem.chat": "حافظه‌ی ChatGPT، پروژه‌های Claude، Gemهای Gemini، رشته‌های Grok و Perplexity: هرکدام <b>حافظه‌ای خصوصی در ابر یک شرکت</b>، بدون راهی برای نوشتن در مخزن شما.",
    "problem.codeh": "ایجنت‌های کدنویس", "problem.code": "Claude Code، Codex، Cursor، Copilot، Gemini CLI، Windsurf و aider هرکدام رونوشت‌ها را <b>فقط روی همین کامپیوتر</b> نگه می‌دارند و هیچ‌کدام نمی‌داند دیگری دیروز چه کرد.",
    "problem.repoh": "مخزن شما", "problem.repo": "کد تغییر می‌کند اما <b>چرایی</b> آن در چتی است که هیچ‌کس دیگر نمی‌بیند. وقتی تصمیمی عوض می‌شود، ایجنت‌ها روی تصمیم کهنه کار می‌کنند.",
    "problem.src": "منابع و بررسی کامل هوک‌ها، لاگ‌ها و کانکتورهای هر ابزار:",
    "demo.h": "پنج AI، یک مغز",
    "demo.lede": "این همان مغز و سرور MCP واقعی هم‌یاد است که در مرورگر اجرا می‌شود. هر اپ چت را در چپ و هر ایجنت کدنویس را در راست انتخاب کنید: همه در یک کشو می‌نویسند و به هر ایجنت گفته می‌شود از <i>آخرین جلسه‌ی خودش</i> چه عوض شده. جز شبکه هیچ‌چیز ساختگی نیست.",
    "demo.play": "▶ پخش کل داستان", "demo.reset": "از نو", "demo.wire": "نمایش پیام‌های JSON-RPC",
    "demo.chatsub": "چت · کانکتور هم‌یاد", "demo.termsub": "هوک‌ها + MCP", "demo.tlsub": "چت‌ها، تصمیم‌ها و تغییرات کد همه‌ی ابزارها، جدیدترین بالا",
    "demo.ph": "یک تصمیم، کار یا یادداشت بنویسید…", "demo.send": "ثبت",
    "demo.tstart": "هوک شروع جلسه", "demo.twork": "ایجنت کد را تغییر می‌دهد", "demo.texit": "هوک پایان جلسه",
    "demo.wireh": "پیام‌های JSON-RPC", "demo.wiresub": "دقیقاً همان چیزی که هر AI و هم‌یاد به هم می‌گویند",
    "conn.h": "هر AIی را وصل کنید",
    "conn.lede": "<code>hamyad init --all</code> همه‌ی ابزارهای کدنویسی مخزن را سیم‌کشی می‌کند. <code>hamyad connect &lt;tool&gt;</code> مراحل دقیق بقیه را چاپ می‌کند. هر چیز دیگری می‌تواند از MCP، REST/OpenAPI یا فایل همیشه‌تازه‌ی <code>MEMORY.md</code> استفاده کند.",
    "conn.remoteh": "اپ‌های چت یک آدرس عمومی لازم دارند",
    "conn.remote": "آن‌ها کانکتور را از ابر خودشان صدا می‌زنند. از Worker رایگان کلادفلر روی مخزن گیت‌هاب استفاده کنید، یا بدون گیت‌هاب <code>hamyad serve --token …</code> را کنار پوشه‌ی مشترک اجرا و با <code>cloudflared tunnel</code> عمومی کنید.",
    "conn.nogh": "گیت‌هاب ندارید؟ یک فایل کافی است",
    "conn.noghp": "<code>hamyad init --all --store ~/Dropbox/shop/MEMORY.md</code> کل مغز را در یک فایل Markdown در Dropbox، گوگل‌درایو یا یک پوشه‌ی مشترک نگه می‌دارد. همان فایل را به هر چتی که فقط فایل می‌پذیرد بدهید.",
    "how.h": "چطور کار می‌کند",
    "how.1h": "هر AI می‌نویسد", "how.1p": "اپ‌های چت از طریق کانکتور یا GPT Action ابزار <code>brain_remember</code> را صدا می‌زنند. ایجنت‌های کدنویس با هوک ثبت می‌شوند: درخواست‌ها، نتیجه و <b>git diff</b> هر جلسه با نام ابزار ذخیره می‌شود.",
    "how.2h": "یک پوشه نگه می‌دارد", "how.2p": "Markdown ساده در <code>.brain/</code>: داخل مخزن (گیت‌هاب منبع حقیقت است)، در هر پوشه‌ی همگام، یا در یک <code>MEMORY.md</code>. رازها پیش از نوشتن حذف می‌شوند.",
    "how.3h": "تصمیم‌ها جایگزین می‌شوند", "how.3p": "وقتی تصمیم تازه‌ای جای قبلی را می‌گیرد، قبلی همه‌جا <i>منسوخ</i> علامت می‌خورد. هم‌یاد تعارض‌های محتمل را نشان می‌دهد، حدس نمی‌زند.",
    "how.4h": "همه به‌روز می‌شوند", "how.4p": "هر ایجنت در شروع جلسه خلاصه را به‌علاوه‌ی <b>«⚠ تصمیم‌هایی که از آخرین جلسه‌ات عوض شده»</b> و کارهای ابزارهای دیگر می‌خواند. اپ‌های چت همین را از <code>brain_context</code> می‌گیرند.",
    "trg.h1": "کِی", "trg.h2": "هم‌یاد چه می‌کند",
    "trg.1": "شروع جلسه", "trg.1d": "pull، تازه‌کردن CLAUDE.md / AGENTS.md / MEMORY.md، تزریق خلاصه + «تصمیم‌های عوض‌شده»",
    "trg.2": "هر درخواست", "trg.2d": "ثبت (با حذف رازها)؛ هشدار اگر ابزار دیگری در این فاصله تصمیمی را عوض کرده",
    "trg.3": "پایان نوبت / جلسه", "trg.3d": "خلاصه‌ی جلسه + git diff، کامیت، push در پس‌زمینه",
    "trg.4": "نوشتن از MCP / REST", "trg.4d": "ذخیره‌ی مورد و بازسازی MEMORY.md و فایل‌های دستورالعمل",
    "trg.5": "کامیت گیت · زمان‌سنج", "trg.5d": "وارد کردن چت‌های aider؛ <code>hamyad watch</code> لاگ‌های محلی را وارد و طبق برنامه همگام می‌کند",
    "setup.h": "راه‌اندازی در ده دقیقه",
    "setup.tab1": "ایجنت‌های کدنویس", "setup.tab2": "اپ‌های چت", "setup.tab3": "بدون گیت‌هاب",
    "setup.code": "داخل مخزن خودتان. <code>init --all</code> پوشه‌ی <code>.brain/</code> را می‌سازد و سرور MCP، هوک‌ها و قواعد را برای Claude Code، Codex، Gemini CLI، Cursor، Copilot، Windsurf، Zed، Roo، Junie و aider ادغام می‌کند، بدون دست‌زدن به چیزهای موجود.",
    "setup.chat": "Worker رایگان را یک‌بار دیپلوی کنید و همان آدرس را به هر اپ چت بدهید. ChatGPT می‌تواند آن را به‌عنوان Action در GPT سفارشی هم استفاده کند.",
    "setup.nogh": "مغز می‌تواند در هر پوشه‌ای باشد که دستگاه‌ها و ابزارهایتان شریک‌اند، یا در یک فایل. برای اپ‌های چت آن را از طریق تونل سرو کنید.",
    "prom.h": "کارهایی که هم‌یاد هرگز نمی‌کند",
    "prom.1": "ذخیره‌ی کلیدهای API شما. رازها پیش از هر نوشتن از چت‌ها، درخواست‌ها و diffها حذف می‌شوند.",
    "prom.2": "push کردن کار نیمه‌تمام شما. فقط وقتی push می‌کند که همه‌ی کامیت‌های push‌نشده کامیت <code>brain:</code> باشند.",
    "prom.3": "ذخیره‌ی رونوشت کامل بدون اجازه‌ی شما. پیش‌فرض یک خلاصه‌ی کوتاه است.",
    "prom.4": "اجرای سرور عمومی بدون توکن. Worker و <code>hamyad serve</code> اجازه نمی‌دهند.",
    "prom.5": "قفل‌کردن شما. یک پوشه Markdown است؛ هم‌یاد را پاک کنید، یادداشت‌ها می‌مانند.",
    "cmp.h": "کنار ابزارهای موجود",
    "cmp.r0": "کار با همه‌ی شرکت‌ها", "cmp.r1": "ثبت جلسه‌ها و diff کد ایجنت‌ها", "cmp.r6": "اعلام تصمیم‌های منسوخ به همه‌ی ابزارها", "cmp.r2": "داخل مخزن یا پوشه‌ی خودتان", "cmp.r4": "جست‌وجوی معنایی", "cmp.r5": "مجوز",
    "cmp.note": "هم‌یاد نمی‌تواند حافظه‌ی داخلی ChatGPT یا Claude را بخواند (API ندارند). اپ‌های چت به این دلیل در هم‌یاد می‌نویسند که کانکتور و دستورالعمل شما از آن‌ها می‌خواهد.",
    "faq.h": "پرسش‌ها",
    "faq.q1": "کلید API از OpenAI یا Anthropic لازم دارد؟", "faq.a1": "نه. فکرکردن در همان AIی انجام می‌شود که الان استفاده می‌کنید؛ هم‌یاد فقط ذخیره، خلاصه (بدون هیچ مدلی) و سرو می‌کند.",
    "faq.q5": "کدام ابزارها واقعاً آزمایش شده‌اند؟", "faq.a5": "Claude Code، Codex، Gemini CLI، Copilot CLI و aider در تست e2e ما واقعاً در برابر یک سرور مدل ساختگی اجرا می‌شوند: هوک‌ها اجرا می‌شوند، جلسه‌ها و diffها ثبت می‌شوند و «تصمیم‌های عوض‌شده» به هر مدل می‌رسد. پیکربندی Cursor، Windsurf، Zed، Roo و JetBrains با پارس‌کردن بررسی شده؛ کانکتورهای اپ‌های چت به حساب شما نیاز دارند.",
    "faq.q2": "در ایران هستم. کانکتورها کار می‌کنند؟", "faq.a2": "بله. ChatGPT، Claude.ai و Grok از سرورهای خودشان به Worker شما وصل می‌شوند، نه از دستگاه شما؛ پس فیلترینگ داخلی <code>workers.dev</code> روی آن‌ها اثری ندارد. فقط برای یک‌بار دیپلوی ممکن است اینترنت آزاد لازم شود.",
    "faq.q3": "برای تیم چطور؟", "faq.a3": "همه‌ی کسانی که به مخزن (یا پوشه) دسترسی دارند در مغز شریک‌اند. نقطه‌ی راه‌دور یک توکن برای هر دیپلوی دارد؛ OAuth برای هر نفر در نقشه‌ی راه است.",
    "faq.q4": "می‌توانم دستی ویرایش کنم؟", "faq.a4": "بله، در ویرایشگر، روی github.com یا مستقیم داخل MEMORY.md.",
    "foot.by": "ساخته‌ی <a href=\"https://mrzroot.github.io/\">محمدرضا زارع (M-R-Z)</a>. وابسته به OpenAI، Anthropic، گوگل، xAI یا هیچ‌کدام از ابزارهای نام‌برده نیست."
  };
  var EN = {};
  $$("[data-t]").forEach(function (el) { EN[el.getAttribute("data-t")] = el.innerHTML; });
  $$("[data-tp]").forEach(function (el) { EN[el.getAttribute("data-tp")] = el.getAttribute("placeholder"); });

  var S = {
    en: {
      entries: function (n) { return n + (n === 1 ? " entry" : " entries"); },
      empty: "empty drawer: save something",
      chips: [
        { id: "express", text: "Backend: Node + Express, Postgres for data.", kind: "decision", title: "Backend: Node + Express", body: "Postgres for data. Express because the first prototype already uses it." },
        { id: "sms", text: "Add SMS login with Kavenegar to the backlog.", kind: "task", title: "SMS login with Kavenegar" },
        { id: "fastapi", text: "Switch the backend to FastAPI: the team knows Python.", kind: "decision", title: "Backend: switch to FastAPI", body: "Team is stronger in Python; keep Postgres. Port existing endpoints.", supersedes: "express" },
        { id: "zarin", text: "Add Zarinpal checkout. Sandbox needs a merchant ID.", kind: "task", title: "Zarinpal checkout", body: "Sandbox needs a merchant ID: any 36-char UUID works." },
        { id: "ask", text: "Where does the project stand?", ask: true }
      ],
      saved: function (k, app) { return "Saved as a " + k + " in the shared brain. Every other AI on this project will see it, attributed to " + app + "."; },
      replaced: function (t) { return "It also marks “" + t + "” as superseded, so agents still on the old plan are warned."; },
      ask: "Here is what every tool has done, from the shared brain:",
      noSession: "start a session first",
      first: function (tool) { return "First " + tool + " session here: full brief, active decisions:"; },
      nothing: function (tool) { return "Nothing changed since your last " + tool + " session."; },
      task: function (t) { return "implement: " + t; },
      tidy: "tidy up and add tests",
      done: "✓ Done. Change set captured, task marked done in the shared brain."
    },
    fa: {
      entries: function (n) { return n.toLocaleString("fa-IR") + " مورد"; },
      empty: "کشو خالی است: چیزی ثبت کنید",
      chips: [
        { id: "express", text: "بک‌اند: Node + Express، داده در Postgres.", kind: "decision", title: "بک‌اند: Node + Express", body: "داده در Postgres. Express چون نمونه‌ی اولیه با آن ساخته شده." },
        { id: "sms", text: "ورود با پیامک کاوه‌نگار را به کارها اضافه کن.", kind: "task", title: "ورود با پیامک کاوه‌نگار" },
        { id: "fastapi", text: "بک‌اند را به FastAPI ببریم؛ تیم پایتون بلد است.", kind: "decision", title: "بک‌اند: مهاجرت به FastAPI", body: "تیم در پایتون قوی‌تر است؛ Postgres می‌ماند. endpointهای فعلی منتقل شوند.", supersedes: "express" },
        { id: "zarin", text: "پرداخت زرین‌پال را اضافه کن. سندباکس مرچنت‌کد می‌خواهد.", kind: "task", title: "پرداخت زرین‌پال", body: "سندباکس مرچنت‌کد می‌خواهد: هر UUID سی‌وشش‌کاراکتری کار می‌کند." },
        { id: "ask", text: "پروژه الان در چه وضعی است؟", ask: true }
      ],
      saved: function (k, app) { return "به‌عنوان " + ({ decision: "تصمیم", task: "کار", note: "یادداشت", context: "زمینه" }[k] || k) + " در مغز مشترک ثبت شد. همه‌ی AIهای دیگر این پروژه آن را با نام " + app + " می‌بینند."; },
      replaced: function (t) { return "«" + t + "» هم منسوخ علامت خورد تا ایجنت‌هایی که روی طرح قدیمی‌اند هشدار بگیرند."; },
      ask: "کارهایی که همه‌ی ابزارها کرده‌اند، از مغز مشترک:",
      noSession: "اول جلسه را شروع کنید",
      first: function (tool) { return "اولین جلسه‌ی " + tool + " در این پروژه: خلاصه‌ی کامل، تصمیم‌های فعال:"; },
      nothing: function (tool) { return "از آخرین جلسه‌ی " + tool + " چیزی عوض نشده."; },
      task: function (t) { return "پیاده‌سازی: " + t; },
      tidy: "مرتب‌سازی و افزودن تست",
      done: "✓ انجام شد. تغییرات ثبت و کار در مغز مشترک انجام‌شده علامت خورد."
    }
  };

  var lang = "en";
  function setLang(l) {
    lang = l === "fa" ? "fa" : "en";
    var html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "fa" ? "rtl" : "ltr";
    var dict = lang === "fa" ? FA : EN;
    $$("[data-t]").forEach(function (el) { var k = el.getAttribute("data-t"); var v = dict[k] != null ? dict[k] : EN[k]; if (v != null) el.innerHTML = v; });
    $$("[data-tp]").forEach(function (el) { var k = el.getAttribute("data-tp"); el.setAttribute("placeholder", (lang === "fa" ? FA[k] : EN[k]) || EN[k]); });
    try { localStorage.setItem("hamyad-lang", lang); } catch (e) {}
    var u = new URL(location.href);
    if (lang === "fa") u.searchParams.set("lang", "fa"); else u.searchParams.delete("lang");
    history.replaceState(null, "", u);
    renderChips();
    renderBrain();
  }
  $("#lang").addEventListener("click", function () { setLang(lang === "fa" ? "en" : "fa"); });

  $$("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = $(b.getAttribute("data-copy")).textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = "✓"; setTimeout(function () { b.textContent = "copy"; }, 1200); }, function () {});
    });
  });
  $$(".tabs [role=tab]").forEach(function (t) {
    t.addEventListener("click", function () {
      $$(".tabs [role=tab]").forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); $("#" + x.getAttribute("data-tab")).hidden = x !== t; });
    });
  });

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var H = window.Hamyad;
  var label = function (s) { return H.toolLabel(s); };

  // ------------------------------------------------------------------ hero orbit
  var orbitItems = $$(".orbit li");
  (function spokes() {
    var g = $("#spokes"); if (!g) return;
    var n = orbitItems.length;
    orbitItems.forEach(function (li, i) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", 300); l.setAttribute("y1", 300);
      l.setAttribute("x2", (300 + Math.cos(a) * 262).toFixed(1)); l.setAttribute("y2", (300 + Math.sin(a) * 262).toFixed(1));
      l.dataset.src = li.dataset.src;
      li.style.left = (50 + Math.cos(a) * 43.7).toFixed(2) + "%";
      li.style.top = (50 + Math.sin(a) * 43.7).toFixed(2) + "%";
      g.appendChild(l);
    });
  })();
  var TICK = [
    ["chatgpt", "◆ decision"], ["codex", "± 3 files +48 −5"], ["claude-chat", "⇄ supersedes"], ["cursor", "💬 session"], ["grok", "✎ note"],
    ["claude-code", "± 2 files +31 −2"], ["perplexity", "? brain_context"], ["gemini-cli", "💬 session"], ["copilot", "✓ task done"], ["windsurf", "± 1 file +9"],
    ["gemini-app", "? brain_search"], ["aider", "± commit"], ["zed", "✎ note"], ["cline", "◆ decision"], ["jetbrains", "? brain_context"], ["claude-desktop", "✎ note"]
  ];
  function ping(src, what) {
    var li = orbitItems.filter(function (x) { return x.dataset.src === src; })[0];
    var ln = $$("#spokes line").filter(function (x) { return x.dataset.src === src; })[0];
    if (li) { li.classList.remove("ping"); void li.offsetWidth; li.classList.add("ping"); }
    if (ln) { ln.classList.remove("ping"); void ln.getBoundingClientRect(); ln.classList.add("ping"); }
    var tk = $("#core-ticker");
    if (tk && what) {
      var s = document.createElement("span"); s.textContent = what + " · " + label(src);
      tk.prepend(s); while (tk.children.length > 3) tk.removeChild(tk.lastChild);
    }
  }
  var ti = 0;
  if (!window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setInterval(function () { if (document.hidden) return; var t = TICK[ti++ % TICK.length]; ping(t[0], t[1]); }, 1600);
  }

  // ------------------------------------------------------------------ connect matrix
  var U = "https://hamyad.&lt;you&gt;.workers.dev/mcp/&lt;TOKEN&gt;";
  var CONNECT = [
    ["ChatGPT", "chat", "remote MCP · GPT Action · file", "Developer mode → chatgpt.com/plugins → <b>+</b> → Add custom MCP server", U + "?source=chatgpt<br>or GPT → Actions → Import <b>/openapi.json</b> (Bearer token)"],
    ["Claude.ai", "chat", "remote MCP · file", "Customize → Connectors → Add custom connector", U + "?source=claude-chat"],
    ["Claude Desktop", "chat", "local MCP", "<code>hamyad init --global</code>", "or Settings → Developer → Edit Config"],
    ["Claude Code", "agent", "hooks + MCP · auto", "<code>hamyad init --all</code>", ".mcp.json · .claude/settings.json · CLAUDE.md"],
    ["Codex CLI / IDE", "agent", "hooks + MCP · auto", "<code>hamyad init --all</code>", ".codex/config.toml · .codex/hooks.json · AGENTS.md"],
    ["Cursor", "ide", "hooks + MCP · auto", "<code>hamyad init --all</code>", ".cursor/mcp.json · hooks.json · rules/hamyad.mdc"],
    ["Windsurf", "ide", "hooks + MCP · auto", "<code>hamyad init --all --global</code>", ".windsurf/hooks.json · rules · global mcp_config.json"],
    ["VS Code Copilot", "ide", "hooks + MCP · auto", "<code>hamyad init --all</code>", ".vscode/mcp.json · .github/hooks/hamyad.json"],
    ["Gemini CLI", "agent", "hooks + MCP · auto", "<code>hamyad init --all</code>", ".gemini/settings.json (mcp, hooks, AGENTS.md)"],
    ["Gemini app", "chat", "remote MCP · file", "Connected Apps → Add a custom app (where offered)", U + "?source=gemini-app<br>else: MEMORY.md in a Gem"],
    ["Grok", "chat", "remote MCP · CLI", "grok.com/connectors → New → Custom", U + "?source=grok<br>Grok CLI reads .mcp.json"],
    ["Perplexity", "chat", "remote MCP · file", "Settings → Connectors → + Custom → Remote", U + "?source=perplexity"],
    ["Zed", "ide", "MCP · auto", "<code>hamyad init --all</code>", ".zed/settings.json context_servers"],
    ["Cline / Roo Code", "ide", "MCP · auto (Roo)", "<code>hamyad init --all</code>", ".roo/mcp.json · Cline: <code>hamyad connect cline</code>"],
    ["JetBrains AI / Junie", "ide", "MCP · auto (Junie)", "<code>hamyad init --all</code>", ".junie/mcp/mcp.json · AI Assistant → MCP"],
    ["aider", "agent", "rules + import · auto", "<code>hamyad init --all</code>", ".aider.conf.yml reads AGENTS.md · chats imported on commit"],
    ["Anything else", "any", "MCP · REST · file", "<code>hamyad connect any</code>", "/mcp · /openapi.json · /api/* · MEMORY.md"]
  ];
  (function renderConnect() {
    var g = $("#conn-grid"); if (!g) return;
    g.innerHTML = CONNECT.map(function (c) {
      return '<article class="conn conn-' + c[1] + '"><header><b>' + c[0] + '</b><span class="kind">' + c[1] + '</span></header><p class="via">' + c[2] + '</p><p class="how1">' + c[3] + '</p><p class="how2">' + c[4] + "</p></article>";
    }).join("");
  })();

  // ------------------------------------------------------------------ demo
  var APPS = ["chatgpt", "claude-chat", "grok", "perplexity", "gemini-app"];
  var AGENTS = [
    { id: "claude-code", cmd: "claude", hook: "SessionStart" },
    { id: "codex", cmd: "codex", hook: "SessionStart" },
    { id: "cursor", cmd: "cursor-agent", hook: "sessionStart" },
    { id: "gemini-cli", cmd: "gemini", hook: "SessionStart" },
    { id: "copilot", cmd: "copilot", hook: "sessionStart" },
    { id: "windsurf", cmd: "windsurf", hook: "pre_user_prompt" }
  ];
  var be, servers, rpcId, t0, tick, lastSeen, session, edits, busy = false, app = "chatgpt", agent = AGENTS[0], chipIds;

  function now() { return new Date(t0 + (tick += 60000)); }
  function srv(src) {
    if (!servers[src]) servers[src] = new H.McpServer(new H.Brain(be, { source: src, now: now }), { source: src });
    return servers[src];
  }
  function reset() {
    t0 = Date.parse("2026-10-09T09:00:00Z"); tick = 0; rpcId = 0; servers = {}; lastSeen = {}; session = null; edits = null; chipIds = {};
    be = new H.MemoryBackend({ "config.json": JSON.stringify({ project: "shop", briefChars: 1800 }) });
    var origWrite = be.write.bind(be);
    be.write = function (path, content, message) {
      return origWrite(path, content, message).then(function (r) { renderBrain(); return r; });
    };
    $("#chat-log").innerHTML = "";
    $("#term").innerHTML = '<span class="c"># ~/shop: hamyad init --all done. Pick an agent, then press start.</span>\n';
    $("#wire-log").textContent = "";
    selectApp("chatgpt"); selectAgent("claude-code");
    renderChips(); renderBrain(); updateTermButtons();
  }

  function wire(dir, obj, who) {
    var pre = $("#wire-log");
    var span = document.createElement("span");
    span.className = dir === "→" ? "req" : "res";
    var txt = JSON.stringify(obj);
    if (txt.length > 900) txt = txt.slice(0, 900) + "…";
    span.textContent = (dir === "→" ? who + " → hamyad  " : "hamyad → " + who + "  ") + txt + "\n";
    pre.appendChild(span);
    pre.scrollTop = pre.scrollHeight;
  }
  function rpc(src, method, params) {
    var req = { jsonrpc: "2.0", id: ++rpcId, method: method };
    if (params) req.params = params;
    wire("→", req, src);
    return srv(src).handle(req).then(function (res) { wire("←", res, src); return res; });
  }
  function tool(src, name, args) {
    return rpc(src, "tools/call", { name: name, arguments: args }).then(function (r) { return r.result.content[0].text; });
  }
  function snap() { return new H.Brain(be).snapshot(); }

  // tabs for apps / agents
  function tabs(box, items, cur, onPick) {
    box.innerHTML = "";
    items.forEach(function (id) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(id === cur));
      b.className = "apptab t-" + id; b.textContent = label(id);
      b.onclick = function () { if (!busy) onPick(id); };
      box.appendChild(b);
    });
  }
  function selectApp(id) {
    app = id;
    tabs($("#chat-apps"), APPS, id, selectApp);
    $("#chat-name").textContent = label(id);
    $(".station.chat").dataset.app = id;
  }
  function selectAgent(id) {
    if (session && session.agent.id !== id) { term('<span class="o">' + (lang === "fa" ? "اول جلسه‌ی فعلی را ببندید" : "exit the current session first") + "</span>"); return; }
    agent = AGENTS.filter(function (a) { return a.id === id; })[0];
    tabs($("#agents"), AGENTS.map(function (a) { return a.id; }), id, selectAgent);
    $("#term-name").textContent = "~/shop $ " + agent.cmd;
    $("#t-start").querySelector("bdi").textContent = agent.cmd;
  }

  // drawer + timeline
  function renderBrain() {
    if (!be) return;
    snap().then(function (s) {
      var box = $("#cards");
      box.setAttribute("data-empty", S[lang].empty);
      box.innerHTML = "";
      s.entries.forEach(function (e) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "mcard" + (e.status === "done" ? " done" : "") + (e.status === "superseded" ? " superseded" : "");
        c.innerHTML = '<span class="row"><span class="k k-' + e.kind + '">' + e.kind.toUpperCase() + "</span>" + (e.status ? "<span>[" + esc(e.status) + "]</span>" : "") +
          '<span class="src"><i class="tdot t-' + esc(e.source) + '"></i>' + esc(label(e.source)) + '</span></span><span class="t" dir="auto">' + esc(e.title) + "</span>";
        c.onclick = function () { openCard(e); };
        box.appendChild(c);
      });
      $("#brain-count").textContent = S[lang].entries(s.entries.length);
      var tl = H.sortTimeline(H.brainTimeline(s.entries), { limit: 40 });
      $("#timeline").innerHTML = tl.map(function (i) {
        return '<li class="ty-' + i.type + '"><time>' + i.at.slice(11, 16) + ' UTC</time><span class="who"><i class="tdot t-' + esc(i.tool) + '"></i>' + esc(label(i.tool)) +
          '</span><span class="ty">' + i.type + '</span><span class="tt" dir="auto">' + esc(i.title) + (i.detail ? " <small>[" + esc(i.detail) + "]</small>" : "") + "</span></li>";
      }).join("");
    });
  }
  function openCard(e) {
    $("#dlg-path").textContent = ".brain/" + e.path;
    $("#dlg-body").textContent = H.serializeEntry(e);
    var d = $("#card-dialog");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }

  // chat
  function bubble(cls, html) {
    var d = document.createElement("div");
    d.className = cls; d.innerHTML = html; d.setAttribute("dir", "auto");
    var log = $("#chat-log"); log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function chatSay(item) {
    var src = app, who = label(src);
    bubble("msg user", '<small class="via t-' + src + '">' + esc(who) + "</small> " + esc(item.text));
    ping(src, item.ask ? "? brain_context" : "◆ " + (item.kind || "note"));
    if (item.ask) {
      bubble("tool", "<b>brain_context</b> {}");
      return tool(src, "brain_context", {}).then(function (txt) {
        bubble("msg ai", esc(S[lang].ask) + '<pre class="brief-pre">' + esc(txt) + "</pre>");
      });
    }
    var args = { kind: item.kind, title: item.title };
    if (item.body) args.body = item.body;
    var old = item.supersedes && chipIds[item.supersedes];
    if (old) args.supersedes = [old];
    bubble("tool", "<b>brain_remember</b> " + esc(JSON.stringify(args)));
    return tool(src, "brain_remember", args).then(function (txt) {
      var m = /`([\w-]+)`/.exec(txt); if (m && item.id) chipIds[item.id] = m[1];
      var msg = esc(S[lang].saved(item.kind, who));
      if (old) { var oc = S[lang].chips.filter(function (c) { return c.id === item.supersedes; })[0]; msg += " " + esc(S[lang].replaced(oc ? oc.title : old)); }
      bubble("msg ai", msg);
    });
  }
  function renderChips() {
    var box = $("#chat-chips"); if (!box) return;
    box.innerHTML = "";
    S[lang].chips.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = c.text; b.setAttribute("dir", "auto");
      b.onclick = function () { if (!busy) chatSay(c); };
      box.appendChild(b);
    });
  }
  $("#chat-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = $("#chat-input").value.trim();
    if (!v || busy) return;
    $("#chat-input").value = "";
    chatSay({ text: v, kind: $("#chat-kind").value, title: v });
  });

  // terminal
  function term(html) { var t = $("#term"); t.innerHTML += html + "\n"; t.scrollTop = t.scrollHeight; }
  function updateTermButtons() {
    $("#t-start").disabled = !!session;
    $("#t-work").disabled = !session;
    $("#t-exit").disabled = !session;
  }
  function startSession() {
    if (session) return Promise.resolve();
    var a = agent, me = a.id, name = label(me);
    session = { agent: a, prompts: [] }; edits = null; updateTermButtons();
    ping(me, "▶ session start");
    term('\n<span class="y">$ ' + a.cmd + "</span>");
    term('<span class="c">● ' + a.hook + " hook › hamyad hook " + me.replace("-cli", "") + " start</span>");
    return snap().then(function (s) {
      term('<span class="c">  pull · AGENTS.md / CLAUDE.md / MEMORY.md refreshed (' + s.entries.length + " entries)</span>");
      term('<span class="b">  [hamyad] Shared project brain loaded (' + s.entries.length + " entries).</span>");
      var since = lastSeen[me];
      if (since) {
        var txt = H.renderChanges(H.changesSince(s.entries, since, me), { since: since, tool: me });
        if (txt) txt.split("\n").forEach(function (l) { term('<span class="' + (/^⚠|REPLACED/.test(l) ? "o" : "b") + '">  ' + esc(l) + "</span>"); });
        else term('<span class="c">  ' + esc(S[lang].nothing(name)) + "</span>");
      } else {
        term('<span class="b">  ' + esc(S[lang].first(name)) + "</span>");
        s.entries.filter(function (e) { return e.kind === "decision" && e.status !== "superseded"; }).forEach(function (e) {
          term('<span class="b">  - ' + esc(e.title) + " `" + e.id + "` (" + esc(label(e.source)) + ")</span>");
        });
      }
      lastSeen[me] = now().toISOString();
      return rpc(me, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: me, version: "1" } })
        .then(function () { return rpc(me, "tools/list"); })
        .then(function (r) { term('<span class="g">✓ MCP server "hamyad" connected · ' + r.result.tools.length + " tools</span>"); });
    });
  }
  function work() {
    if (!session) { term('<span class="o">' + S[lang].noSession + "</span>"); return Promise.resolve(); }
    var me = session.agent.id;
    return snap().then(function (s) {
      var task = s.entries.filter(function (e) { return e.kind === "task" && e.status === "open"; })[0];
      var dec = s.entries.filter(function (e) { return e.kind === "decision" && e.status !== "superseded" && /backend|بک‌اند/i.test(e.title); })[0];
      var py = dec && /fastapi/i.test(dec.title);
      var prompt = task ? S[lang].task(task.title) : S[lang].tidy;
      session.prompts.push(prompt);
      term('\n<span class="y">&gt; ' + esc(prompt) + "</span>");
      term('<span class="c">⏺ hamyad · brain_context</span>');
      return tool(me, "brain_context", {}).then(function () {
        var slug = task && /zarin|زرین/i.test(task.title) ? "payments" : "sms";
        var files = py ? ["app/main.py", "app/" + slug + ".py", "tests/test_" + slug + ".py"] : ["src/server.js", "src/" + slug + ".js"];
        if (!task && py) files = ["app/main.py", "tests/test_main.py"];
        term('<span class="c">  ' + (dec ? (lang === "fa" ? "پیرو تصمیم فعال: " : "following active decision: ") + esc(dec.title) : "") + "</span>");
        term('<span class="o">⏺ ' + files.map(function (f) { return "Edit " + f; }).join(" · ") + " · Bash " + (py ? "pytest -q" : "npm test") + "  ✓</span>");
        edits = { files: files, add: 20 + files.length * 9, del: 3 };
        ping(me, "± " + files.length + " files");
        if (!task) return;
        term('<span class="c">⏺ hamyad · brain_update {"id":"' + task.id + '","status":"done"}</span>');
        return tool(me, "brain_update", { id: task.id, status: "done", append: "Implemented in " + files.join(", ") });
      }).then(function () { term('<span class="g">' + S[lang].done + "</span>"); });
    });
  }
  function exitSession() {
    if (!session) return Promise.resolve();
    var me = session.agent.id, name = label(me), b = new H.Brain(be, { source: me, now: now });
    term('\n<span class="y">&gt; /exit</span>');
    term('<span class="c">● ' + (me === "codex" || me === "copilot" ? "Stop" : "SessionEnd") + " hook › hamyad hook " + me.replace("-cli", "") + " end</span>");
    var p = Promise.resolve(null);
    if (edits) {
      var e0 = edits;
      p = b.add({ kind: "change", source: me, tags: [me], title: name + ": " + e0.files.length + " file(s) +" + e0.add + " −" + e0.del + " — " + (session.prompts[0] || ""),
        body: "### Files\n" + e0.files.map(function (f) { return "- `" + f + "`"; }).join("\n") + "\n\n(git diff captured from the working tree, secrets redacted)" });
    }
    return p.then(function (ch) {
      if (ch) term('<span class="g">  change set ' + ch.id + "  (" + edits.files.length + " files, git diff)</span>");
      return b.add({ kind: "session", source: me, tags: [me], title: name + ": " + (session.prompts[0] || "(no prompts)"),
        body: "### Asked\n" + (session.prompts.map(function (x) { return "- " + x; }).join("\n") || "- (nothing)") + (ch ? "\n\nChanges: `" + ch.id + "`" : "") });
    }).then(function (e) {
      term('<span class="g">  logged session ' + e.id + "</span>");
      term('<span class="g">  commit brain: session [' + me + "] · push → origin/main</span>");
      ping(me, "💬 session");
      session = null; edits = null; updateTermButtons();
    });
  }
  $("#t-start").addEventListener("click", function () { if (!busy) startSession(); });
  $("#t-work").addEventListener("click", function () { if (!busy) work(); });
  $("#t-exit").addEventListener("click", function () { if (!busy) exitSession(); });
  $("#wire-on").addEventListener("change", function (e) { $("#wire").hidden = !e.target.checked; });
  $("#reset").addEventListener("click", function () { if (!busy) reset(); });

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function chip(id) { return S[lang].chips.filter(function (c) { return c.id === id; })[0]; }
  $("#play").addEventListener("click", function () {
    if (busy) return;
    reset();
    busy = true;
    var b = $("#play"); b.disabled = true;
    var steps = [
      function () { selectApp("chatgpt"); return chatSay(chip("express")); },
      function () { return chatSay(chip("sms")); },
      function () { selectAgent("codex"); return startSession(); }, work, exitSession,
      function () { selectApp("claude-chat"); return chatSay(chip("fastapi")); },
      function () { selectApp("grok"); return chatSay(chip("zarin")); },
      function () { selectAgent("codex"); return startSession(); }, work, exitSession,
      function () { selectAgent("cursor"); return startSession(); }, work, exitSession,
      function () { selectApp("perplexity"); return chatSay(chip("ask")); }
    ];
    var p = Promise.resolve();
    steps.forEach(function (s) { p = p.then(function () { return wait(1200); }).then(s); });
    p.then(function () { busy = false; b.disabled = false; }, function (e) { console.error(e); busy = false; b.disabled = false; });
  });

  // ------------------------------------------------------------------ boot
  reset();
  var q = new URL(location.href).searchParams.get("lang");
  var saved = null; try { saved = localStorage.getItem("hamyad-lang"); } catch (e) {}
  var nav = (navigator.language || "").toLowerCase();
  setLang(q || saved || (nav.indexOf("fa") === 0 ? "fa" : "en"));
})();
