"""
app.py — Serveur Flask de Stokvis 360.

UN seul processus sert :
  - les pages HTML (templates/) pour les 3 portails,
  - une API JSON (/api/...) consommée par le JavaScript de ces pages.

Toutes les RÈGLES MÉTIER vivent ici (et nulle part ailleurs), pour qu'elles soient
écrites une seule fois et appliquées de la même façon aux 3 portails :
  - génération des identifiants (T-XXXX, C-0001, TECH-0001)
  - génération du titre depuis les pannes cochées
  - auto-statut : 1er technicien assigné -> Assigné ; dernier retiré -> Envoyé
  - items du ticket = uniquement pannes cochées + champs renseignés
  - gel du temps de résolution à l'instant du clic "Terminé"
  - validation du flux (2 chemins unidirectionnels + Annulé terminal)
  - traçabilité : entrées de timeline + messages système dans le chat
  - compteurs CALCULÉS (tickets actifs/résolus, note moyenne...) jamais stockés

"Remplir le rapport" n'est JAMAIS un statut stocké : il est dérivé côté technicien
quand status == "Terminé" et report is None.

Lancer :  python app.py   puis ouvrir http://127.0.0.1:5001
"""

import os
import uuid
from datetime import datetime
from flask import (Flask, jsonify, request, render_template,
                   send_from_directory, abort)
from werkzeug.exceptions import HTTPException

import db
from constants import (
    ENVOYE, ASSIGNE, ATTENTE, EN_ROUTE, EN_REPARATION, DISTANCE, TERMINE, ANNULE,
    PATH_TERRAIN, PATH_DISTANCE, gen_title,
)

app = Flask(__name__, template_folder="templates", static_folder="static")


@app.errorhandler(HTTPException)
def _json_api_errors(e):
    """Contrat d'erreur unique pour l'API : tout abort()/exception HTTP sous
    /api/ renvoie le même JSON {"error": ...} que les endpoints utilisant déjà
    jsonify, pour que le front affiche le message FR au lieu de
    « HTTP 409 — (/api/…) ». Les pages HTML gardent l'erreur Werkzeug par défaut."""
    if request.path.startswith("/api/"):
        return jsonify({"error": e.description}), e.code
    return e

TERMINAL_STATUSES = {TERMINE, ANNULE}
ACTIVE_STATUSES = {ENVOYE, ASSIGNE, ATTENTE, EN_ROUTE, EN_REPARATION, DISTANCE}

# Statuts qui ENGAGENT un ticket dans un chemin (Envoyé/Assigné sont communs).
TERRAIN_ONLY = {ATTENTE, EN_ROUTE, EN_REPARATION}

# Les deux "Terminé" sont différenciés EN BASE via ticket["termine_via"]
# ("terrain" | "distance") pour que le futur dashboard les suive séparément.
TERMINE_VIA_LABELS = {"terrain": "Terminé (Terrain)", "distance": "Terminé (à Distance)"}

ROLE_LABELS = {"technicien": "Technicien", "client": "Client", "manager": "Manager"}

# Nom d'affichage du manager (compte unique pour l'instant). Quand les comptes
# manager nommés arriveront, ce placeholder sera remplacé par la résolution
# d'une vraie entité — le format "Nom (Manager)" restera identique.
MANAGER_DISPLAY_NAME = "Faouzi Lakjaa"


def current_path(status):
    """Chemin dans lequel le ticket est ENGAGÉ ('terrain'/'distance'),
    ou None si le statut est commun aux deux chemins (Envoyé/Assigné)."""
    if status in TERRAIN_ONLY:
        return "terrain"
    if status == DISTANCE:
        return "distance"
    return None


def termine_label(via):
    """Libellé affiché d'un Terminé selon son chemin ('Terminé' si inconnu)."""
    return TERMINE_VIA_LABELS.get(via, TERMINE)


def actor_display_name(name, role):
    """'Mehdi Mdhi (Technicien)' — toujours Nom (Rôle) quand les deux existent."""
    label = ROLE_LABELS.get(role)
    if not label or not name or name == label:
        return name or label or "Système"
    return "{} ({})".format(name, label)


def manager_display():
    """'Faouzi Lakjaa (Manager)' — affichage de l'acteur manager."""
    return actor_display_name(MANAGER_DISPLAY_NAME, "manager")


# ===========================================================================
# RÈGLES MÉTIER (fonctions pures, réutilisées par les handlers)
# ===========================================================================
def now_iso():
    return datetime.now().replace(microsecond=0).isoformat()


def sanitize_usage_value(raw):
    """Garde uniquement les chiffres et UN séparateur décimal (',' ou '.').
    'abc12 000,50x' -> '12000,50'. Renvoie '' si rien d'exploitable."""
    s = str(raw or "")
    out = []
    sep_used = False
    for ch in s:
        if ch.isdigit():
            out.append(ch)
        elif ch in ".," and not sep_used and out:
            out.append(ch)
            sep_used = True
    return "".join(out)


def clean_usage_readings(raw_list):
    """Normalise les relevés d'usage envoyés par le front :
    liste de {name, unit, value}. On ignore les valeurs vides et les unités N/A."""
    cleaned = []
    for r in (raw_list or []):
        unit = (r.get("unit") or "").strip()
        if unit.upper() in ("N/A", "NA"):
            continue
        value = sanitize_usage_value(r.get("value"))
        if not value:
            continue
        cleaned.append({
            "name": (r.get("name") or "").strip(),
            "unit": unit,
            "value": value,
        })
    return cleaned


def is_normal_transition(current, target):
    """True si target est le successeur immédiat de current dans l'UN des deux chemins.
    Sinon (recul, saut, changement de chemin) -> transition 'inhabituelle' (autorisée
    mais marquée ⚠)."""
    for path in (PATH_TERRAIN, PATH_DISTANCE):
        if current in path:
            i = path.index(current)
            if i + 1 < len(path) and path[i + 1] == target:
                return True
    return False


def add_timeline(ticket, status, actor, unusual=False, extra=None, actor_id=None):
    entry = {"status": status, "timestamp": now_iso(), "actor": actor, "unusual": unusual}
    # actor_id permet de résoudre le NOM COURANT à l'affichage (renommage d'un
    # technicien / d'un client répercuté partout). Le nom stocké sert de repli.
    if actor_id:
        entry["actor_id"] = actor_id
    if extra:
        entry.update(extra)
    ticket["timeline"].append(entry)


def append_message(ticket, **fields):
    """Ajoute un message au chat d'un ticket ; génère son id via db.next_message_id."""
    msg = {"id": db.next_message_id(None, ticket)}
    msg.update(fields)
    ticket["messages"].append(msg)
    return msg


def add_system_message(ticket, content, color="blue", mtype="system_status"):
    append_message(ticket,
                   author_role="system", author_name="Système",
                   type=mtype, color=color, content=content, timestamp=now_iso())


def tech_names(DB, tech_ids):
    """Noms complets COURANTS d'une liste de techniciens (ids inconnus ignorés)."""
    names = []
    for tid in tech_ids:
        tech = db.get_technicien(DB, tid)
        if tech:
            names.append("{} {}".format(tech.get("prenom", ""), tech.get("nom", "")).strip())
    return names


def tech_display_names(DB, tech_ids):
    """Mêmes noms, au format d'affichage 'Nom (Technicien)'."""
    return [actor_display_name(n, "technicien") for n in tech_names(DB, tech_ids)]


def apply_auto_status_on_assignment(DB, ticket):
    """1er technicien assigné à un ticket Envoyé -> Assigné.
    Dernier technicien retiré d'un ticket Assigné -> Envoyé.
    Renvoie le nouveau statut s'il a changé, sinon None."""
    has_techs = len(ticket["technicien_ids"]) > 0
    if ticket["status"] == ENVOYE and has_techs:
        ticket["status"] = ASSIGNE
        # Pas d'entité manager pour l'instant : "manager" est un ID littéral.
        # assigned_to_ids -> "Assigné à X" résolu EN DIRECT à l'affichage.
        add_timeline(ticket, ASSIGNE, "Manager", actor_id="manager",
                     extra={"assigned_to_ids": list(ticket["technicien_ids"])})
        add_system_message(ticket, "Statut mis à jour : Assigné à {} (par {})".format(
            ", ".join(tech_display_names(DB, ticket["technicien_ids"])), manager_display()))
        return ASSIGNE
    if ticket["status"] == ASSIGNE and not has_techs:
        ticket["status"] = ENVOYE
        # Pas d'entrée timeline ici : le retour à "Envoyé" est implicite.
        # L'entrée "Technicien retiré" ajoutée juste après par assign_ticket
        # suffit à comprendre l'historique — une 2e entrée "Envoyé" semblait
        # indiquer que le client avait renvoyé le ticket, ce qui était trompeur.
        add_system_message(ticket, "Tous les techniciens retirés — retour au statut Envoyé", color="blue")
        return ENVOYE
    return None


def derived_status_for_role(ticket, role):
    """Statut tel que VU par chaque rôle.
    Technicien : 'Terminé' sans rapport -> 'Remplir le rapport'.
    Manager / Client : toujours le statut réel."""
    if role == "technicien" and ticket["status"] == TERMINE and ticket.get("report") is None:
        return "Remplir le rapport"
    return ticket["status"]


# ===========================================================================
# ENRICHISSEMENT (sérialisation pour le front)
# ===========================================================================
def fmt_date_parts(created_at):
    dt = datetime.fromisoformat(created_at)
    return {
        "date": dt.strftime("%d/%m/%Y"),
        "time": dt.strftime("%H:%M"),
        "timestamp": int(dt.timestamp() * 1000),
    }


def tech_brief(tech):
    """Représentation légère d'un technicien (utilisée dans les tickets)."""
    return {
        "id": tech["id"],
        "prenom": tech["prenom"],
        "nom": tech["nom"],
        "name": "{} {}".format(tech["prenom"], tech["nom"] if tech["nom"] else "").strip(),
        "telephone": tech["telephone"],
        "disponibilite": tech["disponibilite"],
        "archived": tech["archived"],
    }


def live_actor(DB, actor_id, fallback):
    """(nom COURANT, rôle) d'un acteur de timeline/chat à partir de son ID stocké.
    Renommer un technicien ou un client se répercute ainsi dans tout l'historique.
    Sans ID (anciennes entrées, 'Système') -> (texte stocké, None)."""
    if not actor_id:
        # Anciennes entrées sans ID : "Manager" stocké = l'acteur manager.
        if fallback == "Manager":
            return MANAGER_DISPLAY_NAME, "manager"
        return fallback, None
    if actor_id == "manager":
        return MANAGER_DISPLAY_NAME, "manager"  # compte manager unique (placeholder nommé)
    tech = db.get_technicien(DB, actor_id)
    if tech:
        name = "{} {}".format(tech.get("prenom", ""), tech.get("nom", "")).strip()
        return (name or fallback), "technicien"
    client = db.get_client(DB, actor_id)
    if client:
        return (client.get("raison_sociale") or fallback), "client"
    return fallback, None


def live_actor_name(DB, actor_id, fallback):
    return live_actor(DB, actor_id, fallback)[0]


def enrich_ticket(DB, ticket, role="manager"):
    client = db.get_client(DB, ticket["client_id"]) or {}
    machine = db.get_machine(DB, ticket["instance_id"]) or {}
    techs = [tech_brief(t) for t in (db.get_technicien(DB, tid) for tid in ticket["technicien_ids"]) if t]
    out = dict(ticket)
    # Timeline et chat : noms résolus EN DIRECT via actor_id / author_id.
    # actor_display = "Nom (Rôle)" ; assigned_to = noms courants des techniciens
    # de l'entrée "Assigné à X".
    timeline = []
    for e in ticket.get("timeline", []):
        name, actor_role = live_actor(DB, e.get("actor_id"), e.get("actor", "Système"))
        view = dict(e, actor=name, actor_display=actor_display_name(name, actor_role))
        if e.get("assigned_to_ids"):
            # Format d'affichage direct : "Assigné à Mehdi Alaoui (Technicien)".
            view["assigned_to"] = tech_display_names(DB, e["assigned_to_ids"])
        if e.get("status") == TERMINE and e.get("via"):
            view["status_label"] = termine_label(e["via"])
        timeline.append(view)
    out["timeline"] = timeline
    out["messages"] = [
        dict(m, author_name=live_actor_name(DB, m.get("author_id"), m.get("author_name", "")))
        for m in ticket.get("messages", [])
    ]
    out.update(fmt_date_parts(ticket["created_at"]))
    out["client_name"] = client.get("raison_sociale", "Inconnu")
    out["client_telephone"] = client.get("telephone", "")
    # Référence / pôle / marque / catégorie résolus EN DIRECT via le node_id stable :
    # un renommage dans le catalogue s'affiche partout (listes, détail, PDF généré).
    # Les valeurs stockées sur le ticket servent de repli (et de trace historique).
    node_id = ticket.get("node_id") or machine.get("node_id")
    ref, pole, marque, categorie = catalogue_path_for_node(DB, node_id)
    out["reference"] = ref or ticket.get("reference")
    out["pole"] = pole or ticket.get("pole")
    out["marque"] = marque or ticket.get("marque")
    out["categorie"] = categorie or ticket.get("categorie")
    out["machine_ref"] = out["reference"] or "N/A"
    out["parc_id"] = parc_label(DB, machine) if machine else ticket.get("instance_id")
    out["techs"] = techs
    # termine_via différencie les deux Terminé ; le LIBELLÉ est composé côté
    # front au niveau des badges (status/status_display restent des valeurs
    # canoniques sur lesquelles les pages filtrent et comparent).
    out["termine_via"] = ticket.get("termine_via")
    out["status_display"] = derived_status_for_role(ticket, role)
    # Titres — DEUX valeurs distinctes :
    #  • `titre_original` : toujours dérivé des pannes cochées par le client à
    #    l'ouverture. Trace de ce que le client a déclaré ; affiché tel quel dans
    #    « Informations du ticket » du popup (JAMAIS écrasé par le rapport).
    #  • `titre` : le titre du rapport saisi par le technicien (s'il existe) prime
    #    et remplace PARTOUT ailleurs (listes, cartes, tri, recherche, recaps).
    #    Aucun champ dédié n'est stocké : le rapport EST la source du titre, donc
    #    un rapport déjà saisi (seed ou via l'UI) propage son titre sans migration.
    out["titre_original"] = gen_title(ticket["items"])
    report = ticket.get("report")
    report_title = (report.get("titre_intervention") or "").strip() if report else ""
    out["titre"] = report_title or out["titre_original"]
    # Pièces de rechange utilisées : résolues EN DIRECT depuis le répertoire de la
    # référence (node_id). Le N° Pièce n'est JAMAIS transmis au client.
    is_client = role == "client"
    available_parts = spare_parts_for_node(DB, node_id)
    if out.get("report"):
        rpt = dict(out["report"])  # copie : ne pas muter le rapport stocké
        rpt["used_parts"] = resolve_used_parts(
            available_parts, out["report"].get("used_parts", []), include_num=not is_client)
        out["report"] = rpt
    # Données pour le menu déroulant de saisie (technicien uniquement).
    if role == "technicien":
        out["available_parts"] = [
            {"piece_id": p.get("id"), "num": p.get("num", ""), "name": p.get("name", "")}
            for p in available_parts]
    return out


def tech_stats(DB, tech_id):
    """Compteurs CALCULÉS pour un technicien (jamais stockés)."""
    active = resolved = 0
    res_times = []
    notes = []
    for t in DB["tickets"]:
        if tech_id not in t["technicien_ids"]:
            continue
        if t["status"] in ACTIVE_STATUSES:
            active += 1
        elif t["status"] == TERMINE:
            resolved += 1
            if t.get("resolution_time_ms"):
                res_times.append(t["resolution_time_ms"])
            if t.get("evaluation") and t["evaluation"].get("note"):
                notes.append(t["evaluation"]["note"])
    return {
        "active_tickets": active,
        "resolved_count": resolved,
        "avg_rating": round(sum(notes) / len(notes), 1) if notes else None,
        "avg_resolution_ms": int(sum(res_times) / len(res_times)) if res_times else None,
    }


def enrich_technicien(DB, tech):
    out = dict(tech)
    out.update(tech_stats(DB, tech["id"]))
    return out


def enrich_client(DB, client):
    out = dict(client)
    out["archived"] = client.get("archived", False)
    out["machine_count"] = sum(1 for m in DB["parc"] if m["assignation"] == client["id"])
    out["ticket_count"] = sum(1 for t in DB["tickets"] if t["client_id"] == client["id"])
    return out


def enrich_machine(DB, machine):
    """Ajoute `last_usage` (CALCULÉ, jamais stocké) : le dernier relevé d'usage envoyé
    pour cette instance machine, c.-à-d. les `usage_readings` du ticket le plus récent
    (par created_at) qui en porte. Renvoie None si aucun ticket n'a de relevé."""
    out = dict(machine)
    # reference/pole/marque/categorie ne sont PAS stockés sur la machine : résolus en
    # direct depuis le catalogue via node_id (le renommage se répercute partout).
    ref, pole, marque, categorie = catalogue_path_for_node(DB, machine.get("node_id"))
    out["reference"] = ref
    out["pole"] = pole
    out["marque"] = marque
    out["categorie"] = categorie
    out["parc_id"] = parc_label(DB, machine)  # étiquette affichée (suit les renommages si auto)
    latest = None
    for t in DB["tickets"]:
        if t.get("instance_id") != machine["instance_id"]:
            continue
        if not t.get("usage_readings"):
            continue
        if latest is None or t["created_at"] > latest["created_at"]:
            latest = t
    if latest:
        parts = fmt_date_parts(latest["created_at"])
        out["last_usage"] = {
            "readings": latest["usage_readings"],
            "date": parts["date"],
            "ticket_id": latest["id"],
        }
    else:
        out["last_usage"] = None
    return out


# ---------------------------------------------------------------------------
# Résolution catalogue par IDENTIFIANT STABLE (node_id)
# ---------------------------------------------------------------------------
# Les machines et tickets ne stockent PAS le nom de la référence comme lien : ils
# portent un `node_id` (la clé stable du nœud niveau 4 du catalogue, ex. "pc200").
# Le nom (référence) ainsi que le pôle / la marque / la catégorie sont résolus EN
# DIRECT en remontant l'arbre. Conséquence : renommer un nœud dans le catalogue se
# répercute automatiquement partout (parc, tickets, détail, PDF, futur dashboard),
# sans cascade ni réécriture — le node_id, lui, ne change jamais.

def catalogue_path_for_node(DB, node_id):
    """Remonte l'arbre depuis un nœud niveau 4 -> (reference, pole, marque, categorie).
    Renvoie des None si le node_id est inconnu (machine orpheline)."""
    nodes = DB["catalogue"]["nodes"]
    reference = pole = marque = categorie = None
    nid = node_id
    while nid and nid != "root":
        node = nodes.get(nid)
        if not node:
            break
        lvl = node.get("level")
        if lvl == 4:
            reference = node.get("name")
        elif lvl == 3:
            categorie = node.get("name")
        elif lvl == 2:
            marque = node.get("name")
        elif lvl == 1:
            pole = node.get("name")
        nid = node.get("parent")
    return reference, pole, marque, categorie


def node_id_for_reference(DB, reference):
    """Retrouve le node_id d'une référence par son NOM (pour les appels venant du
    front, qui transmet toujours un nom issu du catalogue COURANT)."""
    for nid, node in DB["catalogue"]["nodes"].items():
        if node.get("level") == 4 and node.get("name") == reference:
            return nid
    return None


def spare_parts_for_node(DB, node_id):
    """Répertoire de pièces de rechange (`spareParts`) du nœud niveau 4, ou []."""
    node = DB["catalogue"]["nodes"].get(node_id) if node_id else None
    return node.get("spareParts", []) if node else []


def resolve_used_parts(available_parts, used, include_num=True):
    """Résout les pièces utilisées d'un rapport (stockées en `piece_id` SEUL) vers
    leur N° Pièce / Désignation COURANTS du catalogue — un renommage dans le
    catalogue se répercute donc sur tout rapport, même clôturé. `include_num=False`
    omet le N° Pièce (jamais transmis au client). Pièce introuvable (cas théorique :
    la suppression n'est pas autorisée) -> repli « Pièce inconnue »."""
    by_id = {p.get("id"): p for p in (available_parts or [])}
    rows = []
    for u in used or []:
        pid = (u or {}).get("piece_id")
        p = by_id.get(pid)
        row = {"piece_id": pid, "name": (p.get("name", "") if p else "Pièce inconnue")}
        if include_num:
            row["num"] = (p.get("num", "") if p else "")
        rows.append(row)
    return rows


def clean_used_parts(DB, node_id, raw):
    """Normalise les pièces utilisées reçues du front : ne garde que des `piece_id`
    EXISTANTS dans le répertoire du nœud, sans doublon, sans rien d'autre (le N°/la
    désignation sont toujours re-résolus à l'affichage)."""
    valid_ids = {p.get("id") for p in spare_parts_for_node(DB, node_id)}
    seen, out = set(), []
    for item in raw or []:
        pid = (item or {}).get("piece_id")
        if pid and pid in valid_ids and pid not in seen:
            seen.add(pid)
            out.append({"piece_id": pid})
    return out


def resolve_checklist_by_node(DB, node_id):
    """Checklist effective d'un nœud niveau 4 (figée dans le ticket à la création)."""
    node = DB["catalogue"]["nodes"].get(node_id) if node_id else None
    if node and node.get("level") == 4:
        items = [dict(it) for it in node.get("pannes", [])]
        if not any(it.get("system") for it in items):
            items.append({"type": "panne", "label": "Autre problème",
                          "required": False, "system": True})
        return items
    return [{"type": "panne", "label": "Autre problème", "required": False, "system": True}]


def resolve_checklist(DB, reference):
    """Checklist d'une référence par son NOM (endpoint /api/catalogue/checklist)."""
    return resolve_checklist_by_node(DB, node_id_for_reference(DB, reference))


def parc_label(DB, machine):
    """Identifiant Parc AFFICHÉ (≠ clé interne `instance_id`, qui ne change jamais).

    - Machine AUTO-générée (porte un `unit_seq`) : on recompose l'étiquette EN DIRECT
      à partir de la référence courante -> elle suit les renommages du catalogue.
    - Machine à identifiant SAISI par l'utilisateur (pas de `unit_seq`) : on conserve
      la valeur telle quelle, figée."""
    seq = machine.get("unit_seq")
    if seq:
        ref, _, _, _ = catalogue_path_for_node(DB, machine.get("node_id"))
        if ref:
            return "{}-{:02d}".format(ref, seq)
    return machine.get("instance_id")


# ===========================================================================
# ROUTES — PAGES (templates)
# ===========================================================================
PORTAL_PAGES = {
    "manager": [
        ("tous-les-tickets", "Tous les tickets"),
        ("gestion-techniciens", "Gestion des techniciens"),
        ("gestion-client", "Gestion des clients"),
        ("gestion-parc", "Gestion du parc"),
        ("gestion-catalogue", "Gestion du catalogue"),
    ],
    "technicien": [("mes-tickets", "Mes tickets assignés")],
    "client": [("tickets-en-cours", "Tickets en cours"),
               ("ouvrir-un-ticket", "Ouvrir un ticket")],
}


@app.route("/")
def index():
    login_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "templates", "login.html")
    if os.path.exists(login_path):
        return render_template("login.html")
    return _fallback_nav()


def _fallback_nav():
    rows = []
    for portal, pages in PORTAL_PAGES.items():
        links = "".join(
            '<li><a href="/{p}/{slug}">{label}</a></li>'.format(p=portal, slug=slug, label=label)
            for slug, label in pages)
        rows.append('<h3>{}</h3><ul>{}</ul>'.format(portal.capitalize(), links))
    return (
        "<html><head><meta charset='utf-8'><title>Stokvis 360</title>"
        "<style>body{font-family:system-ui;max-width:640px;margin:40px auto;color:#1e293b}"
        "a{color:#1d4ed8}h3{margin-top:24px}</style></head><body>"
        "<h1>Stokvis 360 — Prototype</h1>"
        "<p>Page de navigation de secours (login.html sera ajouté à l'étape 3).</p>"
        + "".join(rows) +
        "<hr><p>API : <a href='/api/health'>/api/health</a></p></body></html>"
    )


def _render_portal_page(portal, slug):
    template = "{}/{}.html".format(portal, slug.replace("-", "_"))
    full = os.path.join(app.template_folder, template)
    if not os.path.exists(full):
        return ("<html><body style='font-family:system-ui;margin:40px'>"
                "<h2>Page à venir</h2><p>Le template <code>{}</code> sera créé "
                "dans une prochaine étape.</p><p><a href='/'>← Retour</a></p>"
                "</body></html>".format(template))
    return render_template(template)


@app.route("/manager/<slug>")
def manager_page(slug):
    return _render_portal_page("manager", slug)


@app.route("/technicien/<slug>")
def technicien_page(slug):
    return _render_portal_page("technicien", slug)


@app.route("/client/<slug>")
def client_page(slug):
    return _render_portal_page("client", slug)


@app.route("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(os.path.join(app.static_folder, "uploads"), filename)


# ===========================================================================
# ROUTES — API : lecture
# ===========================================================================
@app.route("/api/health")
def health():
    DB = db.load_db()
    return jsonify({"ok": True, "tickets": len(DB["tickets"]),
                    "clients": len(DB["clients"]), "techniciens": len(DB["techniciens"]),
                    "machines": len(DB["parc"])})


@app.route("/api/bootstrap")
def bootstrap():
    """Tout ce dont un portail a besoin en UN appel : utilisateur courant + données de
    référence + tickets (filtrés selon le rôle). Réduit le travail de réécriture des pages."""
    role = request.args.get("role", "manager")
    user_id = request.args.get("user_id")
    DB = db.load_db()

    tickets = _tickets_for(DB, role, user_id)
    current_user = None
    if role == "technicien" and user_id:
        t = db.get_technicien(DB, user_id)
        current_user = enrich_technicien(DB, t) if t else None
    elif role == "client" and user_id:
        c = db.get_client(DB, user_id)
        current_user = enrich_client(DB, c) if c else None

    return jsonify({
        "role": role,
        "current_user": current_user,
        "clients": [enrich_client(DB, c) for c in DB["clients"]],
        # Pour les dropdowns d'assignation : clients archivés exclus.
        # "clients" reste la liste complète (vues manager).
        "clients_active": [enrich_client(DB, c) for c in DB["clients"]
                           if not c.get("archived")],
        "techniciens": [enrich_technicien(DB, t) for t in DB["techniciens"]],
        "parc": [enrich_machine(DB, m) for m in DB["parc"]],
        "catalogue": DB["catalogue"],
        "tickets": tickets,
    })


def _tickets_for(DB, role, user_id):
    result = []
    for t in DB["tickets"]:
        if role == "technicien" and user_id and user_id not in t["technicien_ids"]:
            continue
        if role == "client" and user_id and t["client_id"] != user_id:
            continue
        result.append(enrich_ticket(DB, t, role))
    return result


@app.route("/api/tickets")
def list_tickets():
    role = request.args.get("role", "manager")
    user_id = request.args.get("user_id")
    DB = db.load_db()
    return jsonify(_tickets_for(DB, role, user_id))


@app.route("/api/ticket/<ticket_id>")
def get_ticket(ticket_id):
    role = request.args.get("role", "manager")
    DB = db.load_db()
    t = db.get_ticket(DB, ticket_id)
    if not t:
        abort(404)
    return jsonify(enrich_ticket(DB, t, role))


@app.route("/api/clients")
def list_clients():
    DB = db.load_db()
    return jsonify([enrich_client(DB, c) for c in DB["clients"]])


@app.route("/api/techniciens")
def list_techniciens():
    DB = db.load_db()
    include_archived = request.args.get("include_archived", "true") == "true"
    techs = DB["techniciens"]
    if not include_archived:
        techs = [t for t in techs if not t["archived"]]
    return jsonify([enrich_technicien(DB, t) for t in techs])


@app.route("/api/parc")
def list_parc():
    DB = db.load_db()
    return jsonify([enrich_machine(DB, m) for m in DB["parc"]])


@app.route("/api/machine/<instance_id>/usage_timeline")
def machine_usage_timeline(instance_id):
    """Historique chronologique des relevés d'usage d'une machine, agrégé depuis
    les tickets qui en portent (les relevés ne sont jamais stockés sur la machine)."""
    DB = db.load_db()
    entries = []
    for t in DB["tickets"]:
        if t["instance_id"] != instance_id:
            continue
        for r in t.get("usage_readings", []):
            entries.append({
                "ticket_id": t["id"],
                "date": t["created_at"],
                "name": r["name"],
                "unit": r["unit"],
                "value": r["value"],
            })
    entries.sort(key=lambda x: x["date"])
    return jsonify(entries)


@app.route("/api/catalogue")
def get_catalogue():
    DB = db.load_db()
    return jsonify(DB["catalogue"])


@app.route("/api/catalogue/checklist")
def get_checklist():
    reference = request.args.get("reference", "")
    DB = db.load_db()
    return jsonify(resolve_checklist(DB, reference))


# ===========================================================================
# ROUTES — API : tickets (écriture, règles métier)
# ===========================================================================
@app.route("/api/tickets", methods=["POST"])
def create_ticket():
    """Création d'un ticket (client OU manager).
    Body : client_id, instance_id, items[], description?, images?, localisation?,
           technicien_ids?(manager), created_by_role/name?"""
    body = request.get_json(force=True)
    with db.transaction() as DB:
        machine = db.get_machine(DB, body["instance_id"])
        if not machine:
            abort(400, "Machine introuvable")
        node_id = machine.get("node_id")
        # Snapshot des valeurs catalogue à la création (trace) ; l'affichage les
        # re-résout en direct via node_id, donc un renommage ultérieur se voit aussi.
        reference, pole, marque, categorie = catalogue_path_for_node(DB, node_id)
        # On ne stocke QUE les pannes cochées et les champs renseignés : la
        # checklist complète vit dans le catalogue, pas dans chaque ticket.
        items = []
        for it in body.get("items", []):
            if it.get("type") == "panne" and it.get("checked") is True:
                items.append(it)
            elif it.get("type") == "champ" and str(it.get("value") or "").strip():
                items.append(it)
        tid = db.next_ticket_id(DB)
        ticket = {
            "id": tid,
            "client_id": body["client_id"],
            "instance_id": body["instance_id"],
            "node_id": node_id,
            "reference": reference,
            "pole": pole,
            "marque": marque,
            "categorie": categorie,
            "titre": gen_title(items),
            "items": items,
            "usage_readings": clean_usage_readings(body.get("usage_readings")),
            "description": body.get("description", ""),
            "images": body.get("images", []),
            "localisation": body.get("localisation", ""),
            "status": ENVOYE,
            "technicien_ids": [],
            "created_at": now_iso(),
            "resolution_time_ms": None,
            "timeline": [{"status": ENVOYE, "timestamp": now_iso(),
                          "actor": "Système", "unusual": False}],
            "report": None,
            "evaluation": None,
            "cancellation": None,
            "messages": [{"id": "m1", "author_role": "system", "author_name": "Système",
                          "type": "system", "content": "Ticket créé", "timestamp": now_iso()}],
        }
        DB["tickets"].append(ticket)
        # Assignation initiale éventuelle (manager) -> déclenche l'auto-statut.
        for tid_assign in body.get("technicien_ids", []):
            if db.get_technicien(DB, tid_assign):
                ticket["technicien_ids"].append(tid_assign)
        if ticket["technicien_ids"]:
            apply_auto_status_on_assignment(DB, ticket)
        return jsonify(enrich_ticket(DB, ticket, "manager")), 201


@app.route("/api/ticket/<ticket_id>/assign", methods=["POST"])
def assign_ticket(ticket_id):
    """Définit la liste complète des techniciens assignés (auto-save).
    Body : {technicien_ids: [...]}. Applique l'auto-statut Envoyé<->Assigné.
    Chaque ajout/retrait est tracé dans la discussion (traçabilité complète)."""
    body = request.get_json(force=True)
    new_ids = [tid for tid in body.get("technicien_ids", [])]
    with db.transaction() as DB:
        ticket = db.get_ticket(DB, ticket_id)
        if not ticket:
            abort(404)
        # On ignore les archivés / inexistants par sécurité.
        valid = []
        for tid in new_ids:
            tech = db.get_technicien(DB, tid)
            if tech and not tech["archived"]:
                valid.append(tid)
        old_ids = list(ticket["technicien_ids"])
        ticket["technicien_ids"] = valid
        changed = apply_auto_status_on_assignment(DB, ticket)
        # Envoyé -> Assigné annonce déjà "Assigné à X" ; sinon on trace le diff.
        if changed != ASSIGNE:
            added = [tid for tid in valid if tid not in old_ids]
            removed = [tid for tid in old_ids if tid not in valid]
            if added:
                label = "Technicien ajouté : {}".format(", ".join(tech_display_names(DB, added)))
                add_timeline(ticket, ASSIGNE, "Manager", actor_id="manager",
                             extra={"status_label": label, "assigned_to_ids": added})
                add_system_message(ticket, "{} (par {})".format(label, manager_display()))
            if removed:
                label = "Technicien retiré : {}".format(", ".join(tech_display_names(DB, removed)))
                add_timeline(ticket, ASSIGNE, "Manager", actor_id="manager",
                             extra={"status_label": label})
                add_system_message(ticket, "{} (par {})".format(label, manager_display()))
        return jsonify(enrich_ticket(DB, ticket, "manager"))


@app.route("/api/ticket/<ticket_id>/status", methods=["POST"])
def change_status(ticket_id):
    """Changement de statut (technicien ou manager).
    Body : {status, actor_name?, actor_role?, via?}.
    - Refuse si le ticket est déjà terminal (Terminé/Annulé).
    - Marque la transition ⚠ si recul / saut / changement de chemin.
    - Si status == Terminé : refuse le Terminé de l'AUTRE chemin (409),
      enregistre termine_via (terrain/distance) et gèle le temps de résolution."""
    body = request.get_json(force=True)
    target = body["status"]
    actor = body.get("actor_name", "Manager")
    with db.transaction() as DB:
        ticket = db.get_ticket(DB, ticket_id)
        if not ticket:
            abort(404)
        # Affichage de l'acteur résolu via son ID (nom courant + rôle correct) :
        # le message gravé porte "Nom (Rôle)", ex. "Faouzi Lakjaa (Manager)".
        live_name, live_role = live_actor(DB, body.get("actor_id"), actor)
        actor_disp = actor_display_name(live_name, live_role or body.get("actor_role"))
        if ticket["status"] in TERMINAL_STATUSES:
            abort(409, "Ticket déjà terminal")
        if target not in (PATH_TERRAIN + PATH_DISTANCE):
            abort(400, "Statut invalide")

        extra = None
        if target == TERMINE:
            # via = chemin du Terminé CLIQUÉ ("terrain"/"distance"). Un ticket
            # engagé dans un chemin ne peut pas être clos par le Terminé de
            # l'autre (la distinction alimente le futur dashboard).
            engaged = current_path(ticket["status"])
            via = body.get("via")
            if engaged and via and via != engaged:
                return jsonify({"error": "Ce ticket suit le chemin {} — utilisez le Terminé "
                                "de ce chemin.".format("Terrain" if engaged == "terrain" else "Distance")}), 409
            effective_via = engaged or via
            if effective_via:
                ticket["termine_via"] = effective_via
                extra = {"via": effective_via}

        unusual = not is_normal_transition(ticket["status"], target)
        ticket["status"] = target
        add_timeline(ticket, target, actor, unusual=unusual,
                     actor_id=body.get("actor_id"), extra=extra)

        if target == TERMINE:
            created = datetime.fromisoformat(ticket["created_at"])
            ticket["resolution_time_ms"] = int((datetime.now() - created).total_seconds() * 1000)
            add_system_message(ticket, "Statut mis à jour : {} (par {})".format(
                termine_label(ticket.get("termine_via")), actor_disp), color="green")
        else:
            prefix = "⚠ " if unusual else ""
            add_system_message(ticket, "{}Statut mis à jour : {} (par {})".format(prefix, target, actor_disp))

        return jsonify(enrich_ticket(DB, ticket, body.get("actor_role", "manager")))


@app.route("/api/ticket/<ticket_id>/cancel", methods=["POST"])
def cancel_ticket(ticket_id):
    """Annulation (client ou manager). Body : {raison, commentaire?, by_role, by_name}."""
    body = request.get_json(force=True)
    with db.transaction() as DB:
        ticket = db.get_ticket(DB, ticket_id)
        if not ticket:
            abort(404)
        if ticket["status"] in TERMINAL_STATUSES:
            abort(409, "Ticket déjà terminal")
        ticket["status"] = ANNULE
        ticket["cancellation"] = {
            "raison": body.get("raison", "Autre raison"),
            "commentaire": body.get("commentaire", ""),
            "by_role": body.get("by_role", "manager"),
            "by_name": body.get("by_name", "Manager"),
            "by_id": body.get("by_id"),
            "at": now_iso(),
        }
        add_timeline(ticket, ANNULE, body.get("by_name", "Manager"),
                     extra={"cancellation": True}, actor_id=body.get("by_id"))
        add_system_message(
            ticket,
            "Ticket annulé — {} : {}".format(
                ticket["cancellation"]["raison"],
                ticket["cancellation"]["commentaire"] or "(sans commentaire)"),
            color="red", mtype="system_cancel")
        return jsonify(enrich_ticket(DB, ticket, body.get("by_role", "manager")))


@app.route("/api/ticket/<ticket_id>/report", methods=["POST"])
def submit_report(ticket_id):
    """Création/mise à jour du rapport (technicien). Le ticket doit être Terminé.
    Body : {titre_intervention, situation, travaux, images?, submitted_by?}.
    Incrémente la version et envoie une carte PDF dans le chat."""
    body = request.get_json(force=True)
    with db.transaction() as DB:
        ticket = db.get_ticket(DB, ticket_id)
        if not ticket:
            abort(404)
        if ticket["status"] != TERMINE:
            abort(409, "Le rapport n'est disponible qu'une fois le ticket Terminé")
        prev_version = ticket["report"]["version"] if ticket.get("report") else 0
        node_id = ticket.get("node_id")
        if not node_id:
            node_id = (db.get_machine(DB, ticket["instance_id"]) or {}).get("node_id")
        titre_int = body.get("titre_intervention", "").strip()
        ticket["report"] = {
            "version": prev_version + 1,
            "titre_intervention": titre_int,
            "situation": body.get("situation", ""),
            "travaux": body.get("travaux", ""),
            # On ne stocke QUE le piece_id : le N°/la désignation sont re-résolus en
            # direct, de sorte qu'un renommage catalogue suive même les rapports clos.
            "used_parts": clean_used_parts(DB, node_id, body.get("used_parts", [])),
            "images": body.get("images", []),
            "submitted_by": body.get("submitted_by", "Technicien"),
            "submitted_at": now_iso(),
        }
        # Pas de champ titre dédié : `enrich_ticket` dérive le titre « partout » du
        # rapport (report.titre_intervention) ; le saisir suffit à l'afficher partout.
        append_message(ticket,
                       author_role="technicien", author_name=body.get("submitted_by", "Technicien"),
                       type="pdf_card", color="blue",
                       content="Rapport d'intervention · Version {}".format(prev_version + 1),
                       version=prev_version + 1, timestamp=now_iso())
        return jsonify(enrich_ticket(DB, ticket, "technicien"))


@app.route("/api/ticket/<ticket_id>/evaluation", methods=["POST"])
def submit_evaluation(ticket_id):
    """Évaluation du service (client). Le ticket doit être Terminé.
    Body : {note (1-5), commentaire?}."""
    body = request.get_json(force=True)
    with db.transaction() as DB:
        ticket = db.get_ticket(DB, ticket_id)
        if not ticket:
            abort(404)
        if ticket["status"] != TERMINE:
            abort(409, "Évaluation possible uniquement après Terminé")
        is_update = ticket.get("evaluation") is not None
        ticket["evaluation"] = {
            "note": int(body.get("note", 0)),
            "commentaire": body.get("commentaire", ""),
            "updated_at": now_iso(),
        }
        verb = "mise à jour" if is_update else "reçue"
        append_message(ticket,
                       author_role="client", author_name="Client",
                       type="system_eval", color="gold",
                       content="Évaluation {} : {}/5 — {}".format(
                           verb, ticket["evaluation"]["note"],
                           ticket["evaluation"]["commentaire"] or "(sans commentaire)"),
                       timestamp=now_iso())
        return jsonify(enrich_ticket(DB, ticket, "client"))


@app.route("/api/ticket/<ticket_id>/messages", methods=["POST"])
def post_message(ticket_id):
    """Ajoute un message au chat partagé.
    Body : {author_role, author_name, content, type?, image?, file_url?, file_name?, file_type?}.
    """
    body = request.get_json(force=True)
    with db.transaction() as DB:
        ticket = db.get_ticket(DB, ticket_id)
        if not ticket:
            abort(404)
        fields = {
            "author_role": body.get("author_role", "manager"),
            "author_name": body.get("author_name", "Utilisateur"),
            "type": body.get("type", "text"),
            "content": body.get("content", ""),
            "timestamp": now_iso(),
        }
        # author_id -> résolution du nom courant à l'affichage (cf. enrich_ticket).
        if body.get("author_id"):
            fields["author_id"] = body["author_id"]
        if body.get("image"):
            fields["image"] = body["image"]
        if body.get("file_url"):
            fields["file_url"]  = body["file_url"]
            fields["file_name"] = body.get("file_name", "fichier")
            fields["file_type"] = body.get("file_type", "file")   # image | audio | file
        msg = append_message(ticket, **fields)
        return jsonify(msg), 201


@app.route("/api/upload", methods=["POST"])
def upload_file():
    """Upload d'un fichier (image, audio, document). Renvoie l'URL publique."""
    if "file" not in request.files:
        abort(400)
    f = request.files["file"]
    if not f.filename:
        abort(400)
    ext = os.path.splitext(f.filename)[1].lower()
    safe_name = "{}{}".format(uuid.uuid4().hex[:14], ext)
    upload_dir = os.path.join(app.static_folder, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    f.save(os.path.join(upload_dir, safe_name))
    return jsonify({"url": "/static/uploads/" + safe_name, "name": f.filename}), 201


# ===========================================================================
# ROUTES — API : CRUD clients / techniciens / parc / catalogue
# ===========================================================================
@app.route("/api/clients", methods=["POST"])
def create_client():
    body = request.get_json(force=True)
    with db.transaction() as DB:
        cid = db.next_client_id(DB)
        client = {
            "id": cid,
            "raison_sociale": body.get("raison_sociale", ""),
            "contact_prenom": body.get("contact_prenom", ""),
            "telephone": body.get("telephone", ""),
            "email": body.get("email", ""),
            "password": body.get("password", ""),
            "archived": body.get("archived", False),
        }
        DB["clients"].append(client)
        return jsonify(enrich_client(DB, client)), 201


@app.route("/api/client/<client_id>", methods=["PUT"])
def update_client(client_id):
    body = request.get_json(force=True)
    with db.transaction() as DB:
        client = db.get_client(DB, client_id)
        if not client:
            abort(404)
        for k in ("raison_sociale", "contact_prenom", "telephone", "email", "password"):
            if k in body:
                client[k] = body[k]
        if "archived" in body:
            client["archived"] = bool(body["archived"])
        return jsonify(enrich_client(DB, client))


@app.route("/api/client/<client_id>/archive", methods=["POST"])
def archive_client(client_id):
    """Archive (désactive) ou réactive un client. Body : {archived: bool}.
    Un client archivé ne peut plus se connecter et disparaît des dropdowns
    d'assignation (clients_active), mais reste visible côté manager."""
    body = request.get_json(force=True)
    with db.transaction() as DB:
        client = db.get_client(DB, client_id)
        if not client:
            abort(404)
        client["archived"] = body.get("archived", True)
        return jsonify(enrich_client(DB, client))


@app.route("/api/login", methods=["POST"])
def login():
    """Validation de connexion (prototype : pas de mot de passe, mais les comptes
    archivés sont bloqués ici, côté serveur). Body : {role, user_id?}."""
    body = request.get_json(force=True)
    role = body.get("role", "manager")
    user_id = body.get("user_id")
    DB = db.load_db()
    if role == "client":
        client = db.get_client(DB, user_id)
        if not client:
            return jsonify({"error": "Client introuvable"}), 404
        if client.get("archived"):
            return jsonify({"error": "Compte désactivé"}), 401
        return jsonify(enrich_client(DB, client))
    if role == "technicien":
        tech = db.get_technicien(DB, user_id)
        if not tech:
            return jsonify({"error": "Technicien introuvable"}), 404
        if tech.get("archived"):
            return jsonify({"error": "Compte désactivé"}), 401
        return jsonify(enrich_technicien(DB, tech))
    return jsonify({"ok": True, "role": "manager"})


def _tech_fullname_conflict(DB, prenom, nom, exclude_id=None):
    """True si un technicien ACTIF (non archivé), autre que exclude_id, porte déjà
    ce nom complet. Le nom complet sert d'identité visible (timeline, chat, fiches) :
    deux actifs homonymes seraient indistinguables pour le manager."""
    full = "{} {}".format(prenom or "", nom or "").strip().lower()
    if not full:
        return False
    for t in DB["techniciens"]:
        if t["id"] == exclude_id or t.get("archived"):
            continue
        if "{} {}".format(t.get("prenom", ""), t.get("nom", "")).strip().lower() == full:
            return True
    return False


@app.route("/api/techniciens", methods=["POST"])
def create_technicien():
    body = request.get_json(force=True)
    with db.transaction() as DB:
        if _tech_fullname_conflict(DB, body.get("prenom"), body.get("nom")):
            return jsonify({"error": "Un technicien actif porte déjà ce nom complet."}), 409
        tid = db.next_technicien_id(DB)
        archived = body.get("statut") == "archive" or body.get("archived", False)
        tech = {
            "id": tid,
            "prenom": body.get("prenom", ""),
            "nom": body.get("nom", ""),
            "telephone": body.get("telephone", ""),
            "email": body.get("email", ""),
            "password": body.get("password", ""),
            "disponibilite": "Archivé" if archived else "Hors service",
            "archived": archived,
        }
        DB["techniciens"].append(tech)
        return jsonify(enrich_technicien(DB, tech)), 201


@app.route("/api/technicien/<tech_id>", methods=["PUT"])
def update_technicien(tech_id):
    body = request.get_json(force=True)
    with db.transaction() as DB:
        tech = db.get_technicien(DB, tech_id)
        if not tech:
            abort(404)
        # Unicité du nom complet parmi les actifs (vérifiée AVANT mutation, sur
        # l'état résultant : couvre le renommage ET la réactivation d'un archivé).
        will_archive = body.get("archived", body.get("statut") == "archive") \
            if ("archived" in body or "statut" in body) else tech.get("archived")
        new_prenom = body.get("prenom", tech.get("prenom"))
        new_nom = body.get("nom", tech.get("nom"))
        if not will_archive and _tech_fullname_conflict(DB, new_prenom, new_nom,
                                                        exclude_id=tech_id):
            return jsonify({"error": "Un technicien actif porte déjà ce nom complet."}), 409
        for k in ("prenom", "nom", "telephone", "email", "password"):
            if k in body:
                tech[k] = body[k]
        # Gestion archivage / réactivation
        if "archived" in body or "statut" in body:
            archived = body.get("archived", body.get("statut") == "archive")
            was_archived = tech["archived"]
            tech["archived"] = archived
            if archived:
                tech["disponibilite"] = "Archivé"
            elif was_archived and not archived:
                # Réactivation -> repasse Hors service (doit rouvrir un shift)
                tech["disponibilite"] = "Hors service"
        return jsonify(enrich_technicien(DB, tech))


@app.route("/api/technicien/<tech_id>/shift", methods=["POST"])
def change_shift(tech_id):
    """Gestion du shift (portail technicien). Body : {disponibilite}."""
    body = request.get_json(force=True)
    dispo = body.get("disponibilite")
    if dispo not in ("En service", "En pause", "Hors service"):
        abort(400, "Disponibilité invalide")
    with db.transaction() as DB:
        tech = db.get_technicien(DB, tech_id)
        if not tech:
            abort(404)
        if tech["archived"]:
            abort(409, "Technicien archivé")
        prev = tech.get("disponibilite")
        if prev != dispo:
            log = tech.setdefault("shift_log", [])
            log.insert(0, {"from": prev, "to": dispo, "at": now_iso()})
            if len(log) > 100:
                log[:] = log[:100]
        tech["disponibilite"] = dispo
        return jsonify(enrich_technicien(DB, tech))


@app.route("/api/parc", methods=["POST"])
def create_machine():
    body = request.get_json(force=True)
    with db.transaction() as DB:
        # Le front envoie le NOM de la référence (issu du catalogue courant) ; on le
        # convertit en node_id stable, seul lien stocké sur la machine.
        reference = body["reference"]
        node_id = node_id_for_reference(DB, reference)
        if not node_id:
            abort(400, "Référence catalogue introuvable")
        instance_id = body.get("instance_id", "").strip()
        if not instance_id:
            # AUTO : on porte un numéro de série stable (`unit_seq`). La clé interne est
            # figée à la création, mais l'étiquette affichée se recompose en direct depuis
            # la référence -> un renommage du catalogue se voit aussi sur l'ID Parc.
            seqs = [m["unit_seq"] for m in DB["parc"]
                    if m.get("node_id") == node_id and m.get("unit_seq")]
            seq = (max(seqs) + 1) if seqs else 1
            instance_id = "{}-{:02d}".format(reference, seq)
            while db.get_machine(DB, instance_id):
                seq += 1
                instance_id = "{}-{:02d}".format(reference, seq)
            machine = {
                "instance_id": instance_id,
                "node_id": node_id,
                "assignation": body.get("assignation", "En stock"),
                "unit_seq": seq,
            }
        else:
            # SAISI par l'utilisateur : conservé tel quel, figé (pas de unit_seq).
            machine = {
                "instance_id": instance_id,
                "node_id": node_id,
                "assignation": body.get("assignation", "En stock"),
                "unit_seq": None,
            }
        DB["parc"].append(machine)
        return jsonify(enrich_machine(DB, machine)), 201


@app.route("/api/machine/<instance_id>", methods=["PUT"])
def update_machine(instance_id):
    """Modification machine. Seuls instance_id et assignation sont modifiables
    (la cascade catalogue est en lecture seule, cf. spec parc §4)."""
    body = request.get_json(force=True)
    with db.transaction() as DB:
        machine = db.get_machine(DB, instance_id)
        if not machine:
            abort(404)
        if "assignation" in body:
            machine["assignation"] = body["assignation"]
        if body.get("new_instance_id"):
            new_id = body["new_instance_id"].strip()
            if new_id and new_id != instance_id and not db.get_machine(DB, new_id):
                # Répercute le changement d'ID sur les tickets liés.
                for t in DB["tickets"]:
                    if t["instance_id"] == instance_id:
                        t["instance_id"] = new_id
                machine["instance_id"] = new_id
                # Identifiant saisi à la main -> devient FIGÉ (ne suit plus les renommages).
                machine["unit_seq"] = None
        return jsonify(enrich_machine(DB, machine))


@app.route("/api/catalogue", methods=["PUT"])
def update_catalogue():
    """Remplace l'intégralité de l'arbre catalogue (le front gère la cascade et
    renvoie l'arbre complet). Garantit l'item système 'Autre problème' partout."""
    body = request.get_json(force=True)
    with db.transaction() as DB:
        nodes = body.get("nodes", {})
        for node in nodes.values():
            # Les labels arrivent du front : on normalise (espaces parasites)
            # pour que la comparaison panne <-> ticket reste fiable.
            for item in node.get("pannes", []):
                if "label" in item and isinstance(item["label"], str):
                    item["label"] = item["label"].strip()
            pannes = node.get("pannes", [])
            if pannes and not any(p.get("system") for p in pannes):
                pannes.append({"type": "panne", "label": "Autre problème",
                               "required": False, "system": True})
        DB["catalogue"] = {"hierarchy": body.get("hierarchy", {}), "nodes": nodes}
        return jsonify(DB["catalogue"])


# ===========================================================================
# Démarrage
# ===========================================================================
if __name__ == "__main__":
    if not db.db_exists():
        print("⚠ data/database.json absent. Lance d'abord :  python seed.py")
    app.run(host="0.0.0.0", debug=False, port=int(os.environ.get("PORT", 10000)))
