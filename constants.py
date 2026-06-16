"""
constants.py — Constantes partagées entre app.py et seed.py.

Les libellés de statut SONT les valeurs stockées en base — ne pas les modifier
sans migration correspondante.
"""

# ---------------------------------------------------------------------------
# Statuts (libellés français = valeurs stockées telles quelles)
# ---------------------------------------------------------------------------
ENVOYE = "Envoyé"
ASSIGNE = "Assigné"
ATTENTE = "Attente pièce"
EN_ROUTE = "En route"
EN_REPARATION = "En Réparation"
DISTANCE = "Maintenance à distance"
TERMINE = "Terminé"
ANNULE = "Annulé"

# Chemins du flux (unidirectionnels). Annulé est terminal et injectable partout.
PATH_TERRAIN = [ENVOYE, ASSIGNE, ATTENTE, EN_ROUTE, EN_REPARATION, TERMINE]
PATH_DISTANCE = [ENVOYE, ASSIGNE, DISTANCE, TERMINE]


# ---------------------------------------------------------------------------
# gen_title — règle de titre unique (même logique côté front et seed)
# ---------------------------------------------------------------------------
def gen_title(items):
    """Titre du ticket : labels des pannes cochées (hors système) joints par ' / '.
    Si aucune panne réelle cochée -> 'Autre problème'. Règle identique au front."""
    checked = [it["label"] for it in items
               if it.get("type") == "panne" and it.get("checked") and not it.get("system")]
    if not checked:
        return "Autre problème"
    return checked[0] if len(checked) == 1 else " / ".join(checked)
