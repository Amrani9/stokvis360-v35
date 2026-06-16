/* =========================================================================
 * ticket_table.js — Utilitaires PARTAGÉS des tableaux de tickets.
 *
 * Inclure :  <script src="/static/js/ticket_table.js"></script>
 *            (après api.js — le modal d'annulation s'appuie sur Session)
 *
 * POURQUOI ce fichier : le tri par priorité de statut, les en-têtes triables,
 * la cellule technicien et le modal d'annulation étaient réimplémentés (et
 * divergaient) dans chaque page. La référence visuelle et comportementale est
 * templates/manager/tous_les_tickets.html — toute page de tickets doit déléguer
 * ici pour rester identique.
 *
 * Expose l'objet global TicketTable :
 *   getPriority(t)                   ordre métier d'un statut (1..7, 10 repli)
 *   defaultSort(tickets)             tri par défaut : priorité ASC puis plus ancien d'abord
 *   sortBy(tickets, col, dir)        tri par colonne (id|date|title|client|machine|status|tech)
 *   renderSortHeader(th, col, c, d)  icône ↕/↑/↓ + classe .sorted sur un <th>
 *   renderTechCell(techs)            "Yassine B." + badge "+N tech" si plusieurs
 *   renderStatusBadge(status)        badge HTML coloré d'un statut
 *   openCancelModal(id, recap, onSuccess, opts)   modal riche d'annulation
 *
 * Les tickets passés peuvent venir de l'API (client_name, technicien_ids, techs)
 * ou des adaptateurs locaux des pages (clientName, techIds) : les accesseurs
 * tolèrent les deux formes pour éviter une migration big-bang des pages.
 * ====================================================================== */

(function (global) {
  "use strict";

  /* Palette de statuts — SOURCE UNIQUE consommée par les tableaux ET le popup
     partagé (ticket_detail.js). Valeurs = standard déjà utilisé par le popup,
     les portails client/technicien, gestion_client et gestion_parc. */
  var STATUS_STYLE = {
    "Envoyé":                 { bg: "rgba(143,163,191,0.12)", color: "#58595B" },
    "Assigné":                { bg: "rgba(74,127,181,0.12)",  color: "#4A7FB5" },
    "Attente pièce":          { bg: "#FFF9E6",                color: "#D97706" },
    "En route":               { bg: "#FFFBEB",                color: "#E8A817" },
    "En Réparation":          { bg: "#FEF3F2",                color: "#F04438" },
    "Maintenance à distance": { bg: "#F0FDF4",                color: "#16A34A" },
    "Remplir le rapport":     { bg: "rgba(217,119,6,0.12)",   color: "#D97706" },
    "Terminé":                { bg: "rgba(45,143,94,0.12)",   color: "#2D8F5E" },
    "Annulé":                 { bg: "#F1F5F9",                color: "#64748B" }
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ── Accesseurs tolérants (forme API ou forme adaptateur de page) ── */
  function techList(t) { return t.techs || []; }
  function techIds(t)  { return t.technicien_ids || t.techIds || []; }
  function clientName(t)  { return t.client_name || t.clientName || ""; }
  function machineRef(t)  { return t.machine_ref || t.machineRef || t.reference || ""; }
  function titleStr(t)    { return t.titre || t.titleStr || ""; }
  function timestampOf(t) {
    if (typeof t.timestamp === "number") return t.timestamp;
    if (t.created_at) { try { return new Date(t.created_at).getTime(); } catch (e) {} }
    return 0;
  }
  function techName(tech) {
    if (typeof tech === "string") return tech;
    if (tech.name) return tech.name;
    return ((tech.prenom || "") + " " + (tech.nom || "")).trim();
  }

  /* ── Priorité métier d'un ticket ──
     L'ordre par défaut des tableaux suit le cycle de vie : ce qui demande une
     action du manager d'abord (à assigner), le terminal en bas. */
  function getPriority(t) {
    var s = t.status;
    // Statut DÉRIVÉ du portail technicien (Terminé sans rapport) : action
    // requise -> tout en haut, comme les tickets à assigner côté manager.
    if (s === "Remplir le rapport") return 1;
    if (s === "Terminé") return 6;     // les terminaux priment même sans technicien
    if (s === "Annulé") return 7;
    if (s === "Envoyé" || techIds(t).length === 0) return 1;
    if (s === "Assigné") return 2;
    if (s === "Attente pièce") return 3;
    if (s === "En route") return 4;
    if (s === "En Réparation" || s === "Maintenance à distance") return 5;
    return 10;
  }

  /* Tri par défaut : priorité ASC, puis le plus ANCIEN d'abord au sein d'un
     même statut (le ticket qui attend depuis le plus longtemps remonte). */
  function defaultSort(tickets) {
    return tickets.slice().sort(function (a, b) {
      var pA = getPriority(a), pB = getPriority(b);
      if (pA !== pB) return pA - pB;
      return timestampOf(a) - timestampOf(b);
    });
  }

  /* Tri par colonne. dir : 'asc' | 'desc'. Égalité -> plus ancien d'abord. */
  function sortBy(tickets, col, dir) {
    var mul = dir === "desc" ? -1 : 1;
    return tickets.slice().sort(function (a, b) {
      var vA, vB;
      switch (col) {
        case "id":      vA = a.id; vB = b.id; break;
        case "date":    vA = timestampOf(a); vB = timestampOf(b); break;
        case "title":   vA = titleStr(a).toLowerCase(); vB = titleStr(b).toLowerCase(); break;
        case "client":  vA = clientName(a).toLowerCase(); vB = clientName(b).toLowerCase(); break;
        case "machine": vA = machineRef(a).toLowerCase(); vB = machineRef(b).toLowerCase(); break;
        case "status":
          // Le statut se trie par PRIORITÉ métier, pas par ordre alphabétique.
          vA = getPriority(a); vB = getPriority(b); break;
        case "tech":
          vA = (techList(a)[0] ? techName(techList(a)[0]) : "").toLowerCase();
          vB = (techList(b)[0] ? techName(techList(b)[0]) : "").toLowerCase();
          break;
        default: return timestampOf(a) - timestampOf(b);
      }
      if (vA < vB) return -1 * mul;
      if (vA > vB) return 1 * mul;
      return timestampOf(a) - timestampOf(b);
    });
  }

  /* Met à jour l'icône de tri d'un <th> (↕ neutre, ↑ asc, ↓ desc) et la classe
     .sorted. Crée le <span class="sort-icon"> s'il manque. */
  function renderSortHeader(thEl, col, currentCol, currentDir) {
    if (!thEl) return;
    var icon = thEl.querySelector(".sort-icon");
    if (!icon) {
      icon = document.createElement("span");
      icon.className = "sort-icon";
      thEl.appendChild(document.createTextNode(" "));
      thEl.appendChild(icon);
    }
    if (col === currentCol) {
      thEl.classList.add("sorted");
      icon.textContent = currentDir === "desc" ? "↓" : "↑";
    } else {
      thEl.classList.remove("sorted");
      icon.textContent = "↕";
    }
  }

  /* Cellule technicien : premier technicien (nom abrégé) + badge "+N tech". */
  function renderTechCell(techs) {
    if (!techs || !techs.length) {
      return '<span style="color:#8FA3BF;font-style:italic;">Non assigné</span>';
    }
    var html = '<span>' + esc(techName(techs[0])) + '</span>';
    if (techs.length > 1) {
      html += ' <span style="display:inline-block;background:#F4F6F9;border:1px solid #E2E6EC;' +
              'border-radius:10px;padding:1px 7px;font-size:11px;font-weight:600;color:#4A7FB5;' +
              'white-space:nowrap;">+' + (techs.length - 1) + ' tech</span>';
    }
    return html;
  }

  function renderStatusBadge(status) {
    // "Terminé (Terrain)" / "Terminé (à Distance)" héritent du style de "Terminé".
    var st = STATUS_STYLE[status] || STATUS_STYLE[String(status).split(" (")[0]] ||
             { bg: "#eee", color: "#333" };
    return '<span class="status-badge" style="display:inline-flex;align-items:center;' +
           'padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap;' +
           'background:' + st.bg + ';color:' + st.color + ';">' + esc(status) + '</span>';
  }

  /* Libellé d'affichage d'un ticket : différencie les deux Terminé via termine_via. */
  function displayStatus(t) {
    if (t.status === "Terminé" && t.termine_via) {
      return t.termine_via === "distance" ? "Terminé (à Distance)" : "Terminé (Terrain)";
    }
    return t.status;
  }

  /* ────────────────────────────────────────────────────────────────────────
     MODAL D'ANNULATION (extrait de ticket_detail.js — même apparence)
     Raison obligatoire (radio) + commentaire optionnel. À la confirmation :
     POST /api/ticket/:id/cancel {raison, commentaire, by_role, by_name, by_id}.
     ──────────────────────────────────────────────────────────────────────── */
  var CANCEL_CSS = '\
  .tt-cancel-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:7000;display:flex;\
    align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .22s;\
    font-family:"Inter",system-ui,sans-serif;}\
  .tt-cancel-overlay.vis{opacity:1;pointer-events:auto;}\
  .tt-cancel-box{background:#fff;width:430px;max-width:95vw;border-radius:10px;padding:22px;\
    box-shadow:0 12px 40px rgba(27,58,107,0.16);display:flex;flex-direction:column;gap:14px;\
    transform:scale(0.96);transition:transform .22s;}\
  .tt-cancel-overlay.vis .tt-cancel-box{transform:scale(1);}\
  .tt-cancel-title{font-size:15px;font-weight:700;color:#2D2D2D;}\
  .tt-cancel-recap{background:#F4F6F9;border:1px solid #E2E6EC;border-radius:7px;padding:11px 13px;}\
  .tt-cancel-recap-id{font-size:13px;font-weight:700;color:#1B3A6B;}\
  .tt-cancel-recap-sub{font-size:12px;color:#58595B;margin-top:3px;}\
  .tt-reason-lbl{font-size:11px;font-weight:700;color:#58595B;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:7px;}\
  .tt-reason-opts{display:flex;flex-direction:column;gap:6px;}\
  .tt-reason-opt{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1.5px solid #E2E6EC;\
    border-radius:7px;cursor:pointer;transition:all 200ms ease-in-out;}\
  .tt-reason-opt:hover{border-color:#4A7FB5;}\
  .tt-reason-opt.sel{border-color:#1B3A6B;background:rgba(27,58,107,0.04);}\
  .tt-reason-opt input{accent-color:#1B3A6B;flex-shrink:0;}\
  .tt-reason-opt-lbl{font-size:13px;font-weight:500;color:#2D2D2D;}\
  .tt-cancel-textarea{width:100%;padding:8px 11px;border:1.5px solid #E2E6EC;border-radius:6px;\
    font-size:13px;resize:vertical;min-height:64px;font-family:inherit;transition:border-color 200ms;box-sizing:border-box;outline:none;}\
  .tt-cancel-textarea:focus{border-color:#EF4444;}\
  .tt-cancel-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:4px;}\
  .tt-btn-secondary{display:inline-flex;align-items:center;justify-content:center;height:36px;\
    padding:0 16px;font-size:13px;font-weight:600;border-radius:6px;border:1.5px solid #E2E6EC;\
    cursor:pointer;background:#fff;color:#58595B;transition:all 200ms;font-family:inherit;}\
  .tt-btn-secondary:hover{border-color:#1B3A6B;color:#1B3A6B;}\
  .tt-btn-danger{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;\
    padding:0 16px;font-size:13px;font-weight:600;border-radius:6px;border:none;cursor:pointer;\
    background:#EF4444;color:#fff;transition:background 200ms;font-family:inherit;}\
  .tt-btn-danger:hover{background:#DC2626;}\
  .tt-btn-danger:disabled{opacity:0.55;cursor:not-allowed;}\
  @media(max-width:768px){.tt-cancel-actions{flex-direction:column-reverse;}\
    .tt-cancel-actions button{width:100%;}}';

  var REASONS = ["Doublon", "Problème résolu", "Envoi par erreur", "Autre raison"];
  var _modal = null;
  var _pending = null;   // {ticketId, onSuccess, opts}

  function injectModal() {
    if (_modal) return;
    var st = document.createElement("style");
    st.id = "tt-cancel-style";
    st.textContent = CANCEL_CSS;
    document.head.appendChild(st);

    var ov = document.createElement("div");
    ov.className = "tt-cancel-overlay";
    ov.id = "tt-cancel-overlay";
    ov.innerHTML =
      '<div class="tt-cancel-box" onclick="event.stopPropagation()">' +
        '<div class="tt-cancel-title">Annuler le ticket</div>' +
        '<div class="tt-cancel-recap" id="tt-cancel-recap"></div>' +
        '<div>' +
          '<div class="tt-reason-lbl">Raison <span style="color:#EF4444">*</span></div>' +
          '<div class="tt-reason-opts" id="tt-reason-opts">' +
          REASONS.map(function (r) {
            return '<label class="tt-reason-opt"><input type="radio" name="tt-cr" value="' + esc(r) +
                   '"><span class="tt-reason-opt-lbl">' + esc(r) + '</span></label>';
          }).join("") +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="tt-reason-lbl" style="margin-bottom:5px;">Commentaire ' +
            '<span style="font-weight:400;color:#8FA3BF;text-transform:none;">(optionnel)</span></div>' +
          '<textarea class="tt-cancel-textarea" id="tt-cancel-comment" placeholder="Précisez si nécessaire…"></textarea>' +
        '</div>' +
        '<div class="tt-cancel-actions">' +
          '<button class="tt-btn-secondary" id="tt-cancel-back">Retour</button>' +
          '<button class="tt-btn-danger" id="tt-cancel-confirm" disabled>Confirmer l\'annulation</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    _modal = ov;

    ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(); });
    ov.querySelector("#tt-cancel-back").addEventListener("click", closeModal);
    ov.querySelector("#tt-cancel-confirm").addEventListener("click", confirmCancel);
    ov.querySelectorAll(".tt-reason-opt").forEach(function (opt) {
      opt.addEventListener("click", function () {
        ov.querySelectorAll(".tt-reason-opt").forEach(function (o) { o.classList.remove("sel"); });
        opt.classList.add("sel");
        ov.querySelector("#tt-cancel-confirm").disabled = false;
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("vis")) {
        closeModal();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  function closeModal() {
    if (_modal) _modal.classList.remove("vis");
    _pending = null;
  }

  function _toast(msg, type) {
    if (typeof global.showToast === "function") { global.showToast(msg, type); return; }
    if (type === "error") console.error(msg); else console.log(msg);
  }

  /* Ouvre le modal.
     recap : string (sous-titre libre) OU objet {titre, client_name, reference}.
     opts  : {byRole, byName, byId} — défaut = session courante. */
  function openCancelModal(ticketId, recap, onSuccess, opts) {
    injectModal();
    _pending = { ticketId: ticketId, onSuccess: onSuccess, opts: opts || {} };

    var idLine = esc(ticketId);
    var subLine = "";
    if (recap && typeof recap === "object") {
      if (recap.titre) idLine += " — " + esc(recap.titre);
      subLine = [recap.client_name, recap.reference].filter(Boolean).map(esc).join(" · ");
    } else if (recap) {
      subLine = esc(recap);
    }
    _modal.querySelector("#tt-cancel-recap").innerHTML =
      '<div class="tt-cancel-recap-id">' + idLine + '</div>' +
      (subLine ? '<div class="tt-cancel-recap-sub">' + subLine + '</div>' : "");

    _modal.querySelectorAll(".tt-reason-opt").forEach(function (o) { o.classList.remove("sel"); });
    _modal.querySelectorAll('input[name="tt-cr"]').forEach(function (r) { r.checked = false; });
    _modal.querySelector("#tt-cancel-comment").value = "";
    _modal.querySelector("#tt-cancel-confirm").disabled = true;
    _modal.classList.add("vis");
  }

  function confirmCancel() {
    if (!_pending) return;
    var p = _pending;
    var sel = _modal.querySelector('input[name="tt-cr"]:checked');
    var raison = sel ? sel.value : "Autre raison";
    var commentaire = _modal.querySelector("#tt-cancel-comment").value.trim();
    var S = global.Session;
    var body = {
      raison: raison,
      commentaire: commentaire,
      by_role: p.opts.byRole || (S ? S.role() : "manager"),
      by_name: p.opts.byName || (S ? (S.userName() || "Manager") : "Manager"),
      by_id:   p.opts.byId   || (S && S.role() !== "manager" ? S.userId() : "manager")
    };
    fetch("/api/ticket/" + ticketIdSafe(p.ticketId) + "/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function () {
      _toast("Ticket " + p.ticketId + " annulé.");
      closeModal();
      if (p.onSuccess) p.onSuccess();
    }).catch(function (e) {
      _toast("Échec de l'annulation : " + e.message, "error");
    });
  }

  function ticketIdSafe(id) { return encodeURIComponent(String(id)); }

  global.TicketTable = {
    getPriority: getPriority,
    defaultSort: defaultSort,
    sortBy: sortBy,
    renderSortHeader: renderSortHeader,
    renderTechCell: renderTechCell,
    renderStatusBadge: renderStatusBadge,
    displayStatus: displayStatus,
    openCancelModal: openCancelModal,
    STATUS_STYLE: STATUS_STYLE
  };
})(window);
