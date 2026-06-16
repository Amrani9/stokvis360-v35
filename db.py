"""
db.py — Couche d'accès aux données pour Stokvis 360.

La "base de données" est un unique fichier JSON (data/database.json) chargé en
mémoire, modifié, puis réécrit sur le disque. Toutes les écritures passent par un
verrou (lock) pour éviter la corruption si le serveur Flask tourne en mode threadé.

Politique de concurrence : dernier écrivain gagne (last-write-wins), conformément
aux décisions d'architecture du projet (pas de soft-lock sur l'édition des rapports).

Ce module ne contient AUCUNE règle métier (génération de titre, auto-statut, gel du
temps de résolution, validation du flux...). Ces règles vivent dans app.py. Ici on
ne fait que lire, écrire, et générer des identifiants.
"""

import json
import os
import threading

# ---------------------------------------------------------------------------
# Chemins
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "database.json")

# Verrou global : sérialise tous les accès en lecture/écriture au fichier.
_LOCK = threading.RLock()


# ---------------------------------------------------------------------------
# Lecture / écriture brutes
# ---------------------------------------------------------------------------
def load_db():
    """Charge et renvoie l'intégralité de la base sous forme de dict Python.

    Lève FileNotFoundError si la base n'a pas encore été générée (lancer seed.py).
    """
    with _LOCK:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            return json.load(f)


def save_db(db):
    """Réécrit l'intégralité de la base sur le disque.

    Écriture atomique : on écrit dans un fichier temporaire puis on le renomme,
    afin qu'une interruption ne laisse jamais un database.json à moitié écrit.
    """
    with _LOCK:
        tmp_path = DB_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, DB_PATH)


# ---------------------------------------------------------------------------
# Helper transactionnel
# ---------------------------------------------------------------------------
class transaction:
    """Context manager : charge la base, te laisse la modifier, la sauvegarde.

    Usage :
        with transaction() as db:
            db["tickets"].append(nouveau_ticket)
        # sauvegarde automatique à la sortie du bloc (sauf exception)

    Tout le bloc s'exécute sous le verrou global : deux requêtes concurrentes ne
    peuvent pas lire-modifier-écrire en même temps.
    """

    def __enter__(self):
        _LOCK.acquire()
        self.db = load_db()
        return self.db

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is None:
                save_db(self.db)
        finally:
            _LOCK.release()
        return False  # ne supprime pas l'exception éventuelle


# ---------------------------------------------------------------------------
# Génération d'identifiants
# ---------------------------------------------------------------------------
# Les compteurs sont stockés dans db["counters"]. On incrémente puis on formate.
# Doit être appelé À L'INTÉRIEUR d'une transaction (le dict db est passé en argument)
# pour que l'incrément du compteur soit persisté avec l'objet créé.

def next_ticket_id(db):
    """T-1001, T-1002, ... (on démarre les compteurs à 1000 dans le seed)."""
    db["counters"]["ticket"] += 1
    return "T-{:04d}".format(db["counters"]["ticket"])


def next_client_id(db):
    """C-0001, C-0002, ..."""
    db["counters"]["client"] += 1
    return "C-{:04d}".format(db["counters"]["client"])


def next_technicien_id(db):
    """TECH-0001, TECH-0002, ... S'étend naturellement au-delà de 9999."""
    db["counters"]["technicien"] += 1
    return "TECH-{:04d}".format(db["counters"]["technicien"])


def next_message_id(db, ticket):
    """Identifiant de message de chat, unique au sein d'un ticket (m1, m2, ...)."""
    n = len(ticket.get("messages", [])) + 1
    # On garantit l'unicité même si des messages ont été supprimés au milieu.
    existing = {m["id"] for m in ticket.get("messages", [])}
    while "m{}".format(n) in existing:
        n += 1
    return "m{}".format(n)


# ---------------------------------------------------------------------------
# Accesseurs pratiques (lecture seule — ne modifient pas la base)
# ---------------------------------------------------------------------------
def find(collection, key, value):
    """Renvoie le premier élément d'une liste dont collection[i][key] == value, sinon None."""
    for item in collection:
        if item.get(key) == value:
            return item
    return None


def get_client(db, client_id):
    return find(db["clients"], "id", client_id)


def get_technicien(db, tech_id):
    return find(db["techniciens"], "id", tech_id)


def get_machine(db, instance_id):
    return find(db["parc"], "instance_id", instance_id)


def get_ticket(db, ticket_id):
    return find(db["tickets"], "id", ticket_id)


# ---------------------------------------------------------------------------
# Existence de la base
# ---------------------------------------------------------------------------
def db_exists():
    return os.path.exists(DB_PATH)