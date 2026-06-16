/* =========================================================================
 * responsive.js — Tiroir latéral mobile (hamburger) pour TOUS les portails.
 *
 * Inclure avec /static/css/responsive.css :
 *     <link rel="stylesheet" href="/static/css/responsive.css">
 *     <script src="/static/js/responsive.js"></script>
 *
 * POURQUOI : sous 768px la sidebar est cachée (transform) ; ce script injecte
 * le bouton ☰ dans la topbar et le backdrop, et gère ouverture/fermeture.
 * Aucun état persistant : tout est recalculé au chargement de chaque page.
 * ====================================================================== */

(function () {
  "use strict";

  function init() {
    var topbar = document.querySelector(".topbar");
    var sidebar = document.querySelector(".sidebar");
    if (!topbar || !sidebar) return;
    if (document.getElementById("sidebar-toggle")) return;

    var btn = document.createElement("button");
    btn.id = "sidebar-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Ouvrir le menu");
    btn.innerHTML = "☰";
    topbar.insertBefore(btn, topbar.firstChild);

    var backdrop = document.createElement("div");
    backdrop.id = "sidebar-backdrop";
    document.body.appendChild(backdrop);

    function close() {
      sidebar.classList.remove("drawer-open");
      backdrop.classList.remove("vis");
    }
    function toggle() {
      var open = sidebar.classList.toggle("drawer-open");
      backdrop.classList.toggle("vis", open);
    }

    btn.addEventListener("click", toggle);
    backdrop.addEventListener("click", close);
    // Navigation = fermeture (les gardes de navigation des pages, ex. catalogue,
    // restent prioritaires : elles écoutent aussi le clic et peuvent l'annuler).
    sidebar.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", close);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 768) close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
