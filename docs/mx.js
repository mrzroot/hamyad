/* mx kit: reveal-on-scroll, cycling how-it-works steps, copy buttons, live release check. No dependencies. */
(function () {
  var d = document.documentElement, RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  d.classList.add('mx-js');
  var fa = function () { return (d.lang || '').slice(0, 2) === 'fa' || d.getAttribute('data-lang') === 'fa'; };
  /* steps: index children, add a progress bar, cycle the highlight while visible */
  var steps = [].slice.call(document.querySelectorAll('.mx-steps'));
  steps.forEach(function (s) {
    var kids = [].slice.call(s.children); kids.forEach(function (k, i) { k.style.setProperty('--i', i); });
    var bar = document.createElement('div'); bar.className = 'mx-prog'; bar.setAttribute('aria-hidden', 'true'); bar.innerHTML = '<i></i>';
    s.parentNode.insertBefore(bar, s);
    var n = 0, timer = null, hover = false;
    function show(i) { kids.forEach(function (k, j) { k.classList.toggle('mx-on', j === i); }); bar.firstChild.style.width = ((i + 1) / kids.length * 100) + '%'; }
    s._mxStart = function () { if (timer || RM) { if (RM) bar.firstChild.style.width = '100%'; return; } show(n); timer = setInterval(function () { if (hover || document.hidden) return; n = (n + 1) % kids.length; show(n); }, 2400); };
    s._mxStop = function () { clearInterval(timer); timer = null; };
    s.addEventListener('mouseenter', function () { hover = true; }); s.addEventListener('mouseleave', function () { hover = false; });
    kids.forEach(function (k, j) { k.addEventListener('mouseenter', function () { n = j; show(j); }); });
  });
  var targets = [].slice.call(document.querySelectorAll('[data-mx],.mx-steps,.mx-one'));
  if (!('IntersectionObserver' in window) || RM) { targets.forEach(function (t) { t.classList.add('mx-in'); t._mxStart && t._mxStart(); }); }
  else {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { var t = e.target; if (e.isIntersecting) { t.classList.add('mx-in'); t._mxStart && t._mxStart(); } else if (t._mxStop) t._mxStop(); }); }, { threshold: 0.18 });
    targets.forEach(function (t) { io.observe(t); });
  }
  /* copy buttons */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-mx-copy]'); if (!b) return;
    var el = document.querySelector(b.getAttribute('data-mx-copy')); if (!el) return;
    var txt = el.textContent.trim(), done = function () { var o = b.innerHTML; b.classList.add('ok'); b.textContent = fa() ? 'کپی شد ✓' : 'Copied ✓'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = o; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done);
    else { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); } catch (x) {} done(); }
  });
  /* release card: the version in the HTML is the real latest release at build time; check GitHub at most every 6 hours for a newer one */
  function fmt(x, iso) { var dt = new Date(iso); if (isNaN(dt)) return; try { x.textContent = dt.toLocaleDateString(x.lang === 'fa' ? 'fa-IR' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tehran' }); } catch (e) {} }
  [].slice.call(document.querySelectorAll('[data-mx-date][data-iso]')).forEach(function (x) { fmt(x, x.getAttribute('data-iso')); });
  [].slice.call(document.querySelectorAll('.mx-rel[data-repo]')).forEach(function (c) {
    var repo = c.getAttribute('data-repo'), K = 'mx-rel-' + repo;
    function put(j) {
      if (!j || !j.tag_name) return;
      var v = c.querySelector('[data-mx-ver]'); if (v && v.textContent.trim() === j.tag_name) return;
      if (v) v.textContent = j.tag_name;
      [].slice.call(c.querySelectorAll('[data-mx-date]')).forEach(function (x) { fmt(x, j.published_at); });
      [].slice.call(c.querySelectorAll('[data-mx-link]')).forEach(function (x) { x.href = j.html_url; });
    }
    try { var cached = JSON.parse(localStorage.getItem(K) || 'null'); if (cached && Date.now() - (cached.at || 0) < 216e5) { put(cached); return; } } catch (x) {}
    if (!window.fetch || !window.AbortController) return;
    var ac = new AbortController(); setTimeout(function () { ac.abort(); }, 4000);
    fetch('https://api.github.com/repos/mrzroot/' + repo + '/releases/latest', { signal: ac.signal, headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (!j) return; var m = { tag_name: j.tag_name, published_at: j.published_at, html_url: j.html_url, at: Date.now() }; try { localStorage.setItem(K, JSON.stringify(m)); } catch (x) {} put(m); })
      .catch(function () { /* offline or rate-limited: keep the built-in version */ });
  });
})();
