/* =========================================================================
 * ticket_detail.js — Popup partagé "Détails du ticket" v3.
 *
 * Inclure :  <script src="/static/js/ticket_detail.js"></script>
 * Ouvrir  :  TicketDetail.open(ticketId, { role, onChange });
 *            TicketDetail.open(ticketId, { role, onChange, scrollTo:'rapport' });
 *
 * Fixes v3 :
 *   - Chat : send/attach/voice stables (évènements sur conteneur, pas sur DOM généré)
 *   - "Remplir le rapport" scrolle vers la section rapport dans la bonne scrollbox
 *   - Messages vocaux (MediaRecorder → blob → upload → message audio)
 *   - Fichiers + images dans le chat (upload serveur → URL permanente)
 *   - Chat indépendant par ticket (cloisonnement)
 *   - Optimisation perf : rafraîchissement différentiel (chat seul si seul le chat change)
 *   - Polling 6 s (vs 4 s) + pause si popup fermé
 * ====================================================================== */

(function (global) {
  "use strict";

  /* ────────────────────────────────────────────────────────────────────────
     CSS
     ──────────────────────────────────────────────────────────────────────── */
  var STYLE = `
  .td-popup-overlay{
    --td-primary:#1B3A6B;--td-primary-hover:#244A82;--td-grey:#58595B;--td-steel-blue:#4A7FB5;
    --td-light-slate:#8FA3BF;--td-white:#FFFFFF;--td-off-white:#F4F6F9;--td-light-grey:#E2E6EC;
    --td-dark:#2D2D2D;--td-success:#2D8F5E;--td-danger:#EF4444;--td-warning:#D97706;
    --td-shadow-card:0 1px 3px rgba(27,58,107,0.08);--td-shadow-popup:0 12px 40px rgba(27,58,107,0.16);
    --td-shadow-dd:0 4px 20px rgba(0,0,0,0.15);--td-tr:200ms ease-in-out;
    font-family:'Inter',system-ui,sans-serif;font-size:14px;color:var(--td-grey);line-height:1.6;
  }

  /* ── OVERLAY ── */
  .td-popup-overlay{position:fixed;inset:0;background:rgba(27,58,107,0.4);backdrop-filter:blur(3px);
    z-index:4000;display:flex;align-items:center;justify-content:center;padding:24px;
    opacity:0;pointer-events:none;transition:opacity 0.3s ease;}
  .td-popup-overlay.open{opacity:1;pointer-events:auto;}

  /* ── MODAL ── */
  .td-popup-modal{background:var(--td-white);border-radius:12px;box-shadow:var(--td-shadow-popup);
    width:1200px;max-width:95vw;height:90vh;display:flex;flex-direction:column;overflow:hidden;
    transform:scale(0.98);transition:transform 0.3s ease;}
  .td-popup-overlay.open .td-popup-modal{transform:scale(1);}

  /* ── HEADER ── */
  .td-popup-header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;
    padding:14px 24px;border-bottom:1px solid var(--td-light-grey);background:var(--td-white);flex-shrink:0;gap:10px;}
  .td-popup-logo{font-size:17px;font-weight:700;color:var(--td-primary);letter-spacing:-0.5px;justify-self:start;}
  .td-popup-logo span{font-weight:400;color:var(--td-light-slate);}
  .td-popup-header-center{display:flex;align-items:center;gap:10px;justify-self:center;}
  .td-popup-title{font-size:12px;font-weight:700;color:var(--td-primary);letter-spacing:1px;text-transform:uppercase;}
  .td-popup-sentby{font-size:12px;color:var(--td-light-slate);font-weight:500;white-space:nowrap;}
  .td-popup-sentby strong{color:var(--td-grey);font-weight:600;}
  .td-popup-header-right{justify-self:end;display:flex;align-items:center;gap:8px;}
  .td-popup-close{width:32px;height:32px;border:none;background:none;color:var(--td-grey);cursor:pointer;
    display:flex;align-items:center;justify-content:center;border-radius:4px;transition:all var(--td-tr);}
  .td-popup-close:hover{background:var(--td-off-white);color:var(--td-dark);transform:rotate(90deg);}
  .td-popup-close svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;}

  /* Status badge */
  .td-status-badge{display:inline-flex;align-items:center;padding:4px 11px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;}
  .td-status-trigger{display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:2px 6px 2px 2px;
    border-radius:14px;border:1.5px solid transparent;transition:all var(--td-tr);}
  .td-status-trigger:hover{border-color:var(--td-light-grey);background:var(--td-off-white);}
  .td-status-trigger.terminal{cursor:default;pointer-events:none;}
  .td-status-trigger .td-arr{width:12px;height:12px;stroke:var(--td-grey);fill:none;stroke-width:2;}

  /* Cancel btn */
  .td-btn-danger-outline{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;
    font-size:12px;font-weight:600;border-radius:6px;border:1.5px solid var(--td-danger);cursor:pointer;
    background:transparent;color:var(--td-danger);transition:all var(--td-tr);}
  .td-btn-danger-outline:hover{background:var(--td-danger);color:var(--td-white);}
  .td-btn-danger-outline svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;}

  /* ── RAPPORT BANNER ── */
  .td-rapport-banner{display:none;align-items:center;gap:12px;padding:10px 24px;
    background:#FFFBEB;border-bottom:1px solid #FDE68A;flex-shrink:0;}
  .td-rapport-banner.show{display:flex;}
  .td-rapport-banner svg{width:16px;height:16px;stroke:var(--td-warning);fill:none;stroke-width:2;flex-shrink:0;}
  .td-rapport-banner-text{font-size:13px;font-weight:600;color:#92400E;flex:1;}
  .td-rapport-banner-btn{background:var(--td-warning);color:white;border:none;border-radius:6px;
    padding:0 12px;height:28px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;}
  .td-rapport-banner-btn:hover{background:#B45309;}

  /* ── BODY ── */
  .td-popup-body{display:flex;flex:1;overflow-y:auto;overflow-x:hidden;background:var(--td-off-white);
    padding:clamp(12px,2vw,24px);gap:20px;align-items:flex-start;}
  .td-popup-body::-webkit-scrollbar{width:7px;}
  .td-popup-body::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:4px;}
  .td-popup-left{flex:1 1 55%;display:flex;flex-direction:column;gap:16px;min-width:0;}
  .td-popup-right{flex:1 1 45%;display:flex;flex-direction:column;gap:16px;min-width:0;}

  /* ── SECTIONS ── */
  .td-section{background:var(--td-white);border-radius:8px;box-shadow:var(--td-shadow-card);
    padding:18px 20px;border:1px solid var(--td-light-grey);}
  .td-section-title{font-size:11px;font-weight:700;color:var(--td-steel-blue);text-transform:uppercase;
    letter-spacing:0.5px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--td-light-grey);}

  /* ── INFO GRID ── */
  .td-info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
  .td-info-grid.single-col{grid-template-columns:1fr;}
  .td-info-item{display:flex;flex-direction:column;gap:4px;}
  .td-info-lbl{font-size:11px;font-weight:600;color:var(--td-light-slate);text-transform:uppercase;letter-spacing:0.4px;}
  .td-info-val{font-size:13px;color:var(--td-dark);line-height:1.5;}
  .td-info-val.mono{font-family:monospace;font-size:12px;}
  .td-info-val.bold{font-weight:600;color:var(--td-primary);}
  .td-link-map{color:var(--td-steel-blue);text-decoration:none;display:inline-flex;align-items:center;gap:5px;font-weight:500;font-size:12px;}
  .td-link-map svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;}
  .td-link-map:hover{text-decoration:underline;}

  /* ── CHECKLIST ── */
  .td-chk-list{display:flex;flex-direction:column;gap:8px;margin-top:4px;}
  .td-chk-item{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--td-dark);}
  .td-chk-item svg{width:14px;height:14px;stroke:var(--td-success);fill:none;stroke-width:2.5;flex-shrink:0;margin-top:3px;}
  .td-chk-field{font-size:13px;}
  .td-chk-field strong{color:var(--td-grey);font-weight:600;}

  /* ── TIMELINE ── */
  .td-timeline{display:flex;flex-direction:column;position:relative;padding-left:10px;margin-top:4px;}
  .td-timeline::before{content:'';position:absolute;left:15px;top:8px;bottom:12px;width:2px;background:var(--td-light-grey);}
  .td-tl-item{position:relative;padding-bottom:16px;padding-left:24px;}
  .td-tl-item:last-child{padding-bottom:0;}
  .td-tl-item::after{content:'';position:absolute;left:0;top:4px;width:12px;height:12px;border-radius:50%;
    background:var(--td-steel-blue);border:2px solid var(--td-white);box-shadow:0 0 0 1px var(--td-light-grey);z-index:2;}
  .td-tl-item.tl-last::after{width:14px;height:14px;left:-1px;top:3px;box-shadow:0 0 0 2px currentColor;}
  .td-tl-item.tl-last .td-tl-status{font-weight:700;}
  .td-tl-item.tl-cancel::after{background:var(--td-danger);box-shadow:0 0 0 2px var(--td-danger);}
  .td-tl-status{font-size:13px;font-weight:600;color:var(--td-dark);}
  .td-tl-time{font-size:11px;color:var(--td-light-slate);margin-top:3px;}
  .td-tl-by{font-size:11px;color:var(--td-light-slate);font-style:italic;margin-top:2px;}
  .td-tl-cancel-detail{font-size:12px;margin-top:5px;background:rgba(239,68,68,0.06);border-left:2px solid var(--td-danger);
    padding:5px 9px;border-radius:0 4px 4px 0;display:flex;flex-direction:column;gap:2px;}
  .td-tl-cancel-detail .cr{font-weight:600;color:var(--td-danger);}
  .td-tl-cancel-detail .cc{font-style:italic;color:var(--td-grey);}

  /* ── GALLERY ── */
  .td-gal-grid{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}
  .td-gal-thumb{width:60px;height:60px;border-radius:6px;border:1px solid var(--td-light-grey);
    object-fit:cover;cursor:pointer;transition:transform .15s,border-color .15s;}
  .td-gal-thumb:hover{transform:scale(1.06);border-color:var(--td-steel-blue);}
  .td-empty{font-size:13px;color:var(--td-light-slate);font-style:italic;}

  /* ── RAPPORT ── */
  .td-rpt-notice{display:flex;align-items:center;gap:10px;padding:9px 13px;border-radius:7px;margin-bottom:13px;}
  .td-rpt-notice.ok{background:rgba(45,143,94,0.08);border:1px solid rgba(45,143,94,0.2);}
  .td-rpt-notice.pending{background:rgba(143,163,191,0.1);border:1px solid var(--td-light-grey);}
  .td-rpt-notice svg{width:15px;height:15px;fill:none;stroke-width:2;flex-shrink:0;}
  .td-rpt-notice.ok svg{stroke:var(--td-success);}
  .td-rpt-notice.pending svg{stroke:var(--td-light-slate);}
  .td-rpt-notice span{font-size:13px;font-weight:600;}
  .td-rpt-notice.ok span{color:var(--td-success);}
  .td-rpt-notice.pending span{color:var(--td-light-slate);}
  .td-rpt-ro{display:flex;flex-direction:column;gap:12px;}
  .td-rpt-ro-field{display:flex;flex-direction:column;gap:4px;}
  .td-rpt-ro-lbl{font-size:11px;font-weight:700;color:var(--td-light-slate);text-transform:uppercase;letter-spacing:0.4px;}
  .td-rpt-ro-val{font-size:13px;color:var(--td-dark);line-height:1.6;white-space:pre-line;overflow-wrap:break-word;word-break:break-word;}
  .td-rapport-form{display:flex;flex-direction:column;gap:13px;}
  .td-form-group{display:flex;flex-direction:column;gap:5px;}
  .td-form-group label{font-size:11px;font-weight:700;color:var(--td-grey);text-transform:uppercase;letter-spacing:0.4px;}
  .td-form-group label .req{color:var(--td-danger);}
  .td-form-input{width:100%;height:38px;border:1.5px solid var(--td-light-grey);border-radius:6px;
    padding:0 11px;font-size:13px;color:var(--td-dark);background:var(--td-white);transition:border-color var(--td-tr);font-family:inherit;box-sizing:border-box;}
  .td-form-input:focus{border-color:var(--td-steel-blue);outline:none;box-shadow:0 0 0 3px rgba(74,127,181,0.1);}
  .td-form-textarea{width:100%;min-height:76px;border:1.5px solid var(--td-light-grey);border-radius:6px;
    padding:8px 11px;font-size:13px;color:var(--td-dark);background:var(--td-white);resize:vertical;
    transition:border-color var(--td-tr);font-family:inherit;box-sizing:border-box;}
  .td-form-textarea:focus{border-color:var(--td-steel-blue);outline:none;box-shadow:0 0 0 3px rgba(74,127,181,0.1);}
  .td-form-input.err,.td-form-textarea.err{border-color:var(--td-danger);}
  .td-ferr{font-size:11px;color:var(--td-danger);display:none;margin-top:1px;}
  .td-ferr.vis{display:block;}
  .td-img-upload-area{border:2px dashed var(--td-light-grey);border-radius:7px;padding:13px;text-align:center;
    cursor:pointer;transition:border-color var(--td-tr);}
  .td-img-upload-area:hover{border-color:var(--td-steel-blue);}
  .td-img-upload-area svg{width:20px;height:20px;stroke:var(--td-light-slate);fill:none;stroke-width:1.5;margin-bottom:4px;}
  .td-img-upload-area p{font-size:12px;color:var(--td-light-slate);margin:0;}

  /* ── PIÈCES DE RECHANGE ── */
  .td-part-note{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--td-light-slate);margin:-1px 0 2px;}
  .td-part-note svg{width:13px;height:13px;fill:none;stroke:var(--td-light-slate);stroke-width:2;flex-shrink:0;}
  .td-parts-list{border:1px solid var(--td-light-grey);border-radius:6px;overflow:hidden;background:var(--td-white);}
  .td-part-head,.td-part-row{display:grid;grid-template-columns:1fr 1.4fr 32px;align-items:center;gap:8px;padding:7px 10px;}
  .td-part-head{background:var(--td-off-white);border-bottom:1px solid var(--td-light-grey);}
  .td-part-head span{font-size:10px;font-weight:700;color:var(--td-light-slate);text-transform:uppercase;letter-spacing:0.4px;}
  .td-part-row+.td-part-row{border-top:1px solid var(--td-light-grey);}
  .td-part-num{font-size:12.5px;font-weight:600;color:var(--td-dark);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
  .td-part-name{font-size:12.5px;color:var(--td-dark);overflow-wrap:anywhere;}
  .td-part-del{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:none;
    background:transparent;color:var(--td-light-slate);cursor:pointer;border-radius:5px;transition:all var(--td-tr);}
  .td-part-del:hover{background:var(--td-danger-bg,rgba(239,68,68,0.1));color:var(--td-danger);}
  .td-part-del svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;}
  .td-part-add{position:relative;margin-top:7px;}
  .td-part-search-wrap{position:relative;}
  .td-part-search-wrap svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;
    fill:none;stroke:var(--td-light-slate);stroke-width:2;pointer-events:none;}
  .td-part-search{padding-left:34px;}
  .td-part-results{position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--td-white);
    border:1px solid var(--td-light-grey);border-radius:8px;box-shadow:var(--td-shadow-dd);z-index:50;
    max-height:212px;overflow-y:auto;display:none;}
  .td-part-results.show{display:block;}
  .td-part-opt{display:grid;grid-template-columns:1fr 1.4fr;gap:10px;align-items:center;padding:8px 11px;cursor:pointer;transition:background var(--td-tr);}
  .td-part-opt+.td-part-opt{border-top:1px solid var(--td-off-white);}
  .td-part-opt:hover{background:var(--td-off-white);}
  .td-part-opt-num{font-size:12.5px;font-weight:600;color:var(--td-dark);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
  .td-part-opt-name{font-size:12.5px;color:var(--td-grey);overflow-wrap:anywhere;}
  .td-part-noopt{padding:10px 12px;font-size:12px;color:var(--td-light-slate);font-style:italic;}
  .td-part-empty{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--td-off-white);
    border:1px dashed var(--td-light-grey);border-radius:6px;font-size:12.5px;color:var(--td-light-slate);}
  .td-part-empty svg{width:14px;height:14px;fill:none;stroke:var(--td-light-slate);stroke-width:2;flex-shrink:0;}
  .td-parts-table{width:100%;border-collapse:collapse;border:1px solid var(--td-light-grey);border-radius:6px;overflow:hidden;}
  .td-parts-table th{font-size:10px;font-weight:700;color:var(--td-light-slate);text-transform:uppercase;letter-spacing:0.4px;
    text-align:left;padding:7px 10px;background:var(--td-off-white);border-bottom:1px solid var(--td-light-grey);}
  .td-parts-table td{padding:7px 10px;font-size:12.5px;color:var(--td-dark);border-top:1px solid var(--td-light-grey);overflow-wrap:anywhere;}
  .td-parts-table tr:first-child td{border-top:none;}
  .td-part-td-num{font-weight:600;font-variant-numeric:tabular-nums;width:38%;}

  /* ── EVAL ── */
  .td-eval-empty{font-size:13px;color:var(--td-light-slate);font-style:italic;padding:2px 0 8px;}
  .td-stars-display{font-size:21px;color:#E8A817;letter-spacing:2px;margin-bottom:3px;}
  .td-eval-comment-box{font-size:13px;color:var(--td-dark);background:var(--td-off-white);
    border:1px solid var(--td-light-grey);border-radius:6px;padding:9px 11px;line-height:1.6;}
  .td-rating-numbers { display: flex; gap: 8px; margin-top: 4px; margin-bottom: 2px; }
  .td-rating-num { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1.5px solid var(--td-light-grey); border-radius: 6px; font-size: 15px; font-weight: 600; color: var(--td-grey); cursor: pointer; transition: all 0.2s; user-select: none; background: var(--td-white); }
  .td-rating-num:hover { border-color: var(--td-primary); color: var(--td-primary); background: var(--td-off-white); }
  .td-rating-num.selected { background: var(--td-primary); border-color: var(--td-primary); color: var(--td-white); }

  /* ── BUTTONS ── */
  .td-btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;
    padding:0 16px;font-size:13px;font-weight:600;border-radius:6px;border:none;cursor:pointer;
    background:var(--td-primary);color:var(--td-white);transition:background var(--td-tr);font-family:inherit;}
  .td-btn-primary:hover{background:var(--td-primary-hover);}
  .td-btn-primary:disabled{opacity:0.55;cursor:not-allowed;}
  .td-btn-primary svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;}
  .td-btn-secondary{display:inline-flex;align-items:center;justify-content:center;height:36px;
    padding:0 16px;font-size:13px;font-weight:600;border-radius:6px;border:1.5px solid var(--td-light-grey);
    cursor:pointer;background:var(--td-white);color:var(--td-grey);transition:all var(--td-tr);font-family:inherit;}
  .td-btn-secondary:hover{border-color:var(--td-primary);color:var(--td-primary);}
  .td-btn-danger{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;
    padding:0 16px;font-size:13px;font-weight:600;border-radius:6px;border:none;cursor:pointer;
    background:var(--td-danger);color:var(--td-white);transition:background var(--td-tr);font-family:inherit;}
  .td-btn-danger:hover{background:#DC2626;}
  .td-btn-danger:disabled{opacity:0.55;cursor:not-allowed;}

  /* ── CHAT ── */
  .td-chat-wrapper{display:flex;flex-direction:column;height:clamp(280px,50vh,560px);background:var(--td-off-white);
    border-radius:7px;border:1px solid var(--td-light-grey);overflow:hidden;margin-top:4px;}
  .td-chat-messages{flex:1;padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:11px;}
  .td-chat-messages::-webkit-scrollbar{width:5px;}
  .td-chat-messages::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:4px;}
  .td-msg-row{display:flex;flex-direction:column;max-width:84%;}
  .td-msg-row.msg-right{align-self:flex-end;align-items:flex-end;}
  .td-msg-row.msg-left{align-self:flex-start;align-items:flex-start;}
  .td-msg-row.msg-center{align-self:center;align-items:center;max-width:100%;}
  .td-msg-header{font-size:11px;color:var(--td-light-slate);margin-bottom:3px;display:flex;gap:5px;align-items:center;}
  .td-msg-header strong{color:var(--td-grey);font-weight:600;}
  .msg-right .td-msg-header{flex-direction:row-reverse;}
  .td-msg-bubble{padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.5;word-break:break-word;}
  .msg-right .td-msg-bubble{background:var(--td-primary);color:var(--td-white);border-bottom-right-radius:2px;}
  .msg-left .td-msg-bubble{background:var(--td-white);color:var(--td-dark);border:1px solid var(--td-light-grey);border-bottom-left-radius:2px;}
  .td-msg-system{font-size:11px;font-weight:600;color:var(--td-light-slate);background:rgba(0,0,0,0.04);
    padding:3px 11px;border-radius:12px;text-align:center;}
  .td-msg-system.sys-danger{background:rgba(239,68,68,0.1);color:var(--td-danger);}
  .td-msg-system.sys-primary{background:rgba(27,58,107,0.08);color:var(--td-primary);}
  .td-msg-system.sys-gold{background:rgba(217,119,6,0.08);color:#D97706;}
  .td-msg-system.sys-success{background:rgba(45,143,94,0.08);color:var(--td-success);}

  /* PDF card */
  .td-pdf-card{background:var(--td-white);border:1px solid var(--td-light-grey);border-radius:7px;
    padding:8px 10px;display:flex;gap:8px;align-items:center;min-width:220px;}
  .td-pdf-card-icon svg{width:22px;height:22px;fill:none;stroke:var(--td-danger);stroke-width:1.5;flex-shrink:0;}
  .td-pdf-card-info{display:flex;flex-direction:column;flex:1;min-width:0;}
  .td-pdf-card-title{font-size:12px;font-weight:600;color:var(--td-dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .td-pdf-card-version{font-size:11px;color:var(--td-light-slate);}
  .td-pdf-card-btn{background:var(--td-off-white);border:1px solid var(--td-light-grey);border-radius:5px;
    padding:3px 8px;font-size:11px;font-weight:600;color:var(--td-primary);cursor:pointer;flex-shrink:0;
    transition:all var(--td-tr);font-family:inherit;}
  .td-pdf-card-btn:hover{background:var(--td-primary);color:var(--td-white);border-color:var(--td-primary);}

  /* File card */
  .td-file-card{background:var(--td-white);border:1px solid var(--td-light-grey);border-radius:7px;
    padding:8px 10px;display:flex;gap:8px;align-items:center;min-width:200px;}
  .td-file-card-icon svg{width:20px;height:20px;fill:none;stroke:var(--td-steel-blue);stroke-width:1.5;flex-shrink:0;}
  .td-file-card-name{font-size:12px;font-weight:600;color:var(--td-dark);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .td-file-card-dl{background:none;border:none;color:var(--td-steel-blue);cursor:pointer;font-size:11px;font-weight:600;padding:0;}

  /* Audio player */
  .td-audio-player{display:flex;align-items:center;gap:9px;background:var(--td-white);
    border:1px solid var(--td-light-grey);border-radius:20px;padding:5px 12px;min-width:180px;}
  .td-audio-player audio{flex:1;height:28px;outline:none;}
  audio::-webkit-media-controls-panel{background:transparent;}

  /* Mic recording */
  .td-chat-icon-btn.rec-active{background:rgba(239,68,68,0.12)!important;color:var(--td-danger)!important;}
  .td-chat-icon-btn.rec-active svg{animation:td-pulse 1s infinite;}
  @keyframes td-pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
  .td-rec-timer{font-size:11px;font-weight:600;color:var(--td-danger);min-width:28px;text-align:right;}

  /* Chat images */
  .td-chat-img{max-width:160px;border-radius:6px;cursor:pointer;border:1px solid rgba(0,0,0,0.1);margin-top:4px;display:block;}

  /* Input area */
  .td-chat-input-area{display:flex;align-items:center;gap:5px;padding:7px 10px;background:var(--td-white);border-top:1px solid var(--td-light-grey);}
  .td-chat-input{flex:1;border:1px solid var(--td-light-grey);border-radius:20px;padding:7px 13px;
    font-size:13px;transition:border-color .2s;background:var(--td-off-white);font-family:inherit;}
  .td-chat-input:focus{border-color:var(--td-primary);background:var(--td-white);outline:none;}
  .td-chat-icon-btn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    border-radius:50%;border:none;background:transparent;color:var(--td-light-slate);cursor:pointer;
    transition:all .15s;flex-shrink:0;}
  .td-chat-icon-btn:hover{background:var(--td-off-white);color:var(--td-primary);}
  .td-chat-icon-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
  .td-chat-send-btn{background:var(--td-primary);color:white;border-radius:20px;padding:0 11px;width:auto;gap:5px;font-weight:600;font-size:12px;}
  .td-chat-send-btn:hover{background:var(--td-primary-hover);}
  .td-chat-send-btn svg{width:12px;height:12px;}

  /* Upload progress */
  .td-upload-progress{font-size:11px;color:var(--td-light-slate);padding:2px 8px;align-self:flex-end;}

  /* ── STATUS DROPDOWN ── */
  .td-status-dd{position:fixed;width:240px;background:var(--td-white);border:1px solid var(--td-light-grey);
    border-radius:10px;box-shadow:var(--td-shadow-dd);z-index:9000;display:none;flex-direction:column;overflow:hidden;}
  .td-status-dd.open{display:flex;}
  .td-sdd-section{padding:4px 0;}
  .td-sdd-label{font-size:10px;font-weight:700;color:var(--td-light-slate);text-transform:uppercase;letter-spacing:0.5px;padding:6px 13px 3px;}
  .td-sdd-opt{display:flex;align-items:center;justify-content:space-between;padding:8px 13px;cursor:pointer;transition:background var(--td-tr);}
  .td-sdd-opt:hover{background:var(--td-off-white);}
  .td-sdd-opt.current{background:rgba(27,58,107,0.04);}
  .td-sdd-cur{font-size:10px;font-weight:700;color:var(--td-primary);background:rgba(27,58,107,0.1);padding:1px 6px;border-radius:8px;}
  .td-sdd-divider{height:1px;background:var(--td-light-grey);margin:3px 0;}

  /* ── CONFIRM DIALOG ── */
  .td-confirm-overlay{position:fixed;inset:0;background:rgba(27,58,107,0.45);backdrop-filter:blur(3px);
    z-index:8000;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .22s;}
  .td-confirm-overlay.vis{opacity:1;pointer-events:auto;}
  .td-confirm-box{background:var(--td-white);border-radius:10px;box-shadow:var(--td-shadow-popup);
    width:390px;max-width:95vw;padding:22px;display:flex;flex-direction:column;gap:15px;
    transform:scale(0.97);transition:transform .22s;}
  .td-confirm-overlay.vis .td-confirm-box{transform:scale(1);}
  .td-confirm-title{font-size:15px;font-weight:700;color:var(--td-dark);}
  .td-confirm-body{font-size:13px;color:var(--td-grey);line-height:1.6;}
  .td-confirm-transition{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap;}
  .td-confirm-arrow{color:var(--td-light-slate);font-size:17px;}
  .td-confirm-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:4px;}

  /* ── CANCEL MODAL ── */
  .td-cancel-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:7000;display:flex;
    align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .22s;}
  .td-cancel-overlay.vis{opacity:1;pointer-events:auto;}
  .td-cancel-box{background:var(--td-white);width:430px;max-width:95vw;border-radius:10px;padding:22px;
    box-shadow:var(--td-shadow-popup);display:flex;flex-direction:column;gap:14px;
    transform:scale(0.96);transition:transform .22s;}
  .td-cancel-overlay.vis .td-cancel-box{transform:scale(1);}
  .td-cancel-title{font-size:15px;font-weight:700;color:var(--td-dark);}
  .td-cancel-recap{background:var(--td-off-white);border:1px solid var(--td-light-grey);border-radius:7px;padding:11px 13px;}
  .td-cancel-recap-id{font-size:13px;font-weight:700;color:var(--td-primary);}
  .td-cancel-recap-sub{font-size:12px;color:var(--td-grey);margin-top:3px;}
  .td-reason-opts{display:flex;flex-direction:column;gap:6px;}
  .td-reason-opt{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1.5px solid var(--td-light-grey);
    border-radius:7px;cursor:pointer;transition:all var(--td-tr);}
  .td-reason-opt:hover{border-color:var(--td-steel-blue);}
  .td-reason-opt.sel{border-color:var(--td-primary);background:rgba(27,58,107,0.04);}
  .td-reason-opt input{accent-color:var(--td-primary);flex-shrink:0;}
  .td-reason-opt-lbl{font-size:13px;font-weight:500;color:var(--td-dark);}
  .td-cancel-textarea{width:100%;padding:8px 11px;border:1.5px solid var(--td-light-grey);border-radius:6px;
    font-size:13px;resize:vertical;min-height:64px;font-family:inherit;transition:border-color var(--td-tr);box-sizing:border-box;}
  .td-cancel-textarea:focus{border-color:var(--td-danger);outline:none;}
  .td-cancel-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:4px;}

  /* ── LIGHTBOX ── */
  .td-lightbox-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:10000;display:flex;
    align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .22s;}
  .td-lightbox-overlay.vis{opacity:1;pointer-events:auto;}
  .td-lightbox-img{max-width:90vw;max-height:90vh;border-radius:7px;}
  .td-lightbox-close{position:absolute;top:16px;right:16px;color:white;background:rgba(255,255,255,0.12);
    border:none;border-radius:50%;width:36px;height:36px;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .td-lightbox-close:hover{background:rgba(255,255,255,0.25);}

  /* ── TOAST ── */
  .td-toast-container{position:fixed;top:18px;right:22px;z-index:11000;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
  .td-toast{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-radius:8px;
    box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:240px;max-width:360px;border-left:4px solid var(--td-success);
    animation:td-slide-in .25s ease;pointer-events:auto;}
  .td-toast.error{border-left-color:var(--td-danger);}
  .td-toast.warning{border-left-color:var(--td-warning);}
  .td-toast.info{border-left-color:var(--td-steel-blue);}
  .td-toast-icon svg{width:16px;height:16px;stroke:var(--td-success);fill:none;stroke-width:2;}
  .td-toast.error .td-toast-icon svg{stroke:var(--td-danger);}
  .td-toast.warning .td-toast-icon svg{stroke:var(--td-warning);}
  .td-toast.info .td-toast-icon svg{stroke:var(--td-steel-blue);}
  .td-toast-msg{font-size:13px;font-weight:500;color:var(--td-dark);flex:1;}
  .td-toast-dismiss{background:none;border:none;color:var(--td-light-slate);cursor:pointer;font-size:14px;padding:2px 3px;}
  @keyframes td-slide-in{from{opacity:0;transform:translateX(48px);}to{opacity:1;transform:translateX(0);}}

  /* ── RESPONSIVE ── */
  @media(max-width:1024px){.td-popup-body{flex-direction:column;}.td-popup-left,.td-popup-right{flex:none;width:100%;}}
  @media(max-width:768px){.td-popup-overlay{padding:0;}.td-popup-modal{width:100%;max-width:100%;height:100vh;border-radius:0;}
    .td-popup-header{padding:10px 14px;}.td-popup-header-center{display:none;}.td-info-grid{grid-template-columns:1fr;}}
  `;

  /* ── STATUS CONFIG ──
     Lit la SOURCE UNIQUE partagée (ticket_table.js). Le littéral ci-dessous
     n'est qu'un repli pour les pages chargeant ce popup sans ticket_table.js. */
  var SC = (global.TicketTable && global.TicketTable.STATUS_STYLE) || {
    "Envoyé":                {bg:"rgba(143,163,191,0.15)", color:"#58595B"},
    "Assigné":               {bg:"rgba(74,127,181,0.12)",  color:"#4A7FB5"},
    "Attente pièce":         {bg:"rgba(212,120,10,0.12)",  color:"#D4780A"},
    "En route":              {bg:"rgba(232,168,23,0.12)",  color:"#B8860B"},
    "En Réparation":         {bg:"#FEF3F2",                color:"#F04438"},
    "Maintenance à distance":{bg:"#F0FDF4",                color:"#16A34A"},
    "Remplir le rapport":    {bg:"rgba(217,119,6,0.12)",   color:"#D97706"},
    "Terminé":               {bg:"rgba(45,143,94,0.12)",   color:"#2D8F5E"},
    "Annulé":                {bg:"#F1F5F9",                color:"#64748B"}
  };
  var PATH_TERRAIN  = ["Assigné","Attente pièce","En route","En Réparation","Terminé"];
  var PATH_DISTANCE = ["Maintenance à distance","Terminé"];

  /* ── STATE ── */
  var state = {
    ticketId:null, role:"manager", onChange:null,
    stopPoll:null, _current:null, _editingReport:false, _pendingStatus:null,
    _lastMsgCount:0, _scrollTo:null, _rptImage:null,
    _editingEvaluation:false, _pendingRating:0, _pendingComment:null
  };
  var els = {};

  /* ── SVG ICONS ── */
  var ICON = {
    close:      '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    chevron:    '<svg class="td-arr" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>',
    check:      '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    mapPin:     '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    warning:    '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:       '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    download:   '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    attach:     '<svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    mic:        '<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    send:       '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    pdf:        '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    file:       '<svg viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    image:      '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    infoCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    toastOk:    '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    toastErr:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    search:     '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    plus:       '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  };

  /* ── UTILITIES ── */
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function fmtDuration(ms){
    if(ms==null) return "—";
    var tot=Math.floor(ms/60000), d=Math.floor(tot/1440), h=Math.floor((tot%1440)/60), m=tot%60;
    if(d>0) return d+"j "+String(h).padStart(2,"0")+"h "+String(m).padStart(2,"0")+"m";
    return String(h).padStart(2,"0")+"h "+String(m).padStart(2,"0")+"m";
  }

  function fmtTime(iso){
    try{
      var dt=new Date(iso);
      return dt.toLocaleDateString("fr-FR")+" "+dt.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
    }catch(e){return iso;}
  }

  function statusBadgeHTML(s){
    // "Terminé (Terrain)" / "Terminé (à Distance)" héritent du style de "Terminé".
    var sc=SC[s]||SC[String(s).split(" (")[0]]||{bg:"#eee",color:"#333"};
    return '<span class="td-status-badge" style="background:'+sc.bg+';color:'+sc.color+';">'+esc(s)+'</span>';
  }

  /* Libellé d'affichage du statut réel (différencie les deux Terminé). */
  function displayStatusOf(t){
    if(t.status==="Terminé"&&t.termine_via)
      return t.termine_via==="distance"?"Terminé (à Distance)":"Terminé (Terrain)";
    return t.status;
  }

  function isNormalNext(from, to){
    var paths=[
      ["Envoyé","Assigné","Attente pièce","En route","En Réparation","Terminé"],
      ["Envoyé","Assigné","Maintenance à distance","Terminé"]
    ];
    for(var i=0;i<paths.length;i++){
      var idx=paths[i].indexOf(from);
      if(idx!==-1 && idx+1<paths[i].length && paths[i][idx+1]===to) return true;
    }
    return false;
  }

  /* ── TOAST ── */
  function _toast(msg, type){
    type=type||"success";
    if(typeof global.showToast==="function" && !els.toastContainer){ global.showToast(msg,type); return; }
    if(!els.toastContainer) return;
    var icons={success:ICON.toastOk, error:ICON.toastErr, warning:ICON.warning, info:ICON.info};
    var t=document.createElement("div");
    t.className="td-toast "+type;
    t.innerHTML='<div class="td-toast-icon">'+(icons[type]||icons.info)+'</div>'+
      '<div class="td-toast-msg">'+esc(msg)+'</div>'+
      '<button class="td-toast-dismiss" onclick="this.parentElement.remove()">×</button>';
    els.toastContainer.appendChild(t);
    setTimeout(function(){ if(t.parentElement) t.remove(); },4500);
  }

  /* ── DOM INJECTION (once) ── */
  function injectOnce(){
    if(document.getElementById("td-style")) return;
    var st=document.createElement("style"); st.id="td-style"; st.textContent=STYLE;
    document.head.appendChild(st);

    /* Main overlay */
    var ov=document.createElement("div");
    ov.className="td-popup-overlay"; ov.id="td-popup-overlay";
    ov.innerHTML=
      '<div class="td-popup-modal">'+
        '<div class="td-popup-header">'+
          '<div class="td-popup-logo"><img src="/static/stokvis360.png" alt="Stokvis 360" style="height:28px;width:auto;object-fit:contain;display:block;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span style="display:none">STOKVIS <span>360</span></span></div>'+
          '<div class="td-popup-header-center">'+
            '<div class="td-popup-title">DÉTAILS DU TICKET</div>'+
            '<div class="td-status-trigger" id="td-status-trigger">'+
              '<span id="td-status-badge"></span>'+ICON.chevron+
            '</div>'+
            '<div class="td-popup-sentby" id="td-sent-by"></div>'+
          '</div>'+
          '<div class="td-popup-header-right">'+
            '<button class="td-btn-danger-outline" id="td-btn-cancel">'+ICON.close+' Annuler le ticket</button>'+
            '<button class="td-popup-close" id="td-close">'+ICON.close+'</button>'+
          '</div>'+
        '</div>'+
        '<div class="td-rapport-banner" id="td-rapport-banner">'+
          ICON.warning+
          '<span class="td-rapport-banner-text">Rapport d\'intervention requis pour clôturer ce ticket.</span>'+
          '<button class="td-rapport-banner-btn" id="td-banner-btn">Remplir le rapport →</button>'+
        '</div>'+
        '<div class="td-popup-body" id="td-popup-body">'+
          '<div class="td-popup-left" id="td-left"></div>'+
          '<div class="td-popup-right" id="td-right"></div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(ov);

    /* Status dropdown */
    var sdd=document.createElement("div"); sdd.className="td-status-dd"; sdd.id="td-status-dd";
    document.body.appendChild(sdd); els.statusDd=sdd;

    /* Confirm dialog */
    var cf=document.createElement("div"); cf.className="td-confirm-overlay"; cf.id="td-confirm-overlay";
    cf.innerHTML=
      '<div class="td-confirm-box">'+
        '<div class="td-confirm-title">Confirmer le changement</div>'+
        '<div class="td-confirm-body" id="td-confirm-body">Vous allez effectuer un changement inhabituel. Toute modification est tracée (⚠).</div>'+
        '<div class="td-confirm-transition" id="td-confirm-transition"></div>'+
        '<div class="td-confirm-actions">'+
          '<button class="td-btn-secondary" id="td-confirm-no">Annuler</button>'+
          '<button class="td-btn-primary" id="td-confirm-yes">Confirmer</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(cf); els.confirm=cf;

    /* Cancel modal */
    var cm=document.createElement("div"); cm.className="td-cancel-overlay"; cm.id="td-cancel-overlay";
    cm.innerHTML=
      '<div class="td-cancel-box" onclick="event.stopPropagation()">'+
        '<div class="td-cancel-title">Annuler le ticket</div>'+
        '<div class="td-cancel-recap" id="td-cancel-recap"></div>'+
        '<div>'+
          '<div style="font-size:11px;font-weight:700;color:var(--td-grey);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:7px;">Raison <span style="color:var(--td-danger)">*</span></div>'+
          '<div class="td-reason-opts" id="td-reason-opts">'+
            '<label class="td-reason-opt"><input type="radio" name="td-cr" value="Doublon"><span class="td-reason-opt-lbl">Doublon</span></label>'+
            '<label class="td-reason-opt"><input type="radio" name="td-cr" value="Problème résolu"><span class="td-reason-opt-lbl">Problème résolu</span></label>'+
            '<label class="td-reason-opt"><input type="radio" name="td-cr" value="Envoi par erreur"><span class="td-reason-opt-lbl">Envoi par erreur</span></label>'+
            '<label class="td-reason-opt"><input type="radio" name="td-cr" value="Autre raison"><span class="td-reason-opt-lbl">Autre raison</span></label>'+
          '</div>'+
        '</div>'+
        '<div>'+
          '<div style="font-size:11px;font-weight:700;color:var(--td-grey);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:5px;">Commentaire <span style="font-weight:400;color:var(--td-light-slate);">(optionnel)</span></div>'+
          '<textarea class="td-cancel-textarea" id="td-cancel-comment" placeholder="Précisez si nécessaire…"></textarea>'+
        '</div>'+
        '<div class="td-cancel-actions">'+
          '<button class="td-btn-secondary" id="td-cancel-back">Retour</button>'+
          '<button class="td-btn-danger" id="td-cancel-confirm" disabled>Confirmer l\'annulation</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(cm); els.cancelModal=cm;

    /* Lightbox */
    var lb=document.createElement("div"); lb.className="td-lightbox-overlay"; lb.id="td-lightbox";
    lb.innerHTML='<button class="td-lightbox-close">×</button><img class="td-lightbox-img" id="td-lightbox-img" src="" alt="">';
    document.body.appendChild(lb); els.lightbox=lb; els.lightboxImg=lb.querySelector("#td-lightbox-img");

    /* Toast container */
    var tc=document.createElement("div"); tc.className="td-toast-container"; tc.id="td-toast-container";
    document.body.appendChild(tc); els.toastContainer=tc;

    /* Cache refs */
    els.overlay=ov;
    els.body=ov.querySelector("#td-popup-body");
    els.left=ov.querySelector("#td-left");
    els.right=ov.querySelector("#td-right");
    els.statusBadge=ov.querySelector("#td-status-badge");
    els.sentBy=ov.querySelector("#td-sent-by");
    els.statusTrigger=ov.querySelector("#td-status-trigger");
    els.btnCancel=ov.querySelector("#td-btn-cancel");
    els.banner=ov.querySelector("#td-rapport-banner");
    els.bannerBtn=ov.querySelector("#td-banner-btn");

    /* ── DELEGATED CHAT EVENTS (on stable parent #td-right) ── */
    els.right.addEventListener("keydown", function(e){
      if(e.target.id==="td-chat-text" && e.key==="Enter" && !e.shiftKey){ e.preventDefault(); _send(); }
    });
    els.right.addEventListener("click", function(e){
      if(e.target.id==="td-chat-send" || e.target.closest("#td-chat-send"))     { _send(); return; }
      if(e.target.id==="td-chat-attach-btn" || e.target.closest("#td-chat-attach-btn"))
        { document.getElementById("td-chat-file-input") && document.getElementById("td-chat-file-input").click(); return; }
      if(e.target.id==="td-chat-mic-btn" || e.target.closest("#td-chat-mic-btn")) { _toggleMic(); return; }
    });
    els.right.addEventListener("change", function(e){
      if(e.target.id==="td-chat-file-input") { _attachFile(e); }
    });

    /* Close */
    ov.querySelector("#td-close").addEventListener("click", close);
    ov.addEventListener("mousedown", function(e){ if(e.target===ov) close(); });

    /* Lightbox */
    lb.addEventListener("click", function(e){ if(e.target===lb||e.target.classList.contains("td-lightbox-close")) lb.classList.remove("vis"); });

    /* Status trigger */
    els.statusTrigger.addEventListener("click", function(e){
      if(!els.statusTrigger.classList.contains("terminal")){ e.stopPropagation(); openStatusDd(); }
    });
    document.addEventListener("mousedown", function(e){
      if(sdd.classList.contains("open")&&!sdd.contains(e.target)&&!els.statusTrigger.contains(e.target))
        sdd.classList.remove("open");
    });

    /* Confirm dialog */
    cf.querySelector("#td-confirm-no").addEventListener("click", function(){ cf.classList.remove("vis"); state._pendingStatus=null; });
    cf.querySelector("#td-confirm-yes").addEventListener("click", function(){
      cf.classList.remove("vis");
      if(state._pendingStatus){
        _applyStatus(state._pendingStatus, state._pendingVia);
        state._pendingStatus=null; state._pendingVia=null;
      }
    });

    /* Cancel modal */
    els.btnCancel.addEventListener("click", openCancelModal);
    cm.addEventListener("click", function(e){ if(e.target===cm) closeCancelModal(); });
    cm.querySelector("#td-cancel-back").addEventListener("click", closeCancelModal);
    cm.querySelector("#td-cancel-confirm").addEventListener("click", executeCancel);
    cm.querySelectorAll(".td-reason-opt").forEach(function(opt){
      opt.addEventListener("click", function(){
        cm.querySelectorAll(".td-reason-opt").forEach(function(o){ o.classList.remove("sel"); });
        opt.classList.add("sel");
        cm.querySelector("#td-cancel-confirm").disabled=false;
      });
    });

    /* Banner → scroll to relevant section (rapport for tech, eval for client) */
    els.bannerBtn.addEventListener("click", function(){
      var targetId=els.bannerBtn.getAttribute("data-scroll")||"td-rapport-section";
      var sec=document.getElementById(targetId);
      var body=els.body;
      if(sec && body){
        var secTop=sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        body.scrollTo({top:secTop-12, behavior:"smooth"});
      }
    });

    /* ESC */
    document.addEventListener("keydown", function(e){
      if(e.key==="Escape"){
        if(lb.classList.contains("vis")){ lb.classList.remove("vis"); e.stopImmediatePropagation(); return; }
        if(cf.classList.contains("vis")){ cf.classList.remove("vis"); state._pendingStatus=null; e.stopImmediatePropagation(); return; }
        if(cm.classList.contains("vis")){ closeCancelModal(); e.stopImmediatePropagation(); return; }
        if(sdd.classList.contains("open")){ sdd.classList.remove("open"); e.stopImmediatePropagation(); return; }
        if(ov.classList.contains("open")) { close(); e.stopImmediatePropagation(); }
      }
    });
  }

  /* ── STATUS BADGE ── */
  function setStatusBadge(displayStatus, realStatus){
    els.statusBadge.innerHTML=statusBadgeHTML(displayStatus);
    var isTerminal=realStatus==="Terminé"||realStatus==="Annulé";
    if(state.role==="technicien" && !isTerminal){
      els.statusTrigger.classList.remove("terminal");
      var arr=els.statusTrigger.querySelector(".td-arr"); if(arr) arr.style.display="";
    } else {
      els.statusTrigger.classList.add("terminal");
      var arr=els.statusTrigger.querySelector(".td-arr"); if(arr) arr.style.display="none";
    }
    var canCancel=(state.role==="manager"||state.role==="client") && !isTerminal;
    els.btnCancel.style.display=canCancel?"inline-flex":"none";
    var t=state._current;
    // "Envoyé par X" : visible dans tous les portails (X = raison sociale du client).
    if(els.sentBy) els.sentBy.innerHTML=t&&t.client_name
      ? 'Envoyé par <strong>'+esc(t.client_name)+'</strong>' : '';
    var showBannerTech=state.role==="technicien" && realStatus==="Terminé" && t && !t.report && !state._editingReport;
    var showBannerClient=state.role==="client" && realStatus==="Terminé" && t && !t.evaluation && !state._editingEvaluation;
    var showBanner=showBannerTech||showBannerClient;
    els.banner.classList.toggle("show", !!showBanner);
    if(showBannerTech){
      els.banner.querySelector(".td-rapport-banner-text").textContent="Rapport d'intervention requis pour clôturer ce ticket.";
      els.bannerBtn.textContent="Remplir le rapport →";
      els.bannerBtn.setAttribute("data-scroll","td-rapport-section");
    } else if(showBannerClient){
      els.banner.querySelector(".td-rapport-banner-text").textContent="L'intervention est terminée — notez la qualité du service.";
      els.bannerBtn.textContent="Noter le service →";
      els.bannerBtn.setAttribute("data-scroll","td-eval-section");
    }
  }

  /* ── STATUS DROPDOWN ── */
  function openStatusDd(){
    var t=state._current; if(!t) return;
    var cur=t.status;
    // Chemin dans lequel le ticket est ENGAGÉ (les statuts intermédiaires sont
    // propres à un chemin) : on bloque le Terminé de l'AUTRE chemin.
    var engaged=(["Attente pièce","En route","En Réparation"].indexOf(cur)>=0)?"terrain"
      :(cur==="Maintenance à distance"?"distance":null);
    function optRow(s, via){
      var isCur=s===cur;
      var label=s;
      var blocked=false;
      if(s==="Terminé"&&via){
        label=via==="distance"?"Terminé (à Distance)":"Terminé (Terrain)";
        blocked=!!(engaged&&via!==engaged);
      }
      return '<div class="td-sdd-opt'+(isCur?" current":"")+(blocked?" blocked":"")+
        '" data-status="'+esc(s)+'"'+(via?' data-via="'+via+'"':'')+
        (blocked?' style="opacity:0.45;cursor:not-allowed;"':'')+'>'+
        statusBadgeHTML(label)+(isCur?'<span class="td-sdd-cur">Actuel</span>':"")+
      '</div>';
    }
    var html='<div class="td-sdd-section"><div class="td-sdd-label">Chemin Terrain</div>';
    PATH_TERRAIN.forEach(function(s){ html+=optRow(s, s==="Terminé"?"terrain":null); });
    html+='</div><div class="td-sdd-divider"></div><div class="td-sdd-section"><div class="td-sdd-label">Chemin Distance</div>';
    PATH_DISTANCE.forEach(function(s){ html+=optRow(s, s==="Terminé"?"distance":null); });
    html+='</div>';
    els.statusDd.innerHTML=html;
    els.statusDd.querySelectorAll(".td-sdd-opt").forEach(function(opt){
      opt.addEventListener("click", function(){
        if(opt.classList.contains("blocked")){
          var chemin=engaged==="terrain"?"Terrain":"Distance";
          _toast("Ce ticket suit le chemin "+chemin+" — utilisez le Terminé de ce chemin.","warning");
          return;
        }
        _pickStatus(opt.getAttribute("data-status"), opt.getAttribute("data-via"));
      });
    });
    var rect=els.statusTrigger.getBoundingClientRect();
    var left=rect.left;
    if(left+250>window.innerWidth-10) left=window.innerWidth-260;
    var spaceBelow=window.innerHeight-rect.bottom-12;
    els.statusDd.style.left=left+"px";
    if(spaceBelow<200){ els.statusDd.style.top="auto"; els.statusDd.style.bottom=(window.innerHeight-rect.top+4)+"px"; }
    else { els.statusDd.style.bottom="auto"; els.statusDd.style.top=(rect.bottom+4)+"px"; }
    els.statusDd.classList.add("open");
  }

  function _pickStatus(target, via){
    els.statusDd.classList.remove("open");
    var t=state._current; if(!t||t.status===target) return;
    var targetLabel=(target==="Terminé"&&via)
      ? (via==="distance"?"Terminé (à Distance)":"Terminé (Terrain)") : target;
    if(isNormalNext(t.status, target)){
      _applyStatus(target, via);
    } else {
      state._pendingStatus=target;
      state._pendingVia=via||null;
      els.confirm.querySelector("#td-confirm-transition").innerHTML=
        statusBadgeHTML(displayStatusOf(t))+'<span class="td-confirm-arrow">→</span>'+statusBadgeHTML(targetLabel);
      els.confirm.classList.add("vis");
    }
  }

  async function _applyStatus(target, via){
    try {
      await API.changeStatus(state.ticketId, target, null, "technicien", via);
      _toast(target==="Terminé"?"Remplissez le rapport pour clôturer le ticket":"Statut mis à jour : "+target,
             target==="Terminé"?"warning":"success");
    } catch(e){ _toast("Échec : "+e.message, "error"); }
    await refresh();
    if(state.onChange) state.onChange();
  }

  /* ── CANCEL MODAL ── */
  function openCancelModal(){
    var t=state._current; if(!t) return;
    els.cancelModal.querySelector("#td-cancel-recap").innerHTML=
      '<div class="td-cancel-recap-id">'+esc(t.id)+' — '+esc(t.titre)+'</div>'+
      '<div class="td-cancel-recap-sub">'+esc(t.client_name)+' · '+esc(t.reference)+'</div>';
    els.cancelModal.querySelectorAll(".td-reason-opt").forEach(function(o){ o.classList.remove("sel"); });
    els.cancelModal.querySelectorAll('input[name="td-cr"]').forEach(function(r){ r.checked=false; });
    els.cancelModal.querySelector("#td-cancel-comment").value="";
    els.cancelModal.querySelector("#td-cancel-confirm").disabled=true;
    els.cancelModal.classList.add("vis");
  }
  function closeCancelModal(){ els.cancelModal.classList.remove("vis"); }

  async function executeCancel(){
    var sel=els.cancelModal.querySelector('input[name="td-cr"]:checked');
    var raison=sel?sel.value:"Autre raison";
    var commentaire=els.cancelModal.querySelector("#td-cancel-comment").value.trim();
    try {
      await API.cancel(state.ticketId, raison, commentaire);
      _toast("Ticket "+state.ticketId+" annulé","info");
    } catch(e){ _toast("Échec : "+e.message,"error"); }
    closeCancelModal();
    await refresh();
    if(state.onChange) state.onChange();
  }

  /* ── RENDER LEFT ── */
  function renderLeft(t){
    var techs=(t.techs&&t.techs.length)
      ? t.techs.map(function(x){ return '<div>'+esc(x.name)+(x.telephone?' — '+esc(x.telephone):'')+' </div>'; }).join("")
      : "—";
    var loc=t.localisation
      ? '<a class="td-link-map" href="'+esc(t.localisation)+'" target="_blank" rel="noopener">'+ICON.mapPin+'Ouvrir sur Google Maps</a>'
      : '<span class="td-empty">Non renseignée.</span>';

    var info=
      '<div class="td-section"><div class="td-section-title">Informations du ticket</div>'+
      '<div class="td-info-grid">'+
        infoItem("Titre",'<span class="td-info-val bold">'+esc(t.titre_original||t.titre)+'</span>')+
        infoItem("Temps de résolution", t.status==="Terminé"?fmtDuration(t.resolution_time_ms):"—")+
        infoItem("Client", esc(t.client_name)+(t.client_telephone?' — '+esc(t.client_telephone):''))+
        infoItem("Technicien(s)", techs)+
        infoItem("Pôle", esc(t.pole))+
        infoItem("Marque", esc(t.marque))+
        infoItem("Catégorie", esc(t.categorie))+
        infoItem("Référence",'<span class="td-info-val mono">'+esc(t.reference)+'</span>')+
        infoItem("Identifiant Parc",'<span class="td-info-val mono">'+esc(t.parc_id || t.instance_id)+'</span>')+
        infoItem("Localisation", loc)+
      '</div></div>';

    /* Seuls les items SIGNIFICATIFS sont affichés : pannes cochées et champs
       renseignés. Les anciens tickets stockaient toute la checklist (items non
       cochés / champs vides) -> filtrage à l'affichage. */
    var checklist=(t.items||[]).filter(function(it){
      return it.type==="champ" ? String(it.value==null?"":it.value).trim() : it.checked;
    }).map(function(it){
      if(it.type==="panne")
        return '<div class="td-chk-item">'+ICON.check+'<span>'+esc(it.label)+'</span></div>';
      return '<div class="td-chk-field"><strong>'+esc(it.label)+' :</strong>&nbsp;'+esc(it.value)+'</div>';
    }).join("");
    if(!checklist) checklist='<div class="td-chk-item">'+ICON.check+'<span>Autre problème</span></div>';

    var desc=t.description?esc(t.description):'<span class="td-empty">Non renseignée.</span>';
    var images=(t.images&&t.images.length)
      ? '<div class="td-gal-grid">'+t.images.map(function(src){
          return '<img class="td-gal-thumb" src="'+esc(src)+'" onclick="TicketDetail._zoom(\''+esc(src)+'\')" alt="">';
        }).join("")+'</div>'
      : '<span class="td-empty">Aucune image jointe.</span>';

    var usageReadings=(t.usage_readings||[]).map(function(u){
      return '<div class="td-chk-field"><strong>'+esc(u.name)+' :</strong>&nbsp;'+esc(u.value)+(u.unit?'&nbsp;'+esc(u.unit):'')+'</div>';
    }).join("");
    var usageBlock=usageReadings
      ? '<div class="td-info-item"><span class="td-info-lbl">Indices d\'usage</span><div class="td-chk-list">'+usageReadings+'</div></div>'
      : '';

    var diag=
      '<div class="td-section"><div class="td-section-title">Pré-diagnostic (soumis par le client)</div>'+
      '<div class="td-info-grid single-col">'+
        usageBlock+
        '<div class="td-info-item"><span class="td-info-lbl">Éléments signalés</span><div class="td-chk-list">'+checklist+'</div></div>'+
        '<div class="td-info-item"><span class="td-info-lbl">Description</span><span class="td-info-val">'+desc+'</span></div>'+
        '<div class="td-info-item"><span class="td-info-lbl">Images client</span>'+images+'</div>'+
      '</div></div>';

    var timeline=(t.timeline||[]).map(function(e,i,arr){
      var isLast=i===arr.length-1;
      var isCancel=e.cancellation||e.status==="Annulé";
      var col=(SC[e.status]||{}).color||"var(--td-dark)";
      var html;
      if(isLast) html='<div class="td-tl-item tl-last'+(isCancel?' tl-cancel':'')+'" style="color:'+col+';">';
      else       html='<div class="td-tl-item'+(isCancel?' tl-cancel':'')+'">';
      // status_label différencie les deux Terminé ; assigned_to -> "Assigné à X".
      // Anciennes entrées Terminé sans `via` : repli sur le termine_via du ticket.
      var statusTxt=e.status_label||(e.status==="Terminé"?displayStatusOf({status:e.status,termine_via:t.termine_via}):e.status);
      if(!e.status_label&&e.status==="Assigné"&&e.assigned_to&&e.assigned_to.length)
        statusTxt="Assigné à "+e.assigned_to.join(", ");
      html+='<div class="td-tl-status">'+(e.unusual?"⚠ ":"")+esc(statusTxt)+'</div>'+
        '<div class="td-tl-time">'+fmtTime(e.timestamp)+'</div>'+
        '<div class="td-tl-by">par '+esc((function(){
          // 1re entrée "Envoyé" : le créateur est le client du ticket.
          if(e.status==="Envoyé"&&t.client_name) return t.client_name+" (Client)";
          // "Nom (Rôle)" résolu EN DIRECT côté serveur via actor_id.
          return e.actor_display||e.actor||"Système";
        })())+'</div>';
      if(isCancel&&t.cancellation){
        html+='<div class="td-tl-cancel-detail">'+
          '<span class="cr">Raison : '+esc(t.cancellation.raison)+'</span>'+
          (t.cancellation.commentaire?'<span class="cc">"'+esc(t.cancellation.commentaire)+'"</span>':'')+
          '</div>';
      }
      return html+'</div>';
    }).join("");

    var hist='<div class="td-section"><div class="td-section-title">Historique</div>'+
      '<div class="td-timeline">'+timeline+'</div></div>';

    els.left.innerHTML=info+diag+hist;
  }

  function infoItem(lbl, valHtml){
    return '<div class="td-info-item"><span class="td-info-lbl">'+lbl+'</span>'+
      (valHtml.indexOf('class="td-info-val')!==-1?valHtml:'<span class="td-info-val">'+valHtml+'</span>')+
      '</div>';
  }

  /* ── RENDER RIGHT ── */
  function renderRight(t){
    // Brouillon du rapport : si le formulaire est à l'écran, on capture les
    // champs AVANT de reconstruire (le polling peut re-rendre en pleine saisie).
    var titreEl=document.getElementById("td-r-titre");
    if(titreEl){
      state._rptDraft={
        titre:titreEl.value,
        situation:(document.getElementById("td-r-situation")||{}).value||"",
        travaux:(document.getElementById("td-r-travaux")||{}).value||""
      };
    }
    // Le menu de recherche de pièces peut être en cours d'utilisation : on note
    // s'il avait le focus pour le restaurer après reconstruction (cf. polling 6 s).
    state._rptPartWasFocused=!!(document.activeElement && document.activeElement.id==="td-rpt-part-search");
    els.right.innerHTML=renderReportSection(t)+renderEvalSection(t)+renderChatSection();
    _renderChatMessages(t.messages||[]);
    // Report image preview input
    var rptInput=document.getElementById("td-rpt-img-input");
    if(rptInput) rptInput.addEventListener("change", _previewRptImages);
    // Restaure l'état du menu de pièces (sélections déjà dans state._rptParts).
    var partSearch=document.getElementById("td-rpt-part-search");
    if(partSearch){
      if(state._rptPartWasFocused){
        partSearch.focus();
        var pv=partSearch.value; partSearch.value=""; partSearch.value=pv;  // caret en fin
      }
      _renderPartResults();
    }
    state._rptPartWasFocused=false;
    // Scroll to rapport if requested
    if(state._scrollTo==="rapport"){
      state._scrollTo=null;
      setTimeout(function(){
        var sec=document.getElementById("td-rapport-section");
        if(sec&&els.body) els.body.scrollTo({top:sec.getBoundingClientRect().top-els.body.getBoundingClientRect().top+els.body.scrollTop-12, behavior:"smooth"});
      },80);
    }
  }

  /* ── REPORT SECTION ── */
  function renderReportSection(t){
    var isTech=state.role==="technicien";
    var html='<div class="td-section" id="td-rapport-section"><div class="td-section-title">Rapport d\'intervention</div>';

    if(!isTech){
      if(t.status!=="Terminé"){
        html+='<div class="td-rpt-notice pending">'+ICON.infoCircle+'<span>Disponible une fois le ticket terminé.</span></div>';
      } else if(t.report){
        html+=reportReadOnly(t)+pdfDownloadBtn(t);
      } else {
        html+='<div class="td-eval-empty">Le rapport d\'intervention n\'est pas encore disponible.</div>';
      }
      return html+'</div>';
    }

    if(t.status!=="Terminé"){
      html+='<div class="td-rpt-notice pending">'+ICON.infoCircle+'<span>Disponible une fois le ticket terminé.</span></div>';
      return html+'</div>';
    }
    if(t.report && !state._editingReport){
      html+='<div class="td-rpt-notice ok">'+ICON.check+'<span>Rapport soumis · Version '+t.report.version+'</span></div>';
      html+=reportReadOnly(t);
      html+='<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:8px;">'+
        '<button class="td-btn-secondary" onclick="TicketDetail._editReport()">Mettre à jour</button></div>';
      return html+'</div>';
    }
    var r=t.report||{};
    // Seed des pièces utilisées (une seule fois par session d'édition) depuis le
    // rapport enregistré ; on ne garde que les piece_id (re-résolus à l'affichage).
    if(state._rptParts===null){
      state._rptParts=(r.used_parts||[]).map(function(p){ return p.piece_id; });
    }
    // Le brouillon (saisie en cours) prime sur le rapport enregistré.
    var d=state._rptDraft;
    // Le titre courant du ticket (qui reflète déjà un éventuel titre_override) sert
    // de valeur par défaut — le saisir ici remplacera le titre partout.
    var titre=d?d.titre:(r.titre_intervention||t.titre||_defaultTitle(t));
    var situation=d?d.situation:(r.situation||"");
    var travaux=d?d.travaux:(r.travaux||"");
    html+='<div class="td-rapport-form">'+
      '<div class="td-form-group"><label>Titre de l\'intervention <span class="req">*</span></label>'+
        '<input type="text" class="td-form-input" id="td-r-titre" value="'+esc(titre)+'">'+
        '<div class="td-ferr" id="td-err-titre">Ce champ est requis.</div></div>'+
      '<div class="td-form-group"><label>Situation constatée <span class="req">*</span></label>'+
        '<textarea class="td-form-textarea" id="td-r-situation" rows="3" placeholder="Décrivez la situation trouvée sur place…">'+esc(situation)+'</textarea>'+
        '<div class="td-ferr" id="td-err-situation">Ce champ est requis.</div></div>'+
      '<div class="td-form-group"><label>Travaux effectués <span class="req">*</span></label>'+
        '<textarea class="td-form-textarea" id="td-r-travaux" rows="3" placeholder="Listez les actions réalisées…">'+esc(travaux)+'</textarea>'+
        '<div class="td-ferr" id="td-err-travaux">Ce champ est requis.</div></div>'+
      partsFormHtml(t)+
      '<div class="td-form-group"><label>Photos <span style="font-weight:400;color:var(--td-light-slate);font-size:11px;">(optionnel)</span></label>'+
        '<div class="td-img-upload-area" onclick="document.getElementById(\'td-rpt-img-input\').click()">'+
          ICON.image+'<p>Cliquer pour ajouter des photos</p></div>'+
        '<input type="file" id="td-rpt-img-input" accept="image/*" multiple style="display:none;">'+
        '<div class="td-gal-grid" id="td-rpt-img-preview">'+_rptImagePreviewHtml()+'</div></div>'+
      '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:2px;">'+
        '<button class="td-btn-primary" onclick="TicketDetail._submitReport()">'+ICON.check+' '+
        (t.report?'Mettre à jour le rapport':'Soumettre le rapport')+'</button></div>'+
      '</div>';
    return html+'</div>';
  }

  function reportReadOnly(t){
    var html='<div class="td-rpt-ro">'+
      '<div class="td-rpt-ro-field"><span class="td-rpt-ro-lbl">Titre</span><span class="td-rpt-ro-val">'+esc(t.report.titre_intervention)+'</span></div>'+
      '<div class="td-rpt-ro-field"><span class="td-rpt-ro-lbl">Situation constatée</span><span class="td-rpt-ro-val">'+esc(t.report.situation)+'</span></div>'+
      '<div class="td-rpt-ro-field"><span class="td-rpt-ro-lbl">Travaux effectués</span><span class="td-rpt-ro-val">'+esc(t.report.travaux)+'</span></div>'+
      partsReadOnlyHtml(t);
    if(t.report.images&&t.report.images.length){
      html+='<div class="td-rpt-ro-field"><span class="td-rpt-ro-lbl">Photos</span><div class="td-gal-grid">'+
        t.report.images.map(function(src){ return '<img class="td-gal-thumb" src="'+esc(src)+'" onclick="TicketDetail._zoom(\''+esc(src)+'\')" alt="">'; }).join("")+
        '</div></div>';
    }
    return html+'</div>';
  }
  function pdfDownloadBtn(t){
    // Bouton « Télécharger PDF » retiré : aucun générateur réel n'est branché sur
    // ce popup partagé (le seul générateur, dans tickets_en_cours.html, lit des
    // champs factices absents de l'API ; html2pdf n'est pas chargé côté
    // manager/technicien). Voir audit H-7.
    return "";
  }
  function _defaultTitle(t){
    var p=(t.items||[]).filter(function(it){ return it.type==="panne"&&it.checked&&!it.system; })[0];
    return p?p.label:"Autre problème";
  }

  /* ── PIÈCES DE RECHANGE UTILISÉES ──
     Le technicien sélectionne des pièces du répertoire de SA référence machine.
     On ne mémorise que des piece_id (dans state._rptParts) ; le N°/la désignation
     sont toujours re-résolus pour suivre les renommages du catalogue. */
  function _partById(avail, pid){
    for(var i=0;i<(avail||[]).length;i++){ if(avail[i].piece_id===pid) return avail[i]; }
    return null;
  }
  // Bloc complet (label + note + zone dynamique) inséré dans le formulaire.
  function partsFormHtml(t){
    return '<div class="td-form-group td-parts-block">'+
      '<label>Pièces de rechange utilisées '+
        '<span style="font-weight:400;color:var(--td-light-slate);font-size:11px;">(optionnel)</span></label>'+
      '<div class="td-part-note">'+ICON.infoCircle+'<span>Le N° Pièce n\'est pas visible par le client.</span></div>'+
      '<div id="td-parts-dynamic">'+partsDynamicHtml(t)+'</div></div>';
  }
  // Zone re-rendue à chaque ajout/suppression (sans toucher aux autres champs).
  function partsDynamicHtml(t){
    var avail=t.available_parts||[];
    var selected=state._rptParts||[];
    if(!avail.length){
      return '<div class="td-part-empty">'+ICON.infoCircle+
        '<span>Aucune pièce au catalogue pour cette référence.</span></div>';
    }
    var list="";
    if(selected.length){
      var rows=selected.map(function(pid){
        var p=_partById(avail,pid);
        return '<div class="td-part-row">'+
          '<span class="td-part-num">'+esc(p?(p.num||"—"):"—")+'</span>'+
          '<span class="td-part-name">'+esc(p?p.name:"Pièce inconnue")+'</span>'+
          '<button type="button" class="td-part-del" title="Retirer la pièce" '+
            'onclick="TicketDetail._removePart(\''+esc(pid)+'\')">'+ICON.close+'</button>'+
        '</div>';
      }).join("");
      list='<div class="td-parts-list"><div class="td-part-head">'+
        '<span>N° Pièce</span><span>Désignation</span><span></span></div>'+rows+'</div>';
    }
    return list+
      '<div class="td-part-add">'+
        '<div class="td-part-search-wrap">'+ICON.search+
          '<input type="text" class="td-form-input td-part-search" id="td-rpt-part-search" autocomplete="off" '+
            'placeholder="Rechercher une pièce (N° ou désignation)…" value="'+esc(state._rptPartQuery||"")+'" '+
            'oninput="TicketDetail._partSearchInput(this.value)" onfocus="TicketDetail._partOpen()" '+
            'onblur="TicketDetail._partBlur()">'+
        '</div>'+
        '<div class="td-part-results" id="td-rpt-part-results"></div>'+
      '</div>';
  }
  // Liste filtrée du menu déroulant (re-rendue seule pendant la frappe).
  function _renderPartResults(){
    var box=document.getElementById("td-rpt-part-results");
    if(!box) return;
    var t=state._current, avail=(t&&t.available_parts)||[], selected=state._rptParts||[];
    if(!state._rptPartOpen){ box.classList.remove("show"); box.innerHTML=""; return; }
    var q=(state._rptPartQuery||"").trim().toLowerCase();
    var matches=avail.filter(function(p){
      if(selected.indexOf(p.piece_id)!==-1) return false;
      if(!q) return true;
      return (p.num||"").toLowerCase().indexOf(q)!==-1 || (p.name||"").toLowerCase().indexOf(q)!==-1;
    });
    if(!matches.length){
      var msg=(selected.length&&selected.length===avail.length)
        ? "Toutes les pièces sont déjà ajoutées." : "Aucune pièce ne correspond.";
      box.innerHTML='<div class="td-part-noopt">'+esc(msg)+'</div>';
    } else {
      box.innerHTML=matches.slice(0,50).map(function(p){
        // onmousedown (≠ click) : se déclenche AVANT le blur de l'input.
        return '<div class="td-part-opt" onmousedown="TicketDetail._addPart(\''+esc(p.piece_id)+'\')">'+
          '<span class="td-part-opt-num">'+esc(p.num||"—")+'</span>'+
          '<span class="td-part-opt-name">'+esc(p.name||"")+'</span></div>';
      }).join("");
    }
    box.classList.add("show");
  }
  function _renderPartsDynamic(){
    var host=document.getElementById("td-parts-dynamic");
    if(!host||!state._current) return;
    host.innerHTML=partsDynamicHtml(state._current);
    var s=document.getElementById("td-rpt-part-search");
    if(s) s.focus();
    _renderPartResults();
  }
  function _partOpen(){ state._rptPartOpen=true; _renderPartResults(); }
  function _partSearchInput(v){ state._rptPartQuery=v; state._rptPartOpen=true; _renderPartResults(); }
  function _partBlur(){
    setTimeout(function(){
      // Ne pas fermer si le focus est revenu sur le champ (ex. après un ajout).
      if(document.activeElement && document.activeElement.id==="td-rpt-part-search") return;
      state._rptPartOpen=false; _renderPartResults();
    },150);
  }
  function _addPart(pid){
    if(!state._rptParts) state._rptParts=[];
    if(state._rptParts.indexOf(pid)===-1) state._rptParts.push(pid);
    state._rptPartQuery=""; state._rptPartOpen=true;
    _renderPartsDynamic();
  }
  function _removePart(pid){
    if(state._rptParts){ var i=state._rptParts.indexOf(pid); if(i!==-1) state._rptParts.splice(i,1); }
    _renderPartsDynamic();
  }
  // Tableau lecture seule : 2 colonnes (technicien/manager), Désignation seule (client).
  function partsReadOnlyHtml(t){
    var parts=(t.report&&t.report.used_parts)||[];
    if(!parts.length) return "";  // section optionnelle : rien si aucune pièce
    var isClient=state.role==="client";
    var rows=parts.map(function(p){
      if(isClient) return '<tr><td class="td-part-td-name">'+esc(p.name||"")+'</td></tr>';
      return '<tr><td class="td-part-td-num">'+esc(p.num||"—")+'</td>'+
        '<td class="td-part-td-name">'+esc(p.name||"")+'</td></tr>';
    }).join("");
    var head=isClient?'<tr><th>Désignation</th></tr>'
      :'<tr><th>N° Pièce</th><th>Désignation</th></tr>';
    var note=isClient?"":'<div class="td-part-note" style="margin-top:6px;">'+ICON.infoCircle+
      '<span>Le N° Pièce n\'est pas visible par le client.</span></div>';
    return '<div class="td-rpt-ro-field"><span class="td-rpt-ro-lbl">Pièces de rechange utilisées</span>'+
      '<table class="td-parts-table">'+head+rows+'</table>'+note+'</div>';
  }

  /* ── EVAL SECTION ── */
  function renderEvalSection(t){
    var html='<div class="td-section" id="td-eval-section"><div class="td-section-title">Évaluation du client</div>';
    if(t.status!=="Terminé"){
      html+='<div class="td-eval-empty">En attente — le client pourra évaluer une fois le ticket terminé.</div>';
    } else if(state.role === "client") {
      if(t.evaluation && !state._editingEvaluation) {
        var stars="★".repeat(t.evaluation.note)+"☆".repeat(5-t.evaluation.note);
        html+='<div class="td-info-grid single-col" style="gap:10px;">'+
          '<div class="td-info-item"><span class="td-info-lbl">Note attribuée</span><div class="td-stars-display" style="color:#E8A817; font-size:20px;">'+stars+' · '+t.evaluation.note+'/5</div></div>';
        if(t.evaluation.commentaire)
          html+='<div class="td-info-item"><span class="td-info-lbl">Votre commentaire</span><div class="td-eval-comment-box">'+esc(t.evaluation.commentaire)+'</div></div>';
        html+='<button class="td-btn-secondary" onclick="TicketDetail._editEvaluation()" style="width:fit-content; margin-top:8px;">Modifier l\'évaluation</button>';
        html+='</div>';
      } else {
        var rating = state._pendingRating || 0;
        var ratingNums = '';
        for(var i=1; i<=5; i++) {
          var selClass = (i === rating) ? ' selected' : '';
          ratingNums += '<div class="td-rating-num' + selClass + '" onclick="TicketDetail._setRating(' + i + ')">' + i + '</div>';
        }
        var comment = state._pendingComment != null ? state._pendingComment : (t.evaluation ? t.evaluation.commentaire : '');
        var submitText = t.evaluation ? "Mettre à jour l'évaluation" : "Soumettre l'évaluation";
        var disabledAttr = (rating === 0) ? ' disabled' : '';
        
        html+='<div class="td-rapport-form">'+
          '<div class="td-form-group"><label>Votre note (sur 5) <span class="req">*</span></label>'+
            '<div class="td-rating-numbers">' + ratingNums + '</div></div>'+
          '<div class="td-form-group"><label>Commentaire <span style="font-weight:400;color:var(--td-light-slate);font-size:11px;">(optionnel)</span></label>'+
            '<textarea class="td-form-textarea" id="td-eval-comment-input" rows="3" placeholder="Partagez votre avis sur l\'intervention…">' + esc(comment) + '</textarea></div>'+
          '<div style="display:flex; gap:9px; flex-wrap:wrap; margin-top:4px;">'+
            '<button class="td-btn-primary" id="td-btn-submit-eval"' + disabledAttr + ' onclick="TicketDetail._submitEvaluation()">' + submitText + '</button>';
        if (t.evaluation) {
          html += '<button class="td-btn-secondary" onclick="TicketDetail._cancelEditEvaluation()">Annuler</button>';
        }
        html += '</div></div>';
      }
    } else {
      if(t.evaluation){
        var stars="★".repeat(t.evaluation.note)+"☆".repeat(5-t.evaluation.note);
        html+='<div class="td-info-grid single-col" style="gap:10px;">'+
          '<div class="td-info-item"><span class="td-info-lbl">Note</span><div class="td-stars-display">'+stars+' · '+t.evaluation.note+'/5</div></div>';
        if(t.evaluation.commentaire)
          html+='<div class="td-info-item"><span class="td-info-lbl">Commentaire</span><div class="td-eval-comment-box">'+esc(t.evaluation.commentaire)+'</div></div>';
        html+='</div>';
      } else {
        html+='<div class="td-eval-empty">En attente de l\'évaluation du client.</div>';
      }
    }
    return html+'</div>';
  }

  /* ── CHAT SECTION (static skeleton) ── */
  function renderChatSection(){
    return '<div class="td-section"><div class="td-section-title" style="margin-bottom:0;">Discussion du ticket</div>'+
      '<div class="td-chat-wrapper">'+
        '<div class="td-chat-messages" id="td-chat-msgs"></div>'+
        '<div class="td-chat-input-area">'+
          '<button class="td-chat-icon-btn" id="td-chat-attach-btn" title="Joindre fichier/image">'+ICON.attach+'</button>'+
          '<input type="file" id="td-chat-file-input" accept="image/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx" style="display:none;">'+
          '<button class="td-chat-icon-btn" id="td-chat-mic-btn" title="Message vocal">'+ICON.mic+'</button>'+
          '<span class="td-rec-timer" id="td-rec-timer" style="display:none;">0:00</span>'+
          '<input type="text" class="td-chat-input" id="td-chat-text" placeholder="Écrire un message…">'+
          '<button class="td-chat-icon-btn td-chat-send-btn" id="td-chat-send">Envoyer '+ICON.send+'</button>'+
        '</div>'+
      '</div></div>';
  }

  /* ── SMART CHAT UPDATE (only re-renders messages, doesn't rebuild entire right column) ── */
  function _updateChatOnly(messages){
    var box=document.getElementById("td-chat-msgs");
    if(!box) return;
    var count=messages?messages.length:0;
    if(count===state._lastMsgCount) return; // nothing new
    _renderChatMessages(messages||[]);
  }

  /* "Nom (Rôle)" dans la discussion — évite le doublon "Manager (Manager)"
     tant que les comptes manager nommés n'existent pas. */
  var CHAT_ROLE_LABELS={technicien:"Technicien", client:"Client", manager:"Manager"};
  function authorLabel(m){
    var lbl=CHAT_ROLE_LABELS[m.author_role];
    var name=m.author_name||lbl||"";
    return (lbl&&name&&name!==lbl)?name+" ("+lbl+")":name;
  }

  function _renderChatMessages(messages){
    var box=document.getElementById("td-chat-msgs");
    if(!box) return;
    var myRole=state.role;
    // Save scroll position — auto-scroll only if user was near bottom
    var wasAtBottom=box.scrollHeight-box.scrollTop-box.clientHeight < 60;

    box.innerHTML=messages.map(function(m){
      // System
      if(m.author_role==="system"||m.type==="system"||m.type==="system_status"||m.type==="system_cancel"||m.type==="system_eval"){
        var sysCls="td-msg-system";
        if(m.color==="green")     sysCls+=" sys-success";
        else if(m.color==="red")  sysCls+=" sys-danger";
        else if(m.color==="gold") sysCls+=" sys-gold";
        else                      sysCls+=" sys-primary";
        return '<div class="td-msg-row msg-center"><div class="'+sysCls+'">'+esc(m.content)+' · '+fmtTime(m.timestamp)+'</div></div>';
      }

      var mine=m.author_role===myRole;
      var side=mine?"msg-right":"msg-left";
      var header='<div class="td-msg-header"><strong>'+esc(authorLabel(m))+'</strong> • '+fmtTime(m.timestamp)+'</div>';
      var bubble="";

      // PDF card (même côté que les autres messages de l'auteur)
      if(m.type==="pdf_card"){
        return '<div class="td-msg-row '+side+'">'+header+
          '<div class="td-pdf-card">'+
            '<div class="td-pdf-card-icon">'+ICON.pdf+'</div>'+
            '<div class="td-pdf-card-info">'+
              '<span class="td-pdf-card-title">Rapport_'+esc(state.ticketId)+'_v'+(m.version||1)+'.pdf</span>'+
              '<span class="td-pdf-card-version">Version '+(m.version||1)+'</span>'+
            '</div>'+
          '</div></div>';
      }

      // Image attachment
      if(m.file_type==="image"||m.image){
        var imgSrc=m.file_url||m.image;
        bubble='<img class="td-chat-img" src="'+esc(imgSrc)+'" onclick="TicketDetail._zoom(\''+esc(imgSrc)+'\')" alt="image">';
        if(m.content&&m.content!==m.file_name)
          bubble='<div>'+esc(m.content)+'</div>'+bubble;
        return '<div class="td-msg-row '+side+'">'+header+
          '<div class="td-msg-bubble">'+bubble+'</div></div>';
      }
      // Audio
      if(m.file_type==="audio"){
        bubble='<div class="td-audio-player"><audio controls src="'+esc(m.file_url)+'"></audio></div>';
        return '<div class="td-msg-row '+side+'">'+header+
          '<div class="td-msg-bubble">'+bubble+'</div></div>';
      }
      // File attachment
      if(m.file_type==="file"&&m.file_url){
        bubble='<div class="td-file-card">'+
          '<div class="td-file-card-icon">'+ICON.file+'</div>'+
          '<span class="td-file-card-name">'+esc(m.file_name||"fichier")+'</span>'+
          '<a class="td-file-card-dl" href="'+esc(m.file_url)+'" target="_blank" download>Télécharger</a>'+
          '</div>';
        return '<div class="td-msg-row '+side+'">'+header+
          '<div class="td-msg-bubble">'+bubble+'</div></div>';
      }
      // Normal text
      return '<div class="td-msg-row '+side+'">'+header+
        '<div class="td-msg-bubble">'+esc(m.content)+'</div></div>';
    }).join("");

    state._lastMsgCount=messages.length;
    if(wasAtBottom) box.scrollTop=box.scrollHeight;
  }

  /* ── REPORT ACTIONS ── */
  function _editReport(){
    state._editingReport=true;
    state._rptDraft=null;  // repartir du rapport enregistré
    state._rptParts=null;  // re-seed des pièces depuis le rapport enregistré
    state._rptPartQuery=""; state._rptPartOpen=false;
    var t=state._current;
    state._rptImages=(t&&t.report&&t.report.images&&t.report.images.length)
      ? t.report.images.slice()
      : [];
    if(state._current) renderRight(state._current);
  }

  function _rptImagePreviewHtml(){
    if(!state._rptImages||!state._rptImages.length) return "";
    return state._rptImages.map(function(src,i){
      return '<div style="position:relative;display:inline-block;">'+
        '<img class="td-gal-thumb" src="'+esc(src)+'" onclick="TicketDetail._zoom(\''+esc(src)+'\')" alt="">'+
        '<button type="button" onclick="TicketDetail._removeRptImage('+i+')" title="Retirer la photo" '+
          'style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;background:var(--td-danger);color:#fff;'+
          'border:none;border-radius:50%;cursor:pointer;font-size:13px;line-height:1;">×</button></div>';
    }).join("");
  }

  /* Met à jour UNIQUEMENT la grille d'aperçu photos : ne JAMAIS re-rendre la
     colonne entière ici, sinon les champs en cours de saisie sont perdus. */
  function _refreshRptPreview(){
    var pv=document.getElementById("td-rpt-img-preview");
    if(pv) pv.innerHTML=_rptImagePreviewHtml();
  }

  function _removeRptImage(idx){
    if(state._rptImages) state._rptImages.splice(idx,1);
    _refreshRptPreview();
  }

  /* Upload immédiat vers /api/upload -> URL permanente sous /static/uploads/.
     Plusieurs fichiers peuvent être sélectionnés en une fois. */
  function _previewRptImages(e){
    var files=Array.from(e.target.files||[]);
    e.target.value="";
    if(!files.length) return;
    var invalid=files.filter(function(f){ return !/^image\//i.test(f.type); });
    if(invalid.length){ _toast("Seules les images sont acceptées","warning"); return; }
    if(!state._rptImages) state._rptImages=[];
    var preview=document.getElementById("td-rpt-img-preview");
    if(preview) preview.innerHTML='<span style="font-size:12px;color:var(--td-light-slate);">Envoi en cours…</span>';
    Promise.all(files.map(function(f){ return API.upload(f); })).then(function(results){
      results.forEach(function(r){ state._rptImages.push(r.url); });
      _refreshRptPreview();
    }).catch(function(err){
      _toast("Échec de l'envoi : "+err.message,"error");
      _refreshRptPreview();
    });
  }

  async function _submitReport(){
    var titre=(document.getElementById("td-r-titre")||{}).value||"";
    var situation=(document.getElementById("td-r-situation")||{}).value||"";
    var travaux=(document.getElementById("td-r-travaux")||{}).value||"";
    var ok=true;
    [["td-r-titre","td-err-titre",titre],["td-r-situation","td-err-situation",situation],["td-r-travaux","td-err-travaux",travaux]].forEach(function(p){
      var el=document.getElementById(p[0]), err=document.getElementById(p[1]);
      if(el&&!String(p[2]).trim()){ el.classList.add("err"); if(err) err.classList.add("vis"); ok=false; }
      else { if(el) el.classList.remove("err"); if(err) err.classList.remove("vis"); }
    });
    if(!ok){ _toast("Veuillez remplir les trois champs obligatoires.","error"); return; }
    try {
      await API.submitReport(state.ticketId, {
        titre_intervention:titre.trim(), situation:situation.trim(), travaux:travaux.trim(),
        used_parts:(state._rptParts||[]).map(function(pid){ return {piece_id:pid}; }),
        images: state._rptImages||[]
      });
      state._editingReport=false;
      state._rptImages=[];
      state._rptDraft=null;
      state._rptParts=null; state._rptPartQuery=""; state._rptPartOpen=false;
      _toast("Rapport soumis avec succès","success");
    } catch(e){ _toast("Échec : "+e.message,"error"); return; }
    await refresh();
    if(state.onChange) state.onChange();
  }

  /* ── CHAT ACTIONS ── */
  async function _send(){
    var input=document.getElementById("td-chat-text");
    var txt=input?input.value.trim():"";
    if(!txt||!state.ticketId) return;
    input.value="";
    try {
      await API.postMessage(state.ticketId, txt, "text");
      // Lightweight: only refresh chat
      var t=await API.ticket(state.ticketId);
      state._current=t;
      _updateChatOnly(t.messages||[]);
    } catch(e){ _toast("Échec de l'envoi : "+e.message,"error"); }
  }

  async function _attachFile(e){
    var file=e.target.files[0]; if(!file) return;
    e.target.value="";
    var isImage=/^image\//i.test(file.type);
    var isAudio=/^audio\//i.test(file.type);
    var fileType=isImage?"image":isAudio?"audio":"file";

    // Show uploading indicator
    var box=document.getElementById("td-chat-msgs");
    var prog=document.createElement("div");
    prog.className="td-upload-progress";
    prog.textContent="Envoi en cours…";
    if(box) box.appendChild(prog);

    try {
      var result=await API.upload(file);
      if(box&&prog.parentElement) prog.remove();
      await API.postMessage(state.ticketId, file.name, "text", null, result.url, result.name, fileType);
      var t=await API.ticket(state.ticketId);
      state._current=t;
      _updateChatOnly(t.messages||[]);
    } catch(err){
      if(box&&prog.parentElement) prog.remove();
      _toast("Échec de l'envoi : "+err.message,"error");
    }
  }

  /* ── VOICE NOTE ── */
  var _micRec=null, _micTimer=null, _micSec=0, _micChunks=[];

  function _toggleMic(){
    if(_micRec&&_micRec.state==="recording"){ _stopMic(); }
    else { _startMic(); }
  }

  function _startMic(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      _toast("Microphone non disponible sur ce navigateur","error"); return;
    }
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      _micChunks=[];
      _micRec=new MediaRecorder(stream);
      _micRec.ondataavailable=function(e){ if(e.data.size>0) _micChunks.push(e.data); };
      _micRec.onstop=function(){
        stream.getTracks().forEach(function(t){ t.stop(); });
        var blob=new Blob(_micChunks,{type:"audio/webm"});
        var file=new File([blob],"voice_"+Date.now()+".webm",{type:"audio/webm"});
        _sendAudioBlob(file);
      };
      _micRec.start();
      // UI
      var btn=document.getElementById("td-chat-mic-btn");
      if(btn) btn.classList.add("rec-active");
      var timer=document.getElementById("td-rec-timer");
      if(timer){ timer.style.display=""; timer.textContent="0:00"; }
      _micSec=0;
      _micTimer=setInterval(function(){
        _micSec++;
        if(timer) timer.textContent=Math.floor(_micSec/60)+":"+String(_micSec%60).padStart(2,"0");
      },1000);
    }).catch(function(err){ _toast("Micro refusé : "+err.message,"warning"); });
  }

  function _stopMic(){
    if(_micRec&&_micRec.state!=="inactive") _micRec.stop();
    clearInterval(_micTimer);
    var btn=document.getElementById("td-chat-mic-btn");
    if(btn) btn.classList.remove("rec-active");
    var timer=document.getElementById("td-rec-timer");
    if(timer) timer.style.display="none";
  }

  async function _sendAudioBlob(file){
    var box=document.getElementById("td-chat-msgs");
    var prog=document.createElement("div"); prog.className="td-upload-progress"; prog.textContent="Envoi du mémo vocal…";
    if(box) box.appendChild(prog);
    try {
      var result=await API.upload(file);
      if(box&&prog.parentElement) prog.remove();
      await API.postMessage(state.ticketId,"Mémo vocal","audio",null,result.url,result.name,"audio");
      var t=await API.ticket(state.ticketId);
      state._current=t;
      _updateChatOnly(t.messages||[]);
    } catch(err){
      if(box&&prog.parentElement) prog.remove();
      _toast("Échec de l'envoi : "+err.message,"error");
    }
  }

  function _zoom(src){ els.lightboxImg.src=src; els.lightbox.classList.add("vis"); }

  /* ── EVALUATION ACTIONS ── */
  function _setRating(val) {
    var input = document.getElementById("td-eval-comment-input");
    if(input) state._pendingComment = input.value;
    state._pendingRating = val;
    if(state._current) renderRight(state._current);
  }

  function _editEvaluation() {
    state._editingEvaluation = true;
    state._pendingRating = state._current.evaluation ? state._current.evaluation.note : 0;
    state._pendingComment = state._current.evaluation ? state._current.evaluation.commentaire : '';
    if(state._current) renderRight(state._current);
  }

  function _cancelEditEvaluation() {
    state._editingEvaluation = false;
    state._pendingRating = 0;
    state._pendingComment = null;
    if(state._current) renderRight(state._current);
  }

  async function _submitEvaluation() {
    if(!state.ticketId || !state._pendingRating) return;
    var commentInput = document.getElementById("td-eval-comment-input");
    var comment = commentInput ? commentInput.value.trim() : "";
    try {
      await API.submitEvaluation(state.ticketId, state._pendingRating, comment);
      state._editingEvaluation = false;
      state._pendingRating = 0;
      state._pendingComment = null;
      _toast("Évaluation enregistrée avec succès !", "success");
    } catch(e) {
      _toast("Échec : " + e.message, "error");
      return;
    }
    await refresh();
    if(state.onChange) state.onChange();
  }

  /* ── OPEN / REFRESH / CLOSE ── */
  function open(ticketId, opts){
    injectOnce();
    opts=opts||{};
    state.ticketId=ticketId;
    state.role=opts.role||(global.Session?Session.role():"manager");
    state.onChange=opts.onChange||null;
    state._editingReport=false;
    state._rptImage=null;
    state._rptImages=[];
    state._rptDraft=null;
    state._rptParts=null;
    state._rptPartQuery="";
    state._rptPartOpen=false;
    state._rptPartWasFocused=false;
    state._editingEvaluation=false;
    state._pendingRating=0;
    state._pendingComment=null;
    state._current=null;
    state._lastMsgCount=0;
    state._scrollTo=opts.scrollTo||null;

    els.overlay.classList.add("open");
    els.left.innerHTML='<div style="padding:18px;color:var(--td-light-slate);">Chargement…</div>';
    els.right.innerHTML='';
    if(state.stopPoll){ state.stopPoll(); state.stopPoll=null; }

    refresh().then(function(){
      // Start polling — smarter: only refresh if data hash changed
      var _prevHash="";
      function tick(){
        if(!state.ticketId) return;
        API.ticket(state.ticketId).then(function(t){
          var hash=t.status+(t.messages?t.messages.length:0)+(t.report?"r":"")+(t.evaluation?"e":"")+(t.timeline?t.timeline.length:0);
          if(hash===_prevHash){
            // Only update chat if new messages
            _updateChatOnly(t.messages||[]);
            return;
          }
          _prevHash=hash;
          state._current=t;
          var displayStatus=displayStatusOf(t);
          setStatusBadge(displayStatus,t.status);
          renderLeft(t);
          var chatBox=document.getElementById("td-chat-msgs");
          var prevScrollTop=chatBox?chatBox.scrollTop:0;
          renderRight(t);
          // Restore scroll position in chat if wasn't at bottom
          chatBox=document.getElementById("td-chat-msgs");
          if(chatBox&&prevScrollTop>0&&chatBox.scrollHeight-prevScrollTop-chatBox.clientHeight>80)
            chatBox.scrollTop=prevScrollTop;
        }).catch(function(){});
      }
      var timer=setInterval(tick, 6000);
      state.stopPoll=function(){ clearInterval(timer); };
    });
  }

  async function refresh(){
    if(!state.ticketId) return;
    try {
      var t=await API.ticket(state.ticketId);
      state._current=t;
      var displayStatus=displayStatusOf(t);
      setStatusBadge(displayStatus,t.status);
      renderLeft(t);
      renderRight(t);
    } catch(e){ /* réseau */ }
  }

  function close(){
    _stopMic();
    els.overlay.classList.remove("open");
    if(state.stopPoll){ state.stopPoll(); state.stopPoll=null; }
    state.ticketId=null; state._current=null; state._lastMsgCount=0;
  }

  /* ── PUBLIC API ── */
  global.TicketDetail={
    open:open, close:close, refresh:refresh,
    isOpen:function(){ return els.overlay&&els.overlay.classList.contains("open"); },
    current:function(){ return state._current; },
    _send:_send, _zoom:_zoom, _toast:_toast,
    _pickStatus:_pickStatus, _submitReport:_submitReport, _editReport:_editReport,
    _previewRptImages:_previewRptImages, _removeRptImage:_removeRptImage,
    _addPart:_addPart, _removePart:_removePart, _partSearchInput:_partSearchInput,
    _partOpen:_partOpen, _partBlur:_partBlur,
    _setRating:_setRating, _editEvaluation:_editEvaluation,
    _cancelEditEvaluation:_cancelEditEvaluation, _submitEvaluation:_submitEvaluation
  };
})(window);