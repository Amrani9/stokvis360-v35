/* =========================================================================
 * api.js — Couche d'accès unique à l'API Stokvis 360.
 *
 * Toutes les pages des 3 portails importent ce fichier :
 *     <script src="/static/js/api.js"></script>
 *
 * Il expose deux objets globaux :
 *   - Session : qui suis-je ? (rôle + identifiant), persisté dans localStorage.
 *   - API     : méthodes async qui parlent à /api/... (renvoient du JSON).
 *
 * Les pages remplacent leurs tableaux de données factices par un appel
 * API.bootstrap() et routent leurs actions (assignation, statut, annulation,
 * rapport, évaluation, chat) vers les méthodes correspondantes.
 * ====================================================================== */

(function (global) {
  "use strict";

  // -----------------------------------------------------------------------
  // Session : rôle + utilisateur courant (choisi sur la page de connexion)
  // -----------------------------------------------------------------------
  const KEY = "stokvis_session";

  const Session = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(KEY)) || null;
      } catch (e) {
        return null;
      }
    },
    set(role, userId, userName) {
      localStorage.setItem(KEY, JSON.stringify({
        role: role, user_id: userId || null, user_name: userName || null
      }));
    },
    clear() {
      localStorage.removeItem(KEY);
    },
    /* Redirige vers la page de connexion si aucune session (sauf rôle attendu). */
    require(expectedRole) {
      const s = Session.get();
      if (!s) { global.location.href = "/"; return null; }
      if (expectedRole && s.role !== expectedRole) { global.location.href = "/"; return null; }
      return s;
    },
    role() { const s = Session.get(); return s ? s.role : "manager"; },
    userId() { const s = Session.get(); return s ? s.user_id : null; },
    userName() { const s = Session.get(); return s ? s.user_name : null; }
  };

  // -----------------------------------------------------------------------
  // Requête HTTP générique
  // -----------------------------------------------------------------------
  async function req(method, url, body) {
    const opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch (e) {}
      throw new Error("HTTP " + res.status + (detail ? " — " + detail : "") + " (" + url + ")");
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function qs(params) {
    const parts = [];
    Object.keys(params).forEach(function (k) {
      if (params[k] !== null && params[k] !== undefined && params[k] !== "") {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  // -----------------------------------------------------------------------
  // API
  // -----------------------------------------------------------------------
  const API = {
    // --- Lecture globale ---
    health() { return req("GET", "/api/health"); },

    /* Validation de connexion côté serveur : bloque les comptes archivés (401). */
    login(role, userId) {
      return req("POST", "/api/login", { role: role, user_id: userId || null });
    },

    /* Tout ce dont le portail courant a besoin en un seul appel. */
    bootstrap() {
      return req("GET", "/api/bootstrap" + qs({ role: Session.role(), user_id: Session.userId() }));
    },

    /* Tickets filtrés selon le rôle courant (pour le polling temps réel). */
    tickets() {
      return req("GET", "/api/tickets" + qs({ role: Session.role(), user_id: Session.userId() }));
    },
    ticket(id) {
      return req("GET", "/api/ticket/" + id + qs({ role: Session.role() }));
    },

    // --- Tickets : écriture ---
    createTicket(payload) { return req("POST", "/api/tickets", payload); },

    /* Définit la liste complète des techniciens (auto-save assignation). */
    assign(id, technicienIds) {
      return req("POST", "/api/ticket/" + id + "/assign", { technicien_ids: technicienIds });
    },

    /* L'ID acteur ("manager" littéral pour le manager, sans entité dédiée) permet
       au serveur de résoudre le nom COURANT dans timeline/chat (cf. enrich_ticket). */
    actorId() {
      return Session.role() === "manager" ? "manager" : Session.userId();
    },

    /* via : "terrain" | "distance" — quel Terminé a été cliqué (différenciation
       des deux chemins, stockée en base dans ticket.termine_via). */
    changeStatus(id, status, actorName, actorRole, via) {
      const body = {
        status: status,
        actor_name: actorName || Session.userName() || "Manager",
        actor_role: actorRole || Session.role(),
        actor_id: API.actorId()
      };
      if (via) body.via = via;
      return req("POST", "/api/ticket/" + id + "/status", body);
    },

    cancel(id, raison, commentaire) {
      return req("POST", "/api/ticket/" + id + "/cancel", {
        raison: raison, commentaire: commentaire || "",
        by_role: Session.role(), by_name: Session.userName() || "Manager",
        by_id: API.actorId()
      });
    },

    submitReport(id, payload) {
      payload = payload || {};
      if (!payload.submitted_by) payload.submitted_by = Session.userName() || "Technicien";
      return req("POST", "/api/ticket/" + id + "/report", payload);
    },

    submitEvaluation(id, note, commentaire) {
      return req("POST", "/api/ticket/" + id + "/evaluation", { note: note, commentaire: commentaire || "" });
    },

    postMessage(id, content, type, image, fileUrl, fileName, fileType) {
      const body = {
        author_role: Session.role(),
        author_name: Session.userName() || (Session.role() === "manager" ? "Manager" : "Utilisateur"),
        author_id: API.actorId(),
        content: content, type: type || "text"
      };
      if (image)   body.image     = image;
      if (fileUrl) { body.file_url = fileUrl; body.file_name = fileName || "fichier"; body.file_type = fileType || "file"; }
      return req("POST", "/api/ticket/" + id + "/messages", body);
    },

    upload(file) {
      const fd = new FormData();
      fd.append("file", file);
      return fetch("/api/upload", { method: "POST", body: fd }).then(function (res) {
        if (!res.ok) throw new Error("Upload échoué (" + res.status + ")");
        return res.json();
      });
    },

    // --- Clients ---
    clients() { return req("GET", "/api/clients"); },
    createClient(payload) { return req("POST", "/api/clients", payload); },
    updateClient(id, payload) { return req("PUT", "/api/client/" + id, payload); },
    archiveClient(id, archived) {
      return req("POST", "/api/client/" + id + "/archive", { archived: archived !== false });
    },

    // --- Techniciens ---
    techniciens(includeArchived) {
      return req("GET", "/api/techniciens" + qs({ include_archived: includeArchived === false ? "false" : "true" }));
    },
    createTechnicien(payload) { return req("POST", "/api/techniciens", payload); },
    updateTechnicien(id, payload) { return req("PUT", "/api/technicien/" + id, payload); },
    shift(id, disponibilite) {
      return req("POST", "/api/technicien/" + id + "/shift", { disponibilite: disponibilite });
    },

    // --- Parc ---
    parc() { return req("GET", "/api/parc"); },
    createMachine(payload) { return req("POST", "/api/parc", payload); },
    updateMachine(instanceId, payload) { return req("PUT", "/api/machine/" + instanceId, payload); },
    usageTimeline(instanceId) {
      return req("GET", "/api/machine/" + encodeURIComponent(instanceId) + "/usage_timeline");
    },

    // --- Catalogue ---
    catalogue() { return req("GET", "/api/catalogue"); },
    saveCatalogue(tree) { return req("PUT", "/api/catalogue", tree); },
    checklist(reference) {
      return req("GET", "/api/catalogue/checklist" + qs({ reference: reference }));
    }
  };

  // -----------------------------------------------------------------------
  // Polling temps réel : appelle fn(tickets) toutes les `ms` millisecondes.
  // Renvoie une fonction stop().
  // -----------------------------------------------------------------------
  API.poll = function (fn, ms) {
    ms = ms || 4000;
    let stopped = false;
    async function tick() {
      if (stopped) return;
      try { fn(await API.tickets()); } catch (e) { /* silencieux : réseau */ }
      if (!stopped) setTimeout(tick, ms);
    }
    setTimeout(tick, ms);
    return function stop() { stopped = true; };
  };

  global.Session = Session;
  global.API = API;
})(window);