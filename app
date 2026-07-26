<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vinifera — Wine Club Management Platform</title>
<script src="https://unpkg.com/lucide@latest"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --wine:#6B1E30; --wine-dark:#4A1220; --wine-light:#F9F0F2; --wine-mid:#8B3045;
  --gold:#C9993A; --gold-light:#FDF6E8;
  --text-primary:#1C1917; --text-secondary:#6B7280; --text-muted:#9CA3AF;
  --bg-page:#F7F5F3; --bg-card:#FFFFFF; --bg-sidebar:#1C0D13;
  --border:#E5E0DC; --border-strong:#D1C9C3;
  --success:#16A34A; --success-bg:#F0FDF4;
  --warning:#B45309; --warning-bg:#FFFBEB;
  --danger:#DC2626; --danger-bg:#FEF2F2;
  --info:#2563EB; --info-bg:#EFF6FF;
  --purple:#7C3AED; --purple-bg:#F5F3FF;
  --radius:10px; --radius-sm:6px;
  --shadow:0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.04);
  --shadow-md:0 4px 16px rgba(0,0,0,0.12);
  --transition:150ms ease; --sidebar-w:230px;
}
body { font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; font-size:15px; line-height:1.5; color:var(--text-primary); background:var(--bg-page); min-height:100vh; }
.app { display:flex; min-height:100vh; }

/* ==== SIDEBAR ==== */
.sidebar { width:var(--sidebar-w); background:var(--bg-sidebar); display:flex; flex-direction:column; position:fixed; top:0; left:0; bottom:0; z-index:100; overflow-y:auto; }
.sidebar-logo { padding:20px 18px 16px; border-bottom:1px solid rgba(255,255,255,0.07); }
.logo-mark { display:flex; align-items:center; gap:9px; }
.logo-icon { width:30px; height:30px; background:var(--wine); border-radius:7px; display:flex; align-items:center; justify-content:center; color:#fff; }
.logo-icon i { width:16px; height:16px; }
.logo-text { color:#fff; font-weight:700; font-size:16px; letter-spacing:-0.02em; }
.logo-sub { color:rgba(255,255,255,0.35); font-size:10px; text-transform:uppercase; letter-spacing:0.08em; }
.sidebar-section { padding:14px 10px 6px; }
.sidebar-section-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:rgba(255,255,255,0.28); padding:0 8px; margin-bottom:3px; }
.nav-item { display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:7px; color:rgba(255,255,255,0.5); font-size:13px; font-weight:500; cursor:pointer; transition:all var(--transition); margin-bottom:1px; border:none; background:none; width:100%; text-align:left; }
.nav-item:hover { background:rgba(255,255,255,0.07); color:rgba(255,255,255,0.85); }
.nav-item.active { background:var(--wine); color:#fff; }
.nav-item i { width:15px; height:15px; flex-shrink:0; }
.nav-badge { margin-left:auto; background:var(--danger); color:#fff; font-size:10px; font-weight:700; padding:1px 6px; border-radius:10px; }
.sidebar-footer { margin-top:auto; padding:12px 10px; border-top:1px solid rgba(255,255,255,0.07); }
.user-row { display:flex; align-items:center; gap:9px; }
.user-avatar { width:30px; height:30px; border-radius:50%; background:var(--wine-mid); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0; }
.user-name { color:rgba(255,255,255,0.75); font-size:12.5px; font-weight:500; }
.user-role { color:rgba(255,255,255,0.35); font-size:11px; }

/* ==== MAIN ==== */
.main { margin-left:var(--sidebar-w); flex:1; display:flex; flex-direction:column; min-height:100vh; }
.topbar { background:var(--bg-card); border-bottom:1px solid var(--border); padding:0 26px; height:54px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:50; }
.topbar-left { display:flex; align-items:center; gap:12px; }
.page-title { font-size:15px; font-weight:600; }
.breadcrumb { font-size:12.5px; color:var(--text-muted); }
.topbar-right { display:flex; align-items:center; gap:8px; }
.btn { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:var(--radius-sm); font-size:13px; font-weight:500; cursor:pointer; border:1px solid var(--border); background:var(--bg-card); color:var(--text-secondary); transition:all var(--transition); }
.btn:hover { background:var(--bg-page); color:var(--text-primary); }
.btn i { width:13px; height:13px; }
.btn-primary { background:var(--wine); color:#fff; border-color:var(--wine); }
.btn-primary:hover { background:var(--wine-mid); border-color:var(--wine-mid); }
.btn-danger { background:var(--danger); color:#fff; border-color:var(--danger); }
.btn-success { background:var(--success); color:#fff; border-color:var(--success); }
.btn-sm { padding:5px 10px; font-size:12px; }
.content { padding:24px; flex:1; }

/* ==== SCREENS ==== */
.screen { display:none; }
.screen.active { display:block; }

/* ==== CARDS ==== */
.card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); }
.card-header { padding:14px 18px 12px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
.card-title { font-size:13.5px; font-weight:600; }
.card-subtitle { font-size:11.5px; color:var(--text-muted); margin-top:1px; }
.card-body { padding:18px; }
.card-action { font-size:12.5px; color:var(--wine); font-weight:500; cursor:pointer; display:inline-flex; align-items:center; gap:4px; background:none; border:none; }
.card-action:hover { color:var(--wine-mid); }
.card-action i { width:13px; height:13px; }

/* ==== KPI ==== */
.kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
.kpi-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow); }
.kpi-label { font-size:11.5px; font-weight:500; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em; }
.kpi-value { font-size:26px; font-weight:700; color:var(--text-primary); margin:5px 0 3px; letter-spacing:-0.02em; }
.kpi-delta { font-size:12px; font-weight:500; display:flex; align-items:center; gap:3px; }
.kpi-delta.up { color:var(--success); } .kpi-delta.down { color:var(--danger); }
.kpi-delta i { width:12px; height:12px; }
.kpi-icon { width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; margin-bottom:9px; }
.kpi-icon i { width:17px; height:17px; }
.kpi-icon.wine { background:var(--wine-light); color:var(--wine); }
.kpi-icon.gold { background:var(--gold-light); color:var(--gold); }
.kpi-icon.green { background:var(--success-bg); color:var(--success); }
.kpi-icon.red { background:var(--danger-bg); color:var(--danger); }
.kpi-icon.blue { background:var(--info-bg); color:var(--info); }
.kpi-icon.purple { background:var(--purple-bg); color:var(--purple); }

/* ==== GRID HELPERS ==== */
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
.grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:18px; }
.grid-4 { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:14px; }
.grid-3-1 { display:grid; grid-template-columns:2fr 1fr; gap:18px; }
.grid-2-1 { display:grid; grid-template-columns:1.5fr 1fr; gap:18px; }
.mb-16 { margin-bottom:16px; }
.mb-20 { margin-bottom:20px; }
.mt-4 { margin-top:4px; } .mt-8 { margin-top:8px; } .mt-12 { margin-top:12px; } .mt-16 { margin-top:16px; } .mt-20 { margin-top:20px; }

/* ==== TABLE ==== */
.data-table { width:100%; border-collapse:collapse; }
.data-table th { padding:9px 14px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); background:var(--bg-page); border-bottom:1px solid var(--border); }
.data-table td { padding:11px 14px; font-size:13.5px; border-bottom:1px solid var(--border); vertical-align:middle; }
.data-table tr:last-child td { border-bottom:none; }
.data-table tr:hover td { background:var(--bg-page); }
.data-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
.data-table td.center { text-align:center; }

/* ==== BADGES ==== */
.badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:20px; font-size:11.5px; font-weight:600; }
.badge i { width:10px; height:10px; }
.badge-success { background:var(--success-bg); color:var(--success); }
.badge-warning { background:var(--warning-bg); color:var(--warning); }
.badge-danger { background:var(--danger-bg); color:var(--danger); }
.badge-info { background:var(--info-bg); color:var(--info); }
.badge-neutral { background:var(--bg-page); color:var(--text-secondary); border:1px solid var(--border); }
.badge-wine { background:var(--wine-light); color:var(--wine); }
.badge-purple { background:var(--purple-bg); color:var(--purple); }
.badge-gold { background:var(--gold-light); color:var(--gold); }

/* ==== PROGRESS ==== */
.progress-track { height:6px; background:var(--border); border-radius:4px; overflow:hidden; }
.progress-fill { height:100%; border-radius:4px; transition:width 0.4s ease; }
.pf-wine { background:var(--wine); } .pf-gold { background:var(--gold); }
.pf-success { background:var(--success); } .pf-danger { background:var(--danger); }
.pf-info { background:var(--info); } .pf-warning { background:var(--warning); }

/* ==== AI CHIP ==== */
.ai-chip { display:inline-flex; align-items:center; gap:5px; background:linear-gradient(135deg,#6B1E30,#9B4060); color:#fff; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; }
.ai-chip i { width:10px; height:10px; }

/* ==== SECTION HEADER ==== */
.section-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.section-title { font-size:14px; font-weight:700; }
.section-sub { font-size:12.5px; color:var(--text-muted); margin-top:1px; }

/* ==== FILTER BAR ==== */
.filter-bar { display:flex; align-items:center; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
.filter-input { padding:7px 12px; border-radius:var(--radius-sm); border:1px solid var(--border); font-size:13px; background:var(--bg-card); color:var(--text-primary); outline:none; min-width:200px; }
.filter-input:focus { border-color:var(--wine); }
.filter-select { padding:7px 10px; border-radius:var(--radius-sm); border:1px solid var(--border); font-size:13px; background:var(--bg-card); color:var(--text-primary); cursor:pointer; outline:none; }
.filter-select:focus { border-color:var(--wine); }

/* ==== FORM CONTROLS ==== */
.form-group { margin-bottom:13px; }
.form-label { font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:5px; display:block; }
.form-control { width:100%; padding:8px 12px; border-radius:var(--radius-sm); border:1px solid var(--border-strong); background:var(--bg-page); font-size:13.5px; color:var(--text-primary); outline:none; transition:border-color var(--transition); }
.form-control:focus { border-color:var(--wine); background:#fff; }
select.form-control { cursor:pointer; }
.form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.form-hint { font-size:11.5px; color:var(--text-muted); margin-top:3px; }

/* ==== STAT ROW ==== */
.stat-row { display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border); font-size:13.5px; }
.stat-row:last-child { border-bottom:none; }
.stat-label { color:var(--text-secondary); }
.stat-value { font-weight:600; }

/* ==== TIMELINE ==== */
.timeline { display:flex; flex-direction:column; }
.timeline-item { display:flex; gap:12px; padding-bottom:14px; position:relative; }
.timeline-item::before { content:''; position:absolute; left:13px; top:26px; bottom:0; width:1px; background:var(--border); }
.timeline-item:last-child::before { display:none; }
.timeline-dot { width:26px; height:26px; border-radius:50%; background:var(--bg-page); border:2px solid var(--border); display:flex; align-items:center; justify-content:center; flex-shrink:0; z-index:1; color:var(--text-muted); }
.timeline-dot i { width:11px; height:11px; }
.timeline-dot.wine { background:var(--wine-light); border-color:var(--wine); color:var(--wine); }
.timeline-dot.gold { background:var(--gold-light); border-color:var(--gold); color:var(--gold); }
.timeline-dot.success { background:var(--success-bg); border-color:var(--success); color:var(--success); }
.timeline-dot.danger { background:var(--danger-bg); border-color:var(--danger); color:var(--danger); }
.timeline-body { flex:1; }
.timeline-title { font-size:13.5px; font-weight:600; }
.timeline-meta { font-size:12px; color:var(--text-muted); margin-top:1px; }
.timeline-note { margin-top:5px; padding:7px 10px; background:var(--bg-page); border-radius:6px; font-size:12px; color:var(--text-secondary); border-left:3px solid var(--border); }

/* ==== PIPELINE STEPS ==== */
.pipeline-steps { display:flex; align-items:center; margin-bottom:14px; }
.pipeline-step { flex:1; text-align:center; position:relative; }
.pipeline-step::after { content:''; position:absolute; top:13px; left:50%; right:-50%; height:2px; background:var(--border); z-index:0; }
.pipeline-step:last-child::after { display:none; }
.step-dot { width:26px; height:26px; border-radius:50%; border:2px solid var(--border); background:var(--bg-card); display:flex; align-items:center; justify-content:center; margin:0 auto 5px; position:relative; z-index:1; color:var(--text-muted); }
.step-dot i { width:11px; height:11px; }
.step-label { font-size:10.5px; color:var(--text-muted); line-height:1.3; }
.pipeline-step.done .step-dot { background:var(--wine); border-color:var(--wine); color:#fff; }
.pipeline-step.done::after { background:var(--wine); }
.pipeline-step.active .step-dot { background:var(--bg-card); border-color:var(--wine); color:var(--wine); box-shadow:0 0 0 3px var(--wine-light); }
.pipeline-step.done .step-label, .pipeline-step.active .step-label { color:var(--text-primary); font-weight:500; }

/* ==== MODAL ==== */
.modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:200; align-items:center; justify-content:center; }
.modal-overlay.open { display:flex; }
.modal { background:var(--bg-card); border-radius:12px; padding:22px; width:480px; max-width:95vw; box-shadow:var(--shadow-md); max-height:90vh; overflow-y:auto; }
.modal-lg { width:640px; }
.modal-title { font-size:16px; font-weight:700; margin-bottom:3px; }
.modal-sub { font-size:13px; color:var(--text-secondary); margin-bottom:16px; }
.modal-footer { display:flex; gap:8px; margin-top:16px; padding-top:14px; border-top:1px solid var(--border); justify-content:flex-end; }

/* ==== TABS ==== */
.tabs { display:flex; gap:2px; background:var(--bg-page); border:1px solid var(--border); border-radius:8px; padding:3px; margin-bottom:18px; }
.tab-btn { flex:1; padding:6px 12px; border-radius:6px; font-size:13px; font-weight:500; text-align:center; cursor:pointer; color:var(--text-secondary); transition:all var(--transition); border:none; background:none; }
.tab-btn:hover { color:var(--text-primary); }
.tab-btn.active { background:var(--bg-card); color:var(--text-primary); box-shadow:var(--shadow); font-weight:600; }
.tab-panel { display:none; }
.tab-panel.active { display:block; }

/* ==== TOGGLE ==== */
.toggle-wrap { display:flex; align-items:center; gap:10px; }
.toggle { position:relative; width:40px; height:22px; }
.toggle input { opacity:0; width:0; height:0; }
.toggle-slider { position:absolute; inset:0; background:var(--border-strong); border-radius:22px; cursor:pointer; transition:0.3s; }
.toggle-slider::before { content:''; position:absolute; width:16px; height:16px; left:3px; top:3px; background:#fff; border-radius:50%; transition:0.3s; }
.toggle input:checked+.toggle-slider { background:var(--wine); }
.toggle input:checked+.toggle-slider::before { transform:translateX(18px); }
.toggle-label { font-size:13.5px; font-weight:500; }

/* ==== SPARKBARS ==== */
.sparkbar-row { display:flex; align-items:flex-end; gap:4px; height:52px; }
.sparkbar { flex:1; border-radius:3px 3px 0 0; background:var(--wine-light); cursor:pointer; transition:background var(--transition); }
.sparkbar:hover { background:var(--wine); }
.sparkbar.active { background:var(--wine); }
.sparkbar-labels { display:flex; gap:4px; margin-top:4px; }
.sparkbar-lbl { flex:1; font-size:10px; color:var(--text-muted); text-align:center; }

/* ==== CHIP / TAG ==== */
.chip { display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:500; border:1px solid var(--border); background:var(--bg-page); color:var(--text-secondary); cursor:pointer; transition:all var(--transition); }
.chip:hover { border-color:var(--wine); color:var(--wine); background:var(--wine-light); }
.chip.active { border-color:var(--wine); color:var(--wine); background:var(--wine-light); }
.chip i { width:12px; height:12px; }

/* ==== EMPTY STATE ==== */
.empty-state { text-align:center; padding:48px 16px; }
.empty-state i { width:40px; height:40px; color:var(--text-muted); margin-bottom:12px; }
.empty-state h3 { font-size:15px; font-weight:600; margin-bottom:4px; }
.empty-state p { font-size:13px; color:var(--text-secondary); }

/* ==== AVATAR ==== */
.avatar { width:32px; height:32px; border-radius:50%; background:var(--wine-light); color:var(--wine); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0; }
.avatar-lg { width:42px; height:42px; font-size:14px; }
.avatar-sm { width:24px; height:24px; font-size:9px; }

/* ==== INFO BOX ==== */
.info-box { border-radius:var(--radius-sm); padding:11px 14px; display:flex; align-items:flex-start; gap:10px; font-size:13px; }
.info-box i { width:16px; height:16px; flex-shrink:0; margin-top:1px; }
.info-box-info { background:var(--info-bg); color:#1e40af; border:1px solid #bfdbfe; }
.info-box-warning { background:var(--warning-bg); color:#92400e; border:1px solid #fde68a; }
.info-box-danger { background:var(--danger-bg); color:#991b1b; border:1px solid #fca5a5; }
.info-box-success { background:var(--success-bg); color:#166534; border:1px solid #86efac; }

/* ==== COMPLIANCE GRID ==== */
.state-grid { display:grid; grid-template-columns:repeat(10,1fr); gap:4px; margin-top:8px; }
.state-cell { padding:4px 3px; border-radius:4px; font-size:9px; font-weight:600; text-align:center; cursor:pointer; transition:all var(--transition); }
.state-cell:hover { opacity:0.85; transform:scale(1.1); }
.sc-allowed { background:#dcfce7; color:#166534; }
.sc-restricted { background:#fef9c3; color:#854d0e; }
.sc-blocked { background:#fee2e2; color:#991b1b; }
.sc-pending { background:var(--bg-page); color:var(--text-muted); border:1px solid var(--border); }

/* ==== CHANNEL CARD ==== */
.channel-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); padding:16px; display:flex; align-items:flex-start; gap:12px; transition:box-shadow var(--transition); }
.channel-card:hover { box-shadow:var(--shadow-md); }
.channel-logo { width:42px; height:42px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:20px; }
.channel-name { font-size:14px; font-weight:700; }
.channel-desc { font-size:12px; color:var(--text-secondary); margin:2px 0 8px; }
.channel-status { display:flex; align-items:center; gap:5px; font-size:12px; font-weight:500; }
.status-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.status-dot.connected { background:var(--success); }
.status-dot.disconnected { background:var(--text-muted); }
.status-dot.error { background:var(--danger); }

/* ==== REWARD CARD ==== */
.reward-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); padding:14px; transition:box-shadow var(--transition); cursor:pointer; }
.reward-card:hover { box-shadow:var(--shadow-md); border-color:var(--wine); }
.reward-icon { width:38px; height:38px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:18px; margin-bottom:8px; }
.reward-name { font-size:13.5px; font-weight:700; margin-bottom:2px; }
.reward-pts { font-size:12px; color:var(--wine); font-weight:600; }
.reward-desc { font-size:12px; color:var(--text-secondary); margin-top:4px; }

/* ==== MEMBER HERO ==== */
.member-hero { background:linear-gradient(135deg,var(--wine-dark),var(--wine)); border-radius:var(--radius); padding:22px; margin-bottom:18px; color:#fff; display:flex; align-items:flex-start; gap:16px; }
.member-hero-avatar { width:54px; height:54px; border-radius:50%; background:rgba(255,255,255,0.15); display:flex; align-items:center; justify-content:center; font-size:19px; font-weight:700; flex-shrink:0; border:2px solid rgba(255,255,255,0.25); }
.member-hero-name { font-size:19px; font-weight:700; letter-spacing:-0.02em; }
.member-hero-meta { font-size:12.5px; color:rgba(255,255,255,0.6); margin-top:2px; }
.member-hero-stats { display:flex; gap:20px; margin-top:12px; border-top:1px solid rgba(255,255,255,0.12); padding-top:12px; }
.hero-stat-value { font-size:20px; font-weight:700; letter-spacing:-0.02em; }
.hero-stat-label { font-size:11px; color:rgba(255,255,255,0.5); }
.member-hero-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px; margin-left:auto; }
.churn-dial { width:82px; height:82px; position:relative; }
.churn-dial svg { transform:rotate(-90deg); }
.churn-dial-label { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.churn-dial-pct { font-size:18px; font-weight:800; color:#fff; letter-spacing:-0.03em; }
.churn-dial-sub { font-size:9px; color:rgba(255,255,255,0.5); text-transform:uppercase; }

/* ==== RISK ITEMS ==== */
.risk-row { display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg-page); cursor:pointer; }
.risk-row:hover { border-color:var(--wine); background:var(--wine-light); }
.risk-score { font-size:17px; font-weight:800; letter-spacing:-0.03em; }
.risk-score.high { color:var(--danger); }
.risk-score.med { color:var(--warning); }
.risk-score.low { color:var(--success); }

/* ==== PORTAL ==== */
.portal-header { background:linear-gradient(135deg,var(--wine-dark),var(--wine)); border-radius:var(--radius) var(--radius) 0 0; padding:20px; color:#fff; }
.portal-winery { font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:rgba(255,255,255,0.5); }
.portal-greeting { font-size:19px; font-weight:700; margin-top:2px; letter-spacing:-0.02em; }
.portal-tier { display:inline-flex; align-items:center; gap:5px; background:rgba(255,255,255,0.15); border-radius:20px; padding:3px 10px; font-size:12px; font-weight:600; margin-top:7px; }
.portal-tier i { width:11px; height:11px; }
.portal-body { background:var(--bg-card); border:1px solid var(--border); border-top:none; border-radius:0 0 var(--radius) var(--radius); overflow:hidden; }
.portal-nav { display:flex; border-bottom:1px solid var(--border); background:var(--bg-page); }
.portal-nav-item { flex:1; padding:10px 6px; text-align:center; font-size:11.5px; font-weight:500; color:var(--text-secondary); cursor:pointer; border:none; background:none; transition:all var(--transition); border-bottom:2px solid transparent; display:flex; flex-direction:column; align-items:center; gap:3px; }
.portal-nav-item i { width:15px; height:15px; }
.portal-nav-item:hover { color:var(--wine); }
.portal-nav-item.active { color:var(--wine); border-bottom-color:var(--wine); background:var(--bg-card); }
.portal-content { padding:16px; }
.wine-slot { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px 12px; display:flex; align-items:center; gap:9px; }
.wine-slot-color { width:30px; height:30px; border-radius:6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:13px; }
.wine-slot-name { font-size:13px; font-weight:600; }
.wine-slot-vintage { font-size:11.5px; color:var(--text-secondary); }
.swap-btn { font-size:11.5px; font-weight:500; color:var(--wine); border:1px solid var(--wine); background:none; padding:3px 8px; border-radius:5px; cursor:pointer; transition:all var(--transition); }
.swap-btn:hover { background:var(--wine); color:#fff; }
.swap-panel { display:none; margin-top:6px; }
.swap-panel.open { display:block; }
.swap-option { display:flex; align-items:center; gap:9px; padding:9px 11px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg-page); cursor:pointer; margin-bottom:6px; transition:all var(--transition); }
.swap-option:hover, .swap-option.selected { border-color:var(--wine); background:var(--wine-light); }
.loyalty-bar-track { height:6px; background:rgba(255,255,255,0.2); border-radius:4px; overflow:hidden; margin-bottom:5px; }
.loyalty-bar-fill { height:100%; background:var(--gold); border-radius:4px; }
.portal-action-btn { width:100%; padding:10px 14px; border-radius:var(--radius-sm); font-size:13px; font-weight:600; cursor:pointer; transition:all var(--transition); display:flex; align-items:center; justify-content:center; gap:6px; border:none; margin-bottom:7px; }
.portal-action-btn i { width:14px; height:14px; }
.pab-primary { background:var(--wine); color:#fff; }
.pab-primary:hover { background:var(--wine-mid); }
.pab-secondary { background:var(--bg-page); color:var(--text-primary); border:1px solid var(--border) !important; border:none; }
.pab-secondary:hover { background:var(--border); }
.pab-ghost { background:none; color:var(--danger); border:1px solid transparent !important; border:none; }
.pab-ghost:hover { background:var(--danger-bg); }
.shipment-countdown { background:var(--warning-bg); border:1px solid #fde68a; border-radius:var(--radius-sm); padding:7px 12px; font-size:12.5px; color:var(--warning); display:flex; align-items:center; gap:6px; margin:10px 0; }
.shipment-countdown i { width:14px; height:14px; flex-shrink:0; }

/* ==== HEATMAP ==== */
.heatmap-grid { display:grid; gap:3px; }
.heatmap-cell { border-radius:3px; height:24px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:600; cursor:pointer; transition:opacity var(--transition); }
.heatmap-cell:hover { opacity:0.8; }
.hm-0 { background:#f1f5f9; color:#94a3b8; }
.hm-1 { background:#fce7f3; color:#9d174d; }
.hm-2 { background:#fbcfe8; color:#9d174d; }
.hm-3 { background:#f9a8d4; color:#831843; }
.hm-4 { background:#f472b6; color:#831843; }
.hm-5 { background:#ec4899; color:#fff; }
.hm-6 { background:#db2777; color:#fff; }
.hm-7 { background:#be185d; color:#fff; }

/* ==== TEMPLATE CARD ==== */
.template-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; cursor:pointer; transition:all var(--transition); }
.template-card:hover { box-shadow:var(--shadow-md); border-color:var(--wine); }
.template-preview { height:90px; display:flex; align-items:center; justify-content:center; font-size:28px; border-bottom:1px solid var(--border); }
.template-info { padding:12px; }
.template-name { font-size:13px; font-weight:600; margin-bottom:2px; }
.template-meta { font-size:11.5px; color:var(--text-muted); }

/* ==== SCROLLBAR ==== */
::-webkit-scrollbar { width:5px; height:5px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:var(--border-strong); border-radius:4px; }

/* ==== CHART CONTAINER ==== */
.chart-wrap { position:relative; }
.chart-wrap canvas { max-width:100%; }

/* ==== PROFILE TABS (member) ==== */
.profile-tabs { display:flex; gap:2px; background:var(--bg-page); border:1px solid var(--border); border-radius:8px; padding:3px; margin-bottom:18px; }
.profile-tab { flex:1; padding:6px 10px; border-radius:6px; font-size:12.5px; font-weight:500; text-align:center; cursor:pointer; color:var(--text-secondary); transition:all var(--transition); border:none; background:none; }
.profile-tab.active { background:var(--bg-card); color:var(--text-primary); box-shadow:var(--shadow); font-weight:600; }

/* ==== TIER CARD ==== */
.tier-card { background:var(--bg-card); border:2px solid var(--border); border-radius:var(--radius); padding:20px; transition:all var(--transition); cursor:pointer; position:relative; }
.tier-card:hover { border-color:var(--wine); box-shadow:var(--shadow-md); }
.tier-card.featured { border-color:var(--wine); }
.tier-featured-badge { position:absolute; top:-10px; left:50%; transform:translateX(-50%); background:var(--wine); color:#fff; font-size:10px; font-weight:700; padding:2px 10px; border-radius:20px; text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap; }
.tier-icon { width:42px; height:42px; border-radius:10px; display:flex; align-items:center; justify-content:center; margin-bottom:10px; }
.tier-icon i { width:20px; height:20px; }
.tier-price { font-size:22px; font-weight:800; letter-spacing:-0.03em; }
.tier-price span { font-size:14px; font-weight:500; color:var(--text-secondary); }
.tier-name { font-size:16px; font-weight:700; margin:4px 0; }
.tier-desc { font-size:12.5px; color:var(--text-secondary); margin-bottom:12px; }
.tier-feature { display:flex; align-items:center; gap:7px; font-size:12.5px; padding:4px 0; }
.tier-feature i { width:13px; height:13px; color:var(--success); flex-shrink:0; }

/* ==== MISC ==== */
.separator { height:1px; background:var(--border); margin:16px 0; }
.text-right { text-align:right; }
.text-center { text-align:center; }
.font-bold { font-weight:700; }
.font-semibold { font-weight:600; }
.text-muted { color:var(--text-secondary); }
.text-sm { font-size:12.5px; }
.text-xs { font-size:11.5px; }
.text-wine { color:var(--wine); }
.text-danger { color:var(--danger); }
.text-success { color:var(--success); }
.flex { display:flex; }
.items-center { align-items:center; }
.justify-between { justify-content:space-between; }
.gap-6 { gap:6px; } .gap-8 { gap:8px; } .gap-12 { gap:12px; }
.flex-1 { flex:1; }
.w-full { width:100%; }

/* ═══════════════════════════════════════════════
   MOBILE RESPONSIVE — app.html
   Breakpoints: 768px (tablet), 480px (mobile)
═══════════════════════════════════════════════ */

/* Hamburger button — hidden on desktop */
.hamburger {
  display: none;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 5px;
  width: 36px;
  height: 36px;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.hamburger span {
  display: block;
  width: 18px;
  height: 2px;
  background: var(--text-secondary);
  border-radius: 2px;
  transition: all 0.25s ease;
}
.hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; }
.hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

/* Sidebar overlay backdrop */
.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 99;
  backdrop-filter: blur(2px);
}
.sidebar-overlay.open { display: block; }

@media (max-width: 768px) {
  /* Show hamburger */
  .hamburger { display: flex; }

  /* Sidebar becomes slide-in drawer */
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
    z-index: 200;
    width: 260px !important;
  }
  .sidebar.open { transform: translateX(0); }

  /* Main content takes full width */
  .main { margin-left: 0 !important; }

  /* Topbar adjustments */
  .topbar { padding: 0 14px; }
  .topbar-right .btn:not(.btn-primary) { display: none; }

  /* Content padding */
  .content { padding: 16px 14px; }

  /* KPI grid: 2 columns on tablet */
  .kpi-grid { grid-template-columns: 1fr 1fr !important; gap: 10px; }

  /* All multi-column grids → single column */
  .grid-2, .grid-3, .grid-4, .grid-3-1, .grid-2-1 {
    grid-template-columns: 1fr !important;
    gap: 14px;
  }

  /* Form rows stack */
  .form-row { grid-template-columns: 1fr !important; }

  /* Tables get horizontal scroll */
  .card > .table-wrap, table {
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    max-width: 100%;
  }

  /* Filter bar wraps */
  .filter-bar { flex-wrap: wrap; gap: 6px; }
  .filter-bar .search-input { width: 100%; }

  /* Pipeline steps scroll on mobile */
  .pipeline-steps { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* Member hero stacks */
  .member-hero { flex-direction: column; gap: 12px; }

  /* Modal takes full width */
  .modal { width: calc(100vw - 32px) !important; max-width: 100% !important; margin: 16px; }

  /* State grid fewer columns */
  .state-grid { grid-template-columns: repeat(5,1fr) !important; }

  /* Tabs scroll on mobile */
  .tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
  .tab-btn { flex-shrink: 0; }

  /* Card actions responsive */
  .card-header { flex-wrap: wrap; gap: 8px; }

  /* Section header wraps */
  .section-hdr { flex-wrap: wrap; gap: 8px; }

  /* Channel cards stack content */
  .channel-card { flex-wrap: wrap; }

  /* iOS safe area */
  .topbar { padding-top: max(0px, env(safe-area-inset-top)); }
  .sidebar { padding-top: max(0px, env(safe-area-inset-top)); }
}

@media (max-width: 480px) {
  /* KPI grid → single column on small phones */
  .kpi-grid { grid-template-columns: 1fr !important; }

  /* Reduce font sizes slightly */
  .content { font-size: 13.5px; }
  .topbar-title { font-size: 14px; }

  /* Buttons in topbar: icon only */
  .topbar-right .btn span { display: none; }

  /* AI chip smaller */
  .ai-chip { font-size: 9px; padding: 2px 6px; }

  /* Reduce content padding further */
  .content { padding: 12px 10px; }

  /* Stats row wraps */
  .stat-row { flex-wrap: wrap; gap: 4px; }

  /* Bottom safe area for fixed elements */
  body { padding-bottom: env(safe-area-inset-bottom); }
}


/* ── QA FIX PASS ── */
@media (max-width: 768px) {
  /* Prevent any element from causing horizontal overflow */
  html, body { overflow-x: hidden; max-width: 100vw; }
  .app { overflow-x: hidden; }

  /* Explicitly wrap all tables */
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; width: 100%; }
  thead, tbody, tr { min-width: 0; }

  /* Pipeline steps: contain horizontally */
  .pipeline-steps { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
  .pipeline-step { min-width: 80px; }

  /* Sparkbar doesn't overflow */
  .sparkbar-row { overflow: hidden; }

  /* State grid max-width */
  .state-grid { max-width: 100%; }

  /* Raise touch targets */
  .nav-item { min-height: 44px; padding: 10px; }
  .btn { min-height: 44px; }
  .tab-btn { min-height: 44px; }
  .card-action { min-height: 44px; align-items: center; }
  input, select, textarea { min-height: 44px; font-size: 16px; } /* 16px prevents iOS zoom */

  /* Chip row wraps instead of overflows */
  .chip { margin-bottom: 4px; }

  /* Form inputs full width */
  .form-group input, .form-group select, .form-group textarea { width: 100%; box-sizing: border-box; }
}

@media (max-width: 480px) {
  /* Hard clamp */
  * { max-width: 100vw; }
  img, canvas, svg { max-width: 100%; height: auto; }
}

</style>
</head>
<body>
<div class='app'>

<!-- SIDEBAR -->
<aside class="sidebar">
  <div class="sidebar-logo">
    <div class="logo-mark">
      <div class="logo-icon"><i data-lucide="grape"></i></div>
      <div><div class="logo-text">Vinifera</div><div class="logo-sub">Club Management</div></div>
    </div>
  </div>
  <div class="sidebar-section">
    <div class="sidebar-section-label">Overview</div>
    <button class="nav-item active" onclick="showScreen('dashboard',this)"><i data-lucide="layout-dashboard"></i> Dashboard</button>
    <button class="nav-item" onclick="showScreen('members',this)"><i data-lucide="users"></i> Members <span class="nav-badge">12</span></button>
    <button class="nav-item" onclick="showScreen('shipments',this)"><i data-lucide="package"></i> Shipments</button>
    <button class="nav-item" onclick="showScreen('analytics',this)"><i data-lucide="bar-chart-2"></i> Analytics</button>
  </div>
  <div class="sidebar-section">
    <div class="sidebar-section-label">Club Operations</div>
    <button class="nav-item" onclick="showScreen('tiers',this)"><i data-lucide="layers"></i> Club Tiers</button>
    <button class="nav-item" onclick="showScreen('allocations',this)"><i data-lucide="wine"></i> Allocations</button>
    <button class="nav-item" onclick="showScreen('schedule',this)"><i data-lucide="calendar"></i> Release Schedule</button>
    <button class="nav-item" onclick="showScreen('fulfillment',this)"><i data-lucide="truck"></i> Fulfillment</button>
  </div>
  <div class="sidebar-section">
    <div class="sidebar-section-label">Member Experience</div>
    <button class="nav-item" onclick="showScreen('portal',this)"><i data-lucide="smartphone"></i> Member Portal</button>
    <button class="nav-item" onclick="showScreen('comms',this)"><i data-lucide="mail"></i> Communications</button>
    <button class="nav-item" onclick="showScreen('loyalty',this)"><i data-lucide="gift"></i> Loyalty & Rewards</button>
  </div>
  <div class="sidebar-section">
    <div class="sidebar-section-label">System</div>
    <button class="nav-item" onclick="showScreen('integrations',this)"><i data-lucide="plug"></i> Integrations</button>
    <button class="nav-item" onclick="showScreen('settings',this)"><i data-lucide="settings"></i> Settings</button>
  </div>
  <div class="sidebar-footer">
    <div class="user-row">
      <div class="user-avatar">JG</div>
      <div><div class="user-name">Jeffrey G.</div><div class="user-role">Club Manager</div></div>
    </div>
  </div>
</aside>

<!-- MAIN -->
<div class="main">
<div class="topbar">
  <button class="hamburger" id="hamburgerBtn" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>
    <div class="topbar-left">
    <div class="page-title" id="page-title">Dashboard</div>
  </div>
  <div class="topbar-right">
    <button class="btn" onclick="openModal('addMemberModal')"><i data-lucide="user-plus"></i> Add Member</button>
    <button class="btn btn-primary" onclick="openModal('releaseModal')"><i data-lucide="play-circle"></i> Run Club Release</button>
  </div>
</div>
<div class="content">

<!-- ═══════ SCREEN: DASHBOARD ═══════ -->
<div class="screen active" id="screen-dashboard">
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon wine"><i data-lucide="users"></i></div><div class="kpi-label">Active Members</div><div class="kpi-value">1,847</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+43 this month</div></div>
    <div class="kpi-card"><div class="kpi-icon gold"><i data-lucide="dollar-sign"></i></div><div class="kpi-label">Club Revenue (MTD)</div><div class="kpi-value">$218K</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+8.2% vs last month</div></div>
    <div class="kpi-card"><div class="kpi-icon red"><i data-lucide="user-x"></i></div><div class="kpi-label">At-Risk Members</div><div class="kpi-value">67</div><div class="kpi-delta down"><i data-lucide="trending-up"></i>Up 12 from last week</div></div>
    <div class="kpi-card"><div class="kpi-icon green"><i data-lucide="percent"></i></div><div class="kpi-label">Retention Rate</div><div class="kpi-value">86.4%</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+2.1pt vs last quarter</div></div>
  </div>
  <div class="grid-3-1 mb-20">
    <div class="card">
      <div class="card-header"><div><div class="card-title">Fall 2026 Club Release</div><div class="card-subtitle">Scheduled · Ships August 14, 2026</div></div><span class="badge badge-warning"><i data-lucide="clock"></i> 23 days away</span></div>
      <div class="card-body">
        <div class="pipeline-steps">
          <div class="pipeline-step done"><div class="step-dot"><i data-lucide="check"></i></div><div class="step-label">Wines<br>Selected</div></div>
          <div class="pipeline-step done"><div class="step-dot"><i data-lucide="check"></i></div><div class="step-label">Inventory<br>Reserved</div></div>
          <div class="pipeline-step active"><div class="step-dot"><i data-lucide="mail"></i></div><div class="step-label">Member<br>Notifications</div></div>
          <div class="pipeline-step"><div class="step-dot"><i data-lucide="credit-card"></i></div><div class="step-label">Billing<br>Capture</div></div>
          <div class="pipeline-step"><div class="step-dot"><i data-lucide="truck"></i></div><div class="step-label">Fulfillment<br>& Ship</div></div>
        </div>
        <table class="data-table mt-16">
          <thead><tr><th>Club Tier</th><th>Members</th><th>Bottles</th><th>Value</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td><strong>Reserve Collection</strong></td><td class="num">312</td><td class="num">1,872</td><td class="num">$74,400</td><td><span class="badge badge-success">Ready</span></td></tr>
            <tr><td><strong>Estate Select</strong></td><td class="num">698</td><td class="num">2,792</td><td class="num">$97,720</td><td><span class="badge badge-success">Ready</span></td></tr>
            <tr><td><strong>Discovery Club</strong></td><td class="num">837</td><td class="num">2,511</td><td class="num">$45,198</td><td><span class="badge badge-warning">Pending Notify</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div><div class="card-title">AI Churn Watch</div><div class="card-subtitle">43 signals · updated daily</div></div><div class="ai-chip"><i data-lucide="sparkles"></i>AI</div></div>
      <div class="card-body">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div class="risk-row" onclick="showScreen('members',document.querySelector('[onclick*=members]'))"><div class="avatar">ML</div><div style="flex:1"><div style="font-size:13px;font-weight:600">Margaret L.</div><div class="text-xs text-muted">Reserve · 14 mo</div></div><div class="risk-score high">87%</div></div>
          <div class="risk-row"><div class="avatar">TR</div><div style="flex:1"><div style="font-size:13px;font-weight:600">Thomas R.</div><div class="text-xs text-muted">Estate · 8 mo</div></div><div class="risk-score high">79%</div></div>
          <div class="risk-row"><div class="avatar">SK</div><div style="flex:1"><div style="font-size:13px;font-weight:600">Soo-Yeon K.</div><div class="text-xs text-muted">Discovery · 22 mo</div></div><div class="risk-score med">64%</div></div>
          <div class="risk-row"><div class="avatar">DP</div><div style="flex:1"><div style="font-size:13px;font-weight:600">David P.</div><div class="text-xs text-muted">Estate · 6 mo</div></div><div class="risk-score med">58%</div></div>
        </div>
        <button class="card-action mt-12">View all 67 at-risk <i data-lucide="arrow-right"></i></button>
      </div>
    </div>
  </div>
  <div class="grid-3 mb-20">
    <div class="card">
      <div class="card-header"><div class="card-title">Monthly Revenue</div></div>
      <div class="card-body">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><span style="font-size:24px;font-weight:800;">$218K</span><span class="badge badge-success"><i data-lucide="trending-up"></i>+8.2%</span></div>
        <div class="chart-wrap" style="height:80px;"><canvas id="revenueChart"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Membership Health</div></div>
      <div class="card-body" style="padding-top:8px;">
        <div class="stat-row"><span class="stat-label">New this month</span><span class="stat-value text-success">+43</span></div>
        <div class="stat-row"><span class="stat-label">Cancelled</span><span class="stat-value text-danger">-19</span></div>
        <div class="stat-row"><span class="stat-label">On pause</span><span class="stat-value">34</span></div>
        <div class="stat-row"><span class="stat-label">Avg. tenure</span><span class="stat-value">2.8 yrs</span></div>
        <div class="stat-row"><span class="stat-label">Avg. annual spend</span><span class="stat-value">$1,420</span></div>
        <div class="stat-row"><span class="stat-label">Churn rate (90d)</span><span class="stat-value" style="color:var(--warning)">2.8%</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Payment Recovery</div><span class="badge badge-danger">18 failed</span></div>
      <div class="card-body" style="padding-top:8px;">
        <div class="flex items-center justify-between mb-16"><span class="text-sm text-muted">Auto-retry in progress</span><span class="badge badge-info">12 retrying</span></div>
        <div class="progress-track" style="height:7px;margin-bottom:8px;"><div class="progress-fill pf-wine" style="width:67%"></div></div>
        <div class="text-sm text-muted mb-16">12 of 18 accounts queued for automatic retry</div>
        <div class="stat-row"><span class="stat-label">Recovered (7 days)</span><span class="stat-value text-success">$8,240</span></div>
        <div class="stat-row"><span class="stat-label">Needs manual action</span><span class="stat-value text-danger">6 cards</span></div>
        <button class="card-action mt-12">Manage failed payments <i data-lucide="arrow-right"></i></button>
      </div>
    </div>
  </div>
</div><!-- /dashboard -->

<!-- ═══════ SCREEN: MEMBERS ═══════ -->
<div class="screen" id="screen-members">
  <div class="member-hero">
    <div class="member-hero-avatar">ML</div>
    <div style="flex:1">
      <div class="flex items-center gap-8"><div class="member-hero-name">Margaret Lassiter</div><span class="badge" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.25)"><i data-lucide="crown"></i> Reserve Collection</span></div>
      <div class="member-hero-meta">margaret.lassiter@email.com · (415) 882-0451 · San Francisco, CA</div>
      <div class="member-hero-stats">
        <div><div class="hero-stat-value">$4,820</div><div class="hero-stat-label">Lifetime Value</div></div>
        <div><div class="hero-stat-value">14 mo</div><div class="hero-stat-label">Tenure</div></div>
        <div><div class="hero-stat-value">7</div><div class="hero-stat-label">Shipments</div></div>
        <div><div class="hero-stat-value">3</div><div class="hero-stat-label">Add-on Orders</div></div>
      </div>
    </div>
    <div class="member-hero-right">
      <div class="ai-chip"><i data-lucide="sparkles"></i>AI Churn Risk</div>
      <div class="churn-dial">
        <svg width="82" height="82" viewBox="0 0 82 82"><circle cx="41" cy="41" r="32" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="8"/><circle cx="41" cy="41" r="32" fill="none" stroke="#DC2626" stroke-width="8" stroke-dasharray="201" stroke-dashoffset="26" stroke-linecap="round"/></svg>
        <div class="churn-dial-label"><div class="churn-dial-pct">87%</div><div class="churn-dial-sub">Risk</div></div>
      </div>
      <div style="text-align:right;font-size:11px;color:rgba(255,255,255,0.45)">Last active 22 days ago<br>0 of 3 emails opened</div>
    </div>
  </div>
  <div style="background:linear-gradient(135deg,#FEF2F2,#FFFBEB);border:1px solid #FCA5A5;border-radius:var(--radius);padding:13px 16px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">
    <div style="width:34px;height:34px;border-radius:8px;background:#DC2626;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;"><i data-lucide="sparkles" style="width:16px;height:16px"></i></div>
    <div style="flex:1"><div style="font-size:13px;font-weight:700;color:#991B1B">AI Retention Alert — Action Recommended</div><div style="font-size:12px;color:#B45309;margin-top:2px">Margaret skipped her last 2 shipments, hasn't opened 3 consecutive emails, and tasting room visits dropped from 4/yr to 0. Predicted cancel within 18 days.</div></div>
    <button class="btn btn-primary btn-sm"><i data-lucide="mail"></i> Send Retention Offer</button>
  </div>
  <div class="profile-tabs">
    <button class="profile-tab active" onclick="switchTab(this,'ptab-history')">Activity & History</button>
    <button class="profile-tab" onclick="switchTab(this,'ptab-taste')">Taste Profile</button>
    <button class="profile-tab" onclick="switchTab(this,'ptab-club')">Club & Shipments</button>
    <button class="profile-tab" onclick="switchTab(this,'ptab-notes')">Notes & Tasks</button>
  </div>
  <!-- Tab: History -->
  <div class="tab-panel active" id="ptab-history">
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Activity Timeline</div></div>
        <div class="card-body">
          <div class="timeline">
            <div class="timeline-item"><div class="timeline-dot danger"><i data-lucide="skip-forward"></i></div><div class="timeline-body"><div class="timeline-title">Shipment skipped — Summer 2026</div><div class="timeline-meta">June 30, 2026</div><div class="timeline-note">Member skipped via self-service portal. Second consecutive skip. No reason provided.</div></div></div>
            <div class="timeline-item"><div class="timeline-dot"><i data-lucide="mail"></i></div><div class="timeline-body"><div class="timeline-title">Email unopened — Summer Release Preview</div><div class="timeline-meta">June 15, 2026</div></div></div>
            <div class="timeline-item"><div class="timeline-dot"><i data-lucide="mail"></i></div><div class="timeline-body"><div class="timeline-title">Email unopened — Thank You for Membership</div><div class="timeline-meta">May 2, 2026</div></div></div>
            <div class="timeline-item"><div class="timeline-dot wine"><i data-lucide="shopping-bag"></i></div><div class="timeline-body"><div class="timeline-title">Add-on purchase · $186</div><div class="timeline-meta">2× 2023 Cabernet Franc · March 8, 2026</div></div></div>
            <div class="timeline-item"><div class="timeline-dot wine"><i data-lucide="package"></i></div><div class="timeline-body"><div class="timeline-title">Shipment received — Reserve Spring 2026</div><div class="timeline-meta">$640 · 6 bottles · Feb 14, 2026</div></div></div>
            <div class="timeline-item"><div class="timeline-dot gold"><i data-lucide="map-pin"></i></div><div class="timeline-body"><div class="timeline-title">Tasting room visit · $220</div><div class="timeline-meta">Last visit: December 2025</div><div class="timeline-note">No tasting room visits recorded in 2026.</div></div></div>
          </div>
        </div>
      </div>
      <div>
        <div class="card mb-16">
          <div class="card-header"><div class="card-title">Spend Breakdown</div></div>
          <div class="card-body" style="padding-top:8px;">
            <div class="stat-row"><span class="stat-label">Club shipments (7)</span><span class="stat-value">$4,218</span></div>
            <div class="stat-row"><span class="stat-label">Add-on orders (3)</span><span class="stat-value">$412</span></div>
            <div class="stat-row"><span class="stat-label">Tasting room (2 visits)</span><span class="stat-value">$380</span></div>
            <div class="stat-row" style="border-top:2px solid var(--border)"><span class="stat-label font-bold">Total Lifetime Value</span><span class="stat-value font-bold">$5,010</span></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Engagement Signals</div><div class="ai-chip"><i data-lucide="sparkles"></i>AI</div></div>
          <div class="card-body" style="padding-top:10px;">
            <div style="margin-bottom:9px"><div class="flex justify-between text-xs text-muted mb-16" style="margin-bottom:4px"><span>Email engagement</span><span class="text-danger font-semibold">Low (12%)</span></div><div class="progress-track"><div class="progress-fill pf-danger" style="width:12%"></div></div></div>
            <div style="margin-bottom:9px"><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Portal logins (90d)</span><span style="font-weight:600;color:var(--warning)">Medium (35%)</span></div><div class="progress-track"><div class="progress-fill pf-warning" style="width:35%"></div></div></div>
            <div style="margin-bottom:9px"><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Purchase frequency</span><span style="font-weight:600;color:var(--warning)">Declining (42%)</span></div><div class="progress-track"><div class="progress-fill pf-warning" style="width:42%"></div></div></div>
            <div><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Tasting room visits</span><span class="text-danger font-semibold">None in 2026</span></div><div class="progress-track"><div class="progress-fill pf-danger" style="width:5%"></div></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <!-- Tab: Taste Profile -->
  <div class="tab-panel" id="ptab-taste">
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Wine Preference Profile</div><div class="ai-chip"><i data-lucide="sparkles"></i>AI Inferred</div></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Boldness</span><span class="font-semibold" style="color:var(--text-primary)">Structured</span></div><div class="progress-track"><div class="progress-fill pf-wine" style="width:80%"></div></div></div>
            <div><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Tannin</span><span class="font-semibold" style="color:var(--text-primary)">High</span></div><div class="progress-track"><div class="progress-fill pf-wine" style="width:75%"></div></div></div>
            <div><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Acidity</span><span class="font-semibold" style="color:var(--text-primary)">Medium</span></div><div class="progress-track"><div class="progress-fill pf-wine" style="width:55%"></div></div></div>
            <div><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Sweetness</span><span class="font-semibold" style="color:var(--text-primary)">Bone Dry</span></div><div class="progress-track"><div class="progress-fill pf-wine" style="width:10%"></div></div></div>
            <div><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Oak Influence</span><span class="font-semibold" style="color:var(--text-primary)">High</span></div><div class="progress-track"><div class="progress-fill pf-gold" style="width:82%"></div></div></div>
            <div><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Fruit Intensity</span><span class="font-semibold" style="color:var(--text-primary)">Dark Fruit</span></div><div class="progress-track"><div class="progress-fill pf-gold" style="width:70%"></div></div></div>
          </div>
          <div style="padding:10px 12px;background:var(--bg-page);border-radius:var(--radius-sm);font-size:12.5px;color:var(--text-secondary);border-left:3px solid var(--wine)"><strong style="color:var(--text-primary)">AI Curation Note:</strong> Margaret consistently adds Cabernet Sauvignon and Merlot add-ons and has never selected rosé or white wines. Feature Napa Valley reds and aged Bordeaux-style blends in her next personalized offer.</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Variety History</div></div>
        <div class="card-body" style="padding-top:8px;">
          <div class="stat-row"><span class="stat-label">Cabernet Sauvignon</span><span class="stat-value">34 bottles</span></div>
          <div class="stat-row"><span class="stat-label">Merlot</span><span class="stat-value">18 bottles</span></div>
          <div class="stat-row"><span class="stat-label">Cabernet Franc</span><span class="stat-value">12 bottles</span></div>
          <div class="stat-row"><span class="stat-label">Red Blend</span><span class="stat-value">8 bottles</span></div>
          <div class="stat-row"><span class="stat-label">Petit Verdot</span><span class="stat-value">4 bottles</span></div>
          <div class="stat-row"><span class="stat-label">Avg. bottle price</span><span class="stat-value">$64</span></div>
          <div class="stat-row"><span class="stat-label">Price sensitivity</span><span class="stat-value">Low — premium buyer</span></div>
        </div>
      </div>
    </div>
  </div>
  <!-- Tab: Club & Shipments -->
  <div class="tab-panel" id="ptab-club">
    <div class="card">
      <div class="card-header"><div><div class="card-title">Club Membership Details</div><div class="card-subtitle">Reserve Collection · Member since May 2025</div></div><div class="flex gap-8"><button class="btn btn-sm">Pause Membership</button><button class="btn btn-primary btn-sm">Upgrade Tier</button></div></div>
      <div class="card-body">
        <div class="grid-2">
          <div><div class="section-title mb-16">Next Shipment</div><div style="padding:13px;background:var(--bg-page);border-radius:var(--radius);border:1px solid var(--border)"><div class="flex justify-between items-center" style="margin-bottom:8px"><span class="font-semibold">Fall 2026 Reserve Box</span><span class="badge badge-warning">Aug 14</span></div><div class="text-sm text-muted" style="margin-bottom:6px">6 bottles · $640 · Ships to San Francisco, CA</div><div class="text-xs text-muted">Card on file: Visa ····4821 · Exp 09/27</div></div></div>
          <div><div class="section-title mb-16">Shipment History</div><table class="data-table"><thead><tr><th>Release</th><th>Status</th><th>Value</th></tr></thead><tbody><tr><td>Summer 2026</td><td><span class="badge badge-neutral">Skipped</span></td><td class="num">—</td></tr><tr><td>Spring 2026</td><td><span class="badge badge-success">Delivered</span></td><td class="num">$640</td></tr><tr><td>Winter 2026</td><td><span class="badge badge-neutral">Skipped</span></td><td class="num">—</td></tr><tr><td>Fall 2025</td><td><span class="badge badge-success">Delivered</span></td><td class="num">$620</td></tr><tr><td>Summer 2025</td><td><span class="badge badge-success">Delivered</span></td><td class="num">$580</td></tr></tbody></table></div>
        </div>
      </div>
    </div>
  </div>
  <!-- Tab: Notes -->
  <div class="tab-panel" id="ptab-notes">
    <div class="card">
      <div class="card-header"><div class="card-title">Staff Notes & Tasks</div><button class="btn btn-sm btn-primary"><i data-lucide="plus"></i> Add Note</button></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:10px;">
        <div style="padding:12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border)"><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>Sarah M. · Jun 12, 2026</span><span class="badge badge-warning">Open</span></div><div style="font-size:13.5px">Follow up re: Summer shipment skip — called and left voicemail. Member mentioned she was traveling. Suggested pausing rather than skipping.</div></div>
        <div style="padding:12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border)"><div class="flex justify-between text-xs text-muted" style="margin-bottom:4px"><span>AI System · Jul 1, 2026</span><span class="badge badge-danger">AI Alert</span></div><div style="font-size:13.5px">Churn model flagged Margaret as high-risk (87%). Second consecutive skip. Recommend personal outreach with exclusive tasting room invitation or loyalty bonus.</div></div>
      </div>
    </div>
  </div>
</div><!-- /members -->

<!-- ═══════ SCREEN: SHIPMENTS ═══════ -->
<div class="screen" id="screen-shipments">
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon wine"><i data-lucide="package"></i></div><div class="kpi-label">Total Shipments (YTD)</div><div class="kpi-value">14,820</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+12% vs last year</div></div>
    <div class="kpi-card"><div class="kpi-icon green"><i data-lucide="check-circle"></i></div><div class="kpi-label">Delivered This Release</div><div class="kpi-value">1,847</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>98.2% success rate</div></div>
    <div class="kpi-card"><div class="kpi-icon red"><i data-lucide="alert-triangle"></i></div><div class="kpi-label">Failed / Returned</div><div class="kpi-value">34</div><div class="kpi-delta down"><i data-lucide="trending-up"></i>22 address issues</div></div>
    <div class="kpi-card"><div class="kpi-icon gold"><i data-lucide="truck"></i></div><div class="kpi-label">Avg. Delivery Time</div><div class="kpi-value">3.2d</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>-0.4d vs last release</div></div>
  </div>
  <div class="card mb-20">
    <div class="card-header">
      <div><div class="card-title">Fall 2026 Shipment Queue</div><div class="card-subtitle">1,847 shipments · 3 carriers · Processing Aug 14</div></div>
      <div class="flex gap-8">
        <button class="btn btn-sm"><i data-lucide="download"></i> Export CSV</button>
        <button class="btn btn-sm btn-primary"><i data-lucide="printer"></i> Print Labels</button>
      </div>
    </div>
    <div class="card-body" style="padding:14px 18px 8px;">
      <div class="filter-bar">
        <input class="filter-input" placeholder="Search by member, address, tracking #..." style="flex:1;min-width:260px">
        <select class="filter-select"><option>All Tiers</option><option>Reserve Collection</option><option>Estate Select</option><option>Discovery Club</option></select>
        <select class="filter-select"><option>All Statuses</option><option>Pending</option><option>Label Printed</option><option>In Transit</option><option>Delivered</option><option>Failed</option></select>
        <select class="filter-select"><option>All Carriers</option><option>UPS</option><option>FedEx</option><option>GSO</option></select>
        <div class="flex gap-8">
          <span class="chip active"><i data-lucide="check"></i> Select All</span>
          <span class="chip"><i data-lucide="mail"></i> Send Tracking</span>
        </div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th><input type="checkbox" onclick="toggleAll(this)"></th>
          <th>Member</th><th>Tier</th><th>Bottles</th><th>Value</th>
          <th>Carrier</th><th>Tracking #</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
          <tr><td><input type="checkbox"></td><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">ML</div><div><div style="font-size:13px;font-weight:600">Margaret Lassiter</div><div class="text-xs text-muted">San Francisco, CA</div></div></div></td><td><span class="badge badge-wine">Reserve</span></td><td class="num">6</td><td class="num">$640</td><td>UPS</td><td><span style="font-size:12px;color:var(--info)">1Z9A4E2F0307</span></td><td><span class="badge badge-warning">Pending</span></td><td><button class="btn btn-sm"><i data-lucide="edit-2"></i></button></td></tr>
          <tr><td><input type="checkbox"></td><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">JW</div><div><div style="font-size:13px;font-weight:600">James Worthington</div><div class="text-xs text-muted">Portland, OR</div></div></div></td><td><span class="badge badge-wine">Reserve</span></td><td class="num">6</td><td class="num">$640</td><td>FedEx</td><td><span style="font-size:12px;color:var(--info)">7489253847392</span></td><td><span class="badge badge-success">In Transit</span></td><td><button class="btn btn-sm"><i data-lucide="eye"></i></button></td></tr>
          <tr><td><input type="checkbox"></td><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">SK</div><div><div style="font-size:13px;font-weight:600">Soo-Yeon Kim</div><div class="text-xs text-muted">Seattle, WA</div></div></div></td><td><span class="badge badge-info">Estate</span></td><td class="num">4</td><td class="num">$340</td><td>UPS</td><td><span style="font-size:12px;color:var(--info)">1Z9A4E2F0892</span></td><td><span class="badge badge-success">Delivered</span></td><td><button class="btn btn-sm"><i data-lucide="eye"></i></button></td></tr>
          <tr><td><input type="checkbox"></td><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">DP</div><div><div style="font-size:13px;font-weight:600">David Park</div><div class="text-xs text-muted">Los Angeles, CA</div></div></div></td><td><span class="badge badge-neutral">Discovery</span></td><td class="num">3</td><td class="num">$162</td><td>GSO</td><td class="text-muted">—</td><td><span class="badge badge-danger">Addr. Issue</span></td><td><button class="btn btn-sm btn-danger"><i data-lucide="alert-triangle"></i></button></td></tr>
          <tr><td><input type="checkbox"></td><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">CR</div><div><div style="font-size:13px;font-weight:600">Claire Reynolds</div><div class="text-xs text-muted">Denver, CO</div></div></div></td><td><span class="badge badge-info">Estate</span></td><td class="num">4</td><td class="num">$340</td><td>FedEx</td><td><span style="font-size:12px;color:var(--info)">7489253849021</span></td><td><span class="badge badge-success">Delivered</span></td><td><button class="btn btn-sm"><i data-lucide="eye"></i></button></td></tr>
          <tr><td><input type="checkbox"></td><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">NB</div><div><div style="font-size:13px;font-weight:600">Nicolas Beaumont</div><div class="text-xs text-muted">Austin, TX</div></div></div></td><td><span class="badge badge-neutral">Discovery</span></td><td class="num">3</td><td class="num">$162</td><td>UPS</td><td><span style="font-size:12px;color:var(--info)">1Z9A4E2F1204</span></td><td><span class="badge badge-info">Label Printed</span></td><td><button class="btn btn-sm"><i data-lucide="edit-2"></i></button></td></tr>
        </tbody>
      </table>
      <div class="flex items-center justify-between" style="padding:12px 0 4px;font-size:12.5px;color:var(--text-secondary)">
        <span>Showing 1–6 of 1,847 shipments</span>
        <div class="flex gap-8">
          <button class="btn btn-sm">← Prev</button>
          <button class="btn btn-sm btn-primary">Next →</button>
        </div>
      </div>
    </div>
  </div>
  <div class="grid-3">
    <div class="card"><div class="card-header"><div class="card-title">Carrier Split</div></div><div class="card-body" style="padding-top:8px">
      <div class="stat-row"><span class="stat-label">UPS Ground</span><span class="stat-value">892 (48%)</span></div>
      <div class="stat-row"><span class="stat-label">FedEx Home</span><span class="stat-value">672 (36%)</span></div>
      <div class="stat-row"><span class="stat-label">GSO (CA/NV)</span><span class="stat-value">283 (15%)</span></div>
      <div style="margin-top:10px"><div class="progress-track" style="height:10px"><div class="progress-fill pf-wine" style="width:48%"></div></div></div>
    </div></div>
    <div class="card"><div class="card-header"><div class="card-title">Compliance Coverage</div><div class="ai-chip"><i data-lucide="shield"></i> Auto</div></div><div class="card-body" style="padding-top:8px">
      <div class="stat-row"><span class="stat-label">States shipping to</span><span class="stat-value">38 of 50</span></div>
      <div class="stat-row"><span class="stat-label">Blocked (dry/restricted)</span><span class="stat-value text-danger">8 states</span></div>
      <div class="stat-row"><span class="stat-label">Compliance verified</span><span class="stat-value text-success">100%</span></div>
      <div class="stat-row"><span class="stat-label">TTB reports due</span><span class="stat-value" style="color:var(--warning)">Aug 31</span></div>
    </div></div>
    <div class="card"><div class="card-header"><div class="card-title">Failed Shipments</div><span class="badge badge-danger">34</span></div><div class="card-body" style="padding-top:8px">
      <div class="stat-row"><span class="stat-label">Address not found</span><span class="stat-value text-danger">22</span></div>
      <div class="stat-row"><span class="stat-label">Recipient unavailable</span><span class="stat-value">8</span></div>
      <div class="stat-row"><span class="stat-label">Access code needed</span><span class="stat-value">4</span></div>
      <button class="card-action mt-12">Resolve all failed <i data-lucide="arrow-right"></i></button>
    </div></div>
  </div>
</div><!-- /shipments -->

<!-- ═══════ SCREEN: ANALYTICS ═══════ -->
<div class="screen" id="screen-analytics">
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon gold"><i data-lucide="trending-up"></i></div><div class="kpi-label">Annual Recurring Rev.</div><div class="kpi-value">$2.61M</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+14.3% YoY</div></div>
    <div class="kpi-card"><div class="kpi-icon wine"><i data-lucide="users"></i></div><div class="kpi-label">Avg. LTV per Member</div><div class="kpi-value">$4,218</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+$310 vs last year</div></div>
    <div class="kpi-card"><div class="kpi-icon green"><i data-lucide="percent"></i></div><div class="kpi-label">12-Month Retention</div><div class="kpi-value">82.1%</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+3.2pt YoY</div></div>
    <div class="kpi-card"><div class="kpi-icon blue"><i data-lucide="user-plus"></i></div><div class="kpi-label">New Members (YTD)</div><div class="kpi-value">421</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>Ahead of pace</div></div>
  </div>
  <div class="grid-2 mb-20">
    <div class="card">
      <div class="card-header"><div class="card-title">Revenue by Club Tier</div><div class="card-subtitle">Last 12 months</div></div>
      <div class="card-body"><div class="chart-wrap" style="height:200px"><canvas id="tierRevenueChart"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Member Growth</div><div class="card-subtitle">Active vs. churned</div></div>
      <div class="card-body"><div class="chart-wrap" style="height:200px"><canvas id="memberGrowthChart"></canvas></div></div>
    </div>
  </div>
  <div class="grid-3-1 mb-20">
    <div class="card">
      <div class="card-header"><div><div class="card-title">Cohort Retention Heatmap</div><div class="card-subtitle">% of members still active by signup cohort × months</div></div><div class="ai-chip"><i data-lucide="sparkles"></i>AI</div></div>
      <div class="card-body">
        <div style="overflow-x:auto;">
          <div style="display:grid;grid-template-columns:80px repeat(12,1fr);gap:3px;min-width:600px;font-size:10px;">
            <div style="font-weight:600;color:var(--text-muted);padding:4px 0">Cohort</div>
            <div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0" title="Month 1">M1</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M2</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M3</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M4</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M5</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M6</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M7</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M8</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M9</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M10</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M11</div><div style="font-weight:600;color:var(--text-muted);text-align:center;padding:4px 0">M12</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Jul '25</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="92%">92%</div>
<div class="heatmap-cell hm-6" title="88%">88%</div>
<div class="heatmap-cell hm-6" title="85%">85%</div>
<div class="heatmap-cell hm-5" title="82%">82%</div>
<div class="heatmap-cell hm-5" title="80%">80%</div>
<div class="heatmap-cell hm-4" title="78%">78%</div>
<div class="heatmap-cell hm-4" title="76%">76%</div>
<div class="heatmap-cell hm-3" title="74%">74%</div>
<div class="heatmap-cell hm-3" title="72%">72%</div>
<div class="heatmap-cell hm-3" title="70%">70%</div>
<div class="heatmap-cell hm-2" title="68%">68%</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Aug '25</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="91%">91%</div>
<div class="heatmap-cell hm-6" title="87%">87%</div>
<div class="heatmap-cell hm-5" title="83%">83%</div>
<div class="heatmap-cell hm-5" title="80%">80%</div>
<div class="heatmap-cell hm-4" title="77%">77%</div>
<div class="heatmap-cell hm-4" title="75%">75%</div>
<div class="heatmap-cell hm-3" title="73%">73%</div>
<div class="heatmap-cell hm-3" title="71%">71%</div>
<div class="heatmap-cell hm-2" title="69%">69%</div>
<div class="heatmap-cell hm-2" title="67%">67%</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Sep '25</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="93%">93%</div>
<div class="heatmap-cell hm-6" title="89%">89%</div>
<div class="heatmap-cell hm-6" title="86%">86%</div>
<div class="heatmap-cell hm-5" title="83%">83%</div>
<div class="heatmap-cell hm-5" title="81%">81%</div>
<div class="heatmap-cell hm-4" title="79%">79%</div>
<div class="heatmap-cell hm-4" title="77%">77%</div>
<div class="heatmap-cell hm-4" title="75%">75%</div>
<div class="heatmap-cell hm-3" title="73%">73%</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Oct '25</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="90%">90%</div>
<div class="heatmap-cell hm-6" title="85%">85%</div>
<div class="heatmap-cell hm-5" title="82%">82%</div>
<div class="heatmap-cell hm-4" title="78%">78%</div>
<div class="heatmap-cell hm-4" title="76%">76%</div>
<div class="heatmap-cell hm-3" title="74%">74%</div>
<div class="heatmap-cell hm-3" title="72%">72%</div>
<div class="heatmap-cell hm-3" title="70%">70%</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Nov '25</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="94%">94%</div>
<div class="heatmap-cell hm-7" title="90%">90%</div>
<div class="heatmap-cell hm-6" title="87%">87%</div>
<div class="heatmap-cell hm-6" title="85%">85%</div>
<div class="heatmap-cell hm-5" title="83%">83%</div>
<div class="heatmap-cell hm-5" title="81%">81%</div>
<div class="heatmap-cell hm-4" title="79%">79%</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Dec '25</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="92%">92%</div>
<div class="heatmap-cell hm-6" title="88%">88%</div>
<div class="heatmap-cell hm-6" title="85%">85%</div>
<div class="heatmap-cell hm-5" title="82%">82%</div>
<div class="heatmap-cell hm-5" title="80%">80%</div>
<div class="heatmap-cell hm-4" title="78%">78%</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Jan '26</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="91%">91%</div>
<div class="heatmap-cell hm-6" title="87%">87%</div>
<div class="heatmap-cell hm-5" title="84%">84%</div>
<div class="heatmap-cell hm-5" title="81%">81%</div>
<div class="heatmap-cell hm-4" title="79%">79%</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div style="font-size:10.5px;font-weight:600;padding:4px 0;color:var(--text-secondary)">Feb '26</div>
<div class="heatmap-cell hm-7" title="100%">100%</div>
<div class="heatmap-cell hm-7" title="93%">93%</div>
<div class="heatmap-cell hm-6" title="89%">89%</div>
<div class="heatmap-cell hm-6" title="86%">86%</div>
<div class="heatmap-cell hm-5" title="84%">84%</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>
<div class="heatmap-cell hm-0" title="—">—</div>

          </div>
        </div>
        <div class="info-box info-box-info mt-12" style="margin-top:12px"><i data-lucide="info"></i><span>Darker = higher retention. AI analysis: Cohorts acquired during harvest events (Nov–Dec) retain 6pt better at 12 months than average.</span></div>
      </div>
    </div>
    <div>
      <div class="card mb-16">
        <div class="card-header"><div class="card-title">LTV Breakdown</div></div>
        <div class="card-body" style="padding-top:8px">
          <div class="stat-row"><span class="stat-label">Reserve Collection</span><span class="stat-value">$7,840</span></div>
          <div class="stat-row"><span class="stat-label">Estate Select</span><span class="stat-value">$3,920</span></div>
          <div class="stat-row"><span class="stat-label">Discovery Club</span><span class="stat-value">$1,640</span></div>
          <div class="stat-row"><span class="stat-label">Blended Avg.</span><span class="stat-value font-bold">$4,218</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Churn Drivers</div><div class="ai-chip"><i data-lucide="sparkles"></i>AI</div></div>
        <div class="card-body" style="padding-top:8px">
          <div class="stat-row"><span class="stat-label">Skipped 2+ shipments</span><span class="stat-value text-danger">41%</span></div>
          <div class="stat-row"><span class="stat-label">Zero email opens (60d)</span><span class="stat-value text-danger">28%</span></div>
          <div class="stat-row"><span class="stat-label">No tasting room visit (1yr)</span><span class="stat-value" style="color:var(--warning)">18%</span></div>
          <div class="stat-row"><span class="stat-label">Card payment failed</span><span class="stat-value" style="color:var(--warning)">13%</span></div>
        </div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">Acquisition Channel Performance</div></div>
    <div class="card-body">
      <table class="data-table">
        <thead><tr><th>Channel</th><th>New Members</th><th>Avg. Tenure</th><th>Avg. LTV</th><th>12-Mo Retention</th><th>Cost per Acquisition</th></tr></thead>
        <tbody>
          <tr><td>Tasting Room Walk-in</td><td class="num">218</td><td class="num">3.4 yrs</td><td class="num">$5,120</td><td class="num"><span class="badge badge-success">88%</span></td><td class="num">$42</td></tr>
          <tr><td>Event / Harvest Festival</td><td class="num">94</td><td class="num">3.8 yrs</td><td class="num">$5,840</td><td class="num"><span class="badge badge-success">91%</span></td><td class="num">$88</td></tr>
          <tr><td>Website / Organic</td><td class="num">72</td><td class="num">2.1 yrs</td><td class="num">$2,980</td><td class="num"><span class="badge badge-warning">74%</span></td><td class="num">$120</td></tr>
          <tr><td>Member Referral</td><td class="num">37</td><td class="num">4.1 yrs</td><td class="num">$6,210</td><td class="num"><span class="badge badge-success">93%</span></td><td class="num">$18</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div><!-- /analytics -->

<!-- ═══════ SCREEN: CLUB TIERS ═══════ -->
<div class="screen" id="screen-tiers">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Club Tier Configuration</div><div class="section-sub">3 active tiers · 1,847 total members</div></div>
    <button class="btn btn-primary" onclick="openModal('newTierModal')"><i data-lucide="plus"></i> Create New Tier</button>
  </div>
  <div class="grid-3 mb-20">
    <!-- Discovery -->
    <div class="tier-card">
      <div class="tier-icon" style="background:#EFF6FF;color:#2563EB"><i data-lucide="compass"></i></div>
      <div class="tier-price">$54<span>/release</span></div>
      <div class="tier-name">Discovery Club</div>
      <div class="tier-desc">Entry-level, 3 bottles per shipment. Perfect for new wine explorers.</div>
      <div class="separator"></div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> 3 bottles per release</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Quarterly shipments</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> 10% tasting room discount</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Member newsletter</div>
      <div class="tier-feature" style="color:var(--text-muted)"><i data-lucide="x-circle" style="color:var(--text-muted)"></i> Allocation access</div>
      <div class="tier-feature" style="color:var(--text-muted)"><i data-lucide="x-circle" style="color:var(--text-muted)"></i> Priority event tickets</div>
      <div class="separator"></div>
      <div class="flex items-center justify-between" style="font-size:13px">
        <span class="text-muted">837 members</span>
        <div class="flex gap-8"><button class="btn btn-sm" onclick="openModal('editTierModal')"><i data-lucide="edit-2"></i> Edit</button></div>
      </div>
    </div>
    <!-- Estate (featured) -->
    <div class="tier-card featured">
      <div class="tier-featured-badge">Most Popular</div>
      <div class="tier-icon" style="background:var(--wine-light);color:var(--wine)"><i data-lucide="award"></i></div>
      <div class="tier-price">$136<span>/release</span></div>
      <div class="tier-name">Estate Select</div>
      <div class="tier-desc">Core tier, 4 bottles. Our best value for dedicated wine lovers.</div>
      <div class="separator"></div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> 4 bottles per release</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Quarterly + optional add-ons</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> 15% tasting room discount</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Seasonal newsletter</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Early allocation access</div>
      <div class="tier-feature" style="color:var(--text-muted)"><i data-lucide="x-circle" style="color:var(--text-muted)"></i> Private winemaker events</div>
      <div class="separator"></div>
      <div class="flex items-center justify-between" style="font-size:13px">
        <span class="text-muted">698 members</span>
        <div class="flex gap-8"><button class="btn btn-sm" onclick="openModal('editTierModal')"><i data-lucide="edit-2"></i> Edit</button></div>
      </div>
    </div>
    <!-- Reserve -->
    <div class="tier-card">
      <div class="tier-icon" style="background:var(--gold-light);color:var(--gold)"><i data-lucide="crown"></i></div>
      <div class="tier-price">$213<span>/release</span></div>
      <div class="tier-name">Reserve Collection</div>
      <div class="tier-desc">Premium tier, 6 bottles. Exclusive access to library and reserve wines.</div>
      <div class="separator"></div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> 6 bottles per release</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Bi-annual + custom cadence</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> 20% tasting room discount</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> VIP newsletter + tasting notes</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Priority allocation access</div>
      <div class="tier-feature"><i data-lucide="check-circle"></i> Private winemaker dinners</div>
      <div class="separator"></div>
      <div class="flex items-center justify-between" style="font-size:13px">
        <span class="text-muted">312 members</span>
        <div class="flex gap-8"><button class="btn btn-sm" onclick="openModal('editTierModal')"><i data-lucide="edit-2"></i> Edit</button></div>
      </div>
    </div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-header"><div class="card-title">Tier Revenue Contribution</div></div>
      <div class="card-body">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div><div class="flex justify-between text-sm" style="margin-bottom:4px"><span>Reserve Collection</span><span class="font-semibold">$97.7K / release (45%)</span></div><div class="progress-track" style="height:8px"><div class="progress-fill pf-gold" style="width:45%"></div></div></div>
          <div><div class="flex justify-between text-sm" style="margin-bottom:4px"><span>Estate Select</span><span class="font-semibold">$75.0K / release (34%)</span></div><div class="progress-track" style="height:8px"><div class="progress-fill pf-wine" style="width:34%"></div></div></div>
          <div><div class="flex justify-between text-sm" style="margin-bottom:4px"><span>Discovery Club</span><span class="font-semibold">$45.2K / release (21%)</span></div><div class="progress-track" style="height:8px"><div class="progress-fill pf-info" style="width:21%"></div></div></div>
        </div>
        <div class="info-box info-box-info mt-12" style="margin-top:12px"><i data-lucide="sparkles"></i><span><strong>AI Insight:</strong> Reserve members represent 17% of your base but 45% of revenue. Each 10 upgrades from Estate → Reserve adds ~$7,700/release.</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Build-Your-Own Customization Settings</div></div>
      <div class="card-body" style="padding-top:10px">
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Allow bottle swaps</div><div class="text-xs text-muted">Members can swap wines before shipment</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
          <div class="separator" style="margin:4px 0"></div>
          <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Allow shipment skip</div><div class="text-xs text-muted">Keep membership active but skip release</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
          <div class="separator" style="margin:4px 0"></div>
          <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Allow quantity upgrades</div><div class="text-xs text-muted">Members can add bottles to their shipment</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
          <div class="separator" style="margin:4px 0"></div>
          <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Allow self-service cancellation</div><div class="text-xs text-muted">Members can cancel without calling staff</div></div><label class="toggle"><input type="checkbox"><span class="toggle-slider"></span></label></div>
          <div class="separator" style="margin:4px 0"></div>
          <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Magic link login (passwordless)</div><div class="text-xs text-muted">One-click portal access via email link</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
        </div>
      </div>
    </div>
  </div>
</div><!-- /tiers -->

<!-- ═══════ SCREEN: ALLOCATIONS ═══════ -->
<div class="screen" id="screen-allocations">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Vintage Allocations</div><div class="section-sub">Reserve exclusive inventory for club members before it reaches retail or the tasting room</div></div>
    <button class="btn btn-primary" onclick="openModal('newAllocModal')"><i data-lucide="plus"></i> New Allocation</button>
  </div>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="kpi-card"><div class="kpi-icon wine"><i data-lucide="wine"></i></div><div class="kpi-label">Bottles Allocated</div><div class="kpi-value">4,840</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>Across 6 SKUs</div></div>
    <div class="kpi-card"><div class="kpi-icon green"><i data-lucide="check"></i></div><div class="kpi-label">Members Assigned</div><div class="kpi-value">312</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>100% Reserve members</div></div>
    <div class="kpi-card"><div class="kpi-icon red"><i data-lucide="alert-triangle"></i></div><div class="kpi-label">Unclaimed (7 days left)</div><div class="kpi-value">48</div><div class="kpi-delta down"><i data-lucide="trending-up"></i>Release to retail Aug 1</div></div>
  </div>
  <div class="card mb-20">
    <div class="card-header"><div class="card-title">Current Allocation Window — Fall 2026 Reserve</div><div class="flex gap-8"><button class="btn btn-sm"><i data-lucide="mail"></i> Remind Unclaimed</button><button class="btn btn-sm btn-primary"><i data-lucide="check-circle"></i> Close Window</button></div></div>
    <div class="card-body">
      <div class="info-box info-box-warning mb-20" style="margin-bottom:14px"><i data-lucide="clock"></i><span>Allocation window closes <strong>August 1, 2026</strong>. 48 members have not yet made their selection. An AI-powered reminder email will be sent automatically in 3 days.</span></div>
      <table class="data-table">
        <thead><tr><th>SKU / Vintage</th><th>Varietal</th><th>Vintage</th><th>Total Bottles</th><th>Reserved</th><th>Claimed</th><th>Unclaimed</th><th>Retail After</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td><strong>2020 Single Vineyard Cab</strong></td><td>Cabernet Sauvignon</td><td>2020</td><td class="num">624</td><td class="num">312</td><td class="num"><span class="text-success font-semibold">284</span></td><td class="num"><span class="text-danger font-semibold">28</span></td><td class="num">$94</td><td><span class="badge badge-warning">Open</span></td></tr>
          <tr><td><strong>2019 Reserve Blend</strong></td><td>Bordeaux Blend</td><td>2019</td><td class="num">312</td><td class="num">156</td><td class="num"><span class="text-success font-semibold">136</span></td><td class="num"><span class="text-danger font-semibold">20</span></td><td class="num">$110</td><td><span class="badge badge-warning">Open</span></td></tr>
          <tr><td><strong>2022 Petit Verdot Res.</strong></td><td>Petit Verdot</td><td>2022</td><td class="num">200</td><td class="num">100</td><td class="num"><span class="text-success font-semibold">100</span></td><td class="num"><span class="text-success font-semibold">0</span></td><td class="num">$78</td><td><span class="badge badge-success">Fully Claimed</span></td></tr>
          <tr><td><strong>2023 Winemaker Reserve</strong></td><td>Red Blend</td><td>2023</td><td class="num">500</td><td class="num">250</td><td class="num"><span class="text-success font-semibold">250</span></td><td class="num"><span class="text-success font-semibold">0</span></td><td class="num">$88</td><td><span class="badge badge-success">Fully Claimed</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-header"><div class="card-title">Unclaimed Allocations — Members</div><button class="btn btn-sm btn-primary"><i data-lucide="mail"></i> Send Bulk Reminder</button></div>
      <div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>Member</th><th>Tier</th><th>Unclaimed SKUs</th><th>Value at Risk</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">JH</div>Jennifer H.</div></td><td><span class="badge badge-wine">Reserve</span></td><td class="num">2</td><td class="num">$204</td><td><button class="btn btn-sm"><i data-lucide="mail"></i></button></td></tr>
            <tr><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">RM</div>Robert M.</div></td><td><span class="badge badge-wine">Reserve</span></td><td class="num">1</td><td class="num">$94</td><td><button class="btn btn-sm"><i data-lucide="mail"></i></button></td></tr>
            <tr><td><div class="flex items-center gap-8"><div class="avatar" style="width:26px;height:26px;font-size:9px">AL</div>Amy L.</div></td><td><span class="badge badge-wine">Reserve</span></td><td class="num">2</td><td class="num">$188</td><td><button class="btn btn-sm"><i data-lucide="mail"></i></button></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Inventory Guard</div><div class="ai-chip"><i data-lucide="sparkles"></i>AI</div></div>
      <div class="card-body" style="padding-top:8px">
        <div class="info-box info-box-success mb-20" style="margin-bottom:12px"><i data-lucide="shield-check"></i><span>All club allocations are reserved. No risk of overselling to non-members.</span></div>
        <div class="stat-row"><span class="stat-label">Total reserved for club</span><span class="stat-value">4,840 btl</span></div>
        <div class="stat-row"><span class="stat-label">Available to retail after Aug 1</span><span class="stat-value">Unclaimed only</span></div>
        <div class="stat-row"><span class="stat-label">Allocation window closes</span><span class="stat-value text-danger">Aug 1, 2026</span></div>
        <div class="stat-row"><span class="stat-label">Projected unclaimed value</span><span class="stat-value" style="color:var(--warning)">~$4,700</span></div>
        <div class="info-box info-box-info mt-12" style="margin-top:12px"><i data-lucide="sparkles"></i><span>AI predicts 85% of unclaimed allocations will be claimed if a personalized reminder is sent 5 days before close.</span></div>
      </div>
    </div>
  </div>
</div><!-- /allocations -->

<!-- ═══════ SCREEN: RELEASE SCHEDULE ═══════ -->
<div class="screen" id="screen-schedule">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Release Schedule</div><div class="section-sub">Full-year calendar for club shipments, events, and allocation windows</div></div>
    <button class="btn btn-primary" onclick="openModal('newReleaseModal')"><i data-lucide="plus"></i> Add Release</button>
  </div>
  <div class="grid-3-1 mb-20">
    <div class="card">
      <div class="card-header"><div class="card-title">2026 Release Calendar</div></div>
      <div class="card-body" style="padding:0">
        <div style="display:flex;flex-direction:column;">
          <!-- Spring -->
          <div style="display:flex;align-items:stretch;border-bottom:1px solid var(--border);">
            <div style="width:110px;flex-shrink:0;background:var(--bg-page);padding:16px 14px;border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted)">Q1 2026</div>
              <div style="font-size:14px;font-weight:700;margin-top:2px;">Spring</div>
            </div>
            <div style="flex:1;padding:14px 18px;">
              <div class="flex items-center gap-8" style="margin-bottom:6px;"><span class="badge badge-success"><i data-lucide="check"></i> Completed</span><span style="font-size:13px;font-weight:600">Spring 2026 — All Tiers</span></div>
              <div class="text-sm text-muted" style="margin-bottom:8px">Shipped Feb 14 · 1,820 shipments · $215,800 billed</div>
              <div class="flex gap-8">
                <span class="chip"><i data-lucide="package"></i> 3 clubs</span>
                <span class="chip"><i data-lucide="check-circle"></i> 98.3% delivered</span>
                <span class="chip"><i data-lucide="alert-triangle"></i> 31 issues resolved</span>
              </div>
            </div>
          </div>
          <!-- Summer -->
          <div style="display:flex;align-items:stretch;border-bottom:1px solid var(--border);">
            <div style="width:110px;flex-shrink:0;background:var(--bg-page);padding:16px 14px;border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted)">Q2 2026</div>
              <div style="font-size:14px;font-weight:700;margin-top:2px;">Summer</div>
            </div>
            <div style="flex:1;padding:14px 18px;">
              <div class="flex items-center gap-8" style="margin-bottom:6px;"><span class="badge badge-success"><i data-lucide="check"></i> Completed</span><span style="font-size:13px;font-weight:600">Summer 2026 — All Tiers</span></div>
              <div class="text-sm text-muted" style="margin-bottom:8px">Shipped May 20 · 1,831 shipments · $217,420 billed</div>
              <div class="flex gap-8">
                <span class="chip"><i data-lucide="package"></i> 3 clubs</span>
                <span class="chip"><i data-lucide="check-circle"></i> 98.7% delivered</span>
              </div>
            </div>
          </div>
          <!-- Fall (ACTIVE) -->
          <div style="display:flex;align-items:stretch;border-bottom:1px solid var(--border);background:var(--wine-light);">
            <div style="width:110px;flex-shrink:0;background:rgba(107,30,48,0.08);padding:16px 14px;border-right:1px solid rgba(107,30,48,0.15);display:flex;flex-direction:column;justify-content:center;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--wine)">Q3 2026</div>
              <div style="font-size:14px;font-weight:700;margin-top:2px;color:var(--wine)">Fall ← Now</div>
            </div>
            <div style="flex:1;padding:14px 18px;">
              <div class="flex items-center gap-8" style="margin-bottom:6px;"><span class="badge badge-warning"><i data-lucide="clock"></i> In Progress</span><span style="font-size:13px;font-weight:600">Fall 2026 — All Tiers</span></div>
              <div class="text-sm text-muted" style="margin-bottom:8px">Billing Aug 12 · Shipping Aug 14 · 1,847 members</div>
              <div style="margin-bottom:8px">
                <div class="flex justify-between text-xs text-muted" style="margin-bottom:3px"><span>Notification sent</span><span class="font-semibold" style="color:var(--text-primary)">✓ Discovery, Estate</span></div>
                <div class="progress-track"><div class="progress-fill pf-wine" style="width:67%"></div></div>
              </div>
              <div class="flex gap-8">
                <span class="chip active"><i data-lucide="mail"></i> Notifications pending — Reserve</span>
                <button class="btn btn-sm btn-primary" onclick="openModal('releaseModal')"><i data-lucide="play-circle"></i> Manage Release</button>
              </div>
            </div>
          </div>
          <!-- Winter -->
          <div style="display:flex;align-items:stretch;">
            <div style="width:110px;flex-shrink:0;background:var(--bg-page);padding:16px 14px;border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:center;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted)">Q4 2026</div>
              <div style="font-size:14px;font-weight:700;margin-top:2px;">Winter</div>
            </div>
            <div style="flex:1;padding:14px 18px;">
              <div class="flex items-center gap-8" style="margin-bottom:6px;"><span class="badge badge-neutral">Planned</span><span style="font-size:13px;font-weight:600">Winter 2026 — All Tiers</span></div>
              <div class="text-sm text-muted" style="margin-bottom:8px">Target: Nov 15, 2026 · Wines not yet selected</div>
              <div class="flex gap-8">
                <button class="btn btn-sm"><i data-lucide="edit-2"></i> Configure</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div class="card mb-16">
        <div class="card-header"><div class="card-title">Upcoming Milestones</div></div>
        <div class="card-body" style="padding:0">
          <div class="timeline" style="padding:14px 16px">
            <div class="timeline-item"><div class="timeline-dot wine"><i data-lucide="mail"></i></div><div class="timeline-body"><div class="timeline-title">Reserve notification email</div><div class="timeline-meta">Jul 27, 2026 — 2 days</div></div></div>
            <div class="timeline-item"><div class="timeline-dot"><i data-lucide="wine"></i></div><div class="timeline-body"><div class="timeline-title">Allocation window closes</div><div class="timeline-meta">Aug 1, 2026 — 7 days</div></div></div>
            <div class="timeline-item"><div class="timeline-dot"><i data-lucide="calendar"></i></div><div class="timeline-body"><div class="timeline-title">Member customization window closes</div><div class="timeline-meta">Aug 10, 2026</div></div></div>
            <div class="timeline-item"><div class="timeline-dot"><i data-lucide="credit-card"></i></div><div class="timeline-body"><div class="timeline-title">Billing batch run</div><div class="timeline-meta">Aug 12, 2026</div></div></div>
            <div class="timeline-item"><div class="timeline-dot gold"><i data-lucide="truck"></i></div><div class="timeline-body"><div class="timeline-title">Fall 2026 ships</div><div class="timeline-meta">Aug 14, 2026</div></div></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Events Calendar</div></div>
        <div class="card-body" style="padding-top:8px">
          <div class="stat-row"><span class="stat-label">Harvest Dinner (Reserve)</span><span class="badge badge-wine">Sep 12</span></div>
          <div class="stat-row"><span class="stat-label">Fall Release Party</span><span class="badge badge-info">Aug 24</span></div>
          <div class="stat-row"><span class="stat-label">Winemaker Q&A (Virtual)</span><span class="badge badge-neutral">Aug 18</span></div>
          <div class="stat-row"><span class="stat-label">Winter Preview Tasting</span><span class="badge badge-neutral">Oct 10</span></div>
          <button class="card-action mt-12">Manage all events <i data-lucide="arrow-right"></i></button>
        </div>
      </div>
    </div>
  </div>
</div><!-- /schedule -->

<!-- ═══════ SCREEN: FULFILLMENT ═══════ -->
<div class="screen" id="screen-fulfillment">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Fulfillment & Compliance</div><div class="section-sub">Label queue, carrier configuration, and state-by-state shipping compliance</div></div>
    <div class="flex gap-8">
      <button class="btn"><i data-lucide="download"></i> Export Manifest</button>
      <button class="btn btn-primary"><i data-lucide="printer"></i> Generate Labels</button>
    </div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon blue"><i data-lucide="printer"></i></div><div class="kpi-label">Labels Queued</div><div class="kpi-value">1,847</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>Ready to print</div></div>
    <div class="kpi-card"><div class="kpi-icon green"><i data-lucide="check-circle"></i></div><div class="kpi-label">Compliance Verified</div><div class="kpi-value">1,815</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>98.3% auto-verified</div></div>
    <div class="kpi-card"><div class="kpi-icon red"><i data-lucide="x-circle"></i></div><div class="kpi-label">Compliance Blocked</div><div class="kpi-value">32</div><div class="kpi-delta down"><i data-lucide="trending-up"></i>8 states restricted</div></div>
    <div class="kpi-card"><div class="kpi-icon gold"><i data-lucide="calendar"></i></div><div class="kpi-label">TTB Report Due</div><div class="kpi-value">Aug 31</div><div class="kpi-delta down"><i data-lucide="trending-up"></i>37 days remaining</div></div>
  </div>
  <div class="grid-2 mb-20">
    <div class="card">
      <div class="card-header"><div class="card-title">Label Print Queue</div><div class="flex gap-8"><button class="btn btn-sm"><i data-lucide="settings"></i> Carrier Config</button><button class="btn btn-sm btn-primary"><i data-lucide="printer"></i> Print All</button></div></div>
      <div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th><input type="checkbox"></th><th>Member</th><th>State</th><th>Carrier</th><th>Service</th><th>Weight</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td><input type="checkbox" checked></td><td><div class="flex items-center gap-6"><div class="avatar" style="width:24px;height:24px;font-size:9px">ML</div>Margaret L.</div></td><td>CA</td><td>UPS</td><td>Ground</td><td class="num">14.2 lb</td><td><span class="badge badge-info">Queued</span></td></tr>
            <tr><td><input type="checkbox" checked></td><td><div class="flex items-center gap-6"><div class="avatar" style="width:24px;height:24px;font-size:9px">JW</div>James W.</div></td><td>OR</td><td>FedEx</td><td>Home</td><td class="num">14.2 lb</td><td><span class="badge badge-success">Printed</span></td></tr>
            <tr><td><input type="checkbox" checked></td><td><div class="flex items-center gap-6"><div class="avatar" style="width:24px;height:24px;font-size:9px">SK</div>Soo-Yeon K.</div></td><td>WA</td><td>UPS</td><td>Ground</td><td class="num">9.8 lb</td><td><span class="badge badge-success">Printed</span></td></tr>
            <tr><td><input type="checkbox"></td><td><div class="flex items-center gap-6"><div class="avatar" style="width:24px;height:24px;font-size:9px">DP</div>David P.</div></td><td>CA</td><td>GSO</td><td>Standard</td><td class="num">7.3 lb</td><td><span class="badge badge-danger">Addr Error</span></td></tr>
            <tr><td><input type="checkbox" checked></td><td><div class="flex items-center gap-6"><div class="avatar" style="width:24px;height:24px;font-size:9px">CR</div>Claire R.</div></td><td>CO</td><td>FedEx</td><td>Home</td><td class="num">9.8 lb</td><td><span class="badge badge-success">Printed</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div><div class="card-title">Carrier Configuration</div><div class="card-subtitle">Rates and routing rules for Fall 2026 release</div></div></div>
      <div class="card-body" style="padding-top:8px">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-page)">
            <div class="flex items-center justify-between" style="margin-bottom:6px"><div class="flex items-center gap-8"><div style="width:28px;height:28px;background:#351C75;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">UPS</div><span style="font-size:13.5px;font-weight:600">UPS Ground</span></div><span class="badge badge-success">Active</span></div>
            <div class="text-xs text-muted">Primary carrier · 892 shipments · Account #4E2F0A · Negotiated rate: $8.42/pkg avg</div>
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-page)">
            <div class="flex items-center justify-between" style="margin-bottom:6px"><div class="flex items-center gap-8"><div style="width:28px;height:28px;background:#4D148C;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">FDX</div><span style="font-size:13.5px;font-weight:600">FedEx Home Delivery</span></div><span class="badge badge-success">Active</span></div>
            <div class="text-xs text-muted">Secondary carrier · 672 shipments · Account #8B3C2 · Negotiated rate: $9.18/pkg avg</div>
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-page)">
            <div class="flex items-center justify-between" style="margin-bottom:6px"><div class="flex items-center gap-8"><div style="width:28px;height:28px;background:#1E3A5F;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">GSO</div><span style="font-size:13.5px;font-weight:600">GSO (CA & NV only)</span></div><span class="badge badge-success">Active</span></div>
            <div class="text-xs text-muted">Regional carrier · CA/NV zones only · 283 shipments · $7.10/pkg avg</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><div><div class="card-title">State Shipping Compliance Map</div><div class="card-subtitle">Direct-to-consumer permit status by state</div></div><div class="ai-chip"><i data-lucide="sparkles"></i>Auto-monitored</div></div>
    <div class="card-body">
      <div class="flex gap-12 mb-16" style="margin-bottom:10px;flex-wrap:wrap">
        <div class="flex items-center gap-6 text-sm"><div style="width:12px;height:12px;border-radius:3px;background:#dcfce7"></div>Allowed (38)</div>
        <div class="flex items-center gap-6 text-sm"><div style="width:12px;height:12px;border-radius:3px;background:#fef9c3"></div>Restricted / Permit req. (4)</div>
        <div class="flex items-center gap-6 text-sm"><div style="width:12px;height:12px;border-radius:3px;background:#fee2e2"></div>Blocked / Prohibited (8)</div>
      </div>
      <div class="state-grid">
<div class="state-cell sc-blocked" title="AL">AL</div>
<div class="state-cell sc-restricted" title="AK">AK</div>
<div class="state-cell sc-allowed" title="AZ">AZ</div>
<div class="state-cell sc-blocked" title="AR">AR</div>
<div class="state-cell sc-allowed" title="CA">CA</div>
<div class="state-cell sc-allowed" title="CO">CO</div>
<div class="state-cell sc-allowed" title="CT">CT</div>
<div class="state-cell sc-allowed" title="DE">DE</div>
<div class="state-cell sc-allowed" title="FL">FL</div>
<div class="state-cell sc-restricted" title="GA">GA</div>
<div class="state-cell sc-allowed" title="HI">HI</div>
<div class="state-cell sc-allowed" title="ID">ID</div>
<div class="state-cell sc-allowed" title="IL">IL</div>
<div class="state-cell sc-allowed" title="IN">IN</div>
<div class="state-cell sc-allowed" title="IA">IA</div>
<div class="state-cell sc-restricted" title="KS">KS</div>
<div class="state-cell sc-allowed" title="KY">KY</div>
<div class="state-cell sc-allowed" title="LA">LA</div>
<div class="state-cell sc-allowed" title="ME">ME</div>
<div class="state-cell sc-allowed" title="MD">MD</div>
<div class="state-cell sc-allowed" title="MA">MA</div>
<div class="state-cell sc-allowed" title="MI">MI</div>
<div class="state-cell sc-allowed" title="MN">MN</div>
<div class="state-cell sc-blocked" title="MS">MS</div>
<div class="state-cell sc-allowed" title="MO">MO</div>
<div class="state-cell sc-allowed" title="MT">MT</div>
<div class="state-cell sc-allowed" title="NE">NE</div>
<div class="state-cell sc-allowed" title="NV">NV</div>
<div class="state-cell sc-allowed" title="NH">NH</div>
<div class="state-cell sc-allowed" title="NJ">NJ</div>
<div class="state-cell sc-allowed" title="NM">NM</div>
<div class="state-cell sc-allowed" title="NY">NY</div>
<div class="state-cell sc-allowed" title="NC">NC</div>
<div class="state-cell sc-allowed" title="ND">ND</div>
<div class="state-cell sc-allowed" title="OH">OH</div>
<div class="state-cell sc-blocked" title="OK">OK</div>
<div class="state-cell sc-allowed" title="OR">OR</div>
<div class="state-cell sc-allowed" title="PA">PA</div>
<div class="state-cell sc-allowed" title="RI">RI</div>
<div class="state-cell sc-allowed" title="SC">SC</div>
<div class="state-cell sc-allowed" title="SD">SD</div>
<div class="state-cell sc-restricted" title="TN">TN</div>
<div class="state-cell sc-allowed" title="TX">TX</div>
<div class="state-cell sc-blocked" title="UT">UT</div>
<div class="state-cell sc-allowed" title="VT">VT</div>
<div class="state-cell sc-allowed" title="VA">VA</div>
<div class="state-cell sc-allowed" title="WA">WA</div>
<div class="state-cell sc-blocked" title="WV">WV</div>
<div class="state-cell sc-allowed" title="WI">WI</div>
<div class="state-cell sc-allowed" title="WY">WY</div>

      </div>
      <div class="info-box info-box-info mt-12" style="margin-top:12px"><i data-lucide="bell"></i><span>Compliance rules are monitored automatically. You will be notified if any state changes its DTC shipping laws. Next permit renewal: California — Oct 15, 2026.</span></div>
    </div>
  </div>
</div><!-- /fulfillment -->

<!-- ═══════ SCREEN: COMMUNICATIONS ═══════ -->
<div class="screen" id="screen-comms">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Communications</div><div class="section-sub">Email templates, AI content generation, and send queue</div></div>
    <div class="flex gap-8">
      <button class="btn"><i data-lucide="bar-chart-2"></i> Email Analytics</button>
      <button class="btn btn-primary" onclick="openModal('newEmailModal')"><i data-lucide="plus"></i> New Campaign</button>
    </div>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon blue"><i data-lucide="mail"></i></div><div class="kpi-label">Emails Sent (30d)</div><div class="kpi-value">12,840</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+18% vs prior period</div></div>
    <div class="kpi-card"><div class="kpi-icon green"><i data-lucide="mouse-pointer-click"></i></div><div class="kpi-label">Avg. Open Rate</div><div class="kpi-value">38.2%</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+4.1pt vs industry avg</div></div>
    <div class="kpi-card"><div class="kpi-icon gold"><i data-lucide="external-link"></i></div><div class="kpi-label">Click-through Rate</div><div class="kpi-value">12.7%</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+2.3pt vs last month</div></div>
    <div class="kpi-card"><div class="kpi-icon red"><i data-lucide="user-minus"></i></div><div class="kpi-label">Unsubscribe Rate</div><div class="kpi-value">0.4%</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>Below 0.5% threshold</div></div>
  </div>
  <div class="grid-3-1 mb-20">
    <div class="card">
      <div class="card-header"><div class="card-title">Email Template Library</div><button class="btn btn-sm btn-primary"><i data-lucide="plus"></i> New Template</button></div>
      <div class="card-body">
        <div class="grid-3" style="grid-template-columns:repeat(3,1fr);gap:12px">
          <div class="template-card" onclick="openModal('aiEmailModal')">
            <div class="template-preview" style="background:linear-gradient(135deg,var(--wine-light),var(--gold-light))">📦</div>
            <div class="template-info"><div class="template-name">Pre-Shipment Notice</div><div class="template-meta">38.4% open rate · 847 uses</div></div>
          </div>
          <div class="template-card" onclick="openModal('aiEmailModal')">
            <div class="template-preview" style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4)">🚚</div>
            <div class="template-info"><div class="template-name">Shipment Confirmed</div><div class="template-meta">44.2% open rate · 1,820 uses</div></div>
          </div>
          <div class="template-card" onclick="openModal('aiEmailModal')">
            <div class="template-preview" style="background:linear-gradient(135deg,#FEF2F2,#FFF7ED)">💔</div>
            <div class="template-info"><div class="template-name">Churn Risk Save</div><div class="template-meta">52.1% open rate · 312 uses</div></div>
          </div>
          <div class="template-card" onclick="openModal('aiEmailModal')">
            <div class="template-preview" style="background:linear-gradient(135deg,var(--gold-light),var(--wine-light))">🍷</div>
            <div class="template-info"><div class="template-name">Winemaker Notes</div><div class="template-meta">41.8% open rate · 3,640 uses</div></div>
          </div>
          <div class="template-card" onclick="openModal('aiEmailModal')">
            <div class="template-preview" style="background:linear-gradient(135deg,#F5F3FF,#EFF6FF)">🎉</div>
            <div class="template-info"><div class="template-name">Member Anniversary</div><div class="template-meta">61.3% open rate · 1,204 uses</div></div>
          </div>
          <div class="template-card" onclick="openModal('aiEmailModal')">
            <div class="template-preview" style="background:linear-gradient(135deg,#F0FDF4,#EFF6FF)">✨</div>
            <div class="template-info"><div class="template-name">Upgrade Invitation</div><div class="template-meta">29.4% open rate · 412 uses</div></div>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div class="card mb-16">
        <div class="card-header"><div class="card-title">Send Queue</div><span class="badge badge-warning">3 pending</span></div>
        <div class="card-body" style="padding:0">
          <div style="display:flex;flex-direction:column;gap:0">
            <div style="padding:11px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px"><div style="width:8px;height:8px;border-radius:50%;background:var(--warning);flex-shrink:0"></div><div style="flex:1"><div style="font-size:13px;font-weight:600">Fall 2026 — Reserve Notification</div><div class="text-xs text-muted">312 recipients · Sends Jul 27</div></div><button class="btn btn-sm"><i data-lucide="edit-2"></i></button></div>
            <div style="padding:11px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px"><div style="width:8px;height:8px;border-radius:50%;background:var(--warning);flex-shrink:0"></div><div style="flex:1"><div style="font-size:13px;font-weight:600">Allocation Reminder — Unclaimed</div><div class="text-xs text-muted">48 recipients · Sends Jul 29</div></div><button class="btn btn-sm"><i data-lucide="edit-2"></i></button></div>
            <div style="padding:11px 14px;display:flex;align-items:center;gap:10px"><div style="width:8px;height:8px;border-radius:50%;background:var(--danger);flex-shrink:0"></div><div style="flex:1"><div style="font-size:13px;font-weight:600">AI Churn Save — 67 at-risk members</div><div class="text-xs text-muted">67 recipients · Awaiting approval</div></div><button class="btn btn-sm btn-primary"><i data-lucide="check"></i> Approve</button></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">AI Content Generator</div><div class="ai-chip"><i data-lucide="sparkles"></i>AI</div></div>
        <div class="card-body" style="padding-top:10px">
          <div class="form-group"><label class="form-label">Email Type</label><select class="form-control"><option>Pre-shipment announcement</option><option>Churn save — personal offer</option><option>Winemaker tasting notes</option><option>Member anniversary</option><option>Allocation reminder</option></select></div>
          <div class="form-group"><label class="form-label">Tone</label><select class="form-control"><option>Warm & personal</option><option>Formal & elegant</option><option>Playful & enthusiastic</option></select></div>
          <div class="form-group"><label class="form-label">Target Segment</label><select class="form-control"><option>All active members</option><option>Reserve Collection only</option><option>At-risk (score > 60%)</option><option>New members (< 6 months)</option></select></div>
          <button class="btn btn-primary w-full" onclick="openModal('aiEmailModal')"><i data-lucide="sparkles"></i> Generate with AI</button>
        </div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">Recent Campaign Performance</div></div>
    <div class="card-body" style="padding:0">
      <table class="data-table">
        <thead><tr><th>Campaign</th><th>Segment</th><th>Sent</th><th>Open Rate</th><th>Click Rate</th><th>Revenue Attributed</th><th>Sent</th></tr></thead>
        <tbody>
          <tr><td><strong>Summer 2026 — All Members</strong></td><td>All (1,831)</td><td class="num">1,831</td><td class="num"><span class="badge badge-success">42.3%</span></td><td class="num">14.1%</td><td class="num text-success font-semibold">$18,420</td><td class="num">May 6</td></tr>
          <tr><td><strong>Churn Save — Spring Cohort</strong></td><td>At-risk (41)</td><td class="num">41</td><td class="num"><span class="badge badge-success">56.1%</span></td><td class="num">22.0%</td><td class="num text-success font-semibold">$6,840</td><td class="num">Apr 18</td></tr>
          <tr><td><strong>Allocation Window Open</strong></td><td>Reserve (312)</td><td class="num">312</td><td class="num"><span class="badge badge-success">61.5%</span></td><td class="num">38.2%</td><td class="num text-success font-semibold">$42,180</td><td class="num">Jul 15</td></tr>
          <tr><td><strong>Member Anniversary (June)</strong></td><td>Anniv. (84)</td><td class="num">84</td><td class="num"><span class="badge badge-success">68.4%</span></td><td class="num">18.9%</td><td class="num text-success font-semibold">$4,220</td><td class="num">Jun 1</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div><!-- /comms -->

<!-- ═══════ SCREEN: LOYALTY & REWARDS ═══════ -->
<div class="screen" id="screen-loyalty">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Loyalty & Rewards</div><div class="section-sub">Tier configuration, points rules, and rewards catalog</div></div>
    <button class="btn btn-primary" onclick="openModal('newRewardModal')"><i data-lucide="plus"></i> Add Reward</button>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-icon purple"><i data-lucide="star"></i></div><div class="kpi-label">Points Issued (MTD)</div><div class="kpi-value">248K</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>+22% vs last month</div></div>
    <div class="kpi-card"><div class="kpi-icon gold"><i data-lucide="gift"></i></div><div class="kpi-label">Rewards Redeemed</div><div class="kpi-value">184</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>$12,400 value</div></div>
    <div class="kpi-card"><div class="kpi-icon green"><i data-lucide="trending-up"></i></div><div class="kpi-label">Retention Lift</div><div class="kpi-value">+8.2pt</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>Loyalty members vs non</div></div>
    <div class="kpi-card"><div class="kpi-icon wine"><i data-lucide="users"></i></div><div class="kpi-label">Cellar Masters Members</div><div class="kpi-value">48</div><div class="kpi-delta up"><i data-lucide="trending-up"></i>Top tier · $12K avg LTV</div></div>
  </div>
  <div class="grid-2 mb-20">
    <div class="card">
      <div class="card-header"><div class="card-title">Loyalty Tiers</div><button class="btn btn-sm"><i data-lucide="edit-2"></i> Edit Rules</button></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
        <div style="padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-page)">
          <div class="flex items-center justify-between" style="margin-bottom:8px">
            <div class="flex items-center gap-8"><div style="width:32px;height:32px;border-radius:8px;background:#EFF6FF;display:flex;align-items:center;justify-content:center;font-size:16px">🌱</div><div><div style="font-size:14px;font-weight:700">Vine Member</div><div class="text-xs text-muted">0–499 points</div></div></div>
            <span class="badge badge-info">618 members</span>
          </div>
          <div class="text-sm text-muted">Free shipping on 1 order/yr · 5% add-on discount · Birthday email</div>
        </div>
        <div style="padding:14px;border:1px solid var(--wine);border-radius:var(--radius-sm);background:var(--wine-light)">
          <div class="flex items-center justify-between" style="margin-bottom:8px">
            <div class="flex items-center gap-8"><div style="width:32px;height:32px;border-radius:8px;background:var(--wine-light);display:flex;align-items:center;justify-content:center;font-size:16px">⭐️</div><div><div style="font-size:14px;font-weight:700">Reserve Circle</div><div class="text-xs" style="color:var(--wine)">500–999 points</div></div></div>
            <span class="badge badge-wine">1,040 members</span>
          </div>
          <div class="text-sm text-muted">15% TR discount · Priority allocation · Seasonal winemaker notes</div>
        </div>
        <div style="padding:14px;border:1px solid var(--gold);border-radius:var(--radius-sm);background:var(--gold-light)">
          <div class="flex items-center justify-between" style="margin-bottom:8px">
            <div class="flex items-center gap-8"><div style="width:32px;height:32px;border-radius:8px;background:var(--gold-light);display:flex;align-items:center;justify-content:center;font-size:16px">✦</div><div><div style="font-size:14px;font-weight:700">Cellar Masters</div><div class="text-xs" style="color:var(--gold)">1,000+ points</div></div></div>
            <span class="badge badge-gold">48 members</span>
          </div>
          <div class="text-sm text-muted">20% TR discount · Private winemaker dinners · Complimentary TR visit · Library access</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Points Rules</div><button class="btn btn-sm"><i data-lucide="edit-2"></i> Edit</button></div>
      <div class="card-body" style="padding-top:8px">
        <div class="stat-row"><span class="stat-label">Club shipment received</span><span class="stat-value">100 pts</span></div>
        <div class="stat-row"><span class="stat-label">Add-on bottle purchase</span><span class="stat-value">10 pts / $1</span></div>
        <div class="stat-row"><span class="stat-label">Tasting room visit</span><span class="stat-value">50 pts</span></div>
        <div class="stat-row"><span class="stat-label">Member referral (joined)</span><span class="stat-value">200 pts</span></div>
        <div class="stat-row"><span class="stat-label">Email click-through</span><span class="stat-value">5 pts</span></div>
        <div class="stat-row"><span class="stat-label">Profile completed</span><span class="stat-value">25 pts (one-time)</span></div>
        <div class="stat-row"><span class="stat-label">Event RSVP + attendance</span><span class="stat-value">75 pts</span></div>
        <div class="separator"></div>
        <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Bonus: Skip penalty</div><div class="text-xs text-muted">Deduct points for consecutive skips</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
        <div class="info-box info-box-info mt-12" style="margin-top:12px"><i data-lucide="sparkles"></i><span>AI recommends adding +25 pts for portal logins — members who log in monthly churn 40% less.</span></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">Rewards Catalog</div><button class="btn btn-sm btn-primary"><i data-lucide="plus"></i> Add Reward</button></div>
    <div class="card-body">
      <div class="grid-4">
        <div class="reward-card"><div class="reward-icon" style="background:var(--wine-light)">🍷</div><div class="reward-name">Complimentary Tasting</div><div class="reward-pts">250 pts</div><div class="reward-desc">Two guests, any Wednesday–Friday</div></div>
        <div class="reward-card"><div class="reward-icon" style="background:var(--gold-light)">🎁</div><div class="reward-name">Free Bottle Add-on</div><div class="reward-pts">400 pts</div><div class="reward-desc">One bottle added to next shipment</div></div>
        <div class="reward-card"><div class="reward-icon" style="background:#F0FDF4">🚚</div><div class="reward-name">Free Shipping</div><div class="reward-pts">150 pts</div><div class="reward-desc">One-time free shipping on any order</div></div>
        <div class="reward-card"><div class="reward-icon" style="background:#EFF6FF">🎟️</div><div class="reward-name">Harvest Event Ticket</div><div class="reward-pts">600 pts</div><div class="reward-desc">VIP access to annual harvest dinner</div></div>
        <div class="reward-card"><div class="reward-icon" style="background:#F5F3FF">👨‍🍳</div><div class="reward-name">Winemaker Dinner</div><div class="reward-pts">1,200 pts</div><div class="reward-desc">Private dinner · 2 guests · Reserve members only</div></div>
        <div class="reward-card"><div class="reward-icon" style="background:var(--gold-light)">📦</div><div class="reward-name">Library Bottle</div><div class="reward-pts">800 pts</div><div class="reward-desc">One aged library release wine</div></div>
        <div class="reward-card"><div class="reward-icon" style="background:var(--wine-light)">🎨</div><div class="reward-name">Custom Engraving</div><div class="reward-pts">300 pts</div><div class="reward-desc">Personalized label on any bottle</div></div>
        <div class="reward-card" style="border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="openModal('newRewardModal')"><div style="text-align:center;color:var(--text-muted)"><i data-lucide="plus-circle" style="width:24px;height:24px;margin:0 auto 6px"></i><div class="text-sm">Add Reward</div></div></div>
      </div>
    </div>
  </div>
</div><!-- /loyalty -->

<!-- ═══════ SCREEN: INTEGRATIONS ═══════ -->
<div class="screen" id="screen-integrations">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Integrations</div><div class="section-sub">Connected apps, webhooks, and API access</div></div>
    <button class="btn btn-primary"><i data-lucide="plus"></i> Browse Integrations</button>
  </div>
  <div class="grid-3 mb-20">
    <div class="integration-card connected">
      <div class="int-logo" style="background:#1A1A1A;color:#FBBF24">S</div>
      <div class="int-info"><div class="int-name">Stripe</div><div class="int-desc">Billing, subscriptions, and failed payment recovery</div></div>
      <div class="int-status"><span class="badge badge-success"><i data-lucide="check-circle"></i> Connected</span><div class="text-xs text-muted mt-4">Last sync: 2 min ago</div></div>
      <button class="btn btn-sm"><i data-lucide="settings"></i></button>
    </div>
    <div class="integration-card connected">
      <div class="int-logo" style="background:#722F37;color:#fff"><i data-lucide="mail" style="width:18px;height:18px"></i></div>
      <div class="int-info"><div class="int-name">Klaviyo</div><div class="int-desc">Email marketing, segments, and automation flows</div></div>
      <div class="int-status"><span class="badge badge-success"><i data-lucide="check-circle"></i> Connected</span><div class="text-xs text-muted mt-4">12,840 contacts synced</div></div>
      <button class="btn btn-sm"><i data-lucide="settings"></i></button>
    </div>
    <div class="integration-card connected">
      <div class="int-logo" style="background:#FF6702;color:#fff">S</div>
      <div class="int-info"><div class="int-name">ShipCompliant</div><div class="int-desc">DTC compliance verification and TTB reporting</div></div>
      <div class="int-status"><span class="badge badge-success"><i data-lucide="check-circle"></i> Connected</span><div class="text-xs text-muted mt-4">38 states covered</div></div>
      <button class="btn btn-sm"><i data-lucide="settings"></i></button>
    </div>
    <div class="integration-card connected">
      <div class="int-logo" style="background:#1C2942;color:#fff"><i data-lucide="truck" style="width:18px;height:18px"></i></div>
      <div class="int-info"><div class="int-name">UPS API</div><div class="int-desc">Label generation, tracking, and address validation</div></div>
      <div class="int-status"><span class="badge badge-success"><i data-lucide="check-circle"></i> Connected</span><div class="text-xs text-muted mt-4">892 active shipments</div></div>
      <button class="btn btn-sm"><i data-lucide="settings"></i></button>
    </div>
    <div class="integration-card connected">
      <div class="int-logo" style="background:#4D148C;color:#fff"><i data-lucide="truck" style="width:18px;height:18px"></i></div>
      <div class="int-info"><div class="int-name">FedEx API</div><div class="int-desc">Label generation, tracking, and rate shopping</div></div>
      <div class="int-status"><span class="badge badge-success"><i data-lucide="check-circle"></i> Connected</span><div class="text-xs text-muted mt-4">672 active shipments</div></div>
      <button class="btn btn-sm"><i data-lucide="settings"></i></button>
    </div>
    <div class="integration-card connected">
      <div class="int-logo" style="background:#0070BA;color:#fff">P</div>
      <div class="int-info"><div class="int-name">PayPal / Venmo</div><div class="int-desc">Alternate payment method for portal checkout</div></div>
      <div class="int-status"><span class="badge badge-success"><i data-lucide="check-circle"></i> Connected</span><div class="text-xs text-muted mt-4">Optional at checkout</div></div>
      <button class="btn btn-sm"><i data-lucide="settings"></i></button>
    </div>
    <div class="integration-card">
      <div class="int-logo" style="background:#F3F4F6;color:#6B7280"><i data-lucide="calendar" style="width:18px;height:18px"></i></div>
      <div class="int-info"><div class="int-name">Google Calendar</div><div class="int-desc">Sync tasting room events and releases to members' calendars</div></div>
      <div class="int-status"><span class="badge badge-neutral">Not Connected</span></div>
      <button class="btn btn-sm btn-primary">Connect</button>
    </div>
    <div class="integration-card">
      <div class="int-logo" style="background:#F3F4F6;color:#6B7280"><i data-lucide="message-square" style="width:18px;height:18px"></i></div>
      <div class="int-info"><div class="int-name">Twilio SMS</div><div class="int-desc">SMS shipment notifications, two-factor auth</div></div>
      <div class="int-status"><span class="badge badge-neutral">Not Connected</span></div>
      <button class="btn btn-sm btn-primary">Connect</button>
    </div>
    <div class="integration-card">
      <div class="int-logo" style="background:#F3F4F6;color:#6B7280"><i data-lucide="bar-chart-3" style="width:18px;height:18px"></i></div>
      <div class="int-info"><div class="int-name">Metabase / Looker</div><div class="int-desc">Advanced BI dashboards and custom report exports</div></div>
      <div class="int-status"><span class="badge badge-neutral">Not Connected</span></div>
      <button class="btn btn-sm btn-primary">Connect</button>
    </div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-header"><div class="card-title">API Access</div><button class="btn btn-sm btn-primary"><i data-lucide="plus"></i> Generate Key</button></div>
      <div class="card-body" style="padding-top:10px">
        <div style="padding:12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:10px">
          <div class="flex items-center justify-between" style="margin-bottom:6px"><div style="font-size:13px;font-weight:600">Production Key</div><span class="badge badge-success">Active</span></div>
          <div style="font-family:monospace;font-size:12px;color:var(--text-muted);word-break:break-all;background:#fff;padding:8px;border-radius:6px;border:1px solid var(--border)">vnf_prod_4xKs9…•••••••••••••••••</div>
          <div class="flex gap-8 mt-8" style="margin-top:8px"><button class="btn btn-sm"><i data-lucide="copy"></i> Copy</button><button class="btn btn-sm text-danger"><i data-lucide="rotate-ccw"></i> Rotate</button></div>
        </div>
        <div style="padding:12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div class="flex items-center justify-between" style="margin-bottom:6px"><div style="font-size:13px;font-weight:600">Sandbox Key</div><span class="badge badge-neutral">Test Mode</span></div>
          <div style="font-family:monospace;font-size:12px;color:var(--text-muted);word-break:break-all;background:#fff;padding:8px;border-radius:6px;border:1px solid var(--border)">vnf_test_8mRq3…•••••••••••••••••</div>
          <div class="flex gap-8 mt-8" style="margin-top:8px"><button class="btn btn-sm"><i data-lucide="copy"></i> Copy</button></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Webhook Events</div><button class="btn btn-sm btn-primary"><i data-lucide="plus"></i> Add Webhook</button></div>
      <div class="card-body" style="padding-top:10px;display:flex;flex-direction:column;gap:8px">
        <div style="padding:10px 12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border)"><div class="flex items-center justify-between" style="margin-bottom:3px"><div style="font-size:13px;font-weight:600">member.created</div><span class="badge badge-success">Active</span></div><div class="text-xs text-muted">→ https://crm.example.com/webhooks/member</div></div>
        <div style="padding:10px 12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border)"><div class="flex items-center justify-between" style="margin-bottom:3px"><div style="font-size:13px;font-weight:600">shipment.delivered</div><span class="badge badge-success">Active</span></div><div class="text-xs text-muted">→ https://crm.example.com/webhooks/ship</div></div>
        <div style="padding:10px 12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border)"><div class="flex items-center justify-between" style="margin-bottom:3px"><div style="font-size:13px;font-weight:600">payment.failed</div><span class="badge badge-warning">1 error today</span></div><div class="text-xs text-muted">→ https://ops.example.com/payments/alert</div></div>
        <div style="padding:10px 12px;background:var(--bg-page);border-radius:var(--radius-sm);border:1px solid var(--border);opacity:0.6"><div class="flex items-center justify-between" style="margin-bottom:3px"><div style="font-size:13px;font-weight:600">member.churn_risk</div><span class="badge badge-neutral">Paused</span></div><div class="text-xs text-muted">→ https://slack.example.com/hooks/churn</div></div>
      </div>
    </div>
  </div>
</div><!-- /integrations -->

<!-- ═══════ SCREEN: SETTINGS ═══════ -->
<div class="screen" id="screen-settings">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Settings</div><div class="section-sub">Winery profile, team management, billing, and notifications</div></div>
    <button class="btn btn-primary"><i data-lucide="save"></i> Save Changes</button>
  </div>
  <div style="display:flex;gap:18px;align-items:flex-start">
    <div style="width:200px;flex-shrink:0">
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <button class="settings-nav active" onclick="switchSettings(this,'s-profile')"><i data-lucide="wine"></i> Winery Profile</button>
        <button class="settings-nav" onclick="switchSettings(this,'s-team')"><i data-lucide="users"></i> Team & Roles</button>
        <button class="settings-nav" onclick="switchSettings(this,'s-billing')"><i data-lucide="credit-card"></i> Billing & Plan</button>
        <button class="settings-nav" onclick="switchSettings(this,'s-notif')"><i data-lucide="bell"></i> Notifications</button>
        <button class="settings-nav" onclick="switchSettings(this,'s-portal')"><i data-lucide="smartphone"></i> Portal Settings</button>
        <button class="settings-nav" onclick="switchSettings(this,'s-security')"><i data-lucide="shield"></i> Security</button>
      </div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:16px">
      <!-- Winery Profile -->
      <div class="settings-panel active" id="s-profile">
        <div class="card">
          <div class="card-header"><div class="card-title">Winery Profile</div></div>
          <div class="card-body"><div class="grid-2">
            <div class="form-group"><label class="form-label">Winery Name</label><input class="form-control" value="Sunridge Estate Winery"></div>
            <div class="form-group"><label class="form-label">DBA / Brand Name</label><input class="form-control" value="Sunridge Estate"></div>
            <div class="form-group"><label class="form-label">Website</label><input class="form-control" value="https://sunridgeestate.com"></div>
            <div class="form-group"><label class="form-label">Support Email</label><input class="form-control" value="club@sunridgeestate.com"></div>
            <div class="form-group"><label class="form-label">Phone</label><input class="form-control" value="(707) 555-0182"></div>
            <div class="form-group"><label class="form-label">Timezone</label><select class="form-control"><option selected>US/Pacific (PST/PDT)</option><option>US/Mountain</option><option>US/Central</option><option>US/Eastern</option></select></div>
            <div class="form-group" style="grid-column:1/-1"><label class="form-label">Address</label><input class="form-control" value="4820 Oak Knoll Ave, Napa, CA 94558"></div>
            <div class="form-group" style="grid-column:1/-1"><label class="form-label">Winery Bio (shown on member portal)</label><textarea class="form-control" rows="3">Sunridge Estate is a family-owned winery in the heart of Napa Valley, producing small-lot Cabernet Sauvignon, Bordeaux blends, and estate reds since 1989.</textarea></div>
          </div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Compliance & Legal</div></div>
          <div class="card-body"><div class="grid-2">
            <div class="form-group"><label class="form-label">TTB License Number</label><input class="form-control" value="BWN-CA-94204-0012"></div>
            <div class="form-group"><label class="form-label">State ABC License</label><input class="form-control" value="CA-DTC-0019841"></div>
            <div class="form-group"><label class="form-label">License Renewal Date</label><input class="form-control" value="2026-12-31" type="date"></div>
            <div class="form-group"><label class="form-label">Adult Signature Required</label><select class="form-control"><option selected>All shipments (recommended)</option><option>$200+ only</option><option>Never</option></select></div>
          </div></div>
        </div>
      </div>
      <!-- Team -->
      <div class="settings-panel" id="s-team">
        <div class="card">
          <div class="card-header"><div class="card-title">Team Members & Roles</div><button class="btn btn-sm btn-primary" onclick="openModal('inviteModal')"><i data-lucide="user-plus"></i> Invite</button></div>
          <div class="card-body" style="padding:0"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>
            <tr><td><div class="flex items-center gap-8"><div class="avatar" style="width:28px;height:28px;font-size:10px">JG</div><span>Jeffrey Geronimo</span></div></td><td>jg@sunridge.com</td><td><span class="badge badge-wine">Admin</span></td><td>Today</td><td><button class="btn btn-sm">Edit</button></td></tr>
            <tr><td><div class="flex items-center gap-8"><div class="avatar" style="width:28px;height:28px;font-size:10px">SM</div><span>Sarah M.</span></div></td><td>sarah@sunridge.com</td><td><span class="badge badge-info">Club Manager</span></td><td>Yesterday</td><td><button class="btn btn-sm">Edit</button></td></tr>
            <tr><td><div class="flex items-center gap-8"><div class="avatar" style="width:28px;height:28px;font-size:10px">TK</div><span>Tom K.</span></div></td><td>tom@sunridge.com</td><td><span class="badge badge-neutral">Fulfillment</span></td><td>Jul 22</td><td><button class="btn btn-sm">Edit</button></td></tr>
          </tbody></table></div>
        </div>
      </div>
      <!-- Billing -->
      <div class="settings-panel" id="s-billing">
        <div class="card">
          <div class="card-header"><div class="card-title">Subscription & Billing</div></div>
          <div class="card-body">
            <div style="padding:16px;background:linear-gradient(135deg,var(--wine),#9B2C2C);border-radius:var(--radius);color:#fff;margin-bottom:16px">
              <div class="flex items-center justify-between"><div><div style="font-size:11px;font-weight:700;letter-spacing:0.1em;opacity:0.7;text-transform:uppercase">Current Plan</div><div style="font-size:20px;font-weight:800;margin-top:2px">Vinifera Pro</div></div><span class="badge" style="background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.3)">Active</span></div>
              <div style="margin-top:10px;font-size:13px;opacity:0.8">Up to 2,500 members · All features · $399/month · Renews Sep 1, 2026</div>
            </div>
            <div class="stat-row"><span class="stat-label">Members used</span><span class="stat-value">1,847 of 2,500</span></div>
            <div class="stat-row"><span class="stat-label">Shipments this month</span><span class="stat-value">1,847</span></div>
            <div class="stat-row"><span class="stat-label">Overage charge</span><span class="stat-value">$0</span></div>
            <div class="stat-row"><span class="stat-label">Next invoice</span><span class="stat-value">Sep 1, 2026 — $399</span></div>
            <div class="progress-track" style="margin-top:12px;height:8px"><div class="progress-fill pf-wine" style="width:73.9%"></div></div>
            <div class="text-xs text-muted" style="margin-top:4px">73.9% of member limit used</div>
          </div>
        </div>
      </div>
      <!-- Notifications -->
      <div class="settings-panel" id="s-notif">
        <div class="card">
          <div class="card-header"><div class="card-title">Notification Preferences</div></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
            <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">High churn risk alert</div><div class="text-xs text-muted">Email me when a member exceeds 70% churn score</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
            <div class="separator"></div>
            <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Failed payment alert</div><div class="text-xs text-muted">Notify when a billing batch has more than 5 failures</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
            <div class="separator"></div>
            <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Shipment exception alerts</div><div class="text-xs text-muted">Notify on failed delivery or returned package</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
            <div class="separator"></div>
            <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Weekly summary digest</div><div class="text-xs text-muted">Every Monday — members, revenue, churn snapshot</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
            <div class="separator"></div>
            <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">New member signup</div><div class="text-xs text-muted">Real-time email on every new club signup</div></div><label class="toggle"><input type="checkbox"><span class="toggle-slider"></span></label></div>
          </div>
        </div>
      </div>
      <!-- Portal Settings / Security — placeholders -->
      <div class="settings-panel" id="s-portal">
        <div class="card"><div class="card-header"><div class="card-title">Member Portal Settings</div></div><div class="card-body">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">Portal Domain</label><input class="form-control" value="club.sunridgeestate.com"></div>
            <div class="form-group"><label class="form-label">Primary Brand Color</label><input class="form-control" value="#6B1E30" type="color" style="height:40px;padding:4px"></div>
            <div class="form-group"><label class="form-label">Portal Login Method</label><select class="form-control"><option selected>Magic link (passwordless)</option><option>Email + password</option><option>Both</option></select></div>
            <div class="form-group"><label class="form-label">Member cancellation</label><select class="form-control"><option>Require staff approval</option><option selected>Allow self-service</option></select></div>
          </div>
          <div class="flex items-center justify-between mt-16"><div><div style="font-size:13.5px;font-weight:600">Show AI taste recommendations</div><div class="text-xs text-muted">Display AI-generated wine suggestions in member portal</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
        </div></div>
      </div>
      <div class="settings-panel" id="s-security">
        <div class="card"><div class="card-header"><div class="card-title">Security</div></div><div class="card-body">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">Two-Factor Auth (staff)</label><select class="form-control"><option selected>Required for Admin</option><option>Required for all</option><option>Optional</option></select></div>
            <div class="form-group"><label class="form-label">Session timeout</label><select class="form-control"><option selected>8 hours</option><option>2 hours</option><option>24 hours</option></select></div>
          </div>
          <div class="flex items-center justify-between mt-12"><div><div style="font-size:13.5px;font-weight:600">Audit log</div><div class="text-xs text-muted">Track all staff actions and data changes</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
        </div></div>
      </div>
    </div>
  </div>
</div><!-- /settings -->

<!-- ═══════ SCREEN: MEMBER PORTAL ═══════ -->
<div class="screen" id="screen-portal">
  <div class="section-hdr mb-20">
    <div><div class="section-title">Member Portal Preview</div><div class="section-sub">As seen by Margaret Lassiter · Logged in via magic link</div></div>
    <div class="flex gap-8">
      <button class="btn"><i data-lucide="smartphone"></i> Mobile View</button>
      <button class="btn btn-primary"><i data-lucide="external-link"></i> Open Live Portal</button>
    </div>
  </div>
  <!-- Portal chrome -->
  <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10)">
    <!-- Portal topbar -->
    <div style="background:var(--wine);padding:14px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:10px"><div style="font-size:20px">🍇</div><div style="font-weight:800;font-size:16px;color:#fff;letter-spacing:-0.02em">Sunridge Estate</div></div>
      <div style="display:flex;align-items:center;gap:12px"><span style="color:rgba(255,255,255,0.65);font-size:13px">Hi, Margaret</span><div style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px">ML</div></div>
    </div>
    <!-- Portal hero -->
    <div style="background:linear-gradient(135deg,#1a0009 0%,#6B1E30 60%,#C9993A 100%);padding:32px 28px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <div style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">Reserve Collection</div>
          <div style="font-size:26px;font-weight:800;color:#fff;margin-top:4px;letter-spacing:-0.03em">Welcome back, Margaret</div>
          <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:4px">Member since May 2025 · 1,240 Vine Points</div>
        </div>
        <div style="display:flex;gap:10px">
          <div style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:14px 18px;text-align:center"><div style="font-size:18px;font-weight:800;color:#fff">7</div><div style="font-size:10px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Shipments</div></div>
          <div style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:14px 18px;text-align:center"><div style="font-size:18px;font-weight:800;color:#fff">$4,820</div><div style="font-size:10px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Total Spent</div></div>
          <div style="background:rgba(201,153,58,0.3);border:1px solid rgba(201,153,58,0.5);border-radius:10px;padding:14px 18px;text-align:center"><div style="font-size:18px;font-weight:800;color:#C9993A">1,240</div><div style="font-size:10px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Points</div></div>
        </div>
      </div>
    </div>
    <!-- Portal content -->
    <div style="background:var(--bg-page);padding:22px 24px;display:flex;flex-direction:column;gap:18px">
      <!-- Next shipment -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between"><div style="font-size:14px;font-weight:700">Your Next Shipment</div><span class="badge badge-warning"><i data-lucide="clock"></i> Ships Aug 14</span></div>
        <div style="padding:16px 18px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">
            <div style="padding:12px;background:var(--bg-page);border-radius:8px;border:1px solid var(--border);text-align:center"><div style="font-size:28px;margin-bottom:6px">🍷</div><div style="font-size:12px;font-weight:700">2020 Single Vineyard Cab</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">2 bottles · $94/ea</div></div>
            <div style="padding:12px;background:var(--bg-page);border-radius:8px;border:1px solid var(--border);text-align:center"><div style="font-size:28px;margin-bottom:6px">🍾</div><div style="font-size:12px;font-weight:700">2019 Reserve Bordeaux Blend</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">2 bottles · $110/ea</div></div>
            <div style="padding:12px;background:var(--bg-page);border-radius:8px;border:1px solid var(--border);text-align:center"><div style="font-size:28px;margin-bottom:6px">🍇</div><div style="font-size:12px;font-weight:700">2022 Petit Verdot</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">2 bottles · $78/ea</div></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div style="font-size:13px;color:var(--text-muted)">6 bottles · <strong style="color:var(--text-primary)">$564 total</strong> · Ships to San Francisco, CA</div>
            <div style="display:flex;gap:8px"><button class="btn btn-sm"><i data-lucide="repeat"></i> Swap Bottles</button><button class="btn btn-sm"><i data-lucide="skip-forward"></i> Skip Shipment</button><button class="btn btn-sm btn-primary"><i data-lucide="plus"></i> Add Bottles</button></div>
          </div>
        </div>
      </div>
      <!-- AI Taste Recommendations -->
      <div style="background:linear-gradient(135deg,#0F0A1E,#1A0F30);border:1px solid rgba(139,92,246,0.3);border-radius:10px;padding:16px 18px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><div style="width:28px;height:28px;border-radius:7px;background:rgba(139,92,246,0.3);display:flex;align-items:center;justify-content:center"><i data-lucide="sparkles" style="width:14px;height:14px;color:#A78BFA"></i></div><div style="font-size:13.5px;font-weight:700;color:#E9D5FF">AI Wine Recommendations for You</div></div>
        <div style="font-size:12.5px;color:rgba(233,213,255,0.7);margin-bottom:12px">Based on your purchase history — Napa-forward, structured reds, high-tannin</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:9px 12px;flex:1;min-width:140px"><div style="font-size:12px;font-weight:700;color:#E9D5FF">2021 Library Cabernet</div><div style="font-size:11px;color:rgba(233,213,255,0.6);margin-top:2px">98% match · $124</div></div>
          <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:9px 12px;flex:1;min-width:140px"><div style="font-size:12px;font-weight:700;color:#E9D5FF">2020 Winemaker's Reserve</div><div style="font-size:11px;color:rgba(233,213,255,0.6);margin-top:2px">95% match · $98</div></div>
          <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:9px 12px;flex:1;min-width:140px"><div style="font-size:12px;font-weight:700;color:#E9D5FF">2022 Estate Merlot</div><div style="font-size:11px;color:rgba(233,213,255,0.6);margin-top:2px">91% match · $72</div></div>
        </div>
      </div>
      <!-- Points + manage -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 18px">
          <div style="font-size:13px;font-weight:700;margin-bottom:10px">Vine Points — 1,240</div>
          <div style="margin-bottom:6px"><div class="flex justify-between text-xs text-muted" style="margin-bottom:3px"><span>Progress to Reserve Circle (500 pts)</span><span class="font-semibold" style="color:var(--wine)">Achieved!</span></div><div class="progress-track"><div class="progress-fill pf-wine" style="width:100%"></div></div></div>
          <div style="margin-bottom:10px"><div class="flex justify-between text-xs text-muted" style="margin-bottom:3px"><span>Progress to Cellar Masters (1,000 pts)</span><span class="font-semibold" style="color:var(--gold)">1,240/1,000 ✓</span></div><div class="progress-track"><div class="progress-fill pf-gold" style="width:100%"></div></div></div>
          <button class="btn btn-sm btn-primary w-full">Redeem Rewards</button>
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 18px">
          <div style="font-size:13px;font-weight:700;margin-bottom:10px">Manage Membership</div>
          <div style="display:flex;flex-direction:column;gap:7px">
            <button class="btn btn-sm w-full" style="justify-content:flex-start"><i data-lucide="map-pin"></i> Update Shipping Address</button>
            <button class="btn btn-sm w-full" style="justify-content:flex-start"><i data-lucide="credit-card"></i> Update Payment Method</button>
            <button class="btn btn-sm w-full" style="justify-content:flex-start"><i data-lucide="calendar"></i> Change Shipment Cadence</button>
            <button class="btn btn-sm w-full text-danger" style="justify-content:flex-start;color:var(--danger)"><i data-lucide="pause-circle"></i> Pause Membership</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div><!-- /portal -->

    </div><!-- /content -->
  </div><!-- /main -->
</div><!-- /app-shell -->

<!-- ═══════════════ MODALS ═══════════════ -->

<!-- Run Release Modal -->
<div class="modal-overlay" id="releaseModal" onclick="closeModal('releaseModal')">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-header"><div class="modal-title">Run Club Release — Fall 2026</div><button class="modal-close" onclick="closeModal('releaseModal')"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <div class="info-box info-box-warning mb-20" style="margin-bottom:14px"><i data-lucide="alert-triangle"></i><span>This will trigger billing for all 1,847 active members and generate 1,847 shipment labels.</span></div>
      <div class="form-group"><label class="form-label">Release Name</label><input class="form-control" value="Fall 2026"></div>
      <div class="grid-2"><div class="form-group"><label class="form-label">Billing Date</label><input class="form-control" type="date" value="2026-08-12"></div><div class="form-group"><label class="form-label">Ship Date</label><input class="form-control" type="date" value="2026-08-14"></div></div>
      <div class="form-group"><label class="form-label">Notification Email</label><select class="form-control"><option selected>Use saved template — Pre-Shipment Notice</option><option>Draft new email</option></select></div>
      <div class="flex items-center justify-between"><div><div style="font-size:13.5px;font-weight:600">Send member notification now</div><div class="text-xs text-muted">Email all members about upcoming release</div></div><label class="toggle"><input type="checkbox" checked><span class="toggle-slider"></span></label></div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeModal('releaseModal')">Cancel</button><button class="btn btn-primary" onclick="toast('Release scheduled for Aug 12 · Members will be notified');closeModal('releaseModal')"><i data-lucide="play-circle"></i> Confirm & Schedule</button></div>
  </div>
</div>

<!-- Add Member Modal -->
<div class="modal-overlay" id="addMemberModal" onclick="closeModal('addMemberModal')">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-header"><div class="modal-title">Add New Member</div><button class="modal-close" onclick="closeModal('addMemberModal')"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">First Name</label><input class="form-control" placeholder="First name"></div>
        <div class="form-group"><label class="form-label">Last Name</label><input class="form-control" placeholder="Last name"></div>
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Email</label><input class="form-control" type="email" placeholder="email@example.com"></div>
        <div class="form-group"><label class="form-label">Phone</label><input class="form-control" placeholder="(555) 000-0000"></div>
        <div class="form-group"><label class="form-label">Club Tier</label><select class="form-control"><option>Discovery Club</option><option selected>Estate Select</option><option>Reserve Collection</option></select></div>
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Shipping Address</label><input class="form-control" placeholder="Street, City, State, ZIP"></div>
      </div>
      <div class="form-group"><label class="form-label">Notes</label><textarea class="form-control" rows="2" placeholder="How they were referred, tasting room visit, etc."></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeModal('addMemberModal')">Cancel</button><button class="btn btn-primary" onclick="toast('New member added successfully');closeModal('addMemberModal')"><i data-lucide="user-plus"></i> Add Member</button></div>
  </div>
</div>

<!-- AI Email Generator Modal -->
<div class="modal-overlay" id="aiEmailModal" onclick="closeModal('aiEmailModal')">
  <div class="modal" style="max-width:660px" onclick="event.stopPropagation()">
    <div class="modal-header"><div class="modal-title"><i data-lucide="sparkles" style="width:16px;height:16px;color:var(--wine)"></i> AI Email Generator</div><button class="modal-close" onclick="closeModal('aiEmailModal')"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <div style="padding:14px;background:linear-gradient(135deg,var(--wine-light),var(--gold-light));border-radius:var(--radius-sm);margin-bottom:14px;border:1px solid rgba(107,30,48,0.12)">
        <div style="font-size:12px;font-weight:700;color:var(--wine);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">AI Generated Draft</div>
        <div style="font-size:13px;font-weight:600;margin-bottom:8px">Subject: Your exclusive Fall 2026 Reserve Collection is ready, Margaret 🍷</div>
        <div style="font-size:12.5px;color:var(--text-secondary);line-height:1.6">Dear Margaret,<br><br>We're delighted to share that your <strong>Fall 2026 Reserve Collection</strong> is curated and ready to ship on <strong>August 14th</strong>. As a valued Reserve member, you're among the first to receive our <em>2020 Single Vineyard Cabernet</em> — a wine we've reserved exclusively for our most dedicated collectors.<br><br>This season's selection reflects the exceptional growing conditions we saw across our estate blocks this past year. We'd love to see you at our private harvest dinner on September 12th — a ticket is on us as a thank-you for your continued membership.<br><br>Warm regards,<br><em>The Sunridge Estate Team</em></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Regenerate Tone</label><select class="form-control"><option>Warm & personal</option><option>Formal & elegant</option><option>Playful & enthusiastic</option></select></div>
        <div class="form-group"><label class="form-label">Personalization</label><select class="form-control"><option selected>High — use member name, history</option><option>Medium</option><option>Generic</option></select></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeModal('aiEmailModal')">Cancel</button><button class="btn btn-sm"><i data-lucide="refresh-cw"></i> Regenerate</button><button class="btn btn-primary" onclick="toast('Email saved to send queue');closeModal('aiEmailModal')"><i data-lucide="send"></i> Save to Queue</button></div>
  </div>
</div>

<!-- Invite modal -->
<div class="modal-overlay" id="inviteModal" onclick="closeModal('inviteModal')">
  <div class="modal" style="max-width:420px" onclick="event.stopPropagation()">
    <div class="modal-header"><div class="modal-title">Invite Team Member</div><button class="modal-close" onclick="closeModal('inviteModal')"><i data-lucide="x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Email Address</label><input class="form-control" type="email" placeholder="colleague@sunridge.com"></div>
      <div class="form-group"><label class="form-label">Role</label><select class="form-control"><option>Club Manager</option><option>Fulfillment</option><option>Marketing</option><option>Read Only</option></select></div>
    </div>
    <div class="modal-footer"><button class="btn" onclick="closeModal('inviteModal')">Cancel</button><button class="btn btn-primary" onclick="toast('Invitation sent');closeModal('inviteModal')"><i data-lucide="send"></i> Send Invite</button></div>
  </div>
</div>

<!-- Generic reusable modal stubs -->
<div class="modal-overlay" id="editTierModal" onclick="closeModal('editTierModal')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-title">Edit Club Tier</div><button class="modal-close" onclick="closeModal('editTierModal')"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-group"><label class="form-label">Tier Name</label><input class="form-control" value="Estate Select"></div><div class="form-group"><label class="form-label">Bottles per Shipment</label><input class="form-control" type="number" value="4"></div><div class="form-group"><label class="form-label">Price per Release ($)</label><input class="form-control" type="number" value="136"></div><div class="form-group"><label class="form-label">Tasting Room Discount (%)</label><input class="form-control" type="number" value="15"></div></div><div class="modal-footer"><button class="btn" onclick="closeModal('editTierModal')">Cancel</button><button class="btn btn-primary" onclick="toast('Tier updated');closeModal('editTierModal')">Save Changes</button></div></div></div>
<div class="modal-overlay" id="newTierModal" onclick="closeModal('newTierModal')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-title">Create New Tier</div><button class="modal-close" onclick="closeModal('newTierModal')"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-group"><label class="form-label">Tier Name</label><input class="form-control" placeholder="e.g. Founders Circle"></div><div class="form-group"><label class="form-label">Bottles per Shipment</label><input class="form-control" type="number" value="12"></div><div class="form-group"><label class="form-label">Price per Release ($)</label><input class="form-control" type="number" value="350"></div></div><div class="modal-footer"><button class="btn" onclick="closeModal('newTierModal')">Cancel</button><button class="btn btn-primary" onclick="toast('New tier created');closeModal('newTierModal')">Create Tier</button></div></div></div>
<div class="modal-overlay" id="newAllocModal" onclick="closeModal('newAllocModal')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-title">New Allocation</div><button class="modal-close" onclick="closeModal('newAllocModal')"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-group"><label class="form-label">Wine / SKU</label><input class="form-control" placeholder="e.g. 2021 Single Vineyard Cab"></div><div class="form-group"><label class="form-label">Total Bottles Available</label><input class="form-control" type="number" value="500"></div><div class="form-group"><label class="form-label">Reserve for Club Members</label><input class="form-control" type="number" value="250"></div></div><div class="modal-footer"><button class="btn" onclick="closeModal('newAllocModal')">Cancel</button><button class="btn btn-primary" onclick="toast('Allocation created');closeModal('newAllocModal')">Create</button></div></div></div>
<div class="modal-overlay" id="newReleaseModal" onclick="closeModal('newReleaseModal')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-title">Add Release</div><button class="modal-close" onclick="closeModal('newReleaseModal')"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-group"><label class="form-label">Release Name</label><input class="form-control" placeholder="e.g. Spring 2027"></div><div class="form-group"><label class="form-label">Ship Date</label><input class="form-control" type="date"></div></div><div class="modal-footer"><button class="btn" onclick="closeModal('newReleaseModal')">Cancel</button><button class="btn btn-primary" onclick="toast('Release added');closeModal('newReleaseModal')">Add Release</button></div></div></div>
<div class="modal-overlay" id="newEmailModal" onclick="closeModal('newEmailModal')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-title">New Email Campaign</div><button class="modal-close" onclick="closeModal('newEmailModal')"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-group"><label class="form-label">Campaign Name</label><input class="form-control" placeholder="e.g. Fall 2026 Member Announcement"></div><div class="form-group"><label class="form-label">Audience</label><select class="form-control"><option>All members</option><option>Reserve only</option><option>At-risk members</option></select></div></div><div class="modal-footer"><button class="btn" onclick="closeModal('newEmailModal')">Cancel</button><button class="btn btn-primary" onclick="openModal('aiEmailModal');closeModal('newEmailModal')"><i data-lucide="sparkles"></i> Continue with AI</button></div></div></div>
<div class="modal-overlay" id="newRewardModal" onclick="closeModal('newRewardModal')"><div class="modal" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-title">Add Reward</div><button class="modal-close" onclick="closeModal('newRewardModal')"><i data-lucide="x"></i></button></div><div class="modal-body"><div class="form-group"><label class="form-label">Reward Name</label><input class="form-control" placeholder="e.g. Library Wine Tasting"></div><div class="form-group"><label class="form-label">Points Required</label><input class="form-control" type="number" value="500"></div><div class="form-group"><label class="form-label">Description</label><textarea class="form-control" rows="2" placeholder="What does the member receive?"></textarea></div></div><div class="modal-footer"><button class="btn" onclick="closeModal('newRewardModal')">Cancel</button><button class="btn btn-primary" onclick="toast('Reward added to catalog');closeModal('newRewardModal')">Add Reward</button></div></div></div>

<!-- Toast -->
<div id="toast" style="position:fixed;bottom:28px;right:28px;background:var(--text-primary);color:#fff;padding:11px 18px;border-radius:var(--radius);font-size:13.5px;font-weight:500;box-shadow:0 4px 18px rgba(0,0,0,0.2);z-index:9999;opacity:0;transform:translateY(8px);transition:all 0.25s ease;pointer-events:none;display:flex;align-items:center;gap:9px"><i data-lucide="check-circle" style="width:15px;height:15px;color:#4ADE80"></i><span id="toast-msg"></span></div>

<!-- ═══════════════ SCRIPTS ═══════════════ -->
<script>
// ── Screen switching ──────────────────────────────────────────────────────
const titles = {
  dashboard:'Dashboard',members:'Member CRM',shipments:'Shipments',analytics:'Analytics',
  tiers:'Club Tiers',allocations:'Allocations',schedule:'Release Schedule',
  fulfillment:'Fulfillment',portal:'Member Portal',comms:'Communications',
  loyalty:'Loyalty & Rewards',integrations:'Integrations',settings:'Settings'
};
function showScreen(id, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.getAttribute('onclick')?.includes("'" + id + "'")) n.classList.add('active');
    });
  }
  document.getElementById('page-title').textContent = titles[id] || id;
}

// ── Tab switching (member profile) ────────────────────────────────────────
function switchTab(btn, panelId) {
  btn.closest('.profile-tabs').querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  btn.closest('.screen').querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(panelId)?.classList.add('active');
}

// ── Settings nav ──────────────────────────────────────────────────────────
function switchSettings(btn, panelId) {
  document.querySelectorAll('.settings-nav').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(panelId)?.classList.add('active');
}

// ── Modals ────────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; setTimeout(() => el.classList.add('open'), 10); }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); setTimeout(() => el.style.display = 'none', 200); }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => { m.classList.remove('open'); setTimeout(() => m.style.display = 'none', 200); }); });

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.style.opacity = '1'; t.style.transform = 'translateY(0)';
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 3200);
}

// ── Checkbox select-all ───────────────────────────────────────────────────
function toggleAll(cb) { cb.closest('table').querySelectorAll('tbody input[type=checkbox]').forEach(c => c.checked = cb.checked); }

// ── Chart.js mini charts ──────────────────────────────────────────────────
window.addEventListener('load', () => {
  lucide.createIcons();

  const chartDefaults = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: true } }, scales: { x: { display: false }, y: { display: false } } };

  // Dashboard revenue sparkline
  const rc = document.getElementById('revenueChart');
  if (rc) new Chart(rc, { type:'line', data:{ labels:['Jan','Feb','Mar','Apr','May','Jun','Jul'], datasets:[{ data:[168,182,195,178,201,210,218], borderColor:'#6B1E30', backgroundColor:'rgba(107,30,48,0.08)', tension:0.4, fill:true, pointRadius:0, borderWidth:2 }] }, options: chartDefaults });

  // Analytics tier revenue bar
  const tr = document.getElementById('tierRevenueChart');
  if (tr) new Chart(tr, { type:'bar', data:{ labels:['Q1','Q2','Q3 EST'], datasets:[
    { label:'Reserve', data:[72400,74200,97720], backgroundColor:'#C9993A', borderRadius:4 },
    { label:'Estate', data:[91200,95400,75000], backgroundColor:'#6B1E30', borderRadius:4 },
    { label:'Discovery', data:[41200,43800,45198], backgroundColor:'#B5C5CE', borderRadius:4 }
  ]}, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:true, position:'bottom', labels:{ font:{ size:11 }, boxWidth:10, padding:10 } } }, scales:{ x:{ grid:{ display:false }, ticks:{ font:{ size:11 } } }, y:{ grid:{ color:'rgba(0,0,0,0.05)' }, ticks:{ font:{ size:11 }, callback: v => '$'+Math.round(v/1000)+'K' } } } }});

  // Analytics member growth line
  const mg = document.getElementById('memberGrowthChart');
  if (mg) new Chart(mg, { type:'line', data:{ labels:['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'], datasets:[
    { label:'Active', data:[1620,1652,1680,1705,1740,1762,1780,1800,1818,1831,1840,1847], borderColor:'#6B1E30', backgroundColor:'rgba(107,30,48,0.07)', tension:0.3, fill:true, pointRadius:2, borderWidth:2 },
    { label:'Churned (cum)', data:[12,18,24,28,35,40,46,52,57,64,69,75], borderColor:'#DC2626', backgroundColor:'transparent', tension:0.3, fill:false, pointRadius:2, borderWidth:2, borderDash:[4,3] }
  ]}, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:true, position:'bottom', labels:{ font:{ size:11 }, boxWidth:10, padding:10 } } }, scales:{ x:{ grid:{ display:false }, ticks:{ font:{ size:11 } } }, y:{ grid:{ color:'rgba(0,0,0,0.05)' }, ticks:{ font:{ size:11 } } } } }});
});
</script>

<script>
(function() {
  const btn = document.getElementById('hamburgerBtn');
  const sidebar = document.getElementById('appSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn || !sidebar || !overlay) return;

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', function() {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);

  // Close on nav item tap (mobile)
  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // Close on ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSidebar();
  });
})();
</script>

</body>
</html>
