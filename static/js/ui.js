/**
 * ui.js — Helpers JS partagés entre toutes les pages Stokvis 360.
 * Chargé avant le script de page ; les pages peuvent redéfinir les fonctions
 * pour spécialiser le comportement (ex. tickets_en_cours ajoute \n→<br> dans xe).
 */

/* ---------------------------------------------------------------------------
 * xe — Échappement HTML (superset : & < > " ')
 * Escaper plus est toujours sûr pour l'output HTML.
 * ------------------------------------------------------------------------- */
function xe(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------------------------
 * parseDate — Convertit "DD/MM/YYYY" + "HH:MM" en objet Date
 * ------------------------------------------------------------------------- */
function parseDate(d, t) {
  var pd = d.split('/'), pt = t.split(':');
  return new Date(pd[2], pd[1] - 1, pd[0], pt[0], pt[1]);
}

/* ---------------------------------------------------------------------------
 * genTitle — Titre AFFICHÉ d'un ticket, source unique (remplace les ex-copies
 * genTitle / generateTitle / getTicketTitle par page).
 *   1. `t.titre` (titre serveur, intègre le titre du rapport technicien) prime
 *      PARTOUT — tables, recherche, tri, recaps.
 *   2. sinon : labels des pannes cochées, joints par ' / ' ; 'Autre problème' si
 *      aucune. Le filtre `type` tolère les deux formes de checklist du projet :
 *      items typés {type:'panne',...} (la plupart) ET items déjà réduits {label}
 *      sans type (tous_les_tickets) — sortie identique aux anciennes copies.
 * ------------------------------------------------------------------------- */
function genTitle(t) {
  if (t && t.titre) return t.titre;
  var items = (t && t.checklist) || [];
  var pannes = items
    .filter(function (c) { return c.type === undefined || c.type === 'panne'; })
    .map(function (c) { return c.label; });
  if (!pannes.length) return 'Autre problème';
  return pannes.length === 1 ? pannes[0] : pannes.join(' / ');
}
