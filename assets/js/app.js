/* ============================================================
   CyberBlog — tek dosya uygulama mantığı
   index.html  -> yazı listesi + arama + etiket filtresi
   post.html   -> ?p=slug ile Markdown yazıyı render eder
   ============================================================ */

/* ---------- Tema ---------- */
(function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem("cb-theme"); } catch (e) {}
  if (saved) document.documentElement.setAttribute("data-theme", saved);

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("cb-theme", next); } catch (e) {}
    });
  });
})();

/* ---------- Yardımcılar ---------- */
function trDate(iso) {
  var aylar = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
  var d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.getDate() + " " + aylar[d.getMonth()] + " " + d.getFullYear();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fail(el, msg) {
  el.innerHTML = '<p class="muted">' + esc(msg) + "</p>";
}

document.addEventListener("DOMContentLoaded", function () {
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  if (document.getElementById("postList")) initHome();
  if (document.getElementById("postBody")) initPost();
});

/* ---------- Ana sayfa ---------- */
function initHome() {
  var listEl = document.getElementById("postList");
  var searchEl = document.getElementById("search");
  var tagBarEl = document.getElementById("tagBar");
  var posts = [], activeTag = null;

  fetch("posts/index.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      posts = data.slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
      buildTags();
      render();
    })
    .catch(function () {
      fail(listEl, "Yazılar yüklenemedi. Siteyi dosyaya çift tıklayarak değil, bir yerel sunucu üzerinden açtığından emin ol (README'ye bak).");
    });

  function buildTags() {
    var all = {};
    posts.forEach(function (p) { (p.tags || []).forEach(function (t) { all[t] = (all[t] || 0) + 1; }); });
    var names = Object.keys(all).sort();
    tagBarEl.innerHTML = names.map(function (t) {
      return '<button class="tag" data-tag="' + esc(t) + '">' + esc(t) + " <span class='muted'>" + all[t] + "</span></button>";
    }).join("");
    tagBarEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".tag");
      if (!btn) return;
      var t = btn.dataset.tag;
      activeTag = activeTag === t ? null : t;
      Array.prototype.forEach.call(tagBarEl.children, function (c) {
        c.classList.toggle("active", c.dataset.tag === activeTag);
      });
      render();
    });
  }

  searchEl.addEventListener("input", render);

  function render() {
    var q = searchEl.value.trim().toLowerCase();
    var shown = posts.filter(function (p) {
      var okTag = !activeTag || (p.tags || []).indexOf(activeTag) !== -1;
      var hay = (p.title + " " + (p.summary || "") + " " + (p.tags || []).join(" ")).toLowerCase();
      return okTag && (!q || hay.indexOf(q) !== -1);
    });

    if (!shown.length) { fail(listEl, "Eşleşen yazı bulunamadı."); return; }

    listEl.innerHTML = shown.map(function (p) {
      return (
        '<a class="post-card" href="post.html?p=' + encodeURIComponent(p.slug) + '">' +
          '<div class="post-meta">' + esc(trDate(p.date)) + "</div>" +
          "<h2>" + esc(p.title) + "</h2>" +
          "<p>" + esc(p.summary || "") + "</p>" +
          '<div class="tag-bar small">' +
            (p.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") +
          "</div>" +
        "</a>"
      );
    }).join("");
  }
}

/* ---------- Tek yazı sayfası ---------- */
function initPost() {
  var bodyEl = document.getElementById("postBody");
  var slug = new URLSearchParams(location.search).get("p");
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    document.getElementById("postTitle").textContent = "Yazı bulunamadı";
    fail(bodyEl, "Geçerli bir yazı adresi verilmedi.");
    return;
  }

  Promise.all([
    fetch("posts/index.json", { cache: "no-store" }).then(function (r) { return r.json(); }),
    fetch("posts/" + slug + ".md", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("md yok");
      return r.text();
    })
  ])
    .then(function (res) {
      var meta = (res[0] || []).filter(function (p) { return p.slug === slug; })[0] || {};
      var md = res[1];

      document.title = (meta.title || slug) + " — CyberBlog";
      document.getElementById("postTitle").textContent = meta.title || slug;
      document.getElementById("postDate").textContent = meta.date ? trDate(meta.date) : "";
      var words = md.split(/\s+/).length;
      document.getElementById("postRead").textContent = Math.max(1, Math.round(words / 200)) + " dk okuma";
      document.getElementById("postTags").innerHTML = (meta.tags || [])
        .map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");

      marked.setOptions({ breaks: false, gfm: true });
      bodyEl.innerHTML = DOMPurify.sanitize(marked.parse(md));

      // Kod bloklarını renklendir
      if (window.hljs) {
        bodyEl.querySelectorAll("pre code").forEach(function (block) {
          try { hljs.highlightElement(block); } catch (e) {}
        });
      }
    })
    .catch(function () {
      document.getElementById("postTitle").textContent = "Yazı yüklenemedi";
      fail(bodyEl, "posts/" + slug + ".md bulunamadı ya da site yerel sunucu olmadan açıldı.");
    });
}
