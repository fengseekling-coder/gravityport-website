/* Runs before first paint: picks the language and turns on print motion. External because the site's CSP allows no inline script. */
(function () {
  /* The home page has one URL per language: "/" is Chinese, "/en/" is English.
     A page only moves when the visitor asked for the other language: ?lang= in the URL, or a
     choice saved by the toggle. The browser language never redirects, because search engines
     render with an English browser and would then see "/" as a redirect and drop it from the
     index. A browser in the other language gets a hint bar instead (suggest below).
     Pure so the tests can run it: returns null to stay, or the URL to replace this one with. */
  var HOME = { zh: "/", en: "/en/" };
  function route(pageLang, search, hash, saved) {
    var params = new URLSearchParams(search || "");
    var asked = params.get("lang");
    if (asked !== "en" && asked !== "zh") asked = "";
    var want = pageLang;
    if (asked) want = asked;
    else if (pageLang === "zh" && saved === "en") want = "en";
    if (want === pageLang) return null;
    params.delete("lang");
    var query = params.toString();
    return HOME[want] + (query ? "?" + query : "") + (hash || "");
  }
  /* Which language to offer in the hint bar on a home page, or null for none: only when the
     visitor has not chosen yet and the browser reads the other language. */
  function suggest(pageLang, saved, browserLang) {
    if (pageLang !== "zh" && pageLang !== "en") return null;
    if (saved === "en" || saved === "zh") return null;
    var browser = /^zh\b/i.test(browserLang || "") ? "zh" : "en";
    return browser === pageLang ? null : browser;
  }
  window.__gpLangSuggest = suggest;
  window.__gpLangRoute = route;

  var root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");
  try {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) root.classList.add("motion");
  } catch (e) {}
  var pageLang = root.getAttribute("data-page-lang");
  var lang = "";
  var saved = "";
  try { saved = localStorage.getItem("gp-lang") || ""; } catch (e) {}
  if (pageLang === "zh" || pageLang === "en") {
    var next = null;
    try { next = route(pageLang, location.search, location.hash, saved); } catch (e) {}
    if (next) {
      location.replace(next);
      return;
    }
    lang = pageLang;
  } else {
    // Pages without a language of their own (the privacy page) switch in place.
    try {
      var q = new URLSearchParams(location.search).get("lang");
      if (q === "en" || q === "zh") lang = q;
    } catch (e) {}
    if (!lang) lang = saved === "en" || saved === "zh" ? saved : "";
    if (!lang) lang = /^zh\b/i.test(navigator.language || "") ? "zh" : "en";
  }
  root.setAttribute("data-lang", lang);
  if (lang === "en") root.classList.add("lang-pending");
  setTimeout(function () { root.classList.remove("lang-pending"); }, 900);
  // If the page script never arrives, nothing may stay unprinted.
  setTimeout(function () { if (!window.__gpReady) root.classList.remove("motion"); }, 4000);
})();
