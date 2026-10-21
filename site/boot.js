/* Runs before first paint: picks the language and turns on print motion. External because the site's CSP allows no inline script. */
(function () {
  var root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");
  try {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) root.classList.add("motion");
  } catch (e) {}
  var lang = "";
  try {
    var q = new URLSearchParams(location.search).get("lang");
    if (q === "en" || q === "zh") lang = q;
    if (!lang) lang = localStorage.getItem("gp-lang") || "";
  } catch (e) {}
  if (!lang) lang = /^zh\b/i.test(navigator.language || "") ? "zh" : "en";
  root.setAttribute("data-lang", lang);
  if (lang === "en") root.classList.add("lang-pending");
  setTimeout(function () { root.classList.remove("lang-pending"); }, 900);
  // If the page script never arrives, nothing may stay unprinted.
  setTimeout(function () { if (!window.__gpReady) root.classList.remove("motion"); }, 4000);
})();
