/* hamyad site: i18n (EN/FA, RTL) + live demo running the real hamyad core in the browser. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ------------------------------------------------------------------ i18n
  var FA = {
    "skip": "رفتن به دموی زنده",
    "nav.problem": "مشکل", "nav.demo": "دموی زنده", "nav.how": "چطور کار می‌کند", "nav.setup": "راه‌اندازی", "nav.compare": "مقایسه",
    "hero.kicker": "MIT · سرور MCP · بدون وابستگی",
    "hero.h1": "یک پروژه.<br>یک مغز.<br><em>همه‌ی Claudeها.</em>",
    "hero.lede": "Claude Code، چت Claude.ai و Claude Desktop هرکدام پروژه‌ی شما را روی جزیره‌ی خودشان به خاطر می‌سپارند. <b>هم‌یاد</b> به همه‌شان یک حافظه‌ی مشترک می‌دهد: پوشه‌ی <code>.brain/</code> از فایل‌های Markdown ساده داخل مخزن شما که از طریق MCP سرو می‌شود و گیت‌هاب منبع حقیقت آن است.",
    "hero.cta1": "اجرای دموی زنده", "hero.cta2": "دیدن کد",
    "problem.h": "سه جزیره، بدون هیچ پل",
    "problem.lede": "در چت Claude.ai تصمیمی می‌گیرید و Claude Code هیچ‌وقت خبردار نمی‌شود. Claude Code در یک جلسه چیزی یاد می‌گیرد و چت هرگز آن را نمی‌بیند.",
    "problem.code": "فایل <code>CLAUDE.md</code> که دستی می‌نویسید، به‌علاوه‌ی <em>حافظه‌ی خودکار</em> در <code>~/.claude/projects/…/memory</code>: <b>فقط روی همین کامپیوتر</b>.",
    "problem.chat": "دانش پروژه، دستورالعمل سفارشی و حافظه‌ی جداگانه‌ی هر پروژه، همه داخل Claude.ai. اتصال گیت‌هاب <b>فقط‌خواندنی</b> است و فقط با زدن <i>Sync now</i> به‌روز می‌شود.",
    "problem.desk": "چت‌ها و سرورهای MCP محلی خودش. هیچ‌چیزی که درباره‌ی پروژه یاد می‌گیرد <b>به مخزن</b> برنمی‌گردد.",
    "problem.src": "منابع و بررسی کامل ابزارهای موجود:",
    "demo.h": "چرخه را اجرا کنید",
    "demo.lede": "این همان مغز و سرور MCP واقعی هم‌یاد است که برای اجرا در مرورگر کامپایل شده. جز شبکه هیچ‌چیز ساختگی نیست: هر کار زیر یک فراخوانی واقعی JSON-RPC است و هر کارت همان فایل Markdownی است که در مخزن شما ذخیره می‌شود.",
    "demo.play": "▶ پخش کل داستان", "demo.reset": "از نو", "demo.wire": "نمایش پیام‌های JSON-RPC",
    "demo.chatsub": "چت پروژه · کانکتور هم‌یاد", "demo.termsub": "Claude Code · MCP محلی + هوک‌ها", "demo.ghsub": "main · کامیت‌های .brain/",
    "demo.ph": "یک تصمیم، کار یا یادداشت بنویسید…", "demo.send": "ثبت",
    "demo.tstart": "شروع جلسه", "demo.twork": "Claude کار می‌کند", "demo.texit": "پایان جلسه",
    "demo.wireh": "پیام‌های JSON-RPC", "demo.wiresub": "دقیقاً همان چیزی که Claude و هم‌یاد به هم می‌گویند",
    "how.h": "چطور کار می‌کند",
    "how.1h": "هر Claudeی می‌نویسد", "how.1p": "همان هفت ابزار MCP همه‌جا: <code>brain_remember</code>، <code>brain_search</code>، <code>brain_update</code>، <code>brain_context</code>… Claude.ai از طریق کانکتور راه‌دور و Claude Code و Desktop از طریق stdio به آن‌ها می‌رسند.",
    "how.2h": "گیت نگه می‌دارد", "how.2p": "برای هر مورد یک فایل Markdown زیر <code>.brain/</code>. هر نوشتن از سمت چت، یک کامیت است که یک Cloudflare Worker کوچک از طریق API گیت‌هاب می‌سازد. نام فایل‌ها یکتاست، پس دو نویسنده هیچ‌وقت تداخل ندارند.",
    "how.3h": "Claude Code می‌کشد", "how.3p": "هوک <code>SessionStart</code> مخزن را fast-forward می‌کند، بلوک خودکار <code>CLAUDE.md</code> را تازه می‌کند و دقیقاً می‌گوید از جلسه‌ی قبل در چت چه عوض شده.",
    "how.4h": "جلسه‌ها دست‌به‌دست می‌شوند", "how.4p": "هوک <code>SessionEnd</code> بدون هیچ فراخوانی مدل، از رونوشت جلسه یک خلاصه‌ی کوتاه (درخواست‌ها، فایل‌ها، کامیت‌ها، نتیجه) می‌سازد، کامیت و push می‌کند تا چت از همان‌جا ادامه دهد.",
    "setup.h": "راه‌اندازی در ده دقیقه",
    "setup.code": "داخل مخزن خودتان. <code>init</code> پوشه‌ی <code>.brain/</code> را می‌سازد، سرور MCP را در <code>.mcp.json</code> ثبت می‌کند، دو هوک را با <code>.claude/settings.json</code> ادغام می‌کند و یک بلوک خودکار به <code>CLAUDE.md</code> اضافه می‌کند، بدون دست‌زدن به چیزهایی که از قبل هست.",
    "setup.chat": "Claude.ai از سرورهای Anthropic به کانکتور وصل می‌شود، پس سرور باید عمومی باشد. پلن رایگان Workers کافی است و چون درخواست را Anthropic می‌فرستد، فیلترشدن <code>workers.dev</code> در داخل مهم نیست.",
    "setup.desk": "Claude Desktop همان سرور محلی را روی همان فایل‌ها اجرا می‌کند. Settings ← Developer ← Edit Config:",
    "prom.h": "کارهایی که هم‌یاد هرگز نمی‌کند",
    "prom.1": "بازنویسی تاریخچه‌ی شما. pull فقط fast-forward است.",
    "prom.2": "push کردن کار نیمه‌تمام شما. فقط وقتی push می‌کند که همه‌ی کامیت‌های push‌نشده کامیت <code>brain:</code> باشند.",
    "prom.3": "کامیت‌کردن ویرایش‌های خودتان در <code>CLAUDE.md</code>. فقط بلوک خودکار آن کامیت می‌شود.",
    "prom.4": "اجرای سرور عمومی بدون توکن. Worker و <code>hamyad serve</code> اجازه نمی‌دهند.",
    "prom.5": "قفل‌کردن شما. یک پوشه Markdown است؛ هم‌یاد را پاک کنید، یادداشت‌ها می‌مانند.",
    "cmp.h": "کنار ابزارهای موجود",
    "cmp.r1": "نوشتن از چت به مخزن", "cmp.r2": "داخل مخزن خودتان، قابل بازبینی در PR", "cmp.r3": "هوک‌های Claude Code و CLAUDE.md", "cmp.r4": "جست‌وجوی معنایی", "cmp.r5": "مجوز",
    "cmp.note": "هم‌یاد نمی‌تواند حافظه‌ی داخلی یا دستورالعمل‌های پروژه در Claude.ai را بخواند یا بنویسد، چون API ندارند. کنار آن‌ها به‌عنوان لایه‌ی مشترک و ماندگار می‌نشیند.",
    "faq.h": "پرسش‌ها",
    "faq.q1": "کلید API از Anthropic یا OpenAI لازم دارد؟", "faq.a1": "نه. فکرکردن با Claude در همان اپی است که استفاده می‌کنید؛ هم‌یاد فقط ذخیره و سرو می‌کند. خلاصه‌ی جلسه هم بدون هیچ مدلی از رونوشت ساخته می‌شود.",
    "faq.q2": "در ایران هستم. کانکتور کار می‌کند؟", "faq.a2": "بله. Claude.ai از سرورهای Anthropic به Worker شما وصل می‌شود، نه از دستگاه شما؛ پس فیلترینگ داخلی <code>workers.dev</code> روی آن اثری ندارد. فقط برای یک‌بار دیپلوی ممکن است اینترنت آزاد لازم شود.",
    "faq.q3": "برای تیم چطور؟", "faq.a3": "همه‌ی کسانی که به مخزن دسترسی دارند از طریق گیت در مغز شریک‌اند. برای کانکتور چت، نسخه‌ی ۰٫۱ یک توکن مشترک برای هر دیپلوی دارد؛ OAuth برای هر نفر در نقشه‌ی راه است.",
    "faq.q4": "می‌توانم دستی ویرایش کنم؟", "faq.a4": "بله، در ویرایشگر یا روی github.com. فایل بدون frontmatter هم قبول است: اولین تیتر آن عنوان می‌شود.",
    "foot.by": "ساخته‌ی <a href=\"https://mrzroot.github.io/\">محمدرضا زارع (M-R-Z)</a>. وابسته به Anthropic نیست."
  };
  var EN = {};
  $$("[data-t]").forEach(function (el) { EN[el.getAttribute("data-t")] = el.innerHTML; });
  $$("[data-tp]").forEach(function (el) { EN[el.getAttribute("data-tp")] = el.getAttribute("placeholder"); });

  var S = {
    en: {
      entries: function (n) { return n + (n === 1 ? " entry" : " entries"); },
      empty: "empty drawer: save something",
      chips: [
        { text: "We'll use PostgreSQL, not MySQL: JSONB for the catalogue.", kind: "decision", title: "Use PostgreSQL, not MySQL", body: "JSONB for the product catalogue; the team already runs Postgres. MySQL rejected." },
        { text: "Add SMS login with Kavenegar to the backlog.", kind: "task", title: "SMS login with Kavenegar" },
        { text: "Note: Zarinpal sandbox needs a merchant ID.", kind: "note", title: "Zarinpal sandbox needs a merchant ID", body: "Use any 36-char UUID in sandbox mode." },
        { text: "Where does the project stand?", ask: true }
      ],
      saved: function (k) { return "Saved that as a " + k + " in the project brain. It is a commit on GitHub now, so Claude Code will see it next session."; },
      ask: "Here is the shared brain right now:",
      work: "build the SMS login",
      workNote: "Kavenegar sandbox allows 3 SMS per minute",
      noSession: "start a session first: press `claude`",
      sessionTitle: "Claude Code: build the SMS login",
      notask: "SMS login task"
    },
    fa: {
      entries: function (n) { return n.toLocaleString("fa-IR") + " مورد"; },
      empty: "کشو خالی است: چیزی ثبت کنید",
      chips: [
        { text: "از PostgreSQL استفاده می‌کنیم نه MySQL؛ برای کاتالوگ JSONB لازم داریم.", kind: "decision", title: "PostgreSQL به‌جای MySQL", body: "برای کاتالوگ محصولات JSONB لازم است و تیم از قبل Postgres دارد. MySQL رد شد." },
        { text: "ورود با پیامک کاوه‌نگار را به کارها اضافه کن.", kind: "task", title: "ورود با پیامک کاوه‌نگار" },
        { text: "یادداشت: سندباکس زرین‌پال مرچنت‌کد می‌خواهد.", kind: "note", title: "سندباکس زرین‌پال مرچنت‌کد می‌خواهد", body: "در حالت سندباکس هر UUID سی‌وشش‌کاراکتری کار می‌کند." },
        { text: "پروژه الان در چه وضعی است؟", ask: true }
      ],
      saved: function (k) { return "به‌عنوان " + ({ decision: "تصمیم", task: "کار", note: "یادداشت", context: "زمینه" }[k] || k) + " در مغز پروژه ثبت شد. الان یک کامیت در گیت‌هاب است و Claude Code جلسه‌ی بعد آن را می‌بیند."; },
      ask: "وضعیت فعلی مغز مشترک:",
      work: "ورود با پیامک را بساز",
      workNote: "سندباکس کاوه‌نگار در هر دقیقه ۳ پیامک اجازه می‌دهد",
      noSession: "اول جلسه را شروع کنید: دکمه‌ی `claude`",
      sessionTitle: "Claude Code: ساخت ورود با پیامک",
      notask: "کار ورود با پیامک"
    }
  };

  var lang = "en";
  function setLang(l) {
    lang = l === "fa" ? "fa" : "en";
    var html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "fa" ? "rtl" : "ltr";
    var dict = lang === "fa" ? FA : EN;
    $$("[data-t]").forEach(function (el) { var k = el.getAttribute("data-t"); if (dict[k] != null) el.innerHTML = dict[k]; });
    $$("[data-tp]").forEach(function (el) { var k = el.getAttribute("data-tp"); el.setAttribute("placeholder", lang === "fa" ? FA[k] : EN[k]); });
    try { localStorage.setItem("hamyad-lang", lang); } catch (e) {}
    var u = new URL(location.href);
    if (lang === "fa") u.searchParams.set("lang", "fa"); else u.searchParams.delete("lang");
    history.replaceState(null, "", u);
    renderChips();
    renderBrain();
  }
  $("#lang").addEventListener("click", function () { setLang(lang === "fa" ? "en" : "fa"); });

  // copy buttons
  $$("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = $(b.getAttribute("data-copy")).textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = "✓"; setTimeout(function () { b.textContent = "copy"; }, 1200); }, function () {});
    });
  });

  // tabs
  $$(".tabs [role=tab]").forEach(function (t) {
    t.addEventListener("click", function () {
      $$(".tabs [role=tab]").forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); $("#" + x.getAttribute("data-tab")).hidden = x !== t; });
    });
  });

  // ------------------------------------------------------------------ demo
  var H = window.Hamyad;
  var be, chatSrv, codeSrv, rpcId = 0, t0, tick, lastStart = null, session = false, worked = false, localWrites = 0, busy = false;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function sha() { return Math.random().toString(16).slice(2, 9); }
  function now() { return new Date(t0 + (tick += 60000)); }

  function reset() {
    t0 = Date.parse("2026-10-09T09:00:00Z"); tick = 0; lastStart = null; session = false; worked = false; localWrites = 0; rpcId = 0;
    be = new H.MemoryBackend({ "config.json": JSON.stringify({ project: "shop", briefChars: 1800 }) });
    var origWrite = be.write.bind(be);
    be.write = function (path, content, message) {
      return origWrite(path, content, message).then(function (r) {
        if (/\[claude-chat\]/.test(message)) commit(message, "hamyad-worker", "claude-chat");
        else localWrites++;
        renderBrain();
        return r;
      });
    };
    var opts = function (src) { return { source: src, now: now }; };
    chatSrv = new H.McpServer(new H.Brain(be, opts("claude-chat")), { source: "claude-chat" });
    codeSrv = new H.McpServer(new H.Brain(be, opts("claude-code")), { source: "claude-code" });
    $("#chat-log").innerHTML = "";
    $("#term").innerHTML = '<span class="c"># ~/shop is a git repo with hamyad init done.\n# Press `claude` to start a Claude Code session.</span>\n';
    $("#commits").innerHTML = "";
    $("#wire-log").textContent = "";
    commit("Add hamyad brain (.brain/, .mcp.json, hooks, CLAUDE.md)", "you", "cli");
    renderChips(); renderBrain(); updateTermButtons();
  }

  function commit(msg, who, src) {
    var li = document.createElement("li");
    li.innerHTML = "<code>" + sha() + "</code><span>" + esc(msg) + '</span><span class="who"><i class="dot ' + ({ "claude-chat": "d-chat", "claude-code": "d-code", cli: "d-gh" }[src] || "d-gh") + '"></i> ' + esc(who) + "</span>";
    $("#commits").prepend(li);
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

  function rpc(srv, who, method, params) {
    var req = { jsonrpc: "2.0", id: ++rpcId, method: method };
    if (params) req.params = params;
    wire("→", req, who);
    return srv.handle(req).then(function (res) { wire("←", res, who); return res; });
  }
  function tool(srv, who, name, args) {
    return rpc(srv, who, "tools/call", { name: name, arguments: args }).then(function (r) { return r.result.content[0].text; });
  }

  // --- drawer
  function renderBrain() {
    if (!be) return;
    new H.Brain(be).snapshot().then(function (s) {
      var box = $("#cards");
      box.setAttribute("data-empty", S[lang].empty);
      var known = {};
      $$(".mcard", box).forEach(function (c) { known[c.dataset.id] = c; });
      var frag = document.createDocumentFragment();
      s.entries.forEach(function (e) {
        var c = known[e.id] || document.createElement("button");
        c.type = "button";
        c.className = "mcard" + (e.status === "done" ? " done" : "");
        c.dataset.id = e.id;
        c.innerHTML = '<span class="row"><span class="k k-' + e.kind + '">' + e.kind.toUpperCase() + "</span>" + (e.status ? "<span>[" + esc(e.status) + "]</span>" : "") +
          '<span class="src"><i class="dot ' + ({ "claude-chat": "d-chat", "claude-code": "d-code" }[e.source] || "d-desk") + '"></i>' + esc(e.source) + '</span></span><span class="t" dir="auto">' + esc(e.title) + "</span>";
        c.onclick = function () { openCard(e); };
        frag.appendChild(c);
      });
      box.innerHTML = "";
      box.appendChild(frag);
      $("#brain-count").textContent = S[lang].entries(s.entries.length);
    });
  }
  function openCard(e) {
    $("#dlg-path").textContent = ".brain/" + e.path;
    $("#dlg-body").textContent = H.serializeEntry(e);
    var d = $("#card-dialog");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }

  // --- chat
  function bubble(cls, html) {
    var d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    d.setAttribute("dir", "auto");
    var log = $("#chat-log");
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function chatSay(item) {
    bubble("msg user", esc(item.text));
    if (item.ask) {
      bubble("tool", "<b>brain_context</b> {}");
      return tool(chatSrv, "claude.ai", "brain_context", {}).then(function (txt) {
        bubble("msg claude", esc(S[lang].ask) + '<pre class="brief-pre">' + esc(txt) + "</pre>");
      });
    }
    var args = { kind: item.kind, title: item.title };
    if (item.body) args.body = item.body;
    bubble("tool", "<b>brain_remember</b> " + esc(JSON.stringify(args)));
    return tool(chatSrv, "claude.ai", "brain_remember", args).then(function () { bubble("msg claude", esc(S[lang].saved(item.kind))); });
  }
  function renderChips() {
    var box = $("#chat-chips");
    if (!box) return;
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

  // --- terminal
  function term(html) { var t = $("#term"); t.innerHTML += html + "\n"; t.scrollTop = t.scrollHeight; }
  function updateTermButtons() {
    $("#t-start").disabled = session;
    $("#t-work").disabled = !session;
    $("#t-exit").disabled = !session;
  }
  function startSession() {
    if (session) return Promise.resolve();
    session = true; worked = false; updateTermButtons();
    term('\n<span class="y">$ claude</span>');
    term('<span class="c">● SessionStart hook › hamyad hook session-start</span>');
    return new H.Brain(be).snapshot().then(function (s) {
      var fresh = lastStart ? s.entries.filter(function (e) { return (e.updated || e.created) > lastStart && e.source !== "claude-code"; }) :
        s.entries.filter(function (e) { return e.source !== "claude-code"; });
      var pulled = fresh.length;
      term(pulled ? '<span class="g">  git: fast-forwarded ' + pulled + " commit(s) from origin/main</span>" : '<span class="c">  git: already up to date</span>');
      term('<span class="c">  CLAUDE.md block refreshed (' + s.entries.length + " entries)</span>");
      term('<span class="b">  [hamyad] Shared project brain loaded from .brain/ (' + s.entries.length + " entries).</span>");
      if (fresh.length) {
        term('<span class="b">  New since your last Claude Code session (from Claude chat / Desktop / GitHub):</span>');
        fresh.slice(0, 6).forEach(function (e) { term('<span class="b">  - ' + e.kind + " `" + e.id + "`: " + esc(e.title) + " [" + e.source + "]</span>"); });
      }
      lastStart = now().toISOString();
      return rpc(codeSrv, "claude-code", "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } })
        .then(function () { return rpc(codeSrv, "claude-code", "tools/list"); })
        .then(function (r) { term('<span class="g">✓ MCP server "hamyad" connected · ' + r.result.tools.length + " tools</span>"); });
    });
  }
  function work() {
    if (!session) { term('<span class="o">' + S[lang].noSession + "</span>"); return Promise.resolve(); }
    term('\n<span class="y">&gt; ' + esc(S[lang].work) + "</span>");
    term('<span class="c">⏺ hamyad · brain_search {"query":"sms"}</span>');
    return new H.Brain(be).search(lang === "fa" ? "پیامک" : "sms").then(function (hits) {
      var task = hits.filter(function (e) { return e.kind === "task"; })[0];
      return tool(codeSrv, "claude-code", "brain_search", { query: lang === "fa" ? "پیامک" : "sms" }).then(function (txt) {
        term('<span class="c">  ' + esc(txt.split("\n")[0] || "") + "</span>");
        term('<span class="o">⏺ Write app/sms.py · Edit app/routes.py · Bash pytest -q  ✓ 12 passed</span>');
        var p = task
          ? (term('<span class="c">⏺ hamyad · brain_update {"id":"' + task.id + '","status":"done"}</span>'), tool(codeSrv, "claude-code", "brain_update", { id: task.id, status: "done", append: "Implemented in app/sms.py" }))
          : (term('<span class="c">⏺ hamyad · brain_remember task</span>'), tool(codeSrv, "claude-code", "brain_remember", { kind: "task", title: S[lang].notask, status: "done" }));
        return p.then(function () {
          term('<span class="c">⏺ hamyad · brain_remember {"kind":"note"}</span>');
          return tool(codeSrv, "claude-code", "brain_remember", { kind: "note", title: S[lang].workNote, tags: ["sms"] });
        }).then(function () { worked = true; term('<span class="g">✓ Done. Task marked done, gotcha saved to the shared brain.</span>'); });
      });
    });
  }
  function exitSession() {
    if (!session) return Promise.resolve();
    term('\n<span class="y">&gt; /exit</span>');
    term('<span class="c">● SessionEnd hook › hamyad hook session-end</span>');
    var body = "### Asked\n- " + S[lang].work + (worked ? "\n\n### Files changed\n- `app/routes.py`\n- `app/sms.py`\n\n### Outcome (Claude's last message)\nDone. Task marked done, gotcha saved to the shared brain." : "");
    return new H.Brain(be, { source: "claude-code", now: now }).add({ kind: "session", title: S[lang].sessionTitle, body: body, source: "claude-code" }).then(function (e) {
      term('<span class="g">  logged session ' + e.id + "</span>");
      var n = localWrites; localWrites = 0;
      commit("brain: session summary [claude-code]  (" + n + " file" + (n === 1 ? "" : "s") + ")", "you · hook", "claude-code");
      term('<span class="g">  commit brain: session summary [claude-code]</span>');
      term('<span class="g">  push   1 brain commit(s) → origin/main</span>');
      session = false; updateTermButtons();
    });
  }
  $("#t-start").addEventListener("click", function () { if (!busy) startSession(); });
  $("#t-work").addEventListener("click", function () { if (!busy) work(); });
  $("#t-exit").addEventListener("click", function () { if (!busy) exitSession(); });

  $("#wire-on").addEventListener("change", function (e) { $("#wire").hidden = !e.target.checked; });
  $("#reset").addEventListener("click", function () { if (!busy) reset(); });

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  $("#play").addEventListener("click", function () {
    if (busy) return;
    reset();
    busy = true;
    var b = $("#play"); b.disabled = true;
    var c = S[lang].chips;
    var steps = [
      function () { return chatSay(c[0]); }, function () { return chatSay(c[1]); }, function () { return chatSay(c[2]); },
      startSession, work, exitSession, function () { return chatSay(c[3]); }
    ];
    var p = Promise.resolve();
    steps.forEach(function (s) { p = p.then(function () { return wait(1100); }).then(s); });
    p.then(function () { busy = false; b.disabled = false; }, function (e) { console.error(e); busy = false; b.disabled = false; });
  });

  // ------------------------------------------------------------------ boot
  reset();
  var q = new URL(location.href).searchParams.get("lang");
  var saved = null; try { saved = localStorage.getItem("hamyad-lang"); } catch (e) {}
  var nav = (navigator.language || "").toLowerCase();
  setLang(q || saved || (nav.indexOf("fa") === 0 ? "fa" : "en"));
})();
