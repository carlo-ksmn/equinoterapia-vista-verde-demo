const SUPABASE_URL = 'https://zntkttwnnufdbfxhuyvj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ixq4380dVr0wvCTC3sUGcQ_ie2G0i-H';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Demo build: the geofence is off so the time clock can be tried from anywhere,
// and the coordinates below are fictional. The production build uses the real
// farm location with GEOFENCE_ENABLED = true.
const GEOFENCE_ENABLED = false;
const FARM_LAT = 18.500000;
const FARM_LNG = -69.900000;
const FARM_RADIUS_M = 200;

// PIN to delete. Only protects against accidental deletion, NOT real security
// (visible in browser). Real protection = RLS in Supabase. Store the value
// separately in the handover document, do not leave it in the repo long-term.
const DELETE_PIN = '1234';

// ===== AM/PM Time Picker Helpers =====
// Internally stores 24h "HH:MM" (for Supabase/export), displays AM/PM.
function timePickerHTML(id, value) {
  value = value || '09:00';
  let [h24, m] = value.split(':').map(n => parseInt(n, 10));
  if (isNaN(h24)) h24 = 9;
  if (isNaN(m)) m = 0;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  // Round minutes to nearest 5 (5-minute grid)
  m = Math.round(m / 5) * 5; if (m === 60) m = 55;
  let hourOpts = '';
  for (let i = 1; i <= 12; i++) {
    hourOpts += `<option value="${i}"${i === h12 ? ' selected' : ''}>${i}</option>`;
  }
  let minOpts = '';
  for (let i = 0; i < 60; i += 5) {
    const mm = String(i).padStart(2, '0');
    minOpts += `<option value="${mm}"${i === m ? ' selected' : ''}>${mm}</option>`;
  }
  const apOpts =
    `<option value="AM"${ap === 'AM' ? ' selected' : ''}>AM</option>` +
    `<option value="PM"${ap === 'PM' ? ' selected' : ''}>PM</option>`;
  return `<span class="time-picker" id="${id}" data-timepicker="1" style="display:inline-flex;gap:6px;">
    <select class="form-input tp-h" style="margin-bottom:0;">${hourOpts}</select>
    <select class="form-input tp-m" style="margin-bottom:0;">${minOpts}</select>
    <select class="form-input tp-ap" style="margin-bottom:0;">${apOpts}</select>
  </span>`;
}
function getTimeValue(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  let h = parseInt(el.querySelector('.tp-h').value, 10);
  const m = el.querySelector('.tp-m').value;
  const ap = el.querySelector('.tp-ap').value;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m}`;
}
function setTimeValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  let [h24, m] = (value || '09:00').split(':').map(n => parseInt(n, 10));
  if (isNaN(h24)) h24 = 9;
  if (isNaN(m)) m = 0;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;
  m = Math.round(m / 5) * 5; if (m === 60) m = 55;
  el.querySelector('.tp-h').value = String(h12);
  el.querySelector('.tp-m').value = String(m).padStart(2, '0');
  el.querySelector('.tp-ap').value = ap;
}
// ===== End Time Picker Helpers =====

// ---- Catalogs from the DB (populated by loadCatalogs() on login) ----
let RATES = {};                 // user_id -> hourly_rate
let HORSES = [];                // [{name, active, ...}]
let DAILY_BY_USER = {};         // user_id -> [{id,time,dur,name}]  · scope 'finca'
let RECURRING = { weekly: [], biweekly: [], monthly: [] }; // monthly entries carry user_id · scope 'finca'
let DAILY_BY_USER_OFICINA = {}; // user_id -> [{id,time,dur,name}]  · scope 'oficina'
let RECURRING_OFICINA = { weekly: [], biweekly: [], monthly: [] }; // scope 'oficina'
let VOLUNTEER_POOL = [];        // [{id, name, name_en}]
let PROFILES_BY_ID = {};        // user_id -> {id, name, role, daily_target_mins}

async function loadCatalogs() {
  // Single source of truth: the consolidated `tasks` table. Scope 'finca' feeds the pesticero views.
  const [h, tk, tko, vp, sp, pr] = await Promise.all([
    sb.from('horses').select('*').order('sort'),
    sb.from('tasks').select('*').eq('scope','finca').eq('is_active',true).order('sort_order'),
    sb.from('tasks').select('*').eq('scope','oficina').eq('is_active',true).order('sort_order'),
    sb.from('volunteer_pool').select('*').eq('active',true).order('sort'),
    sb.from('staff_pay').select('user_id,hourly_rate'),
    sb.from('profiles').select('id,name,role,daily_target_mins'),
  ]);
  PROFILES_BY_ID = {}; (pr.data||[]).forEach(p=>{ PROFILES_BY_ID[p.id]=p; });
  HORSES = h.data || [];
  DAILY_BY_USER = {};
  RECURRING = { weekly: [], biweekly: [], monthly: [] };
  (tk.data||[]).forEach(r=>{
    if(r.cadence==='daily'){
      // slice(0,5): keep HH:MM identical to the old text time_slot format
      (DAILY_BY_USER[r.assignee_id]=DAILY_BY_USER[r.assignee_id]||[]).push({id:r.id,time:(r.default_time||'').slice(0,5),dur:r.duration_mins,name:r.name});
    } else if(RECURRING[r.cadence]){
      RECURRING[r.cadence].push({id:r.id,name:r.name,dur:r.duration_mins,freq:r.frequency_count,user_id:r.assignee_id,mode:r.completion_mode});
    }
  });
  // Same distribution for scope 'oficina' into the parallel globals
  DAILY_BY_USER_OFICINA = {};
  RECURRING_OFICINA = { weekly: [], biweekly: [], monthly: [] };
  (tko.data||[]).forEach(r=>{
    if(r.cadence==='daily'){
      (DAILY_BY_USER_OFICINA[r.assignee_id]=DAILY_BY_USER_OFICINA[r.assignee_id]||[]).push({id:r.id,time:(r.default_time||'').slice(0,5),dur:r.duration_mins,name:r.name});
    } else if(RECURRING_OFICINA[r.cadence]){
      RECURRING_OFICINA[r.cadence].push({id:r.id,name:r.name,dur:r.duration_mins,freq:r.frequency_count,user_id:r.assignee_id,mode:r.completion_mode});
    }
  });
  VOLUNTEER_POOL = (vp.data||[]).map(r=>({id:r.task_id,name:r.name,name_en:r.name_en}));
  RATES = {}; (sp.data||[]).forEach(r=>{ RATES[r.user_id]=r.hourly_rate; });
}

// Role default as fallback when profiles.daily_target_mins is NULL
// Daily target in minutes: coordinador 7.5h, pesticero 9h (9.5h presence minus 30 min merienda)
function roleDefaultTarget(role) { return role==='coordinador' ? 450 : 540; }
// Single source of truth for the daily target time (minutes).
// Accepts a profile object OR a user_id. Reads daily_target_mins
// from the DB; falls back to the role default when NULL.
// Volunteer (or unknown) → null (no target time).
function targetMinsFor(profileOrId) {
  let p = profileOrId;
  if (typeof profileOrId === 'string') p = PROFILES_BY_ID[profileOrId] || null;
  if (!p) return null;
  if (p.role === 'volunteer') return null;
  if (p.daily_target_mins != null) return p.daily_target_mins;
  return roleDefaultTarget(p.role);
}
// Compatibility wrapper for existing role-based callers
function dailyTargetMins(role) { return roleDefaultTarget(role); }
// Merienda cap: a merienda block "costs" at most 30 min of work time.
// Any minutes beyond 30 are credited back as if work had resumed automatically.
// Handles closed blocks and a merienda that is still running right now.
function meriendaCreditMins(entries) {
  let credit = 0;
  (entries || []).forEach(e => {
    if (e.entry_type !== 'merienda') return;
    const end = e.clock_out ? new Date(e.clock_out) : new Date();
    const m = Math.floor((end - new Date(e.clock_in)) / 60000);
    if (m > 30) credit += m - 30;
  });
  return credit;
}

let currentUser = null, currentProfile = null;
let clockInterval = null, activeEntry = null;

// UI language. 'es' is the default for everyone; only volunteers can switch to 'en'.
// Persisted per device/browser via localStorage (browser-only, no Supabase).
const LANG_STORAGE_KEY = 'vv_lang';
let currentLang = 'es';

const T = {
  es: {
    role_pesticero: 'Pesticero', role_colaborador: 'Colaborador', role_coordinador: 'Coordinador', role_volunteer: 'Voluntario',
    touch_worker: 'Toca un trabajador para ver su historial',
    last_30_days: 'Últimos 30 días', loading: 'Cargando…', no_records: 'Sin registros',
    worked: 'trabajados', pending_badge: 'Pendiente', weekly_tasks_label: 'Tareas semanales',
    this_week: 'Esta sem.', period_info: '🔒 Período de solicitudes: del 13–15 y del 28 al último día del mes',
    type_money: '💵 Dinero', type_time: '⏱ Tiempo libre',
    err_name: '⚠ Escribe el nombre', err_person: '⚠ Selecciona al menos una persona',
    err_date: '⚠ Selecciona una fecha', err_save: 'Error al guardar',
    rec_once: 'Extra', rec_daily: 'Diaria', rec_weekly: 'Semanal', rec_monfri: 'Lun–Vie',
    biweekly_tasks: 'Tareas cada 2 semanas', monthly_tasks: 'Tareas mensuales',
    weekly_badge: 'Semanal', biweekly_badge: 'Cada 2 sem.', monthly_badge: 'Mensual',
    clock_in: 'Registrar entrada', clock_out: 'Registrar salida',
    merienda_start: 'Iniciar merienda', merienda_end: 'Fin de merienda',
    today: 'Hoy', overtime: 'Horas extra',
    hour_bank: 'Banco de horas', history: 'Historial de hoy',
    entry_work_in: 'Entrada', entry_work_out: 'Salida',
    entry_merienda_in: 'Inicio merienda', entry_merienda_out: 'Fin merienda',
    compensation: 'Solicitar compensación',
    comp_money: 'Pago en dinero extra', comp_time: 'Tiempo libre (salir antes)',
    send_request: 'Enviar solicitud al colaborador', no_bank: 'Sin horas acumuladas aún',
    team_status: 'Estado del equipo', pending_requests: 'Solicitudes pendientes',
    week_summary: 'Resumen semanal', plan_tab: 'Plan',
    approve: 'Aprobar', deny: 'Rechazar',
    approved: 'Aprobado ✓', denied: 'Rechazado',
    no_pending: 'Sin solicitudes pendientes',
    requests_tab: 'Solicitudes', team_tab: 'Equipo', week_tab: 'Semana',
    on_shift: 'En turno', off: 'Libre', normal_hours: 'En hora',
    session_active: 'Turno activo desde las', session_none: 'Sin turno activo',
    break_active: 'En merienda desde las',
    punched_in: 'Entrada registrada', punched_out: 'Salida registrada',
    break_started: 'Merienda iniciada', break_ended: 'Merienda terminada',
    break_already: 'Merienda ya tomada hoy', break_no_pm: 'Merienda solo disponible en la mañana (06:30–12:00)',
    request_sent: 'Solicitud enviada al colaborador',
    gps_blocked: '📍 Debes estar en la finca para fichar',
    gps_checking: 'Verificando ubicación…',
    daily_plan: 'Plan del día', weekly_tasks: 'Tareas semanales',
    add_today: '+ Hoy', completed_at: 'Listo',
    late_by: 'Atraso', overtime_dop: 'Valor en efectivo',
    task_done: '✓ Tarea completada', weekly_added: 'Tarea añadida al plan de hoy',
    comp_locked: '🔒 Solicitudes disponibles del 13–15 y del 28 al último día del mes',
    view_history: 'Ver historial',
    week_plan: 'Plan de la semana', week_tab_p: 'Semana',
    not_confirmed: '⚠ Plan pendiente de confirmación por el colaborador',
    confirm_plan: 'Confirmar plan', plan_confirmed: '✓ Plan confirmado',
    add_to_plan: '+ Agregar', delete_task: 'Eliminar',
    no_plan: 'Sin tareas planificadas para este día',
    wplan_saved: '✓ Tarea añadida al plan', wplan_deleted: 'Tarea eliminada',
    wplan_confirmed: '✓ Plan confirmado',
    // Volunteer view (previously hardcoded strings)
    tab_terapias: 'Terapias', tab_tareas: 'Tareas', tab_horario: 'Horario',
    terapias_today: 'Terapias hoy',
    status_confirmed: 'Confirmó', status_cancelled: 'Canceló', status_pending: 'Pendiente',
    prep_mark: 'Marcar como preparado', prep_unmark: 'Preparado — clic para desmarcar',
    pool_title: 'Pool de tareas', last_time: 'última vez:', never: 'nunca', done_btn: 'Hecho',
  },

  // English — volunteer scope only. Keys not listed here fall back to Spanish via t().
  en: {
    role_volunteer: 'Volunteer',
    loading: 'Loading…',
    clock_in: 'Clock in', clock_out: 'Clock out',
    history: "Today's log",
    entry_work_in: 'In', entry_work_out: 'Out',
    session_active: 'On shift since', session_none: 'No active shift',
    punched_in: 'Clocked in', punched_out: 'Clocked out',
    gps_blocked: '📍 You must be at the farm to clock in',
    gps_checking: 'Checking location…',
    task_done: '✓ Task completed',
    tab_terapias: 'Therapies', tab_tareas: 'Tasks', tab_horario: 'Schedule',
    terapias_today: 'Therapies today',
    status_confirmed: 'Confirmed', status_cancelled: 'Cancelled', status_pending: 'Pending',
    prep_mark: 'Mark as prepped', prep_unmark: 'Prepped — click to unmark',
    pool_title: 'Task pool', last_time: 'last time:', never: 'never', done_btn: 'Done',
  },
};

// Translation lookup: current language -> Spanish fallback -> raw key.
// Non-volunteers always have currentLang === 'es', so their views never change.
function t(key) { return T[currentLang]?.[key] ?? T['es']?.[key] ?? key; }
function pad(n) { return String(n).padStart(2,'0'); }
function fmtTime(date) { if (!date) return '—'; const d = new Date(date); const h=d.getHours(); const m=d.getMinutes(); const ampm=h>=12?'pm':'am'; const h12=h%12||12; return h12+':'+(m<10?'0'+m:m)+ampm; }
function fmtTimeSlot(timeStr) { if(!timeStr) return '—'; const [h,m]=timeStr.slice(0,5).split(':').map(Number); const ampm=h>=12?'pm':'am'; const h12=h%12||12; return h12+':'+(m<10?'0'+m:m)+ampm; }
function fmtDuration(minutes) { const h = Math.floor(Math.abs(minutes)/60); const m = Math.abs(minutes)%60; return (minutes<0?'-':'')+h+'h '+pad(m)+'m'; }
function fmtDate(d) {
  // Day/month names follow the UI language (English only ever active for volunteers)
  const days = currentLang==='en'
    ? ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    : ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = currentLang==='en'
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return days[d.getDay()]+', '+d.getDate()+' '+months[d.getMonth()];
}
function fmtDateShort(str) {
  const d = new Date(str+'T12:00:00');
  const days = currentLang==='en'
    ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    : ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const months = currentLang==='en'
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()];
}
function showToast(msg) { const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2500); }
function todayStr() { const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function getWeekStart() { const d=new Date(); const day=d.getDay(); d.setDate(d.getDate()-day+(day===0?-6:1)); d.setHours(0,0,0,0); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function isRequestWindowOpen() { const d=new Date().getDate(); return (d>=13&&d<=15)||(d>=28); }

// GPS
function haversineM(lat1,lng1,lat2,lng2) { const R=6371000; const dLat=(lat2-lat1)*Math.PI/180; const dLng=(lng2-lng1)*Math.PI/180; const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
function getPosition() { return new Promise((resolve,reject)=>{ if(!navigator.geolocation){reject(new Error('no_geo'));return;} navigator.geolocation.getCurrentPosition(resolve,reject,{timeout:10000,maximumAge:30000}); }); }
async function checkGps() { if(!GEOFENCE_ENABLED) return {ok:true,dist:null}; try { const pos=await getPosition(); const dist=haversineM(FARM_LAT,FARM_LNG,pos.coords.latitude,pos.coords.longitude); return {ok:dist<=FARM_RADIUS_M,dist:Math.round(dist)}; } catch(e) { return {ok:false,dist:null,error:true}; } }

// AUTH
async function login() {
  const email=document.getElementById('auth-email').value.trim();
  const pw=document.getElementById('auth-password').value;
  const btn=document.getElementById('login-btn');
  const err=document.getElementById('auth-error');
  err.style.display='none'; btn.innerHTML='<div class="spinner"></div>'; btn.disabled=true;
  const {data,error}=await sb.auth.signInWithPassword({email,password:pw});
  if(error){ err.textContent='Correo o contraseña incorrectos'; err.style.display='block'; btn.textContent='Entrar'; btn.disabled=false; return; }
  await initApp(data.user);
}
async function logout() { await sb.auth.signOut(); clearInterval(clockInterval); document.getElementById('auth-screen').style.display='flex'; document.getElementById('app-screen').style.display='none'; document.getElementById('auth-password').value=''; const btn=document.getElementById('login-btn'); btn.textContent='Entrar'; btn.disabled=false; }

// INIT
async function initApp(user) {
  currentUser=user;
  const {data:profile}=await sb.from('profiles').select('*').eq('id',user.id).single();
  currentProfile=profile;
  // Safety latch: language always resets to 'es' on login.
  // English is only restored for volunteers who previously chose it on this device.
  currentLang=(profile.role==='volunteer' && localStorage.getItem(LANG_STORAGE_KEY)==='en')?'en':'es';
  updateLangToggle();
  await loadCatalogs();
  document.getElementById('top-name').textContent=profile.name||user.email;
  document.getElementById('top-role').textContent=t('role_'+profile.role);
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app-screen').style.display='flex';
  if(profile.role==='pesticero') renderPesticero(); else if(profile.role==='volunteer') renderVolunteer(); else renderColaborador();
}

// LANGUAGE TOGGLE (volunteers only)
// Creates or removes the 🇪🇸/🇬🇧 button in the topbar depending on role.
// The button shows the flag of the language you would SWITCH TO.
function updateLangToggle() {
  const existing=document.getElementById('lang-toggle');
  if(currentProfile?.role!=='volunteer'){ if(existing) existing.remove(); return; }
  if(existing){ existing.textContent=currentLang==='es'?'🇬🇧':'🇪🇸'; return; }
  const logoutBtn=document.querySelector('.logout-btn');
  if(!logoutBtn) return;
  const btn=document.createElement('button');
  btn.id='lang-toggle';
  btn.className='logout-btn';
  btn.title='Español / English';
  btn.textContent=currentLang==='es'?'🇬🇧':'🇪🇸';
  btn.onclick=toggleLang;
  logoutBtn.parentElement.insertBefore(btn,logoutBtn);
}

function toggleLang() {
  currentLang=currentLang==='es'?'en':'es';
  localStorage.setItem(LANG_STORAGE_KEY,currentLang);
  updateLangToggle();
  document.getElementById('top-role').textContent=t('role_'+currentProfile.role);
  renderVolunteer();
}

function startClock(elId) { clearInterval(clockInterval); function update(){ const now=new Date(); const el=document.getElementById(elId); if(el) el.textContent=pad(now.getHours())+':'+pad(now.getMinutes()); } update(); clockInterval=setInterval(update,60000); }


// PESTICERO VIEW — 3 tabs: Diario · Semanal · Balance
async function renderPesticero() {
  const content=document.getElementById('main-content');
  content.innerHTML=`<div class="tab-bar"><button class="tab active" onclick="pesticeroTab('diario')" id="ptab-diario">Diario</button><button class="tab" onclick="pesticeroTab('semanal')" id="ptab-semanal">Semanal</button><button class="tab" onclick="pesticeroTab('balance')" id="ptab-balance">Balance</button></div><div class="tab-content active" id="pest-diario"><div class="card"><div class="clock-display" id="main-clock">--:--</div><div class="clock-date" id="main-date"></div><div class="gps-banner" id="gps-banner"></div><div class="session-info" id="session-info"></div><div id="punch-buttons"></div></div><div class="metric-grid" id="metrics" style="margin-bottom:12px;"></div><div id="terapias-hoy-card" style="margin-bottom:12px;"></div><div class="card" id="plan-card"></div><div class="card" id="history-card"></div></div><div class="tab-content" id="pest-semanal"></div><div class="tab-content" id="pest-balance"></div>`;
  document.getElementById('main-date').textContent=fmtDate(new Date());
  startClock('main-clock');
  await refreshPesticeroState();
}

function pesticeroTab(tab) {
  ['diario','semanal','balance'].forEach(name=>{
    document.getElementById('ptab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('pest-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='semanal') renderPesticeroSemanal();
  if(tab==='balance') renderPesticeroBalance();
}

async function refreshPesticeroState() {
  const today=new Date(); today.setHours(0,0,0,0);
  const {data:entries}=await sb.from('time_entries').select('*').eq('user_id',currentUser.id).gte('clock_in',today.toISOString()).order('clock_in',{ascending:true});
  activeEntry=entries?.find(e=>!e.clock_out)||null;
  let workedMins=0;
  entries?.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') workedMins+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
  if(activeEntry?.entry_type==='work') workedMins+=Math.floor((new Date()-new Date(activeEntry.clock_in))/60000);
  // Merienda minutes beyond the 30-min cap count as work again
  workedMins+=meriendaCreditMins(entries);
  const targetToday=targetMinsFor(currentProfile)??(9*60);
  const overtimeMins=Math.max(0,workedMins-targetToday);
  const sessionEl=document.getElementById('session-info');
  if(activeEntry){ sessionEl.textContent=activeEntry.entry_type==='merienda'?t('break_active')+' '+fmtTime(activeEntry.clock_in):t('session_active')+' '+fmtTime(activeEntry.clock_in); } else { sessionEl.textContent=t('session_none'); }
  const now=new Date(); const hour=now.getHours(); const mins=now.getMinutes();
  const inMorningWindow=(hour>6||(hour===6&&mins>=30))&&hour<12;
  const alreadyTook=entries?.some(e=>e.entry_type==='merienda');
  const showMerienda=inMorningWindow&&!alreadyTook;
  const btns=document.getElementById('punch-buttons');
  if(!activeEntry){ btns.innerHTML=`<button class="punch-btn in" onclick="punchInGps('work')">${t('clock_in')}</button>`; }
  else if(activeEntry.entry_type==='work'){
    let mb='';
    if(showMerienda){ mb=`<button class="punch-btn break" onclick="punchIn('merienda')" style="margin-top:8px;">${t('merienda_start')}</button>`; }
    else if(alreadyTook){ mb=`<div style="text-align:center;font-size:12px;color:var(--text3);margin-top:8px;">☕ ${t('break_already')}</div>`; }
    else if(!inMorningWindow){ mb=`<div style="text-align:center;font-size:12px;color:var(--text3);margin-top:8px;">${t('break_no_pm')}</div>`; }
    btns.innerHTML=`<button class="punch-btn out" onclick="punchOut()">${t('clock_out')}</button>${mb}`;
  }
  else if(activeEntry.entry_type==='merienda'){
    // Display-only countdown; the actual accounting is handled by meriendaCreditMins
    const merElapsed=Math.floor((new Date()-new Date(activeEntry.clock_in))/60000);
    const merRemaining=Math.max(0,30-merElapsed);
    const merInfo=merRemaining>0?`☕ Quedan ${merRemaining} de 30 min`:'☕ 30 min cumplidos · el resto cuenta como trabajo';
    btns.innerHTML=`<div id="mer-remaining" style="text-align:center;font-size:12px;color:var(--text3);margin-bottom:8px;">${merInfo}</div><button class="punch-btn break-end" onclick="punchOut()">${t('merienda_end')}</button>`;
    clearInterval(window.merTick);
    window.merTick=setInterval(()=>{ const el=document.getElementById('mer-remaining'); if(!el||!activeEntry||activeEntry.entry_type!=='merienda'){ clearInterval(window.merTick); return; } const em=Math.floor((new Date()-new Date(activeEntry.clock_in))/60000); const rm=Math.max(0,30-em); el.textContent=rm>0?`☕ Quedan ${rm} de 30 min`:'☕ 30 min cumplidos · el resto cuenta como trabajo'; },30000);
  }
  document.getElementById('metrics').innerHTML=`<div class="metric"><div class="metric-label">${t('today')}</div><div class="metric-val neutral">${fmtDuration(workedMins)}</div></div><div class="metric"><div class="metric-label">${t('overtime')}</div><div class="metric-val ${overtimeMins>0?'positive':'neutral'}">${overtimeMins>0?'+':''}${fmtDuration(overtimeMins)}</div></div>`;
  await renderTerapiasHoy();
  await renderDailyPlan();
  // History log
  const histEl=document.getElementById('history-card');
  let histHTML=`<div class="card-title">${t('history')}</div>`;
  if(!entries||entries.length===0){ histHTML+=`<div class="empty">—</div>`; }
  else { entries.forEach(e=>{ const typeIn=e.entry_type==='merienda'?t('entry_merienda_in'):t('entry_work_in'); const typeOut=e.entry_type==='merienda'?t('entry_merienda_out'):t('entry_work_out'); histHTML+=`<div class="log-row"><span class="log-type">${typeIn}</span><span class="log-time">${fmtTime(e.clock_in)}</span></div>`; if(e.clock_out) histHTML+=`<div class="log-row"><span class="log-type">${typeOut}</span><span class="log-time">${fmtTime(e.clock_out)}</span></div>`; }); }
  histEl.innerHTML=histHTML;
  window._lastOvertimeMins=overtimeMins;
}

// TERAPIAS HOY (Pesticero read-only)
async function renderTerapiasHoy() {
  const el = document.getElementById('terapias-hoy-card');
  if(!el) return;
  const dateStr = todayStr();
  const jsDay = new Date().getDay();
  const dow = jsDay === 0 ? 7 : jsDay;

  const {data: slots} = await sb
    .from('therapy_schedule')
    .select('*, clients(id, name, horse)')
    .eq('day_of_week', dow)
    .eq('is_active', true)
    .order('time_slot', {ascending: true});

  const {data: sessions} = await sb
    .from('therapy_sessions')
    .select('*')
    .eq('date', dateStr);

  const sessionMap = {};
  (sessions||[]).forEach(s => { if(s.schedule_id) sessionMap[s.schedule_id] = s; });

  const {data: profilesList} = await sb.from('profiles').select('id, name');
  window.profilesMap = {};
  (profilesList||[]).forEach(p => { window.profilesMap[p.id] = p.name; });

  if(!slots || slots.length === 0){
    el.innerHTML = '';
    return;
  }

  let html = `<div class="card" style="padding:0;margin-bottom:12px;">
    <div style="padding:10px 16px 6px;border-bottom:1px solid var(--border);">
      <div class="card-title" style="margin-bottom:0;">${t('terapias_today')}</div>
    </div>`;

  slots.forEach(slot => {
    const session = sessionMap[slot.id];
    const status = session?.status || 'pendiente';
    const statusColor = status==='confirmo'?'var(--green)':status==='cancelo'?'var(--red)':'var(--amber)';
    const statusLabel = status==='confirmo'?t('status_confirmed'):status==='cancelo'?t('status_cancelled'):t('status_pending');
    const time = fmtTimeSlot(slot.time_slot);
    html += `<div style="display:flex;align-items:center;padding:8px 16px;border-bottom:1px solid var(--border);gap:12px;">
      <div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text2);width:48px;flex-shrink:0;">${time}</div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;">${slot.clients?.name||'—'}</div>
        <div style="font-size:11px;color:var(--text3);">${slot.clients?.horse||'—'}${session?.prep_done_by ? ` · 🐴 ${(window.profilesMap||{})[session.prep_done_by]||'?'} · ${fmtTime(session.prep_done_at)}` : ''}</div>
      </div>
      <span style="font-size:11px;color:${statusColor};font-weight:500;">${statusLabel}</span>
      ${session ? `<button onclick="cyclePrep('${session.id}','${session.prep_done_by||''}','${session.prep_done_at||''}',this)" title="${session.prep_done_by?t('prep_unmark'):t('prep_mark')}" style="font-size:16px;width:30px;height:30px;line-height:1;border-radius:50%;border:1.5px solid ${session.prep_done_by?'var(--green)':'var(--border)'};background:${session.prep_done_by?'var(--green)':'transparent'};cursor:pointer;flex-shrink:0;">🐴</button>` : ''}
    </div>`;
  });

  html += '</div>';
  const elFinal = document.getElementById('terapias-hoy-card');
  if(!elFinal) return;
  elFinal.innerHTML = html;
}

// ── SHARED TASK RENDERING HELPERS ──────────────────────────────
// Foundation reused across pesticero views and (later) coordinador oficina.

// Rhythm badge for a task cadence. Daily tasks show no badge.
function taskBadge(cadence) {
  const cls = { weekly:'badge-green', biweekly:'badge-blue', monthly:'badge-amber' }[cadence];
  if(!cls) return '';
  return `<span class="badge ${cls}" style="margin-left:6px;font-size:9px;">${t(cadence+'_badge')}</span>`;
}

// Unified row for recurring tasks (weekly / biweekly / monthly).
// name: task name · cadence: for the badge · meta: right-of-name detail line
// isDone: dims the name · rightHTML: the trailing action (check / + Hoy / done marker)
function recurringRowHTML({ name, cadence, meta, isDone, rightHTML }) {
  return `<div class="task-item"><div style="flex:1;min-width:0;"><div class="task-name ${isDone?'done':''}">${name}${taskBadge(cadence)}</div><div class="task-meta">${meta}</div></div>${rightHTML}</div>`;
}

// Trailing action for a recurring task row.
// dimDone: already satisfied this period but not on my plan today → shown as done, no action.
// onToday: on my plan today → tappable check. Otherwise → "+ Hoy" to add it to today.
function recurringRightHTML(taskId, cadence, onToday, isDone, dimDone) {
  if(dimDone) return `<div class="task-check weekly-done" style="opacity:0.55;">✓</div>`;
  if(onToday){
    const ck = isDone ? '' : `completeTask('${taskId}','${cadence}')`;
    return `<div class="task-check ${isDone?'weekly-done':''}" onclick="${ck}">${isDone?'✓':''}</div>`;
  }
  return `<button class="btn-add-today" onclick="addTaskOnDate('${taskId}','${cadence}','${todayStr()}',this)">${t('add_today')}</button>`;
}

// DAILY PLAN (only daily tasks — no weekly/biweekly/monthly)
async function renderDailyPlan() {
  const tasks=DAILY_BY_USER[currentUser.id]||[]; const today=todayStr();
  const {data:completions}=await sb.from('task_completions').select('*').eq('user_id',currentUser.id).eq('date',today).eq('task_type','daily');
  const doneMap={}; (completions||[]).forEach(c=>{doneMap[c.task_id]=c.completed_at;});
  const extras=await loadExtraTasks(currentUser.id,today);
  const {data:extraCompletions}=await sb.from('task_completions').select('*').eq('user_id',currentUser.id).eq('date',today).eq('task_type','extra');
  const extraDoneMap={}; (extraCompletions||[]).forEach(c=>{extraDoneMap[c.task_id]=c.completed_at;});
  let html=`<div class="card-title">${t('daily_plan')}</div>`; const now=new Date();
  tasks.forEach(task=>{ const isDone=!!doneMap[task.id]; const taskName=task.name; const [sh,sm]=task.time.split(':').map(Number); const targetEnd=new Date(); targetEnd.setHours(sh,sm,0,0); targetEnd.setMinutes(targetEnd.getMinutes()+task.dur); let statusHtml=''; if(isDone){ const doneDate=new Date(doneMap[task.id]); const lateMins=Math.round((doneDate-targetEnd)/60000); statusHtml=lateMins>2?'<div class="task-late">+'+lateMins+'min '+t('late_by')+'</div>':'<div class="task-stamp">'+t('completed_at')+' '+fmtTime(doneMap[task.id])+'</div>'; } else if(now>targetEnd){ statusHtml='<div class="task-late">⚠ '+t('late_by')+'</div>'; } const ck=isDone?'':'completeTask(\''+task.id+'\',\'daily\')'; html+='<div class="task-item"><div class="task-check '+(isDone?'done':'')+('" onclick="')+ck+'">'+(isDone?'✓':'')+'</div><div class="task-body"><div class="task-name '+(isDone?'done':'')+'">'+taskName+'</div><div class="task-target">'+fmtTimeSlot(task.time)+' · '+task.dur+'min</div>'+statusHtml+'</div></div>'; });
  extras.forEach(task=>{ const isDone=!!extraDoneMap[task.id]; const ck2=isDone?'':'completeTask(\''+task.id+'\',\'extra\')'; html+='<div class="task-item"><div class="task-check '+(isDone?'done':'')+('" onclick="')+ck2+'">'+(isDone?'✓':'')+'</div><div class="task-body"><div class="task-name '+(isDone?'done':'')+'">'+task.name+'<span class="extra-badge">Extra</span></div><div class="task-target">'+(task.duration_mins?task.duration_mins+'min':'—')+(task.note?' · '+task.note:'')+'</div>'+(isDone?'<div class="task-stamp">'+t('completed_at')+' '+fmtTime(extraDoneMap[task.id])+'</div>':'')+'</div></div>'; });
  document.getElementById('plan-card').innerHTML=html;
}

// Coordinador oficina daily plan — mirrors renderDailyPlan but reads oficina scope.
async function renderOficinaDailyPlan() {
  const el=document.getElementById('oficina-plan-card');
  if(!el) return;
  const tasks=DAILY_BY_USER_OFICINA[currentUser.id]||[]; const today=todayStr();
  const {data:completions}=await sb.from('task_completions').select('*').eq('user_id',currentUser.id).eq('date',today).eq('task_type','daily');
  const doneMap={}; (completions||[]).forEach(c=>{doneMap[c.task_id]=c.completed_at;});
  let html=`<div class="card-title">${t('daily_plan')}</div>`; const now=new Date();
  if(tasks.length===0){ html+=`<div class="empty">—</div>`; }
  tasks.forEach(task=>{ const isDone=!!doneMap[task.id]; const taskName=task.name; const [sh,sm]=task.time.split(':').map(Number); const targetEnd=new Date(); targetEnd.setHours(sh,sm,0,0); targetEnd.setMinutes(targetEnd.getMinutes()+task.dur); let statusHtml=''; if(isDone){ const doneDate=new Date(doneMap[task.id]); const lateMins=Math.round((doneDate-targetEnd)/60000); statusHtml=lateMins>2?'<div class="task-late">+'+lateMins+'min '+t('late_by')+'</div>':'<div class="task-stamp">'+t('completed_at')+' '+fmtTime(doneMap[task.id])+'</div>'; } else if(now>targetEnd){ statusHtml='<div class="task-late">⚠ '+t('late_by')+'</div>'; } const ck=isDone?'':'completeTask(\''+task.id+'\',\'daily\')'; html+='<div class="task-item"><div class="task-check '+(isDone?'done':'')+('" onclick="')+ck+'">'+(isDone?'✓':'')+'</div><div class="task-body"><div class="task-name '+(isDone?'done':'')+'">'+taskName+'</div><div class="task-target">'+fmtTimeSlot(task.time)+' · '+task.dur+'min</div>'+statusHtml+'</div></div>'; });
  el.innerHTML=html;
}

// COMPLETE TASK
async function completeTask(taskId,taskType) {
  const today=todayStr(); const now=new Date().toISOString();
  await sb.from('task_completions').upsert({user_id:currentUser.id,task_id:taskId,date:today,task_type:taskType,completed_at:now},{onConflict:'user_id,task_id,date'});
  showToast(t('task_done'));
  if(taskType==='daily'||taskType==='extra') await renderDailyPlan();
  else if(taskType==='weekly') await renderWeeklyTasks();
  else if(taskType==='biweekly') await renderBiweeklyTasks();
  else if(taskType==='monthly') await renderMonthlyTasks();
  else if(taskType==='vol_pool') await renderVolunteerTareas();
}

async function completeTaskOnDate(taskId,taskType,date) {
  const now=new Date().toISOString();
  await sb.from('task_completions').upsert({user_id:currentUser.id,task_id:taskId,date:date,task_type:taskType,completed_at:now},{onConflict:'user_id,task_id,date'});
  showToast(t('task_done'));
  await renderPesticeroSemanal();
}

// SEMANAL TAB (Pesticero) — Weekly plan + weekly/biweekly/monthly with day selector
async function renderPesticeroSemanal() {
  const el=document.getElementById('pest-semanal');
  if(!el) return;
  el.innerHTML='<div class="empty">Cargando…</div>';

  // Gather data
  const today=todayStr();
  const weekStart=getWeekStart();
  const now=new Date(); const dom=now.getDate();
  const periodStart=new Date(now.getFullYear(),now.getMonth(),(dom<=15?1:16));
  const periodStartStr=periodStart.toISOString().slice(0,10);
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);

  const [{data:weekCompletions},{data:biweeklyComp},{data:monthlyComp}] = await Promise.all([
    sb.from('task_completions').select('*, profiles(name)').gte('date',weekStart).eq('task_type','weekly'),
    sb.from('task_completions').select('*, profiles(name)').gte('date',periodStartStr).eq('task_type','biweekly'),
    sb.from('task_completions').select('*').eq('user_id',currentUser.id).gte('date',monthStart).eq('task_type','monthly'),
  ]);

  const weekCountMap={}; const weekDoneByMap={};
  (weekCompletions||[]).forEach(c=>{ if(c.completed_at){ weekCountMap[c.task_id]=(weekCountMap[c.task_id]||0)+1; if(!weekDoneByMap[c.task_id]) weekDoneByMap[c.task_id]=[]; weekDoneByMap[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });
  const biweeklyDoneByMap={};
  (biweeklyComp||[]).forEach(c=>{ if(c.completed_at){ if(!biweeklyDoneByMap[c.task_id]) biweeklyDoneByMap[c.task_id]=[]; biweeklyDoneByMap[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });
  const monthlyDoneMap={}; (monthlyComp||[]).forEach(c=>{if(c.completed_at) monthlyDoneMap[c.task_id]=c.completed_at;});

  // My scheduled entries (for + Hoy logic)
  const {data:myWeekToday}=await sb.from('task_completions').select('*').eq('user_id',currentUser.id).eq('date',today).eq('task_type','weekly');
  const {data:myBiToday}=await sb.from('task_completions').select('*').eq('user_id',currentUser.id).eq('date',today).eq('task_type','biweekly');
  const myWeekTodayIds=new Set((myWeekToday||[]).map(c=>c.task_id));
  const myBiTodayIds=new Set((myBiToday||[]).map(c=>c.task_id));
  const myWeekDoneMap={}; (myWeekToday||[]).forEach(c=>{if(c.completed_at) myWeekDoneMap[c.task_id]=c.completed_at;});
  const myBiDoneMap={}; (myBiToday||[]).forEach(c=>{if(c.completed_at) myBiDoneMap[c.task_id]=c.completed_at;});
  const {data:myMonthToday}=await sb.from('task_completions').select('*').eq('user_id',currentUser.id).eq('date',today).eq('task_type','monthly');
  const myMonthTodayIds=new Set((myMonthToday||[]).map(c=>c.task_id));

  const myMonthly=RECURRING.monthly.filter(mt=>mt.user_id===currentUser.id);

  let html='';

  // 1. Weekly plan
  html+=`<div id="pest-wplan-container"></div>`;

  // 2. Weekly tasks (collective: quota shared across all pesticeros)
  html+=`<div class="card" id="weekly-card"><div class="card-title">${t('weekly_tasks')}</div>`;
  RECURRING.weekly.forEach(task=>{
    const doneCount=weekCountMap[task.id]||0; const satisfied=doneCount>=task.freq;
    const onToday=myWeekTodayIds.has(task.id); const isDoneToday=!!myWeekDoneMap[task.id];
    const dimDone=satisfied&&!onToday;
    const doneBy=weekDoneByMap[task.id]||[];
    const byHtml=doneBy.length&&!isDoneToday?' · <span style="color:var(--green);font-size:10px;">'+doneBy.map(d=>d.name+' '+fmtTime(d.time)).join(', ')+'</span>':'';
    const freqLabel=task.freq>1?(doneCount+'/'+task.freq+'×/sem'):(satisfied?'✓':(onToday?t('today'):t('this_week')));
    const durLabel=task.dur>=60?Math.floor(task.dur/60)+'h'+(task.dur%60?pad(task.dur%60)+'m':''):task.dur+'min';
    html+=recurringRowHTML({name:task.name,cadence:'weekly',meta:`${durLabel} · ${freqLabel}${byHtml}`,isDone:isDoneToday||dimDone,rightHTML:recurringRightHTML(task.id,'weekly',onToday,isDoneToday,dimDone)});
  });
  html+=`</div>`;

  // 3. Biweekly tasks (collective)
  html+=`<div class="card" id="biweekly-card"><div class="card-title">${t('biweekly_tasks')}</div>`;
  RECURRING.biweekly.forEach(task=>{
    const doneBy=biweeklyDoneByMap[task.id]||[]; const satisfied=doneBy.length>0;
    const onToday=myBiTodayIds.has(task.id); const isDoneToday=!!myBiDoneMap[task.id];
    const dimDone=satisfied&&!onToday;
    const byHtml=doneBy.length&&!isDoneToday?' · <span style="color:var(--green);font-size:10px;">'+doneBy.map(d=>d.name+' '+fmtTime(d.time)).join(', ')+'</span>':'';
    html+=recurringRowHTML({name:task.name,cadence:'biweekly',meta:`${task.dur}min${byHtml}`,isDone:isDoneToday||dimDone,rightHTML:recurringRightHTML(task.id,'biweekly',onToday,isDoneToday,dimDone)});
  });
  html+=`</div>`;

  // 4. Monthly tasks (Arturo only: filtered by assignee)
  if(myMonthly.length){
    html+=`<div class="card" id="monthly-card"><div class="card-title">${t('monthly_tasks')}</div>`;
    RECURRING.monthly.forEach(task=>{
      const satisfied=!!monthlyDoneMap[task.id]; const onToday=myMonthTodayIds.has(task.id);
      const dimDone=satisfied&&!onToday;
      const doneTimeHtml=satisfied?' · <span style="color:var(--green);font-size:10px;">'+fmtTime(monthlyDoneMap[task.id])+'</span>':'';
      html+=recurringRowHTML({name:task.name,cadence:'monthly',meta:`${task.dur}min${doneTimeHtml}`,isDone:satisfied,rightHTML:recurringRightHTML(task.id,'monthly',onToday,satisfied,dimDone)});
    });
    html+=`</div>`;
  }

  el.innerHTML=html;
  // Render week plan into its container
  await renderWeekPlanView('pest-wplan-container', currentUser.id, false);
}

// Add a task to a specific date (Pesticero day-picker)
async function addTaskOnDate(taskId, taskType, date, btn) {
  await sb.from('task_completions').upsert({user_id:currentUser.id,task_id:taskId,date:date,task_type:taskType,completed_at:null},{onConflict:'user_id,task_id,date'});
  showToast(t('weekly_added'));
  await renderPesticeroSemanal();
}

// BALANCE TAB (Pesticero)
async function renderPesticeroBalance() {
  const el=document.getElementById('pest-balance');
  if(!el) return;
  el.innerHTML='<div class="empty">Cargando…</div>';
  const {data:allEntries}=await sb.from('time_entries').select('*').eq('user_id',currentUser.id);
  const {data:approved}=await sb.from('compensation_requests').select('*').eq('user_id',currentUser.id).eq('status','approved');
  const compEl=document.createElement('div');
  const {data:_ovr}=await sb.from('attendance_overrides').select('*').eq('user_id',currentUser.id);
  await renderWorkerCompensation(currentUser.id, currentProfile, allEntries||[], approved||[], compEl, _ovr||[]);
  el.innerHTML='';
  el.appendChild(compEl);
}

// GPS PUNCH
function refreshAfterPunch() { if(currentProfile.role==='volunteer') return refreshVolunteerTimeState(); if(currentProfile.role==='coordinador') return refreshCoordinadoraState(); return refreshPesticeroState(); }
async function punchInGps(type) { const banner=document.getElementById('gps-banner'); banner.style.display='block'; banner.textContent=t('gps_checking'); const result=await checkGps(); if(!result.ok){ const dist=result.dist!=null?` (${result.dist}m)`:''; banner.textContent=t('gps_blocked')+dist; return; } banner.style.display='none'; await punchIn(type); }
async function punchIn(type) {
  // Starting a merienda must first clock out the running work entry (real switch, not parallel)
  if (type === 'merienda' && activeEntry && activeEntry.entry_type === 'work') {
    const { data: closed, error: closeErr } = await sb.from('time_entries')
      .update({ clock_out: new Date().toISOString() })
      .eq('id', activeEntry.id).select();
    if (closeErr || !closed?.length) { showToast('Error al cerrar el turno'); return; }
    activeEntry = null;
  }
  const { data: opened, error } = await sb.from('time_entries')
    .insert({ user_id: currentUser.id, clock_in: new Date().toISOString(), entry_type: type })
    .select();
  if (!error && opened?.length) { showToast(type === 'merienda' ? t('break_started') : t('punched_in')); await refreshAfterPunch(); }
  else { showToast('Error al fichar'); }
}
async function punchOut() {
  if (!activeEntry) return;
  const wasMerienda = activeEntry.entry_type === 'merienda';
  const { data: closed, error } = await sb.from('time_entries')
    .update({ clock_out: new Date().toISOString() })
    .eq('id', activeEntry.id).select();
  if (error || !closed?.length) { showToast('Error al fichar'); return; }
  activeEntry = null;
  if (wasMerienda) {
    // Ending a merienda automatically resumes work with a fresh work entry
    const { data: opened, error: openErr } = await sb.from('time_entries')
      .insert({ user_id: currentUser.id, clock_in: new Date().toISOString(), entry_type: 'work' })
      .select();
    if (openErr || !opened?.length) { showToast('Error al reanudar el turno'); return; }
    showToast(t('break_ended'));
  } else {
    showToast(t('punched_out'));
  }
  await refreshAfterPunch();
}

// COMPENSATION (worker side)
async function renderCompensation(overtimeMins) {
  const {data:allEntries}=await sb.from('time_entries').select('*').eq('user_id',currentUser.id);
  const {data:approved}=await sb.from('compensation_requests').select('*').eq('user_id',currentUser.id).eq('status','approved');
  const compEl=document.createElement('div');
  const {data:_ovr}=await sb.from('attendance_overrides').select('*').eq('user_id',currentUser.id);
  await renderWorkerCompensation(currentUser.id, currentProfile, allEntries||[], approved||[], compEl, _ovr||[]);
}
async function sendCompRequest(bankMins) { const type=document.getElementById('comp-type').value; const {error}=await sb.from('compensation_requests').insert({user_id:currentUser.id,hours_requested:+(bankMins/60).toFixed(2),type,status:'pending'}); if(!error) showToast(t('request_sent')); }

async function renderWorkerCompensation(userId, profile, allEntries, approved, compEl, overrides) {
  overrides = overrides || [];
  const rate=RATES[userId]||0;
  const now=new Date(); const day=now.getDate();
  function getPeriods() {
    const periods=[];
    let d=new Date(now.getFullYear(),now.getMonth(), day<=15?1:16);
    for(let i=0;i<7;i++){
      const start=new Date(d);
      const isFirstHalf=start.getDate()===1;
      const end=new Date(start.getFullYear(),start.getMonth(), isFirstHalf?15:new Date(start.getFullYear(),start.getMonth()+1,0).getDate());
      periods.push({start:start.toISOString().slice(0,10), end:end.toISOString().slice(0,10)});
      if(isFirstHalf){ d=new Date(start.getFullYear(),start.getMonth()-1,16); }
      else { d=new Date(start.getFullYear(),start.getMonth(),1); }
    }
    return periods;
  }
  function periodBalance(startStr, endStr) {
    const entries=allEntries.filter(e=>e.clock_in.slice(0,10)>=startStr&&e.clock_in.slice(0,10)<=endStr);
    let worked=0;
    entries.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') worked+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
    worked+=meriendaCreditMins(entries);
    const workedDays=new Set(entries.filter(e=>e.entry_type==='work'&&e.clock_out).map(e=>e.clock_in.slice(0,10)));
    // Absence override days in range that are NOT already worked days count as extra meta deductions
    const absDaysInRange=overrides.filter(o=>o.date>=startStr&&o.date<=endStr&&!workedDays.has(o.date)).length;
    const days=workedDays.size+absDaysInRange;
    const deducted=approved.filter(r=>{ const rd=r.created_at.slice(0,10); return rd>=startStr&&rd<=endStr; }).reduce((s,r)=>s+r.hours_requested*60,0);
    return worked-(days*(targetMinsFor(profile)??roleDefaultTarget(profile?.role)))-deducted;
  }
  let totalWorked=0;
  allEntries.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') totalWorked+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
  totalWorked+=meriendaCreditMins(allEntries);
  const totalWorkedDays=new Set(allEntries.filter(e=>e.entry_type==='work'&&e.clock_out).map(e=>e.clock_in.slice(0,10)));
  const totalAbsDays=overrides.filter(o=>!totalWorkedDays.has(o.date)).length;
  const totalDays=totalWorkedDays.size+totalAbsDays;
  const totalDeducted=approved.reduce((s,r)=>s+r.hours_requested*60,0);
  const bankMins=totalWorked-(totalDays*(targetMinsFor(profile)??roleDefaultTarget(profile?.role)))-totalDeducted;
  const periods=getPeriods();
  const currentPeriod=periods[0];
  const curBalance=periodBalance(currentPeriod.start, currentPeriod.end);
  const canRequest=isRequestWindowOpen();
  const balanceColor=bankMins>0?'var(--green)':bankMins<0?'var(--red)':'var(--text2)';
  const curColor=curBalance>0?'var(--green)':curBalance<0?'var(--red)':'var(--text2)';
  let html=`<div class="card-title">${t('compensation')}</div>`;
  html+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:12px;color:var(--text3);">Balance total</span><strong style="color:${balanceColor};">${bankMins>=0?'+':''}${fmtDuration(bankMins)}</strong></div>`;
  const periodLabel=`${currentPeriod.start.slice(8)} – ${currentPeriod.end.slice(8)} ${now.toLocaleString('es',{month:'short'})}`;
  html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface2);border-radius:var(--radius-sm);margin-bottom:8px;"><span style="font-size:12px;color:var(--text2);">${periodLabel}</span><span style="font-size:13px;font-weight:500;color:${curColor};">${curBalance>=0?'+':''}${fmtDuration(curBalance)}</span></div>`;
  html+=`<div id="period-history-${userId}" style="display:none;">`;
  periods.slice(1,7).forEach(p=>{
    const bal=periodBalance(p.start,p.end);
    if(bal===0&&allEntries.filter(e=>e.clock_in.slice(0,10)>=p.start&&e.clock_in.slice(0,10)<=p.end).length===0) return;
    const col=bal>0?'var(--green)':bal<0?'var(--red)':'var(--text3)';
    const pLabel=`${p.start.slice(8)} – ${p.end.slice(8)} ${new Date(p.start+'T12:00:00').toLocaleString('es',{month:'short'})}`;
    html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-top:1px solid var(--border);"><span style="font-size:12px;color:var(--text3);">${pLabel}</span><span style="font-size:12px;font-weight:500;color:${col};">${bal>=0?'+':''}${fmtDuration(bal)}</span></div>`;
  });
  html+=`</div><button onclick="const el=document.getElementById('period-history-${userId}');el.style.display=el.style.display==='none'?'block':'none';this.textContent=el.style.display==='none'?'▾ Ver historial':'▴ Ocultar'" style="font-size:12px;color:var(--text3);background:none;border:none;cursor:pointer;padding:4px 0;margin-bottom:8px;">▾ Ver historial</button>`;
  if(bankMins>0){
    const dopValue=Math.round((bankMins/60)*rate);
    html+=`<div class="dop-display"><div class="dop-amount">RD$ ${dopValue.toLocaleString()}</div><div class="dop-label">${t('overtime_dop')} · ${rate} DOP/h</div></div>`;
    if(canRequest&&userId===currentUser?.id){ html+=`<select id="comp-type"><option value="money">${t('comp_money')}</option><option value="time_off">${t('comp_time')}</option></select><button class="btn-send" onclick="sendCompRequest(${bankMins})">${t('send_request')} →</button>`; }
    else if(!canRequest){ html+=`<div class="btn-send-locked">${t('comp_locked')}</div>`; }
  } else if(bankMins<0){
    html+=`<div style="font-size:13px;color:var(--red);text-align:center;padding:8px 0;">⚠ ${fmtDuration(Math.abs(bankMins))} por recuperar</div>`;
  } else {
    html+=`<div class="empty">${t('no_bank')}</div>`;
  }
  compEl.innerHTML=html;
}

// COLABORADOR VIEW — 3 tabs: Finca · Terapias · Admin
// VOLUNTEER VIEW — 2 tabs: Terapias (prep-toggle) · Tareas (pool)
async function renderVolunteer() {
  const content=document.getElementById('main-content');
  content.innerHTML=`<div class="tab-bar"><button class="tab active" onclick="volunteerTab('terapias')" id="vtab-terapias">${t('tab_terapias')}</button><button class="tab" onclick="volunteerTab('tareas')" id="vtab-tareas">${t('tab_tareas')}</button><button class="tab" onclick="volunteerTab('horario')" id="vtab-horario">${t('tab_horario')}</button></div><div class="tab-content active" id="volunteer-terapias"><div id="terapias-hoy-card"></div></div><div class="tab-content" id="volunteer-tareas"></div><div class="tab-content" id="volunteer-horario"><div class="card"><div class="clock-display" id="main-clock">--:--</div><div class="clock-date" id="main-date"></div><div class="gps-banner" id="gps-banner"></div><div class="session-info" id="session-info"></div><div id="punch-buttons"></div></div><div class="card" id="history-card"></div></div>`;
  await renderTerapiasHoy();
}

function volunteerTab(tab) {
  ['terapias','tareas','horario'].forEach(name=>{
    document.getElementById('vtab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('volunteer-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='terapias') renderTerapiasHoy();
  if(tab==='tareas') renderVolunteerTareas();
  if(tab==='horario') { document.getElementById('main-date').textContent=fmtDate(new Date()); startClock('main-clock'); refreshVolunteerTimeState(); }
}

async function refreshVolunteerTimeState() {
  const today=new Date(); today.setHours(0,0,0,0);
  const {data:entries}=await sb.from('time_entries').select('*').eq('user_id',currentUser.id).gte('clock_in',today.toISOString()).order('clock_in',{ascending:true});
  activeEntry=entries?.find(e=>!e.clock_out)||null;
  const sessionEl=document.getElementById('session-info');
  if(sessionEl){ sessionEl.textContent=activeEntry?t('session_active')+' '+fmtTime(activeEntry.clock_in):t('session_none'); }
  const btns=document.getElementById('punch-buttons');
  if(btns){ btns.innerHTML=activeEntry?`<button class="punch-btn out" onclick="punchOut()">${t('clock_out')}</button>`:`<button class="punch-btn in" onclick="punchInGps('work')">${t('clock_in')}</button>`; }
  const histEl=document.getElementById('history-card');
  if(histEl){
    let histHTML=`<div class="card-title">${t('history')}</div>`;
    if(!entries||entries.length===0){ histHTML+=`<div class="empty">—</div>`; }
    else { entries.forEach(e=>{ histHTML+=`<div class="log-row"><span class="log-type">${t('entry_work_in')}</span><span class="log-time">${fmtTime(e.clock_in)}</span></div>`; if(e.clock_out) histHTML+=`<div class="log-row"><span class="log-type">${t('entry_work_out')}</span><span class="log-time">${fmtTime(e.clock_out)}</span></div>`; }); }
    histEl.innerHTML=histHTML;
  }
}

// Display name for a pool task: English column if present, Spanish fallback.
function taskDisplayName(task) {
  return (currentLang === 'en' && task.name_en) ? task.name_en : task.name;
}

async function renderVolunteerTareas() {
  const el=document.getElementById('volunteer-tareas');
  if(!el) return;
  const {data:comps}=await sb.from('task_completions').select('*, profiles(name)').eq('task_type','vol_pool').not('completed_at','is',null).order('completed_at',{ascending:false});
  const lastDoneMap={};
  (comps||[]).forEach(c=>{ if(!lastDoneMap[c.task_id]) lastDoneMap[c.task_id]={date:c.date,name:(c.profiles?.name||'').split(' ')[0],ts:c.completed_at}; });
  const rows=VOLUNTEER_POOL.map(task=>{
    const d=lastDoneMap[task.id];
    return {task, last:d, sortKey:d?new Date(d.ts).getTime():-1};
  }).sort((a,b)=>a.sortKey-b.sortKey);
  let html='<div class="card" style="padding:0;"><div style="padding:10px 16px 6px;border-bottom:1px solid var(--border);"><div class="card-title" style="margin-bottom:0;">'+t('pool_title')+'</div></div>';
  rows.forEach(r=>{
    const info=r.last?`${t('last_time')} ${fmtDateShort(r.last.date)} · ${r.last.name||'?'}`:t('never');
    html+=`<div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);gap:12px;"><div style="flex:1;"><div style="font-size:14px;font-weight:500;">${taskDisplayName(r.task)}</div><div style="font-size:11px;color:var(--text3);">${info}</div></div><button onclick="completeTask('${r.task.id}','vol_pool')" style="font-size:12px;padding:6px 14px;border-radius:20px;border:1.5px solid var(--green);color:var(--green);background:transparent;font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:500;flex-shrink:0;">${t('done_btn')}</button></div>`;
  });
  html+='</div>';
  el.innerHTML=html;
}

async function renderColaborador() {
  const content=document.getElementById('main-content');
  content.innerHTML=`<div class="tab-bar"><button class="tab active" onclick="colaboradorTab('finca')" id="tab-finca">${currentProfile.role==='coordinador'?'Oficina':'Operativo'}</button><button class="tab" onclick="colaboradorTab('terapias')" id="tab-terapias">Agenda</button><button class="tab" onclick="colaboradorTab('admin')" id="tab-admin">Admin</button></div><div class="tab-content active" id="colaborador-finca"></div><div class="tab-content" id="colaborador-terapias"></div><div class="tab-content" id="colaborador-admin"></div>`;
  await loadColaboradorFinca();
}

function colaboradorTab(tab) {
  ['finca','terapias','admin'].forEach(name=>{
    document.getElementById('tab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('colaborador-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='terapias') loadColaboradorTerapias();
  if(tab==='admin') loadColaboradorAdmin();
}

// COLABORADOR TERAPIAS — Plan de terapias
async function loadColaboradorTerapias() {
  const el = document.getElementById('colaborador-terapias');
  el.innerHTML = '<div class="empty">Cargando…</div>';
  window._terapiasDate = window._terapiasDate || todayStr();
  await renderTerapiasDay(window._terapiasDate);
}

// ── AGENDA: monthly mini-calendar (collapsible) ────────────────
function agendaMonthState() {
  if (!window._agendaMonth) {
    const d = new Date((window._terapiasDate || todayStr()) + 'T12:00:00');
    window._agendaMonth = { y: d.getFullYear(), m: d.getMonth() };
  }
  return window._agendaMonth;
}
function pad2(n){ return String(n).padStart(2,'0'); }
function dateStrYMD(y, m, d){ return `${y}-${pad2(m+1)}-${pad2(d)}`; } // m: 0-11

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const jsDay = first.getDay();              // 0=Dom..6=Sáb
  const lead = jsDay === 0 ? 6 : jsDay - 1;  // Lunes-basiert
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function toggleAgendaCal() {
  window._agendaOpen = !window._agendaOpen;
  agendaMonthState();
  renderAgendaHeader();
}
function agendaPrevMonth() {
  const s = agendaMonthState();
  s.m--; if (s.m < 0) { s.m = 11; s.y--; }
  renderAgendaHeader();
}
function agendaNextMonth() {
  const s = agendaMonthState();
  s.m++; if (s.m > 11) { s.m = 0; s.y++; }
  renderAgendaHeader();
}

// Renders the slim header + (when open) the month grid in #agenda-cal
function renderAgendaHeader() {
  const host = document.getElementById('agenda-cal');
  if (!host) return;
  const dayNames = ['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const selected = window._terapiasDate || todayStr();
  const selDate = new Date(selected + 'T12:00:00');
  const jsDay = selDate.getDay();
  const dow = jsDay === 0 ? 7 : jsDay;
  const open = !!window._agendaOpen;

  // Slim, tappable header
  let html = `
    <div onclick="toggleAgendaCal()" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px;cursor:pointer;background:var(--surface2);border-radius:12px;margin-bottom:${open?'10px':'12px'};">
      <span style="font-size:14px;font-weight:600;">${dayNames[dow]}, ${fmtDateShort(selected)}</span>
      <span style="font-size:12px;color:var(--text3);transition:transform .15s;${open?'transform:rotate(180deg);':''}">▾</span>
    </div>`;

  // Expanded month grid
  if (open) {
    const s = agendaMonthState();
    const cells = buildMonthGrid(s.y, s.m);
    const today = todayStr();
    html += `
      <div style="background:var(--surface2);border-radius:12px;padding:10px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <button onclick="agendaPrevMonth()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text2);">‹</button>
          <div style="font-weight:600;font-size:14px;">${monthNames[s.m]} ${s.y}</div>
          <button onclick="agendaNextMonth()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text2);">›</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;">
          ${['L','M','X','J','V','S','D'].map(d=>`<div style="text-align:center;font-size:10px;font-weight:600;color:var(--text3);padding:2px 0;">${d}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">`;
    cells.forEach(d => {
      if (d === null) { html += `<div></div>`; return; }
      const ds = dateStrYMD(s.y, s.m, d);
      const isToday = ds === today;
      const isSel = ds === selected;
      const bg = isSel ? 'var(--primary)' : isToday ? 'var(--primary-light)' : 'transparent';
      const col = isSel ? '#fff' : isToday ? 'var(--primary-dark)' : 'var(--text2)';
      const wt = (isSel || isToday) ? '600' : '400';
      html += `<div onclick="navigateTerapias('${ds}')" style="text-align:center;font-size:13px;padding:7px 0;border-radius:8px;cursor:pointer;background:${bg};color:${col};font-weight:${wt};font-family:'DM Mono',monospace;">${d}</div>`;
    });
    html += `</div></div>`;
  }
  host.innerHTML = html;
}

async function renderTerapiasDay(dateStr) {
  const el = document.getElementById('colaborador-terapias');
  const date = new Date(dateStr + 'T12:00:00');
  const jsDay = date.getDay(); // 0=Dom
  const dow = jsDay === 0 ? 7 : jsDay; // 1=Lun...7=Dom

  const dayNames = ['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

// Fetch profiles for prep-done-by lookup
  const {data: profilesList} = await sb.from('profiles').select('id, name');
  window.profilesMap = {};
  (profilesList||[]).forEach(p => { window.profilesMap[p.id] = p.name; });

  // Fetch schedule slots for this day_of_week
  const {data: slots} = await sb
    .from('therapy_schedule')
    .select('*, clients(id, name, horse)')
    .eq('day_of_week', dow)
    .eq('is_active', true)
    .order('time_slot', {ascending: true});

  // Fetch existing sessions for this date
  const {data: existing} = await sb
    .from('therapy_sessions')
    .select('*, clients(id, name, horse)')
    .eq('date', dateStr);

  const existingMap = {};
  const extraSessions = [];
  (existing||[]).forEach(s => {
    if(s.schedule_id) existingMap[s.schedule_id] = s;
    else extraSessions.push(s);
  });

  // Generate missing sessions
  if(slots && slots.length > 0){
    const missing = slots.filter(s => !existingMap[s.id]);
    if(missing.length > 0){
      const inserts = missing.map(s => ({
        schedule_id: s.id,
        date: dateStr,
        client_id: s.client_id,
        horse: s.clients?.horse || '—',
        time_slot: s.time_slot,
        session_type: 'regular',
        status: 'pendiente'
      }));
      const {data: inserted} = await sb.from('therapy_sessions').insert(inserts).select();
      (inserted||[]).forEach(s => { existingMap[s.schedule_id] = s; });
    }
  }

  // Navigation
  const prev = new Date(date); prev.setDate(prev.getDate()-1);
  const next = new Date(date); next.setDate(next.getDate()+1);
  const prevStr = prev.toISOString().slice(0,10);
  const nextStr = next.toISOString().slice(0,10);

  let html = `
    <div id="agenda-cal"></div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <button onclick="openExtraSessionModal()" style="background:var(--primary);color:white;border:none;border-radius:20px;padding:5px 14px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;">+ Sesión</button>
<button onclick="openEditPlanModal()" style="background:var(--surface2);color:var(--text2);border:none;border-radius:20px;padding:5px 14px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;">✏️ Editar</button>
    </div>
    <div style="font-size:11px;color:var(--amber);margin-bottom:12px;">⚠ Verificar en la pizarra · ningún caballo más de 3 sesiones hoy</div>`;

  const rowHtml = (session, name, horse, timeSlot) => {
    const status = session.status;
    const statusColor = status==='confirmo'?'var(--green)':status==='cancelo'?'var(--red)':'var(--amber)';
    const statusLabel = status==='confirmo'?'Confirmó':status==='cancelo'?'Canceló':'Pendiente';
    const time = fmtTimeSlot(timeSlot);
    const att = session.attendance || '';
    const attIcon = att==='asistio'?'✓':att==='ausente'?'✗':'○';
    const attColor = att==='asistio'?'var(--green)':att==='ausente'?'var(--red)':'var(--text3)';
    return `
        <div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);gap:12px;">
          <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text2);width:42px;flex-shrink:0;">${time}</div>
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:500;">${name||'—'}</div>
            <div style="font-size:11px;color:var(--text3);">${horse||'—'}${session.session_type!=='regular'?` <span style="font-size:10px;padding:1px 5px;border-radius:8px;background:var(--primary-light);color:var(--primary-dark);">${session.session_type==='primera_vez'?'1ª vez':session.session_type==='reposicion'?'Repos.':'Extra'}</span>`:''}${session.prep_done_by ? ` · 🐴 ${(window.profilesMap||{})[session.prep_done_by]||'?'} · ${fmtTime(session.prep_done_at)}` : ''}</div>
          </div>
          <button onclick="cycleStatus('${session.id}','${status}',this)" style="font-size:11px;padding:4px 10px;border-radius:20px;border:1.5px solid ${statusColor};color:${statusColor};background:transparent;font-family:'DM Sans',sans-serif;cursor:pointer;font-weight:500;">${statusLabel}</button>
<button onclick="cycleAttendance('${session.id}','${att}',this)" title="Asistencia" style="font-size:14px;width:30px;height:30px;line-height:1;border-radius:50%;border:1.5px solid ${attColor};color:${attColor};background:transparent;cursor:pointer;flex-shrink:0;">${attIcon}</button>
          <button onclick="cyclePrep('${session.id}','${session.prep_done_by||''}','${session.prep_done_at||''}',this)" title="${session.prep_done_by?'Preparado — clic para desmarcar':'Marcar como preparado'}" style="font-size:16px;width:30px;height:30px;line-height:1;border-radius:50%;border:1.5px solid ${session.prep_done_by?'var(--green)':'var(--border)'};background:${session.prep_done_by?'var(--green)':'transparent'};cursor:pointer;flex-shrink:0;">🐴</button>
        </div>`;
  };

  // Group all sessions by time block
  function getTerapiasSection(timeStr) {
    if(!timeStr) return 'tarde';
    const t = timeStr.slice(0,5);
    if(t >= '08:30' && t < '12:00') return 'manana';
    if(t >= '12:00' && t < '14:00') return 'mediodia';
    return 'tarde';
  }

  const allSessionItems = [];
  (slots||[]).forEach(slot => {
    const session = existingMap[slot.id];
    if(!session) return;
    allSessionItems.push({session, name: slot.clients?.name, horse: slot.clients?.horse||session.horse, timeSlot: slot.time_slot});
  });
  extraSessions
    .sort((a,b)=>(a.time_slot||'').localeCompare(b.time_slot||''))
    .forEach(session => {
      allSessionItems.push({session, name: session.clients?.name||session.client_name, horse: session.clients?.horse||session.horse, timeSlot: session.time_slot});
    });

  const terapiasSections = {
    manana:   { label: 'Mañana',   range: '8:30 – 11:30 AM', items: [] },
    mediodia: { label: 'Mediodía', range: '12:00 – 1:30 PM',  items: [] },
    tarde:    { label: 'Tarde',    range: '2:00 – 5:30 PM',   items: [] }
  };
  allSessionItems.forEach(s => { terapiasSections[getTerapiasSection(s.timeSlot)].items.push(s); });

  const hasContent = allSessionItems.length > 0;
  if(!hasContent){
    html += '<div class="card"><div class="empty">Sin sesiones planificadas.</div></div>';
  } else {
    ['manana','mediodia','tarde'].forEach(key => {
      const sec = terapiasSections[key];
      if(sec.items.length === 0) return;
      html += `<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin:12px 0 4px;padding:0 2px;">${sec.label} · <span style="font-weight:400;">${sec.range}</span></div>`;
      html += '<div class="card" style="padding:0;">';
      sec.items.forEach(s => { html += rowHtml(s.session, s.name, s.horse, s.timeSlot); });
      html += '</div>';
    });
  }

  el.innerHTML = html;
  window._terapiasDate = dateStr;
  renderAgendaHeader();
}

async function cycleStatus(sessionId, currentStatus, btn) {
  const next = currentStatus==='pendiente'?'confirmo':currentStatus==='confirmo'?'cancelo':'pendiente';
  btn.disabled = true;
  const patch = next==='cancelo' ? {status: next, attendance: 'ausente'} : {status: next};
  const {error} = await sb.from('therapy_sessions').update(patch).eq('id', sessionId);
  if(error){ btn.disabled=false; showToast('Error al actualizar'); return; }
  await renderTerapiasDay(window._terapiasDate);
}

async function cycleAttendance(sessionId, currentAtt, btn) {
  const next = currentAtt==='asistio' ? 'ausente' : currentAtt==='ausente' ? null : 'asistio';
  btn.disabled = true;
  const {data, error} = await sb.from('therapy_sessions').update({attendance: next}).eq('id', sessionId).select();
  if(error){ btn.disabled=false; showToast('Error al actualizar'); console.error(error); return; }
  if(!data || data.length===0){ btn.disabled=false; showToast('⚠ Sin permiso (RLS)'); return; }
  await renderTerapiasDay(window._terapiasDate);
}

async function cyclePrep(sessionId, currentDoneBy, currentDoneAt, btn) {
  btn.disabled = true;
  const clearing = !!currentDoneBy;
  const patch = clearing
    ? { prep_done_by: null, prep_done_at: null }
    : { prep_done_by: currentUser.id, prep_done_at: new Date().toISOString() };
  const {data, error} = await sb.from('therapy_sessions').update(patch).eq('id', sessionId).select();
  if(error){ btn.disabled=false; showToast('Error al actualizar'); console.error(error); return; }
  if(!data || data.length===0){ btn.disabled=false; showToast('⚠ Sin permiso (RLS)'); return; }
  if(window._terapiasDate) await renderTerapiasDay(window._terapiasDate);
  else await renderTerapiasHoy();
}

function navigateTerapias(dateStr) {
  window._terapiasDate = dateStr;
  renderTerapiasDay(dateStr);
}

// EXTRA SESSION
function selectEsTipo(btn) {
  document.querySelectorAll('#extra-session-modal .rec-opt[data-val="reposicion"], #extra-session-modal .rec-opt[data-val="primera_vez"], #extra-session-modal .rec-opt[data-val="extra"]').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
}

function selectEsType(btn) {
  document.querySelectorAll('#extra-session-modal .rec-opt[data-val="list"], #extra-session-modal .rec-opt[data-val="free"]').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  const isList = btn.dataset.val === 'list';
  document.getElementById('es-list-section').style.display = isList ? '' : 'none';
  document.getElementById('es-free-section').style.display = isList ? 'none' : '';
}

async function openExtraSessionModal() {
  const {data: clients} = await sb.from('clients').select('*').eq('is_active', true).order('name');
  const sel = document.getElementById('es-client');
  sel.innerHTML = (clients||[]).map(c =>
    `<option value="${c.id}" data-horse="${c.horse}">${c.name} · ${c.horse}</option>`
  ).join('');
  document.getElementById('es-date').value = window._terapiasDate || todayStr();
  document.getElementById('es-time-wrap').innerHTML = timePickerHTML('es-time', '09:00');
  document.getElementById('es-client-name').value = '';
  fillHorseSelect('es-horse-free');
  document.querySelectorAll('#extra-session-modal .rec-opt[data-val="reposicion"], #extra-session-modal .rec-opt[data-val="primera_vez"], #extra-session-modal .rec-opt[data-val="extra"]').forEach(b=>b.classList.remove('selected'));
  document.querySelector('#extra-session-modal .rec-opt[data-val="reposicion"]').classList.add('selected');
  document.querySelectorAll('#extra-session-modal .rec-opt[data-val="list"], #extra-session-modal .rec-opt[data-val="free"]').forEach(b=>b.classList.remove('selected'));
  document.querySelector('#extra-session-modal .rec-opt[data-val="list"]').classList.add('selected');
  document.getElementById('es-list-section').style.display='';
  document.getElementById('es-free-section').style.display='none';
  document.getElementById('extra-session-modal').style.display='flex';
}

function closeExtraSessionModal() {
  document.getElementById('extra-session-modal').style.display='none';
}

// ADMIN — Gestión de clientes
async function renderClientes() {
  const el = document.getElementById('admin-clientes');
  const {data: clients, error} = await sb.from('clients').select('*').order('name', {ascending:true});
  if(error){ el.innerHTML='<div class="card"><div class="empty">Error al cargar.</div></div>'; console.error(error); return; }
  window._clientsCache = clients || [];

  let html = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <button onclick="openClientModal()" style="background:var(--primary);color:white;border:none;border-radius:20px;padding:5px 14px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;">+ Cliente</button>
    </div>
    <div class="card" style="padding:0;">`;

  if(!clients || clients.length===0){
    html += '<div class="empty" style="padding:16px;">Sin clientes.</div>';
  } else {
    clients.forEach(c => {
      const inactive = !c.is_active;
      const safeName = (c.name||'').replace(/'/g,"\\'");
      html += `
        <div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);gap:8px;${inactive?'opacity:0.45;':''}">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:500;">${c.name||'—'}${inactive?' <span style="font-size:10px;color:var(--text3);">(inactivo)</span>':''}</div>
            <div style="font-size:11px;color:var(--text3);">${c.horse||'—'}</div>
          </div>
          <button onclick="openClientModal('${c.id}')" title="Editar" style="background:none;border:none;font-size:15px;cursor:pointer;">✏️</button>
          <button onclick="toggleClientActive('${c.id}',${c.is_active})" title="${inactive?'Activar':'Desactivar'}" style="background:none;border:none;font-size:15px;cursor:pointer;">${inactive?'✅':'🚫'}</button>
          <button onclick="deleteClientHard('${c.id}','${safeName}')" title="Eliminar" style="background:none;border:none;font-size:15px;cursor:pointer;">🗑</button>
        </div>`;
    });
  }
  html += '</div>';
  el.innerHTML = html;
}

async function openClientModal(id) {
  document.getElementById('cm-id').value = id || '';
  const c = id ? (window._clientsCache||[]).find(x=>x.id===id) : null;
  document.getElementById('cm-title').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('cm-name').value = c ? (c.name||'') : '';
  fillHorseSelect('cm-horse', c ? (c.horse||'') : '');
  let priv = {};
  if(id){ const {data} = await sb.from('client_private').select('*').eq('client_id', id).maybeSingle(); priv = data || {}; }
  document.getElementById('cm-diagnosis').value = priv.diagnosis || '';
  document.getElementById('cm-notes').value     = priv.notes || '';
  document.getElementById('cm-tutor').value     = priv.tutor_name || '';
  document.getElementById('cm-phone').value     = priv.phone || '';
  document.getElementById('cm-email').value     = priv.email || '';
  document.getElementById('cm-address').value   = priv.address || '';
  await loadClientHistory(id);
  document.getElementById('client-modal').style.display='flex';
}

function closeClientModal() {
  document.getElementById('client-modal').style.display='none';
}

async function saveClient() {
  const id = document.getElementById('cm-id').value;
  const name = document.getElementById('cm-name').value.trim();
  const horse = document.getElementById('cm-horse').value;
  if(!name){ showToast('⚠ Escribe el nombre'); return; }

  let error, data;
  if(id){
    ({data, error} = await sb.from('clients').update({name, horse}).eq('id', id).select());
  } else {
    ({data, error} = await sb.from('clients').insert({name, horse, is_active:true}).select());
  }
  if(error){ showToast('Error al guardar'); console.error(error); return; }
  if(!data || data.length===0){ showToast('⚠ Sin permiso (RLS)'); return; }
  const cid = id || data[0].id;
  const priv = { client_id: cid,
    diagnosis:  document.getElementById('cm-diagnosis').value.trim() || null,
    notes:      document.getElementById('cm-notes').value.trim() || null,
    tutor_name: document.getElementById('cm-tutor').value.trim() || null,
    phone:      document.getElementById('cm-phone').value.trim() || null,
    email:      document.getElementById('cm-email').value.trim() || null,
    address:    document.getElementById('cm-address').value.trim() || null,
    updated_at: new Date().toISOString() };
  const {error: perr} = await sb.from('client_private').upsert(priv, {onConflict:'client_id'});
  if(perr) console.error(perr);
  showToast('✓ Guardado');
  closeClientModal();
  await renderClientes();
}

async function toggleClientActive(id, current) {
  const {error} = await sb.from('clients').update({is_active: !current}).eq('id', id);
  if(error){ showToast('Error'); console.error(error); return; }
  await renderClientes();
}

let _pendingDeleteId = null, _pendingDeleteName = null;
// Generalized delete-PIN mechanism: stores the action to run after correct PIN.
let _pendingDeleteAction = null;

function deleteClientHard(id, name) {
  askDeletePin(`Eliminar "${name}"`, async () => {
    const {error} = await sb.from('clients').delete().eq('id', id);
    if(error){
      console.error(error);
      if(error.code === '23503'){
        showToast('⚠ Cliente vinculado a terapias — desactívalo en su lugar');
      } else {
        showToast('Error al eliminar');
      }
      return;
    }
    showToast('✓ Eliminado');
    await renderClientes();
  });
}

function closeDeletePinModal() {
  document.getElementById('delete-pin-modal').style.display = 'none';
  _pendingDeleteId = null;
  _pendingDeleteName = null;
  _pendingDeleteAction = null;
}

async function confirmDeletePin() {
  const pin = document.getElementById('delete-pin-input').value;
  if(pin !== DELETE_PIN) {
    document.getElementById('delete-pin-error').style.display = 'block';
    return;
  }
  const action = _pendingDeleteAction;
  closeDeletePinModal();
  if(typeof action === 'function') await action();
}

// Opens the PIN modal and remembers which delete action to run on success.
// title: text shown in the modal header. action: async function performing the delete.
function askDeletePin(title, action) {
  _pendingDeleteAction = action;
  document.getElementById('delete-pin-title').textContent = title;
  document.getElementById('delete-pin-input').value = '';
  document.getElementById('delete-pin-error').style.display = 'none';
  document.getElementById('delete-pin-modal').style.display = 'flex';
}

async function saveExtraSession() {
  const date = document.getElementById('es-date').value;
  const time = getTimeValue('es-time');
  const tipo = document.querySelector('#extra-session-modal .rec-opt[data-val="reposicion"].selected, #extra-session-modal .rec-opt[data-val="primera_vez"].selected, #extra-session-modal .rec-opt[data-val="extra"].selected')?.dataset.val || 'extra';
  const isList = document.querySelector('#extra-session-modal .rec-opt[data-val="list"]')?.classList.contains('selected');

  if(!date || !time){ showToast('⚠ Completa fecha y hora'); return; }

  let insert = {
    date,
    time_slot: time,
    session_type: tipo,
    status: 'pendiente',
    schedule_id: null
  };

  if(isList) {
    const sel = document.getElementById('es-client');
    const opt = sel.options[sel.selectedIndex];
    insert.client_id = sel.value;
    insert.horse = opt?.dataset.horse || '—';
  } else {
    const name = document.getElementById('es-client-name').value.trim();
    if(!name){ showToast('⚠ Escribe el nombre'); return; }
    insert.client_name = name;
    insert.horse = document.getElementById('es-horse-free').value;
  }

  const {error} = await sb.from('therapy_sessions').insert(insert);
  if(error){ showToast('Error al guardar'); console.error(error); return; }
  showToast('✓ Sesión guardada');
  closeExtraSessionModal();
  await renderTerapiasDay(window._terapiasDate || todayStr());
}

async function openEditPlanModal() {
  document.getElementById('edit-plan-modal').style.display='flex';
  await loadEditPlanContent();
}

function closeEditPlanModal() {
  document.getElementById('edit-plan-modal').style.display='none';
}

async function loadEditPlanContent() {
  const el = document.getElementById('edit-plan-content');
  el.innerHTML = '<div class="empty">Cargando…</div>';

  const {data: slots} = await sb
    .from('therapy_schedule')
    .select('*, clients(id, name, horse)')
    .eq('is_active', true)
    .order('day_of_week', {ascending: true})
    .order('time_slot', {ascending: true});

  const {data: clients} = await sb
    .from('clients')
    .select('*')
    .eq('is_active', true)
    .order('name', {ascending: true});

  const dayNames = ['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

  // Group slots by day
  const byDay = {};
  (slots||[]).forEach(s => {
    if(!byDay[s.day_of_week]) byDay[s.day_of_week] = [];
    byDay[s.day_of_week].push(s);
  });

  let html = '';

  // Existing slots by day
  [1,2,3,4,5,6,7].forEach(dow => {
    const daySlots = byDay[dow] || [];
    if(daySlots.length === 0) return;
    html += `<div style="margin-bottom:12px;"><div class="card-title">${dayNames[dow]}</div>`;
    daySlots.forEach(slot => {
      const time = fmtTimeSlot(slot.time_slot);
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;font-weight:500;">${time} · ${slot.clients?.name||'—'}</div>
          <div style="font-size:11px;color:var(--text3);">${slot.clients?.horse||'—'}</div>
        </div>
        <button onclick="deactivateSlot('${slot.id}', '${time} · ${(slot.clients?.name||'—').replace(/'/g,"\\'")}')" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--red-light);color:var(--red);cursor:pointer;">✕</button>
      </div>`;
    });
    html += '</div>';
  });

  // Add new slot form
  const clientOptions = (clients||[]).map(c =>
    `<option value="${c.id}" data-horse="${c.horse}">${c.name} · ${c.horse}</option>`
  ).join('');

  html += `<div style="border-top:2px solid var(--border);padding-top:12px;margin-top:4px;">
    <div class="card-title">Agregar slot</div>
    <div class="form-row" style="margin-bottom:8px;">
      <div class="field-label">Día</div>
      <select class="form-input" id="ep-day">
        ${[1,2,3,4,5,6,7].map(d=>`<option value="${d}">${dayNames[d]}</option>`).join('')}
      </select>
    </div>
    <div class="form-row" style="margin-bottom:8px;">
      <div class="field-label">Hora</div>
      <span id="ep-time-wrap"></span>
    </div>
    <div class="form-row" style="margin-bottom:12px;">
      <div class="field-label">Cliente</div>
      <select class="form-input" id="ep-client">${clientOptions}</select>
    </div>
    <button class="btn-primary" onclick="saveNewSlot()">Agregar →</button>
  </div>`;

  el.innerHTML = html;
  document.getElementById('ep-time-wrap').innerHTML = timePickerHTML('ep-time', '09:00');
}

async function deactivateSlot(slotId, label) {
  askDeletePin(label ? `Eliminar slot · ${label}` : 'Eliminar slot', async () => {
    const {error} = await sb.from('therapy_schedule').update({is_active: false}).eq('id', slotId);
    if(error){ showToast('Error al eliminar'); return; }
    showToast('✓ Slot eliminado');
    await loadEditPlanContent();
  });
}

async function saveNewSlot() {
  const dow = parseInt(document.getElementById('ep-day').value);
  const time = getTimeValue('ep-time');
  const clientSel = document.getElementById('ep-client');
  const clientId = clientSel.value;
  const horse = clientSel.options[clientSel.selectedIndex]?.dataset.horse || '—';

  if(!time || !clientId){ showToast('⚠ Completa todos los campos'); return; }

  const {error} = await sb.from('therapy_schedule').insert({
    client_id: clientId,
    day_of_week: dow,
    time_slot: time,
    is_active: true
  });

  if(error){ showToast('Error al guardar'); console.error(error); return; }
  showToast('✓ Slot agregado');
  await loadEditPlanContent();
}

// COLABORADOR FINCA — Diario + Semanal
async function loadColaboradorFinca() {
  if(currentProfile.role==='coordinador'){ await loadCoordinadoraOficina(); return; }
  document.getElementById('colaborador-finca').innerHTML=`
    <div class="tab-bar" style="margin:0 0 8px 0;">
      <button class="tab active" onclick="operativoTab('voluntarios')" id="otab-voluntarios">Voluntarios</button>
      <button class="tab" onclick="operativoTab('finca')" id="otab-finca">Finca</button>
      <button class="tab" onclick="operativoTab('oficina')" id="otab-oficina">Oficina</button>
      <button class="tab" onclick="operativoTab('ejecutivo')" id="otab-ejecutivo">Ejecutivo</button>
    </div>
    <div class="tab-content active" id="operativo-voluntarios"></div>
    <div class="tab-content" id="operativo-finca">
      <div class="tab-bar" style="margin:0 0 8px 0;">
        <button class="tab active" onclick="fincaTab('diario')" id="ftab-diario">Diario</button>
        <button class="tab" onclick="fincaTab('semanal')" id="ftab-semanal">Semanal</button>
      </div>
      <div class="tab-content active" id="finca-diario"></div>
      <div class="tab-content" id="finca-semanal"></div>
    </div>
    <div class="tab-content" id="operativo-oficina">
      <div class="tab-bar" style="margin:0 0 8px 0;">
        <button class="tab active" onclick="oficinaColTab('diario')" id="octab-diario">Diario</button>
        <button class="tab" onclick="oficinaColTab('semanal')" id="octab-semanal">Semanal</button>
      </div>
      <div class="tab-content active" id="oficina-col-diario"></div>
      <div class="tab-content" id="oficina-col-semanal"></div>
    </div>
    <div class="tab-content" id="operativo-ejecutivo">
      <div class="card"><div class="empty">Ejecutivo · próximamente</div></div>
    </div>`;
  await loadColaboradorDiario();
  await loadColaboradorVoluntarios();
}

// Colaborador view of the volunteer pool — read-only overview, oldest/never-done first.
// Reuses VOLUNTEER_POOL and vol_pool completions; no action button (view only).
async function loadColaboradorVoluntarios() {
  const el=document.getElementById('operativo-voluntarios');
  if(!el) return;
  const {data:comps}=await sb.from('task_completions').select('*, profiles(name)').eq('task_type','vol_pool').not('completed_at','is',null).order('completed_at',{ascending:false});
  const lastDoneMap={};
  (comps||[]).forEach(c=>{ if(!lastDoneMap[c.task_id]) lastDoneMap[c.task_id]={date:c.date,name:(c.profiles?.name||'').split(' ')[0],ts:c.completed_at}; });
  const rows=VOLUNTEER_POOL.map(task=>{
    const d=lastDoneMap[task.id];
    return {task, last:d, sortKey:d?new Date(d.ts).getTime():-1};
  }).sort((a,b)=>a.sortKey-b.sortKey);
  let html='<div class="card" style="padding:0;"><div style="padding:10px 16px 6px;border-bottom:1px solid var(--border);"><div class="card-title" style="margin-bottom:0;">Tareas de voluntarios</div></div>';
  rows.forEach(r=>{
    const info=r.last?`Última vez: ${fmtDateShort(r.last.date)} · ${r.last.name||'?'}`:'Nunca';
    html+=`<div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);gap:12px;"><div style="flex:1;"><div style="font-size:14px;font-weight:500;">${taskDisplayName(r.task)}</div><div style="font-size:11px;color:var(--text3);">${info}</div></div></div>`;
  });
  html+='</div>';
  el.innerHTML=html||'<div class="card"><div class="empty">—</div></div>';
}
function operativoTab(tab) {
  ['voluntarios','finca','oficina','ejecutivo'].forEach(name=>{
    document.getElementById('otab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('operativo-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='oficina') loadColaboradorDiarioOficina();
  if(tab==='voluntarios') loadColaboradorVoluntarios();
}

// Colaborador oficina sub-tabs (Diario | Semanal)
function oficinaColTab(tab) {
  ['diario','semanal'].forEach(name=>{
    document.getElementById('octab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('oficina-col-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='diario') loadColaboradorDiarioOficina();
  if(tab==='semanal') renderColaboradorSemanalOficina();
}
function fincaTab(tab) {
  ['diario','semanal'].forEach(name=>{
    document.getElementById('ftab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('finca-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='semanal') renderColaboradorSemanal();
}

// COORDINADORA OFICINA — Diario (fichaje sin merienda, meta 7,5h) · Semanal · Balance
async function loadCoordinadoraOficina() {
  document.getElementById('colaborador-finca').innerHTML=`
    <div class="tab-bar" style="margin:0 0 8px 0;">
      <button class="tab active" onclick="oficinaTab('diario')" id="otab-diario">Diario</button>
      <button class="tab" onclick="oficinaTab('semanal')" id="otab-semanal">Semanal</button>
      <button class="tab" onclick="oficinaTab('balance')" id="otab-balance">Balance</button>
    </div>
    <div class="tab-content active" id="oficina-diario">
      <div class="card">
        <div class="clock-display" id="main-clock">--:--</div>
        <div class="clock-date" id="main-date"></div>
        <div class="gps-banner" id="gps-banner"></div>
        <div class="session-info" id="session-info"></div>
        <div id="punch-buttons"></div>
      </div>
      <div class="metric-grid" id="coord-metrics" style="margin-bottom:12px;"></div>
      <div class="card" id="oficina-plan-card" style="margin-bottom:12px;"></div>
      <div class="card" id="history-card"></div>
    </div>
    <div class="tab-content" id="oficina-semanal"><div id="oficina-wplan"></div></div>
    <div class="tab-content" id="oficina-balance"></div>`;
  document.getElementById('main-date').textContent=fmtDate(new Date());
  startClock('main-clock');
  await refreshCoordinadoraState();
}
function oficinaTab(tab) {
  ['diario','semanal','balance'].forEach(name=>{
    document.getElementById('otab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('oficina-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='diario'){ document.getElementById('main-date').textContent=fmtDate(new Date()); startClock('main-clock'); refreshCoordinadoraState(); }
  if(tab==='balance') renderCoordinadoraBalance();
  if(tab==='semanal') renderWeekPlanView('oficina-wplan', currentUser.id, false, 'oficina');
}
async function renderCoordinadoraBalance() {
  const el=document.getElementById('oficina-balance');
  if(!el) return;
  el.innerHTML='<div class="empty">Cargando…</div>';
  const {data:allEntries}=await sb.from('time_entries').select('*').eq('user_id',currentUser.id);
  const {data:approved}=await sb.from('compensation_requests').select('*').eq('user_id',currentUser.id).eq('status','approved');
  const compEl=document.createElement('div');
  const {data:_ovr}=await sb.from('attendance_overrides').select('*').eq('user_id',currentUser.id);
  await renderWorkerCompensation(currentUser.id, currentProfile, allEntries||[], approved||[], compEl, _ovr||[]);
  el.innerHTML=''; el.appendChild(compEl);
}
async function refreshCoordinadoraState() {
  const today=new Date(); today.setHours(0,0,0,0);
  const {data:entries}=await sb.from('time_entries').select('*').eq('user_id',currentUser.id).gte('clock_in',today.toISOString()).order('clock_in',{ascending:true});
  activeEntry=entries?.find(e=>!e.clock_out)||null;
  let workedMins=0;
  entries?.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') workedMins+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
  if(activeEntry?.entry_type==='work') workedMins+=Math.floor((new Date()-new Date(activeEntry.clock_in))/60000);
  const balanceMins=workedMins-(targetMinsFor(currentProfile)??450);
  const sessionEl=document.getElementById('session-info');
  if(sessionEl){ sessionEl.textContent=activeEntry?t('session_active')+' '+fmtTime(activeEntry.clock_in):t('session_none'); }
  const btns=document.getElementById('punch-buttons');
  if(btns){ btns.innerHTML=activeEntry?`<button class="punch-btn out" onclick="punchOut()">${t('clock_out')}</button>`:`<button class="punch-btn in" onclick="punchInGps('work')">${t('clock_in')}</button>`; }
  const mEl=document.getElementById('coord-metrics');
  if(mEl){ mEl.innerHTML=`<div class="metric"><div class="metric-label">${t('today')}</div><div class="metric-val neutral">${fmtDuration(workedMins)}</div></div><div class="metric"><div class="metric-label">Saldo</div><div class="metric-val ${balanceMins>0?'positive':balanceMins<0?'negative':'neutral'}">${balanceMins>=0?'+':'−'}${fmtDuration(Math.abs(balanceMins))}</div></div>`; }
  const histEl=document.getElementById('history-card');
  if(histEl){
    let histHTML=`<div class="card-title">${t('history')}</div>`;
    if(!entries||entries.length===0){ histHTML+=`<div class="empty">—</div>`; }
    else { entries.forEach(e=>{ histHTML+=`<div class="log-row"><span class="log-type">${t('entry_work_in')}</span><span class="log-time">${fmtTime(e.clock_in)}</span></div>`; if(e.clock_out) histHTML+=`<div class="log-row"><span class="log-type">${t('entry_work_out')}</span><span class="log-time">${fmtTime(e.clock_out)}</span></div>`; }); }
    histEl.innerHTML=histHTML;
  }
  await renderOficinaDailyPlan();
}

// COLABORADOR TEAM
async function loadColaboradorTeam() {
  const today=new Date(); today.setHours(0,0,0,0);
  const [{data:people},{data:allEntries}] = await Promise.all([
    sb.from('profiles').select('*').eq('active',true).in('role',['pesticero','coordinador','volunteer']),
    sb.from('time_entries').select('*').gte('clock_in',today.toISOString()),
  ]);
  const entriesByUser={};
  (allEntries||[]).forEach(e=>{ (entriesByUser[e.user_id]=entriesByUser[e.user_id]||[]).push(e); });
  const groups=[
    {role:'pesticero',   label:'Pesticeros',   av:'av-brown'},
    {role:'coordinador', label:'Coordinador', av:'av-primary'},
    {role:'volunteer',   label:'Voluntarios',  av:'av-primary'},
  ];
  let html='';
  groups.forEach(g=>{
    const members=(people||[]).filter(p=>p.role===g.role);
    if(members.length===0) return;
    let rows='';
    members.forEach(p=>{
      const entries=entriesByUser[p.id]||[];
      const active=entries.find(e=>!e.clock_out);
      let workedMins=0;
      entries.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') workedMins+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
      if(active?.entry_type==='work') workedMins+=Math.floor((new Date()-new Date(active.clock_in))/60000);
      const initials=p.name.split(' ').slice(0,2).map(w=>w[0]).join('');
      const personTarget=targetMinsFor(p);
      const overtime=personTarget==null?null:workedMins-personTarget;
      const badge=active?`<span class="badge badge-green">${t('on_shift')}</span>`:`<span class="badge" style="background:var(--surface2);color:var(--text3);">${t('off')}</span>`;
      const right=(overtime!=null&&overtime>0)?'<span class="badge badge-primary">+'+fmtDuration(overtime)+'</span>':badge;
      const safeName=p.name.split(' ').slice(0,2).join(' ').replace(/'/g,"\\'");
      rows+='<div class="team-row" onclick="openHistoryModal(\''+p.id+'\',\''+safeName+'\')">'
        +'<div class="status-dot '+(active?'dot-green':'dot-gray')+'"></div>'
        +'<div class="avatar '+g.av+'">'+initials+'</div>'
        +'<div class="team-info"><div class="team-name">'+p.name.split(' ').slice(0,2).join(' ')+'</div><div class="team-sub">'+(active?(active.entry_type==='merienda'?'🍽 Merienda':fmtTime(active.clock_in)+' →'):'— · Ver historial →')+'</div></div>'
        +'<div class="team-right"><div class="team-hours">'+fmtDuration(workedMins)+'</div>'+right+'</div></div>';
    });
    html+=`<div class="card"><div class="card-title">${g.label}</div>${rows}</div>`;
  });
  document.getElementById('admin-equipo-team').innerHTML=(html||'<div class="card"><div class="empty">—</div></div>')+`<div style="text-align:center;font-size:12px;color:var(--text3);margin-top:-4px;">${t('touch_worker')}</div>`;
}


// HISTORY MODAL (unchanged)
async function openHistoryModal(userId, name) {
  document.getElementById('history-modal-title').textContent=name;
  document.getElementById('history-modal-content').innerHTML='<div class="empty">'+t('loading')+'</div>';
  document.getElementById('history-modal').style.display='flex';
  let html=`<div style="display:flex;gap:6px;margin-bottom:12px;">
    <button id="htab-time" onclick="showHistoryTab('time','${userId}')" style="flex:1;padding:8px;border-radius:var(--radius-sm);border:none;background:var(--primary);color:white;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;">⏱ Tiempo</button>
    <button id="htab-comp" onclick="showHistoryTab('comp','${userId}')" style="flex:1;padding:8px;border-radius:var(--radius-sm);border:none;background:var(--surface2);color:var(--text2);font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;">💰 Balance</button>
  </div>
  <div id="htab-time-content"></div>
  <div id="htab-comp-content" style="display:none;"></div>`;
  document.getElementById('history-modal-content').innerHTML=html;
  await showHistoryTab('time', userId);
}

async function showHistoryTab(tab, userId) {
  document.getElementById('htab-time').style.background=tab==='time'?'var(--primary)':'var(--surface2)';
  document.getElementById('htab-time').style.color=tab==='time'?'white':'var(--text2)';
  document.getElementById('htab-comp').style.background=tab==='comp'?'var(--primary)':'var(--surface2)';
  document.getElementById('htab-comp').style.color=tab==='comp'?'white':'var(--text2)';
  document.getElementById('htab-time-content').style.display=tab==='time'?'block':'none';
  document.getElementById('htab-comp-content').style.display=tab==='comp'?'block':'none';
  if(tab==='time'&&document.getElementById('htab-time-content').innerHTML===''){
    const since=new Date(); since.setDate(since.getDate()-30); since.setHours(0,0,0,0);
    const {data:entries}=await sb.from('time_entries').select('*').eq('user_id',userId).gte('clock_in',since.toISOString()).order('clock_in',{ascending:false});
    if(!entries||entries.length===0){ document.getElementById('htab-time-content').innerHTML='<div class="empty">'+t('no_records')+'</div>'; return; }
    const byDay={};
    entries.forEach(e=>{ const day=e.clock_in.slice(0,10); if(!byDay[day]) byDay[day]=[]; byDay[day].push(e); });
    let html='';
    Object.keys(byDay).sort().reverse().forEach(day=>{
      const dayEntries=byDay[day]; let dayWorked=0;
      dayEntries.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') dayWorked+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
      dayWorked+=meriendaCreditMins(dayEntries);
      html+=`<div class="history-day"><div class="history-day-label">${fmtDateShort(day)}</div>`;
      dayEntries.forEach(e=>{
        const typeIn=e.entry_type==='merienda'?'☕ Merienda inicio':'▶ Entrada';
        const typeOut=e.entry_type==='merienda'?'☕ Merienda fin':'⏹ Salida';
        html+=`<div class="history-entry"><span class="history-type">${typeIn}</span><span class="history-time">${fmtTime(e.clock_in)}</span></div>`;
        if(e.clock_out) html+=`<div class="history-entry"><span class="history-type">${typeOut}</span><span class="history-time">${fmtTime(e.clock_out)}</span></div>`;
      });
      html+=`<div class="history-total">${fmtDuration(dayWorked)} ${t('worked')}</div></div>`;
    });
    document.getElementById('htab-time-content').innerHTML=html;
  }
  if(tab==='comp'&&document.getElementById('htab-comp-content').innerHTML===''){
    const {data:allEntries}=await sb.from('time_entries').select('*').eq('user_id',userId);
    const {data:approved}=await sb.from('compensation_requests').select('*').eq('user_id',userId).eq('status','approved');
    const {data:profile}=await sb.from('profiles').select('*').eq('id',userId).single();
    const div=document.getElementById('htab-comp-content');
    await renderWorkerCompensation(userId, profile, allEntries||[], approved||[], div);
  }
}

function closeHistoryModal() { document.getElementById('history-modal').style.display='none'; }

// COLABORADOR DIARIO — only daily tasks (no weekly/biweekly/monthly pool)
async function loadColaboradorDiario() {
  const today=todayStr();
  const {data:pesticeros}=await sb.from('profiles').select('*').eq('active',true).eq('role','pesticero');
  const fincaCanEdit = currentProfile.role!=='coordinador';
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span class="card-title" style="margin-bottom:0;">${t('daily_plan')}</span>${fincaCanEdit?`<button onclick="openExtraModal()" style="background:var(--primary);color:white;border:none;border-radius:20px;padding:5px 14px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;">+ Tarea extra</button>`:''}</div>`;
  for(const p of (pesticeros||[])){
    const tasks=DAILY_BY_USER[p.id]||[];
    const {data:completions}=await sb.from('task_completions').select('*').eq('user_id',p.id).eq('date',today).eq('task_type','daily');
    const doneMap={}; (completions||[]).forEach(c=>{doneMap[c.task_id]=c.completed_at;});
    const extras=await loadExtraTasks(p.id,today);
    const {data:extraComp}=await sb.from('task_completions').select('*').eq('user_id',p.id).eq('date',today).eq('task_type','extra');
    const extraDoneMap={}; (extraComp||[]).forEach(c=>{extraDoneMap[c.task_id]=c.completed_at;});
    const now=new Date();
    const firstName=p.name.split(' ').slice(0,2).join(' ');
    const doneCount=Object.values(doneMap).filter(v=>v).length+Object.values(extraDoneMap).filter(v=>v).length;
    const totalCount=tasks.length+extras.length;
    html+=`<div class="card"><div class="card-title">${firstName} · ${doneCount}/${totalCount} ${t('completed_at')}</div>`;
    tasks.forEach(task=>{ const isDone=!!doneMap[task.id]; const [sh,sm]=task.time.split(':').map(Number); const targetEnd=new Date(); targetEnd.setHours(sh,sm,0,0); targetEnd.setMinutes(targetEnd.getMinutes()+task.dur); const isLate=!isDone&&now>targetEnd; let istHtml=''; if(isDone){ const doneDate=new Date(doneMap[task.id]); const lateMins=Math.round((doneDate-targetEnd)/60000); istHtml=lateMins>2?`<div class="colaborador-task-actual" style="color:var(--red);">${fmtTime(doneMap[task.id])} +${lateMins}m</div>`:`<div class="colaborador-task-actual" style="color:var(--green);">${fmtTime(doneMap[task.id])} ✓</div>`; } else if(isLate){ istHtml=`<span class="badge badge-red">⚠ ${t('pending_badge')}</span>`; } else { istHtml=`<span style="font-size:11px;color:var(--text3);">—</span>`; } html+=`<div class="colaborador-task-item"><div class="colaborador-task-left"><div class="colaborador-task-name" style="${isDone?'color:var(--text3);text-decoration:line-through;':isLate?'color:var(--red);':''}">${task.name}</div><div class="colaborador-task-target">${fmtTimeSlot(task.time)} · ${task.dur}min</div></div><div class="colaborador-task-right">${istHtml}</div></div>`; });
    extras.forEach(task=>{ const isDone=!!extraDoneMap[task.id]; const recLabel=task.recurrence==='once'?t('rec_once'):task.recurrence==='daily'?t('rec_daily'):task.recurrence==='weekly'?t('rec_weekly'):t('rec_monfri'); const istHtml=isDone?`<div class="colaborador-task-actual" style="color:var(--green);">${fmtTime(extraDoneMap[task.id])} ✓</div>`:`<span style="font-size:11px;color:var(--text3);">—</span>`; html+=`<div class="colaborador-task-item"><div class="colaborador-task-left"><div class="colaborador-task-name" style="${isDone?'color:var(--text3);text-decoration:line-through;':''}">${task.name} <span class="extra-badge">${recLabel}</span></div><div class="colaborador-task-target">${task.duration_mins?task.duration_mins+'min':'—'}${task.note?' · '+task.note:''}</div></div><div class="colaborador-task-right">${istHtml}</div></div>`; });
    html+='</div>';
  }
  document.getElementById('finca-diario').innerHTML=html||'<div class="card"><div class="empty">—</div></div>';
}

// Colaborador oficina daily view — mirrors loadColaboradorDiario but reads oficina scope
// and lists coordinadores instead of pesticeros. No extra-task button (kept simple).
async function loadColaboradorDiarioOficina() {
  const el=document.getElementById('oficina-col-diario');
  if(!el) return;
  const today=todayStr();
  const {data:coordinadores}=await sb.from('profiles').select('*').eq('active',true).eq('role','coordinador');
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span class="card-title" style="margin-bottom:0;">${t('daily_plan')}</span></div>`;
  for(const p of (coordinadores||[])){
    const tasks=DAILY_BY_USER_OFICINA[p.id]||[];
    const {data:completions}=await sb.from('task_completions').select('*').eq('user_id',p.id).eq('date',today).eq('task_type','daily');
    const doneMap={}; (completions||[]).forEach(c=>{doneMap[c.task_id]=c.completed_at;});
    const now=new Date();
    const firstName=p.name.split(' ').slice(0,2).join(' ');
    const doneCount=Object.values(doneMap).filter(v=>v).length;
    const totalCount=tasks.length;
    html+=`<div class="card"><div class="card-title">${firstName} · ${doneCount}/${totalCount} ${t('completed_at')}</div>`;
    if(tasks.length===0){ html+=`<div class="empty" style="padding:1rem 0;">—</div>`; }
    tasks.forEach(task=>{ const isDone=!!doneMap[task.id]; const [sh,sm]=task.time.split(':').map(Number); const targetEnd=new Date(); targetEnd.setHours(sh,sm,0,0); targetEnd.setMinutes(targetEnd.getMinutes()+task.dur); const isLate=!isDone&&now>targetEnd; let istHtml=''; if(isDone){ const doneDate=new Date(doneMap[task.id]); const lateMins=Math.round((doneDate-targetEnd)/60000); istHtml=lateMins>2?`<div class="colaborador-task-actual" style="color:var(--red);">${fmtTime(doneMap[task.id])} +${lateMins}m</div>`:`<div class="colaborador-task-actual" style="color:var(--green);">${fmtTime(doneMap[task.id])} ✓</div>`; } else if(isLate){ istHtml=`<span class="badge badge-red">⚠ ${t('pending_badge')}</span>`; } else { istHtml=`<span style="font-size:11px;color:var(--text3);">—</span>`; } html+=`<div class="colaborador-task-item"><div class="colaborador-task-left"><div class="colaborador-task-name" style="${isDone?'color:var(--text3);text-decoration:line-through;':isLate?'color:var(--red);':''}">${task.name}</div><div class="colaborador-task-target">${fmtTimeSlot(task.time)} · ${task.dur}min</div></div><div class="colaborador-task-right">${istHtml}</div></div>`; });
    html+='</div>';
  }
  el.innerHTML=html||'<div class="card"><div class="empty">—</div></div>';
}

// COLABORADOR SEMANAL — Weekly plan + weekly/biweekly/monthly pools
async function renderColaboradorSemanal() {
  const el=document.getElementById('finca-semanal');
  if(!el) return;
  const {data:pesticeros}=await sb.from('profiles').select('*').eq('active',true).eq('role','pesticero');
  const pesticerosList=pesticeros||[];

  // Weekly/Biweekly/Monthly pools
  const today=todayStr(); const weekStart=getWeekStart();
  const now2=new Date(); const dom2=now2.getDate();
  const periodStart=new Date(now2.getFullYear(),now2.getMonth(),(dom2<=15?1:16));
  const periodStartStr=periodStart.toISOString().slice(0,10);
  const monthStart2=new Date(now2.getFullYear(),now2.getMonth(),1).toISOString().slice(0,10);

  const [{data:weeklyComp},{data:biweeklyComp},{data:monthlyComp}] = await Promise.all([
    sb.from('task_completions').select('*, profiles(name)').gte('date',weekStart).eq('task_type','weekly'),
    sb.from('task_completions').select('*, profiles(name)').gte('date',periodStartStr).eq('task_type','biweekly'),
    sb.from('task_completions').select('*, profiles(name)').gte('date',monthStart2).eq('task_type','monthly'),
  ]);

  const weeklyCountMap={}; const weeklyDoneByMap={};
  (weeklyComp||[]).forEach(c=>{ if(c.completed_at){ weeklyCountMap[c.task_id]=(weeklyCountMap[c.task_id]||0)+1; if(!weeklyDoneByMap[c.task_id]) weeklyDoneByMap[c.task_id]=[]; weeklyDoneByMap[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });
  const biweeklyDoneByMap2={};
  (biweeklyComp||[]).forEach(c=>{ if(c.completed_at){ if(!biweeklyDoneByMap2[c.task_id]) biweeklyDoneByMap2[c.task_id]=[]; biweeklyDoneByMap2[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });
  const monthlyDoneByMap={};
  (monthlyComp||[]).forEach(c=>{ if(c.completed_at){ if(!monthlyDoneByMap[c.task_id]) monthlyDoneByMap[c.task_id]=[]; monthlyDoneByMap[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });

  let poolHtml=`<div class="card"><div class="card-title" style="margin-bottom:8px;">${t('weekly_tasks_label')}</div>`;
  RECURRING.weekly.forEach(task=>{
    const count=weeklyCountMap[task.id]||0; const done=count>=task.freq;
    const doneBy=weeklyDoneByMap[task.id]||[];
    const doneByLabel=doneBy.map(d=>'<span style="color:var(--green);">'+d.name+'</span> '+fmtTime(d.time)).join(' · ');
    poolHtml+=`<div class="weekly-colaborador-item"><div><div style="font-size:13px;font-weight:500;${done?'color:var(--text3);text-decoration:line-through;':''}">${task.name}</div><div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${task.dur>=60?Math.floor(task.dur/60)+'h'+(task.dur%60?pad(task.dur%60)+'m':''):task.dur+'min'}${doneByLabel?' · '+doneByLabel:''}</div></div><div style="text-align:right;">${done?`<span class="badge badge-green">✓ ${count}/${task.freq}</span>`:`<span class="badge badge-brown">${count}/${task.freq}</span>`}</div></div>`;
  });
  poolHtml+=`</div><div class="card"><div class="card-title" style="margin-bottom:8px;">${t('biweekly_tasks')}</div>`;
  RECURRING.biweekly.forEach(task=>{
    const doneBy=biweeklyDoneByMap2[task.id]||[]; const done=doneBy.length>0;
    const doneByLabel=doneBy.map(d=>'<span style="color:var(--green);">'+d.name+'</span> '+fmtTime(d.time)).join(' · ');
    poolHtml+=`<div class="weekly-colaborador-item"><div><div style="font-size:13px;font-weight:500;${done?'color:var(--text3);text-decoration:line-through;':''}">${task.name}</div><div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${task.dur}min${doneByLabel?' · '+doneByLabel:''}</div></div><div style="text-align:right;">${done?'<span class="badge badge-green">✓</span>':'<span class="badge badge-blue">'+t('biweekly_badge')+'</span>'}</div></div>`;
  });
  poolHtml+=`</div><div class="card"><div class="card-title" style="margin-bottom:8px;">${t('monthly_tasks')}</div>`;
  RECURRING.monthly.forEach(task=>{
    const doneBy=monthlyDoneByMap[task.id]||[]; const done=doneBy.length>0;
    const doneByLabel=doneBy.map(d=>'<span style="color:var(--green);">'+d.name+'</span> '+fmtTime(d.time)).join(' · ');
    poolHtml+=`<div class="weekly-colaborador-item"><div><div style="font-size:13px;font-weight:500;${done?'color:var(--text3);text-decoration:line-through;':''}">${task.name}</div><div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${task.dur}min${doneByLabel?' · '+doneByLabel:''}</div></div><div style="text-align:right;">${done?'<span class="badge badge-green">✓</span>':'<span class="badge badge-amber">'+t('monthly_badge')+'</span>'}</div></div>`;
  });
  poolHtml+=`</div>`;

  const toggleHtml=pesticerosList.map((p,i)=>`<button class="wplan-person-btn${i===0?' active':''}" data-uid="${p.id}" onclick="switchWplanPerson('${p.id}')">${p.name.split(' ')[0]}</button>`).join('');
  el.innerHTML=`<div class="wplan-person-toggle">${toggleHtml}</div><div id="wplan-colaborador-content"></div>${poolHtml}`;

  window._wplanColaboradorUsers=pesticerosList;
  if(pesticerosList[0]) await renderColaboradorSemanaForPerson(pesticerosList[0].id);
}

async function switchWplanPerson(uid) {
  document.querySelectorAll('.wplan-person-btn').forEach(b=>b.classList.toggle('active', b.dataset.uid===uid));
  await renderColaboradorSemanaForPerson(uid);
}

async function renderColaboradorSemanaForPerson(uid) {
  const user=(window._wplanColaboradorUsers||[]).find(u=>u.id===uid);
  if(!user){ document.getElementById('wplan-colaborador-content').innerHTML='<div class="empty">—</div>'; return; }
  document.getElementById('wplan-colaborador-content').innerHTML='<div class="empty">Cargando…</div>';
  await renderWeekPlanView('wplan-colaborador-content', user.id, currentProfile.role!=='coordinador');
}

// Colaborador oficina weekly view — mirrors renderColaboradorSemanal (full pools),
// but coordinadores + oficina scope + parallel globals to avoid finca collision.
async function renderColaboradorSemanalOficina() {
  const el=document.getElementById('oficina-col-semanal');
  if(!el) return;
  const {data:coordinadores}=await sb.from('profiles').select('*').eq('active',true).eq('role','coordinador');
  const coordList=coordinadores||[];
  const today=todayStr(); const weekStart=getWeekStart();
  const now2=new Date(); const dom2=now2.getDate();
  const periodStart=new Date(now2.getFullYear(),now2.getMonth(),(dom2<=15?1:16));
  const periodStartStr=periodStart.toISOString().slice(0,10);
  const monthStart2=new Date(now2.getFullYear(),now2.getMonth(),1).toISOString().slice(0,10);
  const [{data:weeklyComp},{data:biweeklyComp},{data:monthlyComp}] = await Promise.all([
    sb.from('task_completions').select('*, profiles(name)').gte('date',weekStart).eq('task_type','weekly'),
    sb.from('task_completions').select('*, profiles(name)').gte('date',periodStartStr).eq('task_type','biweekly'),
    sb.from('task_completions').select('*, profiles(name)').gte('date',monthStart2).eq('task_type','monthly'),
  ]);
  const weeklyCountMap={}; const weeklyDoneByMap={};
  (weeklyComp||[]).forEach(c=>{ if(c.completed_at){ weeklyCountMap[c.task_id]=(weeklyCountMap[c.task_id]||0)+1; if(!weeklyDoneByMap[c.task_id]) weeklyDoneByMap[c.task_id]=[]; weeklyDoneByMap[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });
  const biweeklyDoneByMap2={};
  (biweeklyComp||[]).forEach(c=>{ if(c.completed_at){ if(!biweeklyDoneByMap2[c.task_id]) biweeklyDoneByMap2[c.task_id]=[]; biweeklyDoneByMap2[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });
  const monthlyDoneByMap={};
  (monthlyComp||[]).forEach(c=>{ if(c.completed_at){ if(!monthlyDoneByMap[c.task_id]) monthlyDoneByMap[c.task_id]=[]; monthlyDoneByMap[c.task_id].push({name:(c.profiles?.name||'').split(' ')[0],time:c.completed_at}); } });
  let poolHtml=`<div class="card"><div class="card-title" style="margin-bottom:8px;">${t('weekly_tasks_label')}</div>`;
  RECURRING_OFICINA.weekly.forEach(task=>{
    const count=weeklyCountMap[task.id]||0; const done=count>=task.freq;
    const doneBy=weeklyDoneByMap[task.id]||[];
    const doneByLabel=doneBy.map(d=>'<span style="color:var(--green);">'+d.name+'</span> '+fmtTime(d.time)).join(' · ');
    poolHtml+=`<div class="weekly-colaborador-item"><div><div style="font-size:13px;font-weight:500;${done?'color:var(--text3);text-decoration:line-through;':''}">${task.name}</div><div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${task.dur>=60?Math.floor(task.dur/60)+'h'+(task.dur%60?pad(task.dur%60)+'m':''):task.dur+'min'}${doneByLabel?' · '+doneByLabel:''}</div></div><div style="text-align:right;">${done?`<span class="badge badge-green">✓ ${count}/${task.freq}</span>`:`<span class="badge badge-brown">${count}/${task.freq}</span>`}</div></div>`;
  });
  poolHtml+=`</div><div class="card"><div class="card-title" style="margin-bottom:8px;">${t('biweekly_tasks')}</div>`;
  RECURRING_OFICINA.biweekly.forEach(task=>{
    const doneBy=biweeklyDoneByMap2[task.id]||[]; const done=doneBy.length>0;
    const doneByLabel=doneBy.map(d=>'<span style="color:var(--green);">'+d.name+'</span> '+fmtTime(d.time)).join(' · ');
    poolHtml+=`<div class="weekly-colaborador-item"><div><div style="font-size:13px;font-weight:500;${done?'color:var(--text3);text-decoration:line-through;':''}">${task.name}</div><div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${task.dur}min${doneByLabel?' · '+doneByLabel:''}</div></div><div style="text-align:right;">${done?'<span class="badge badge-green">✓</span>':'<span class="badge badge-blue">'+t('biweekly_badge')+'</span>'}</div></div>`;
  });
  poolHtml+=`</div><div class="card"><div class="card-title" style="margin-bottom:8px;">${t('monthly_tasks')}</div>`;
  RECURRING_OFICINA.monthly.forEach(task=>{
    const doneBy=monthlyDoneByMap[task.id]||[]; const done=doneBy.length>0;
    const doneByLabel=doneBy.map(d=>'<span style="color:var(--green);">'+d.name+'</span> '+fmtTime(d.time)).join(' · ');
    poolHtml+=`<div class="weekly-colaborador-item"><div><div style="font-size:13px;font-weight:500;${done?'color:var(--text3);text-decoration:line-through;':''}">${task.name}</div><div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${task.dur}min${doneByLabel?' · '+doneByLabel:''}</div></div><div style="text-align:right;">${done?'<span class="badge badge-green">✓</span>':'<span class="badge badge-amber">'+t('monthly_badge')+'</span>'}</div></div>`;
  });
  poolHtml+=`</div>`;
  const toggleHtml=coordList.map((p,i)=>`<button class="wplan-person-btn-of${i===0?' active':''}" data-uid="${p.id}" onclick="switchWplanPersonOficina('${p.id}')">${p.name.split(' ')[0]}</button>`).join('');
  el.innerHTML=`<div class="wplan-person-toggle">${toggleHtml}</div><div id="wplan-colaborador-content-of"></div>${poolHtml}`;
  window._wplanColaboradorUsersOficina=coordList;
  if(coordList[0]) await renderColaboradorSemanaForPersonOficina(coordList[0].id);
}

async function switchWplanPersonOficina(uid) {
  document.querySelectorAll('.wplan-person-btn-of').forEach(b=>b.classList.toggle('active', b.dataset.uid===uid));
  await renderColaboradorSemanaForPersonOficina(uid);
}

async function renderColaboradorSemanaForPersonOficina(uid) {
  const user=(window._wplanColaboradorUsersOficina||[]).find(u=>u.id===uid);
  const cont=document.getElementById('wplan-colaborador-content-of');
  if(!user){ if(cont) cont.innerHTML='<div class="empty">—</div>'; return; }
  if(cont) cont.innerHTML='<div class="empty">Cargando…</div>';
  // isColaborador=true -> editable (+ Agregar); scope 'oficina' -> dropdown shows oficina tasks
  await renderWeekPlanView('wplan-colaborador-content-of', user.id, true, 'oficina');
}

// COLABORADOR ADMIN — Equipo + Balance
async function loadColaboradorAdmin() {
  document.getElementById('colaborador-admin').innerHTML=`
    <div class="tab-bar" style="margin:0 0 8px 0;">
      <button class="tab active" onclick="adminTab('equipo')" id="atab-equipo">Equipo</button>
      <button class="tab" onclick="adminTab('clientes')" id="atab-clientes">Clientes</button>
      <button class="tab" onclick="adminTab('finanzas')" id="atab-finanzas">Finanzas</button>
      <button class="tab" onclick="adminTab('inventario')" id="atab-inventario">Inventario</button>
      <button class="tab" onclick="adminTab('exportar')" id="atab-exportar">Exportar</button>
    </div>
    <div class="tab-content active" id="admin-equipo">
      <div id="admin-equipo-team"></div>
      <div id="admin-balance" style="margin-top:12px;"></div>
    </div>
    <div class="tab-content" id="admin-clientes"></div>
    <div class="tab-content" id="admin-finanzas"></div>
    <div class="tab-content" id="admin-inventario"></div>
    <div class="tab-content" id="admin-exportar"></div>`;
  await loadColaboradorTeam();
  await renderColaboradorBalance();
}
function adminTab(tab) {
  ['equipo','clientes','finanzas','inventario','exportar'].forEach(name=>{
    document.getElementById('atab-'+name)?.classList.toggle('active',name===tab);
    document.getElementById('admin-'+name)?.classList.toggle('active',name===tab);
  });
  if(tab==='clientes') renderClientes();
  if(tab==='finanzas') renderFinanzas();
  if(tab==='inventario') renderInventario();
  if(tab==='exportar') renderExportar();
}

// ===== EXPORTAR — CSV export (date range, comma-separated, UTF-8) =====

// Generic CSV download. headers = array of column names, rows = array of arrays.
function downloadCSV(filename, headers, rows) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Quote fields containing comma, double-quote or newline
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(esc).join(',')];
  rows.forEach(r => lines.push(r.map(esc).join(',')));
  // \uFEFF = UTF-8 BOM so Excel/Sheets render ñ á correctly
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Read the selected date range from the inputs. Returns {from, to} as 'YYYY-MM-DD'.
function exportRange() {
  const from = document.getElementById('exp-from')?.value || '';
  const to   = document.getElementById('exp-to')?.value || '';
  return { from, to };
}

// Filename helper: ...-2026-06-30.csv
function exportStamp() { return new Date().toISOString().slice(0, 10); }

async function renderExportar() {
  const el = document.getElementById('admin-exportar');
  if (!el) return;
  // Default: current week up to today
  const today = todayStr();
  const weekStart = getWeekStart().slice(0, 10);
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Exportar datos (CSV)</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px;line-height:1.5;">
        Elige un rango de fechas, descarga el archivo y súbelo a Google Drive.
        Se abre directamente en Google Sheets.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <div style="flex:1;">
          <div class="field-label">Desde</div>
          <input class="form-input" type="date" id="exp-from" value="${weekStart}" style="margin-bottom:0;">
        </div>
        <div style="flex:1;">
          <div class="field-label">Hasta</div>
          <input class="form-input" type="date" id="exp-to" value="${today}" style="margin-bottom:0;">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn-primary" onclick="exportTareas()">⬇ Tareas completadas</button>
        <button class="btn-primary" onclick="exportTiempo()">⬇ Registro de tiempo</button>
        <button class="btn-primary" onclick="exportAgenda()">⬇ Agenda (terapias)</button>
        <button class="btn-primary" onclick="exportInventario()">⬇ Inventario (actual)</button>
        <button class="btn-primary" onclick="exportInventarioHistorial()">⬇ Inventario (historial de revisiones)</button>
      </div>
    </div>`;
}

// Placeholders — filled in the next steps:
async function exportTareas() {
  const { from, to } = exportRange();
  if (!from || !to) { showToast('⚠ Elige un rango de fechas'); return; }

  // Build task_id -> name lookup from the unified `tasks` table (+ volunteer_pool + extra_tasks).
  // daily/weekly/biweekly/monthly completions all carry a tasks.id in task_id, so a single
  // unscoped read of `tasks` covers both finca and oficina scopes.
  const [tk, vp, ex] = await Promise.all([
    sb.from('tasks').select('id,name'),
    sb.from('volunteer_pool').select('task_id,name'),
    sb.from('extra_tasks').select('id,name'),
  ]);
  const nameById = {};
  (tk.data||[]).forEach(r => { nameById[r.id] = r.name; });
  (vp.data||[]).forEach(r => { nameById[r.task_id] = r.name; });
  // extra_tasks use their row id as task_id in completions
  (ex.data||[]).forEach(r => { nameById[r.id] = r.name; });

  // Completed tasks in range, joined with person name
  const { data, error } = await sb
    .from('task_completions')
    .select('*, profiles(name)')
    .gte('date', from)
    .lte('date', to)
    .not('completed_at', 'is', null)
    .order('date', { ascending: true });

  if (error) { showToast('Error al exportar'); console.error(error); return; }
  if (!data || data.length === 0) { showToast('Sin datos en ese rango'); return; }

  const typeLabel = {
    daily: 'Diaria', weekly: 'Semanal', biweekly: 'Quincenal',
    monthly: 'Mensual', extra: 'Extra', vol_pool: 'Voluntario'
  };

  const headers = ['Fecha', 'Persona', 'Tarea', 'Tipo', 'Completado'];
  const rows = data.map(c => [
    c.date,
    c.profiles?.name || '',
    nameById[c.task_id] || c.task_id,
    typeLabel[c.task_type] || c.task_type,
    c.completed_at ? new Date(c.completed_at).toLocaleString('es-DO') : ''
  ]);

  downloadCSV(`tareas-${from}_a_${to}.csv`, headers, rows);
  showToast(`✓ ${rows.length} tareas exportadas`);
}
async function exportTiempo() {
  const { from, to } = exportRange();
  if (!from || !to) { showToast('⚠ Elige un rango de fechas'); return; }

  // clock_in is a timestamp, so range = [from 00:00, to 23:59:59]
  const fromTs = new Date(from + 'T00:00:00').toISOString();
  const toTs   = new Date(to   + 'T23:59:59').toISOString();

  const { data, error } = await sb
    .from('time_entries')
    .select('*, profiles(name)')
    .gte('clock_in', fromTs)
    .lte('clock_in', toTs)
    .order('clock_in', { ascending: true });

  if (error) { showToast('Error al exportar'); console.error(error); return; }
  if (!data || data.length === 0) { showToast('Sin datos en ese rango'); return; }

  const typeLabel = { work: 'Trabajo', merienda: 'Merienda' };

  const headers = ['Fecha', 'Persona', 'Tipo', 'Entrada', 'Salida', 'Duración (min)'];
  const rows = data.map(e => {
    const inDate = new Date(e.clock_in);
    const out = e.clock_out ? new Date(e.clock_out) : null;
    const mins = out ? Math.floor((out - inDate) / 60000) : '';
    return [
      e.clock_in.slice(0, 10),
      e.profiles?.name || '',
      typeLabel[e.entry_type] || e.entry_type,
      inDate.toLocaleTimeString('es-DO'),
      out ? out.toLocaleTimeString('es-DO') : '(abierto)',
      mins
    ];
  });

  downloadCSV(`tiempo-${from}_a_${to}.csv`, headers, rows);
  showToast(`✓ ${rows.length} registros exportados`);
}
async function exportAgenda() {
  const { from, to } = exportRange();
  if (!from || !to) { showToast('⚠ Elige un rango de fechas'); return; }

  const { data, error } = await sb
    .from('therapy_sessions')
    .select('*, clients(name)')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('time_slot', { ascending: true });

  if (error) { showToast('Error al exportar'); console.error(error); return; }
  if (!data || data.length === 0) { showToast('Sin datos en ese rango'); return; }

  const statusLabel = {
    pendiente: 'Pendiente', confirmo: 'Confirmó', cancelo: 'Canceló'
  };
  const attLabel = {
    asistio: 'Asistió', ausente: 'Ausente'
  };
  const typeLabel = {
    regular: 'Regular', reposicion: 'Reposición',
    primera_vez: 'Primera vez', extra: 'Extra'
  };

  const headers = ['Fecha', 'Hora', 'Cliente', 'Caballo', 'Tipo', 'Estado', 'Asistencia'];
  const rows = data.map(s => [
    s.date,
    s.time_slot || '',
    s.clients?.name || s.client_name || '',
    s.horse || '',
    typeLabel[s.session_type] || s.session_type || '',
    statusLabel[s.status] || s.status || '',
    s.attendance ? (attLabel[s.attendance] || s.attendance) : '—'
  ]);

  downloadCSV(`agenda-${from}_a_${to}.csv`, headers, rows);
  showToast(`✓ ${rows.length} sesiones exportadas`);
}
// Inventario — current live stock, all fields + computed alert
async function exportInventario() {
  const { data: items } = await sb.from('inventory_items')
    .select('*').order('sort_order').order('name');
  if (!items || items.length === 0) { showToast('⚠ Sin artículos'); return; }
  const alertLabel = it => {
    const a = inventoryAlert(it);
    return a === 'urgent' ? 'Comprar urgente' : a === 'week' ? 'Comprar esta semana' : 'OK';
  };
  const headers = ['Emoji','Artículo','Categoría','Cantidad','Unidad','Tipo','Alerta urgente <','Alerta semana <','Estado','Última actualización'];
  const rows = items.map(it => [
    it.emoji || '', it.name, it.category || '', it.quantity,
    it.unit || '', it.unit_type || '',
    it.min_stock ?? '', it.threshold_week ?? '',
    alertLabel(it),
    it.updated_at ? it.updated_at.slice(0, 10) : ''
  ]);
  downloadCSV(`inventario-actual-${exportStamp()}.csv`, headers, rows);
  showToast('✓ Descargado');
}

// Inventario — snapshot history within the selected date range
// One row per item per revisión (long format, ideal for Sheets time-series)
async function exportInventarioHistorial() {
  const { from, to } = exportRange();
  if (!from || !to) { showToast('⚠ Elige un rango de fechas'); return; }
  // Snapshots in range (inclusive; +1 day on 'to' to cover the whole day)
  const toEnd = to + 'T23:59:59';
  const { data: snaps } = await sb.from('inventory_snapshots')
    .select('*')
    .gte('taken_at', from + 'T00:00:00')
    .lte('taken_at', toEnd)
    .order('taken_at', { ascending: true });
  if (!snaps || snaps.length === 0) { showToast('⚠ Sin revisiones en el rango'); return; }
  const ids = snaps.map(s => s.id);
  const { data: lines } = await sb.from('inventory_snapshot_lines')
    .select('*').in('snapshot_id', ids);
  if (!lines || lines.length === 0) { showToast('⚠ Sin datos'); return; }
  // Map snapshot_id -> {date, by, note} for joining
  const meta = {};
  snaps.forEach(s => { meta[s.id] = {
    date: s.taken_at.slice(0, 10),
    time: new Date(s.taken_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    by: s.taken_by || '', note: s.note || ''
  }; });
  const headers = ['Fecha','Hora','Revisado por','Emoji','Artículo','Categoría','Cantidad','Unidad','Tipo','Nota'];
  const rows = lines
    .sort((a, b) => (meta[a.snapshot_id].date + (a.sort_order||0)).localeCompare(meta[b.snapshot_id].date + (b.sort_order||0)))
    .map(l => {
      const m = meta[l.snapshot_id];
      return [ m.date, m.time, m.by, l.emoji || '', l.item_name, l.category || '',
               l.quantity, l.unit || '', l.unit_type || '', m.note ];
    });
  downloadCSV(`inventario-historial-${from}_${to}.csv`, headers, rows);
  showToast(`✓ ${snaps.length} revisiones exportadas`);
}

// COLABORADOR BALANCE — Semana (hours) + Solicitudes
async function renderColaboradorBalance() {
  const el=document.getElementById('admin-balance');
  if(!el) return;
  el.innerHTML='<div class="empty">Cargando…</div>';

  // Hours summary
  const {data:pesticeros}=await sb.from('profiles').select('*').eq('active',true).eq('role','pesticero');
  const weekStart=getWeekStart();
  let html=`<div class="card"><div class="card-title">${t('week_summary')}</div>`;
  for(const p of (pesticeros||[])){
    const firstName=p.name.split(' ').slice(0,2).join(' ');
    const {data:entries}=await sb.from('time_entries').select('*').eq('user_id',p.id).gte('clock_in',weekStart);
    const {data:wOvr}=await sb.from('attendance_overrides').select('date').eq('user_id',p.id).gte('date',weekStart.slice(0,10));
    let workedMins=0; entries?.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') workedMins+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
    workedMins+=meriendaCreditMins(entries);
    const workedDaySet=new Set(entries?entries.filter(e=>e.entry_type==='work'&&e.clock_out).map(e=>e.clock_in.slice(0,10)):[]);
    const absDaySet=new Set((wOvr||[]).map(o=>o.date).filter(d=>!workedDaySet.has(d)));
    const days=workedDaySet.size+absDaySet.size;
    const dayTarget=targetMinsFor(p)??(9*60);
    const overtime=workedMins-days*dayTarget; const rate=RATES[p.id]||0;
    const dopOT=overtime>0?Math.round((overtime/60)*rate):0;
    const overtimeStr=(overtime>=0?'+':'')+fmtDuration(Math.abs(overtime));
    const overtimeColor=overtime>0?'var(--green)':overtime<0?'var(--red)':'var(--text3)';
    html+=`<div class="week-row" style="cursor:pointer;" onclick="toggleQuincenal('${p.id}')">
      <span style="font-size:14px;font-weight:500;">${firstName}</span>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <span style="font-family:'DM Mono',monospace;font-size:14px;">${fmtDuration(workedMins)}</span>
        <span style="font-size:12px;color:${overtimeColor};font-family:'DM Mono',monospace;">${overtimeStr}</span>
      </div>
    </div>
    <div id="quincenal-${p.id}" style="display:none;"></div>`;
  }
  html+=`</div>`;

  // Solicitudes
  const {data:requests}=await sb.from('compensation_requests').select('*, profiles(name)').eq('status','pending').order('created_at',{ascending:false});
  html+=`<div class="card"><div class="card-title">${t('pending_requests')}</div>`;
  if(!isRequestWindowOpen()){ html+=`<div style="font-size:13px;color:var(--text2);text-align:center;padding:1rem 0;">${t('period_info')}</div>`; }
  if(!requests||requests.length===0){ html+=`<div class="empty">${t('no_pending')}</div></div>`; }
  else {
    requests.forEach(r=>{ const rate=RATES[r.user_id]||0; const dop=Math.round(r.hours_requested*rate); const typeLabel=r.type==='money'?t('type_money')+' · RD$ '+dop.toLocaleString():t('type_time'); html+=`<div class="request-card" id="req-${r.id}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><strong style="font-size:14px;">${r.profiles?.name}</strong><span class="badge badge-primary">${t('pending_badge')}</span></div><div style="font-size:13px;color:var(--text2);">${typeLabel} · ${fmtDuration(r.hours_requested*60)}</div><div class="req-actions"><button class="btn-approve" onclick="handleRequest('${r.id}','approved')">${t('approve')}</button><button class="btn-deny" onclick="handleRequest('${r.id}','denied')">${t('deny')}</button></div></div>`; });
    html+=`</div>`;
  }

  el.innerHTML=html;
}

async function toggleQuincenal(userId) {
  const el=document.getElementById('quincenal-'+userId);
  if(!el) return;
  if(el.style.display!=='none'){ el.style.display='none'; return; }
  el.innerHTML='<div class="empty">Cargando…</div>';
  el.style.display='block';
  // Current quincenal period
  const now=new Date(); const dom=now.getDate();
  const curStart=new Date(now.getFullYear(),now.getMonth(),(dom<=15?1:16));
  const curEnd=new Date(now.getFullYear(),now.getMonth(),(dom<=15?15:new Date(now.getFullYear(),now.getMonth()+1,0).getDate()));
  const curStartStr=curStart.toISOString().slice(0,10);
  const curEndStr=curEnd.toISOString().slice(0,10);
  // All entries ever
  const {data:allEntries}=await sb.from('time_entries').select('*').eq('user_id',userId).order('clock_in',{ascending:false});
  // Load absence overrides for this user (map by date -> record)
  const {data:ovrList}=await sb.from('attendance_overrides').select('*, creator:created_by(name)').eq('user_id',userId);
  (ovrList||[]).forEach(o=>{ o.created_by_name=o.creator?.name?.split(' ')[0]||'colaborador'; });
  const ovrByDay={}; (ovrList||[]).forEach(o=>{ ovrByDay[o.date]=o; });
  if((!allEntries||allEntries.length===0)&&(!ovrList||ovrList.length===0)){ el.innerHTML='<div class="empty">Sin registros</div>'; return; }
  // Build day map
  const byDay={};
  allEntries.forEach(e=>{ const d=e.clock_in.slice(0,10); if(!byDay[d]) byDay[d]=[]; byDay[d].push(e); });
  // Merge worked days with absence-override days (overrides with no fichaje still appear)
  const allDaySet=new Set([...Object.keys(byDay),...Object.keys(ovrByDay)]);
  const allDays=[...allDaySet].sort().reverse();
  // Split into current period and history
  const curDays=allDays.filter(d=>d>=curStartStr&&d<=curEndStr);
  const histDays=allDays.filter(d=>d<curStartStr);
  const userDayTarget=targetMinsFor(userId)??(9*60);
  function renderDays(days) {
    let h='';
    days.forEach(day=>{
      const dateLabel=new Date(day+'T12:00:00').toLocaleDateString('es',{weekday:'short',day:'numeric',month:'short'});
      const ovr=ovrByDay[day];
      const entries=byDay[day]||[];
      // Pure absence day (no fichaje): red row with who registered it + delete button
      if(ovr && entries.length===0){
        const byName=(ovr.created_by_name||'colaborador');
        const noteHtml=ovr.note?` · ${ovr.note}`:'';
        h+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:12px;color:var(--red);">⚠ ${dateLabel} · Ausencia injustificada</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;font-family:'DM Mono',monospace;color:var(--red);">−${fmtDuration(userDayTarget)}</span>
            <button onclick="deleteAbsence('${ovr.id}','${userId}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0 2px;">🗑</button>
          </span></div>
          <div style="font-size:11px;color:var(--text3);padding:0 0 6px;">Registrado por ${byName}${noteHtml}</div>`;
        return;
      }
      let worked=0;
      entries.forEach(e=>{ if(e.clock_out&&e.entry_type==='work') worked+=Math.floor((new Date(e.clock_out)-new Date(e.clock_in))/60000); });
      worked+=meriendaCreditMins(entries);
      const diff=worked-userDayTarget; const diffStr=(diff>=0?'+':'')+fmtDuration(Math.abs(diff));
      const col=diff>0?'var(--green)':diff<0?'var(--red)':'var(--text3)';
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);"><span style="font-size:12px;color:var(--text2);">${dateLabel}</span><span style="font-size:12px;font-family:'DM Mono',monospace;">${fmtDuration(worked)} <span style="color:${col};">${diffStr}</span></span></div>`;
    });
    return h;
  }
  const periodLabel=`${curStartStr.slice(8)} – ${curEndStr.slice(8)} ${now.toLocaleString('es',{month:'short'})}`;
  let html=`<div style="padding:8px 0 4px;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">${periodLabel}</div>`;
  html+=curDays.length?renderDays(curDays):'<div style="font-size:12px;color:var(--text3);padding:6px 0;">Sin días trabajados</div>';
  if(histDays.length){
    html+=`<button onclick="const hd=document.getElementById('hist-${userId}');hd.style.display=hd.style.display==='none'?'block':'none';this.textContent=hd.style.display==='none'?'▾ Ver historial completo':'▴ Ocultar'" style="font-size:12px;color:var(--text3);background:none;border:none;cursor:pointer;padding:6px 0;margin-top:4px;">▾ Ver historial completo</button>`;
    html+=`<div id="hist-${userId}" style="display:none;">${renderDays(histDays)}</div>`;
  }
  // Absence button — only colaborador may register
  if(currentProfile?.role==='colaborador'){
    html+=`<button onclick="openAbsenceModal('${userId}')" style="font-size:12px;color:var(--red);background:none;border:1px solid var(--border);border-radius:8px;cursor:pointer;padding:7px 10px;margin-top:10px;width:100%;">＋ Marcar ausencia injustificada</button>`;
  }
  el.innerHTML=`<div style="padding:0 0 8px;">${html}</div>`;
}

// ABSENCE OVERRIDES (colaborador registers unjustified absence)
let _absenceUserId = null;
async function openAbsenceModal(userId){
  _absenceUserId = userId;
  const {data:p}=await sb.from('profiles').select('name').eq('id',userId).single();
  document.getElementById('ab-user-id').value=userId;
  document.getElementById('ab-user-name').textContent=p?.name||'—';
  document.getElementById('ab-date').value=todayStr();
  document.getElementById('ab-note').value='';
  document.getElementById('absence-modal').style.display='flex';
}
function closeAbsenceModal(){ document.getElementById('absence-modal').style.display='none'; }
async function saveAbsence(){
  const userId=document.getElementById('ab-user-id').value;
  const date=document.getElementById('ab-date').value;
  const note=document.getElementById('ab-note').value.trim()||null;
  if(!userId||!date){ showToast('Falta fecha'); return; }
  const {data,error}=await sb.from('attendance_overrides')
    .insert({user_id:userId,date,note,created_by:currentUser.id})
    .select();
  if(error||!data||data.length===0){
    showToast(error?.code==='23505'?'Ya existe una ausencia ese día':'Error al guardar');
    return;
  }
  showToast('Ausencia registrada');
  closeAbsenceModal();
  // Refresh the open detail panel
  const panel=document.getElementById('quincenal-'+userId);
  if(panel){ panel.style.display='none'; toggleQuincenal(userId); }
}
function deleteAbsence(id, userId){
  askDeletePin('Eliminar ausencia', async ()=>{
    const {error}=await sb.from('attendance_overrides').delete().eq('id',id);
    if(error){ showToast('Error al eliminar'); return; }
    showToast('Ausencia eliminada');
    const panel=document.getElementById('quincenal-'+userId);
    if(panel){ panel.style.display='none'; toggleQuincenal(userId); }
  });
}

async function handleRequest(id,status) {
  await sb.from('compensation_requests').update({status}).eq('id',id);
  const card=document.getElementById('req-'+id);
  if(card){ card.className='request-card '+(status==='approved'?'approved':'denied'); card.querySelector('.req-actions').innerHTML=`<span style="font-size:13px;font-weight:500;color:${status==='approved'?'var(--green)':'var(--text3)'};">${status==='approved'?t('approved'):t('denied')}</span>`; card.querySelector('.badge').textContent=status==='approved'?t('approved'):t('denied'); card.querySelector('.badge').className='badge '+(status==='approved'?'badge-green':''); }
  showToast(status==='approved'?t('approved'):t('denied'));
}

// EXTRA TASKS
async function openExtraModal() { const {data:pesticeros}=await sb.from('profiles').select('id,name').eq('active',true).eq('role','pesticero').order('name'); document.getElementById('et-persons').innerHTML=(pesticeros||[]).map(p=>`<button class="person-toggle" data-uid="${p.id}" onclick="togglePerson(this)">${p.name.split(' ')[0]}</button>`).join(''); document.getElementById('et-date').value=todayStr(); document.getElementById('et-name').value=''; document.getElementById('et-dur').value=''; document.getElementById('et-note').value=''; document.querySelectorAll('.rec-opt').forEach(b=>b.classList.remove('selected')); document.querySelector('.rec-opt[data-val="once"]').classList.add('selected'); document.getElementById('extra-modal').style.display='flex'; }
function closeExtraModal() { document.getElementById('extra-modal').style.display='none'; }
function togglePerson(btn) { btn.classList.toggle('selected'); }
function selectRec(btn) { document.querySelectorAll('.rec-opt').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); }

async function saveExtraTask() {
  const name=document.getElementById('et-name').value.trim(); const date=document.getElementById('et-date').value; const dur=parseInt(document.getElementById('et-dur').value)||0; const note=document.getElementById('et-note').value.trim(); const recurrence=document.querySelector('.rec-opt.selected')?.dataset.val||'once'; const persons=[...document.querySelectorAll('.person-toggle.selected')].map(b=>b.dataset.uid);
  if(!name){showToast(t('err_name'));return;} if(persons.length===0){showToast(t('err_person'));return;} if(!date){showToast(t('err_date'));return;}
  const inserts=persons.map(uid=>({name,date,duration_mins:dur,note,recurrence,assigned_to:uid,created_by:currentUser.id}));
  const {error}=await sb.from('extra_tasks').insert(inserts);
  if(error){showToast(t('err_save'));console.error(error);return;}
  showToast('✓ Tarea guardada'); closeExtraModal(); await loadColaboradorDiario();
}

async function loadExtraTasks(userId,date) {
  const dow=new Date(date+'T12:00:00').getDay();
  const {data}=await sb.from('extra_tasks').select('*').eq('assigned_to',userId).or(`date.eq.${date},recurrence.eq.daily,recurrence.eq.weekly,recurrence.eq.mon-fri`);
  return (data||[]).filter(task=>{ if(task.recurrence==='once') return task.date===date; if(task.recurrence==='daily') return true; if(task.recurrence==='weekly') return task.date===date||new Date(task.date).getDay()===dow; if(task.recurrence==='mon-fri') return dow>=1&&dow<=5; return false; });
}

// WEEK PLAN
let wplanState = { userId: null, dow: null, weekStart: null, isColaborador: false };

function getWplanWeekStart() {
  const d=new Date(); const day=d.getDay();
  d.setDate(d.getDate()-day+(day===0?-6:1)); d.setHours(0,0,0,0);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}

function getDayName(dow) { return ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][dow-1]||''; }
function getDayNameShort(dow) { return ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'][dow-1]||''; }
function getTodayDow() { const d=new Date().getDay(); return d===0?7:d; }

function getAllNonDailyTasks(scope) {
  const src = scope==='oficina' ? RECURRING_OFICINA : RECURRING;
  const tasks=[];
  src.weekly.forEach(t=>tasks.push({id:t.id,name:t.name,dur:t.dur,type:'weekly'}));
  src.biweekly.forEach(t=>tasks.push({id:t.id,name:t.name,dur:t.dur,type:'biweekly'}));
  src.monthly.forEach(t=>tasks.push({id:t.id,name:t.name,dur:t.dur,type:'monthly'}));
  return tasks;
}

// task_id -> cadence lookup, so a planned task completes with its real type
// and feeds the weekly/biweekly/monthly counters. Returns null for free-typed plan items.
function cadenceForTaskId(taskId) {
  if(!taskId) return null;
  if(RECURRING.weekly.some(t=>t.id===taskId)) return 'weekly';
  if(RECURRING.biweekly.some(t=>t.id===taskId)) return 'biweekly';
  if(RECURRING.monthly.some(t=>t.id===taskId)) return 'monthly';
  for(const uid in DAILY_BY_USER){ if(DAILY_BY_USER[uid].some(t=>t.id===taskId)) return 'daily'; }
  return null;
}

async function renderWeekPlanView(containerId, userId, isColaborador, scope) {
  const el=document.getElementById(containerId);
  if(!el) return;
  const weekStart=getWplanWeekStart();
  const todayDow=getTodayDow();
  wplanState={userId, weekStart, isColaborador, dow:todayDow, scope:scope||'finca'};
  const {data:planRows}=await sb.from('week_plan').select('*').eq('user_id',userId).eq('week_start',weekStart);
  const confirmed=(planRows||[]).some(r=>r.confirmed);
  let html='';
  if(!confirmed&&(planRows||[]).length>0){
    if(isColaborador){
      html+=`<div style="background:var(--amber-light);border:1px solid rgba(156,98,0,0.2);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:13px;color:var(--amber);">⚠ Plan pendiente de confirmación</span><button onclick="confirmWplan('${userId}','${weekStart}','${containerId}',${isColaborador})" style="font-size:12px;padding:5px 12px;background:var(--primary);color:white;border:none;border-radius:20px;cursor:pointer;font-family:'DM Sans',sans-serif;">${t('confirm_plan')}</button></div>`;
    } else {
      html+=`<div style="background:var(--amber-light);border:1px solid rgba(156,98,0,0.2);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--amber);">${t('not_confirmed')}</div>`;
    }
  }
  html+=`<div class="wplan-day-nav">`;
  for(let d=1;d<=7;d++){
    const isToday=d===todayDow;
    html+=`<button class="wplan-day-btn${d===wplanState.dow?' active':''}${isToday?' today':''}" onclick="switchWplanDay(${d},'${containerId}','${userId}',${isColaborador})">${getDayNameShort(d)}${isToday?' •':''}</button>`;
  }
  html+=`</div><div id="wplan-day-content-${containerId}"></div>`;
  el.innerHTML=html;
  await renderWplanDay(containerId, userId, isColaborador, wplanState.dow, weekStart, planRows||[]);
}

async function renderWplanDay(containerId, userId, isColaborador, dow, weekStart, planRows) {
  const dayTasks=(planRows||[]).filter(r=>r.day_of_week===dow).sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||''));
  const todayDow=getTodayDow();
  const el=document.getElementById('wplan-day-content-'+containerId);
  if(!el) return;
  // Pesticero viewing today's own plan -> items become directly completable.
  const canCheck = !isColaborador && dow===todayDow;
  let planDoneMap={};
  if(canCheck){
    const {data:comps}=await sb.from('task_completions').select('task_id,completed_at').eq('user_id',userId).eq('date',todayStr());
    (comps||[]).forEach(c=>{ if(c.completed_at) planDoneMap[c.task_id]=c.completed_at; });
  }
  let html=`<div class="card"><div class="wplan-day-header"><span class="wplan-day-name">${getDayName(dow)}${dow===todayDow?'<span class="wplan-day-today">HOY</span>':''}</span>${isColaborador?`<button onclick="openWplanModal('${userId}',${dow},'${weekStart}','${containerId}')" style="font-size:12px;padding:5px 12px;background:var(--primary);color:white;border:none;border-radius:20px;cursor:pointer;font-family:'DM Sans',sans-serif;">+ Agregar</button>`:''}</div>`;
  if(dayTasks.length===0){
    html+=`<div class="empty" style="padding:1.5rem 0;">${t('no_plan')}</div>`;
  } else {
    dayTasks.forEach(task=>{
      // Linked: real task_id completes with its own cadence (feeds the counters);
      // free-typed items (no task_id) use a self-contained 'plan' completion keyed by the plan row id.
      const cad=cadenceForTaskId(task.task_id);
      const compKey=task.task_id||task.id;
      const compType=cad||'plan';
      const isDone=!!planDoneMap[compKey];
      let rightHtml='';
      if(canCheck){
        const ck=isDone?'':`completeTaskOnDate('${compKey}','${compType}','${todayStr()}')`;
        rightHtml=`<div class="task-check ${isDone?'done':''}" onclick="${ck}" style="flex-shrink:0;">${isDone?'✓':''}</div>`;
      } else if(isColaborador){
        rightHtml=`<button onclick="deleteWplanTask('${task.id}','${containerId}','${userId}',${isColaborador},'${weekStart}')" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--red-light);color:var(--red);cursor:pointer;flex-shrink:0;">✕</button>`;
      }
      html+=`<div class="wplan-item"><div style="flex:1;min-width:0;"><div class="wplan-item-name ${isDone?'done':''}">${task.task_name}</div><div class="wplan-item-meta">${task.start_time||'—'} · ${task.duration_mins?task.duration_mins+'min':'—'}${task.note?' · '+task.note:''}</div></div>${rightHtml}</div>`;
    });
  }
  html+=`</div>`;
  el.innerHTML=html;
}

async function switchWplanDay(dow, containerId, userId, isColaborador) {
  wplanState.dow=dow;
  const nav=document.querySelector(`#${containerId} .wplan-day-nav`);
  if(nav) nav.querySelectorAll('.wplan-day-btn').forEach((btn,i)=>{ btn.classList.toggle('active',i+1===dow); });
  const {data:planRows}=await sb.from('week_plan').select('*').eq('user_id',userId).eq('week_start',wplanState.weekStart);
  await renderWplanDay(containerId, userId, isColaborador, dow, wplanState.weekStart, planRows||[]);
}

async function confirmWplan(userId, weekStart, containerId, isColaborador) {
  await sb.from('week_plan').update({confirmed:true}).eq('user_id',userId).eq('week_start',weekStart);
  showToast(t('wplan_confirmed'));
  await renderWeekPlanView(containerId, userId, isColaborador);
}

async function deleteWplanTask(taskId, containerId, userId, isColaborador, weekStart) {
  askDeletePin('Eliminar tarea del plan', async () => {
    await sb.from('week_plan').delete().eq('id',taskId);
    showToast(t('wplan_deleted'));
    const {data:planRows}=await sb.from('week_plan').select('*').eq('user_id',userId).eq('week_start',weekStart);
    await renderWplanDay(containerId, userId, isColaborador, wplanState.dow, weekStart, planRows||[]);
  });
}

// Week plan modal
let wplanModalState = { userId: null, dow: null, weekStart: null, containerId: null };

function openWplanModal(userId, dow, weekStart, containerId) {
  const scope=(wplanState&&wplanState.scope)||'finca';
  wplanModalState={userId,dow,weekStart,containerId,scope};
  const sel=document.getElementById('wplan-task-select');
  sel.innerHTML='';
  getAllNonDailyTasks(scope).forEach(task=>{
    const opt=document.createElement('option');
    opt.value=task.id; opt.textContent=task.name+(task.dur?` · ${task.dur}min`:'');
    opt.dataset.name=task.name; opt.dataset.dur=task.dur||'';
    sel.appendChild(opt);
  });
  document.getElementById('wplan-time-wrap').innerHTML = timePickerHTML('wplan-time', '07:00');
  document.getElementById('wplan-dur').value='';
  document.getElementById('wplan-note').value='';
  document.getElementById('wplan-custom-name').value='';
  document.querySelectorAll('#wplan-modal .rec-opt').forEach(b=>b.classList.remove('selected'));
  document.querySelector('#wplan-modal .rec-opt[data-val="existing"]').classList.add('selected');
  document.getElementById('wplan-existing-section').style.display='';
  document.getElementById('wplan-custom-section').style.display='none';
  document.getElementById('wplan-modal-title').textContent=`${getDayName(dow)} · Agregar tarea`;
  document.getElementById('wplan-modal').style.display='flex';
}

function closeWplanModal() { document.getElementById('wplan-modal').style.display='none'; wplanModalState={userId:null,dow:null,weekStart:null,containerId:null,scope:'finca'}; }

function selectWplanType(btn) {
  document.querySelectorAll('#wplan-modal .rec-opt').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  const isExisting=btn.dataset.val==='existing';
  document.getElementById('wplan-existing-section').style.display=isExisting?'':'none';
  document.getElementById('wplan-custom-section').style.display=isExisting?'none':'';
}

async function saveWplanTask() {
  const {userId,dow,weekStart,containerId}=wplanModalState;
  const isExisting=document.querySelector('#wplan-modal .rec-opt.selected')?.dataset.val==='existing';
  let taskName=''; let taskId=null; let dur=parseInt(document.getElementById('wplan-dur').value)||null;
  if(isExisting){
    const sel=document.getElementById('wplan-task-select');
    const opt=sel.options[sel.selectedIndex];
    taskName=opt?.dataset.name||opt?.textContent||'';
    taskId=sel.value;
    if(!dur&&opt?.dataset.dur) dur=parseInt(opt.dataset.dur)||null;
  } else {
    taskName=document.getElementById('wplan-custom-name').value.trim();
  }
  const startTime=getTimeValue('wplan-time');
  const note=document.getElementById('wplan-note').value.trim();
  if(!taskName){showToast(t('err_name'));return;}
  const {error}=await sb.from('week_plan').insert({user_id:userId,task_name:taskName,task_id:taskId,day_of_week:dow,week_start:weekStart,start_time:startTime,duration_mins:dur,note:note||null,confirmed:false,created_by:currentUser.id});
  if(error){showToast(t('err_save'));console.error(error);return;}
  showToast(t('wplan_saved')); closeWplanModal();
  const {data:planRows}=await sb.from('week_plan').select('*').eq('user_id',userId).eq('week_start',weekStart);
  await renderWplanDay(containerId, userId, true, dow, weekStart, planRows||[]);
}

// AUTO LOGIN
sb.auth.getSession().then(({data:{session}})=>{ if(session?.user) initApp(session.user); });


// =====================================================================
// CATALOG / CRM / FINANZAS / INVENTARIO  (Rewrite part 2)
// =====================================================================

// Populate horse dropdown from DB (inactive only if currently selected)
function fillHorseSelect(elId, selected) {
  const el = document.getElementById(elId);
  if(!el) return;
  el.innerHTML = HORSES
    .filter(h => h.active || h.name === selected)
    .map(h => `<option value="${h.name}"${h.name === selected ? ' selected' : ''}>${h.name}${h.active ? '' : ' (inactivo)'}</option>`)
    .join('');
}

// CRM: session history of a client (in the client modal)
async function loadClientHistory(cid) {
  const el = document.getElementById('cm-history');
  if(!el) return;
  if(!cid){ el.innerHTML = ''; return; }
  const {data: sess} = await sb.from('therapy_sessions')
    .select('date,status,attendance,session_type')
    .eq('client_id', cid)
    .order('date', {ascending:false})
    .limit(30);
  if(!sess || sess.length === 0){
    el.innerHTML = '<div class="section-label">Historial de sesiones</div><div class="empty" style="padding:0.5rem 0;">Sin sesiones registradas.</div>';
    return;
  }
  let h = '<div class="section-label">Historial de sesiones</div><div class="card" style="padding:0;">';
  sess.forEach(x => {
    const att = x.attendance==='asistio'
      ? '<span style="color:var(--green);">✓ Asistió</span>'
      : x.attendance==='ausente'
        ? '<span style="color:var(--red);">✗ Ausente</span>'
        : '<span style="color:var(--text3);">—</span>';
    const tipo = (x.session_type && x.session_type!=='regular') ? ' · '+x.session_type : '';
    h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 14px;border-bottom:1px solid var(--border);font-size:12px;"><span>${fmtDateShort(x.date)}${tipo}</span><span>${att}</span></div>`;
  });
  h += '</div>';
  el.innerHTML = h;
}

// FINANZAS — Enlace a Alegra (fuente oficial) + flujo de facturas con Claude.
// La app ya no registra ingresos/gastos: Alegra es la única fuente de verdad.
// Browser-only: no se sube ninguna foto ni se guarda ninguna clave aquí.
function renderFinanzas() {
  const el = document.getElementById('admin-finanzas');
  if(!el) return;
  const ALEGRA_URL = 'https://app.alegra.com/?origin=login';
  const DRIVE_SALIDAS_URL = 'https://drive.google.com/drive/u/1/folders/18eLHrOtryjpZxe0rMyg9fNSGj8p8wSXY';
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Contabilidad · Alegra</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:12px;">
        Alegra es el sistema oficial de contabilidad de la organización.
        Los ingresos y gastos se registran allí, no en esta app.
      </div>
      <a href="${ALEGRA_URL}" target="_blank" rel="noopener" class="btn-primary" style="display:block;text-align:center;text-decoration:none;">Abrir Alegra →</a>
    </div>
    <div class="card">
      <div class="card-title">Facturas y recibos (salidas)</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:12px;">
        Flujo para ordenar las facturas del mes con ayuda de Claude:
      </div>
      <ol style="font-size:13px;color:var(--text2);line-height:1.6;margin:0 0 12px 0;padding-left:20px;">
        <li>Guarda las fotos de las facturas en la carpeta de Drive.</li>
        <li>Súbelas a tu chat de Claude (Claude Pro).</li>
        <li>Pídele una lista ordenada de gastos (fecha, monto, concepto).</li>
        <li>Registra los valores en Alegra y guarda la lista en Drive.</li>
      </ol>
      <a href="${DRIVE_SALIDAS_URL}" target="_blank" rel="noopener" class="btn-primary" style="display:block;text-align:center;text-decoration:none;">Abrir carpeta de salidas →</a>
    </div>`;
}

// INVENTARIO
async function renderInventario() {
  const el = document.getElementById('admin-inventario');
  if(!el) return;
  el.innerHTML = '<div class="empty">Cargando…</div>';

  const {data: items} = await sb.from('inventory_items').select('*').order('sort_order').order('name');
  const {data: lastSnap} = await sb.from('inventory_snapshots').select('*').order('taken_at',{ascending:false}).limit(1).maybeSingle();

  // --- Header: última revisión ---
  let html = `<div class="card">`;
  if(lastSnap){
    html += `<div style="font-size:12px;color:var(--text3);">Última revisión</div>
      <div style="font-size:14px;font-weight:600;margin-top:2px;">${fmtDateShort(lastSnap.taken_at.slice(0,10))} · ${new Date(lastSnap.taken_at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}</div>
      <div style="font-size:12px;color:var(--text2);">por ${lastSnap.taken_by||'—'}</div>`;
  } else {
    html += `<div style="font-size:13px;color:var(--text3);">Aún no hay revisiones guardadas.</div>`;
  }
  html += `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
      <button class="btn-primary" style="flex:1;min-width:130px;" onclick="takeSnapshot()">📸 Nueva revisión</button>
      <button class="btn-primary" style="flex:1;min-width:130px;background:#1d6f63;" onclick="genInventoryWhatsApp()">💬 Generar texto</button>
    </div>
    <button onclick="renderInventoryHistory()" style="margin-top:6px;width:100%;background:none;border:1px solid var(--border);border-radius:8px;padding:8px;cursor:pointer;font-size:13px;color:var(--text2);">🕘 Ver historial</button>
  </div>`;

  // --- Add item form ---
  html += `<div class="card"><div class="card-title">+ Artículo</div>
    <div class="form-row" style="margin-bottom:6px;"><input class="form-input" id="iv-name" type="text" placeholder="Nombre (ej: Trigo)"></div>
    <div style="display:flex;gap:6px;margin-bottom:6px;">
      <input class="form-input" id="iv-emoji" type="text" placeholder="🌾" style="flex:1;text-align:center;" maxlength="3">
      <input class="form-input" id="iv-category" type="text" placeholder="Categoría" style="flex:3;">
    </div>
    <div style="display:flex;gap:6px;margin-bottom:6px;">
      <input class="form-input" id="iv-qty" type="number" inputmode="decimal" placeholder="Cantidad" style="flex:2;">
      <input class="form-input" id="iv-unit" type="text" placeholder="%/sacos" style="flex:1;">
      <select class="form-input" id="iv-unittype" style="flex:1.4;">
        <option value="count">N.º</option>
        <option value="pct">%</option>
        <option value="free">Libre</option>
      </select>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      <input class="form-input" id="iv-min" type="number" inputmode="decimal" placeholder="Alerta urgente <" style="flex:1;">
      <input class="form-input" id="iv-week" type="number" inputmode="decimal" placeholder="Alerta semana <" style="flex:1;">
    </div>
    <button class="btn-primary" onclick="addInventory()">Agregar →</button>
  </div>`;

  // --- Items grouped by category, with alert badges ---
  if(!items || items.length===0){
    html += '<div class="card"><div class="empty">Sin artículos.</div></div>';
  } else {
    const cats = {};
    items.forEach(it => { (cats[it.category||'Otros'] = cats[it.category||'Otros']||[]).push(it); });
    Object.keys(cats).forEach(cat => {
      html += `<div class="card" style="padding:0;"><div style="padding:10px 16px 6px;border-bottom:1px solid var(--border);"><div class="card-title" style="margin-bottom:0;">${cat}</div></div>`;
      cats[cat].forEach(it => {
        const alert = inventoryAlert(it); // '', 'urgent', 'week'
        const badge = alert==='urgent' ? ' <span class="badge badge-red" style="font-size:9px;">🚨 urgente</span>'
                    : alert==='week'   ? ' <span class="badge" style="font-size:9px;background:#f3d27a;color:#5a4400;">⚠️ semana</span>' : '';
        const unitLabel = it.unit ? ' '+it.unit : '';
        html += `<div id="iv-row-${it.id}" style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:500;">${it.emoji?it.emoji+' ':''}${it.name}<span id="iv-badge-${it.id}">${badge}</span></div>
            <div style="font-size:11px;color:var(--text3);">${it.unit_type==='free'?'libre':it.unit_type}${it.min_stock!=null?' · urgente<'+it.min_stock:''}${it.threshold_week!=null?' · semana<'+it.threshold_week:''}</div>
          </div>
          <input type="number" inputmode="decimal" value="${Number(it.quantity)}" onchange="setInventoryQty('${it.id}', this.value)" style="width:64px;text-align:center;font-family:'DM Mono',monospace;font-size:14px;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg);flex-shrink:0;">
          <div style="font-size:12px;color:var(--text3);min-width:38px;">${it.unit||''}</div>
          <button onclick="deleteInventory('${it.id}')" title="Eliminar" style="background:none;border:none;font-size:13px;cursor:pointer;color:var(--text3);flex-shrink:0;">🗑</button>
        </div>`;
      });
      html += '</div>';
    });
  }
  el.innerHTML = html;
}

// Returns '' | 'urgent' | 'week' for an item (NULL thresholds = no alert)
function inventoryAlert(it){
  if(it.unit_type==='free') return '';
  const q = Number(it.quantity);
  if(it.min_stock!=null && q < Number(it.min_stock)) return 'urgent';
  if(it.threshold_week!=null && q < Number(it.threshold_week)) return 'week';
  return '';
}

async function addInventory() {
  const name = document.getElementById('iv-name').value.trim();
  if(!name){ showToast('⚠ Escribe el nombre'); return; }
  const emoji = document.getElementById('iv-emoji').value.trim() || null;
  const category = document.getElementById('iv-category').value.trim() || null;
  const quantity = parseFloat(document.getElementById('iv-qty').value) || 0;
  const unit = document.getElementById('iv-unit').value.trim() || null;
  const unit_type = document.getElementById('iv-unittype').value;
  const minv = document.getElementById('iv-min').value;
  const min_stock = minv === '' ? null : parseFloat(minv);
  const weekv = document.getElementById('iv-week').value;
  const threshold_week = weekv === '' ? null : parseFloat(weekv);
  const {data, error} = await sb.from('inventory_items')
    .insert({name, emoji, category, quantity, unit, unit_type, min_stock, threshold_week}).select();
  if(error){ showToast('Error al guardar'); console.error(error); return; }
  if(!data || data.length===0){ showToast('⚠ Sin permiso (RLS)'); return; }
  showToast('✓ Agregado'); await renderInventario();
}

// --- Snapshot: freeze current live stock as a revisión ---
async function takeSnapshot() {
  const note = prompt('Nota / observaciones (opcional):', '') || null;
  const {data: items} = await sb.from('inventory_items').select('*').order('sort_order').order('name');
  if(!items || items.length===0){ showToast('⚠ Sin artículos'); return; }
  const {data: snap, error: e1} = await sb.from('inventory_snapshots')
    .insert({taken_by: currentProfile.name || '—', note}).select();
  if(e1 || !snap || snap.length===0){ showToast('⚠ Sin permiso (RLS)'); return; }
  const snapId = snap[0].id;
  const lines = items.map(it => ({
    snapshot_id: snapId, item_name: it.name, emoji: it.emoji, category: it.category,
    quantity: it.quantity, unit: it.unit, unit_type: it.unit_type, sort_order: it.sort_order
  }));
  const {data: ld, error: e2} = await sb.from('inventory_snapshot_lines').insert(lines).select();
  if(e2 || !ld || ld.length===0){ showToast('⚠ Error al guardar líneas'); return; }
  showToast('📸 Revisión guardada'); await renderInventario();
}

// --- Generate WhatsApp text from current live stock ---
async function genInventoryWhatsApp() {
  const {data: items} = await sb.from('inventory_items').select('*').order('sort_order').order('name');
  if(!items || items.length===0){ showToast('⚠ Sin artículos'); return; }
  const now = new Date();
  const fecha = now.toLocaleDateString('es', {day:'2-digit',month:'2-digit',year:'numeric'});
  const hora = now.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'});
  const bar = '━━━━━━━━━━━━━━━━━━━━';
  let txt = `📦 INVENTARIO GENERAL – EVV\nFecha: ${fecha}\nHora: ${hora}\nRevisado por: ${currentProfile.name||'—'}\n${bar}\n📦 INVENTARIO ACTUAL\n${bar}\n`;
  // group by category
  const cats = {};
  items.forEach(it => { (cats[it.category||'Otros'] = cats[it.category||'Otros']||[]).push(it); });
  Object.keys(cats).forEach(cat => {
    txt += `\n${cat}\n`;
    cats[cat].forEach(it => {
      const val = it.unit_type==='pct' ? Number(it.quantity)+'%' : Number(it.quantity)+(it.unit?' '+it.unit:'');
      txt += `• ${it.emoji?it.emoji+' ':''}${it.name}: ${val}\n`;
    });
  });
  // alerts
  const urgent = items.filter(it => inventoryAlert(it)==='urgent');
  const week   = items.filter(it => inventoryAlert(it)==='week');
  txt += `${bar}\n🚨 ALERTAS DE COMPRA\n${bar}\n`;
  if(urgent.length){ txt += `Comprar urgente\n`; urgent.forEach((it,i)=> txt += `${i+1}. ${it.name}\n`); }
  if(week.length){ txt += `Comprar esta semana\n`; week.forEach((it,i)=> txt += `${i+1}. ${it.name}\n`); }
  if(!urgent.length && !week.length) txt += `Sin alertas.\n`;
  // copy to clipboard
  try { await navigator.clipboard.writeText(txt); showToast('💬 Texto copiado'); }
  catch(e){ showToast('Copia manual abajo'); }
  // also show in history modal for manual copy
  document.getElementById('history-modal-title').textContent = 'Texto para WhatsApp';
  document.getElementById('history-modal-content').innerHTML =
    `<textarea readonly style="width:100%;height:340px;font-family:monospace;font-size:12px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);resize:vertical;">${txt.replace(/</g,'&lt;')}</textarea>`;
  document.getElementById('history-modal').style.display='flex';
}

// --- History: list past revisiones ---
async function renderInventoryHistory() {
  document.getElementById('history-modal-title').textContent = 'Historial de revisiones';
  document.getElementById('history-modal-content').innerHTML = '<div class="empty">Cargando…</div>';
  document.getElementById('history-modal').style.display='flex';
  const {data: snaps} = await sb.from('inventory_snapshots').select('*').order('taken_at',{ascending:false}).limit(30);
  if(!snaps || snaps.length===0){ document.getElementById('history-modal-content').innerHTML='<div class="empty">Sin revisiones aún.</div>'; return; }
  let html = '';
  snaps.forEach(s => {
    const d = fmtDateShort(s.taken_at.slice(0,10));
    const h = new Date(s.taken_at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
    html += `<div onclick="viewSnapshot('${s.id}')" style="padding:12px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer;">
      <div style="font-size:14px;font-weight:600;">${d} · ${h}</div>
      <div style="font-size:12px;color:var(--text2);">por ${s.taken_by||'—'}</div>
      ${s.note?`<div style="font-size:12px;color:var(--text3);margin-top:4px;">📋 ${s.note}</div>`:''}
    </div>`;
  });
  document.getElementById('history-modal-content').innerHTML = html;
}

// --- View one past snapshot ---
async function viewSnapshot(id) {
  document.getElementById('history-modal-content').innerHTML = '<div class="empty">Cargando…</div>';
  const {data: lines} = await sb.from('inventory_snapshot_lines').select('*').eq('snapshot_id', id).order('sort_order');
  if(!lines || lines.length===0){ document.getElementById('history-modal-content').innerHTML='<div class="empty">Vacío.</div>'; return; }
  const cats = {};
  lines.forEach(l => { (cats[l.category||'Otros'] = cats[l.category||'Otros']||[]).push(l); });
  let html = `<button onclick="renderInventoryHistory()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:13px;margin-bottom:8px;">← Volver</button>`;
  Object.keys(cats).forEach(cat => {
    html += `<div style="font-size:12px;font-weight:700;color:var(--text2);margin:10px 0 4px;">${cat}</div>`;
    cats[cat].forEach(l => {
      const val = l.unit_type==='pct' ? Number(l.quantity)+'%' : Number(l.quantity)+(l.unit?' '+l.unit:'');
      html += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--border);"><span>${l.emoji?l.emoji+' ':''}${l.item_name}</span><span style="font-family:monospace;">${val}</span></div>`;
    });
  });
  document.getElementById('history-modal-content').innerHTML = html;
}

async function setInventoryQty(id, val) {
  const q = Math.max(0, parseFloat(val) || 0);
  const {data, error} = await sb.from('inventory_items')
    .update({quantity:q, updated_at:new Date().toISOString()})
    .eq('id', id).select();
  if(error || !data || data.length===0){ showToast(error?'Error':'⚠ Sin permiso (RLS)'); return; }
  const it = data[0];
  const alert = inventoryAlert(it);
  const badge = alert==='urgent' ? ' <span class="badge badge-red" style="font-size:9px;">🚨 urgente</span>'
              : alert==='week'   ? ' <span class="badge" style="font-size:9px;background:#f3d27a;color:#5a4400;">⚠️ semana</span>' : '';
  const badgeEl = document.getElementById('iv-badge-'+id);
  if(badgeEl) badgeEl.innerHTML = badge;
}

async function deleteInventory(id) {
  askDeletePin('Eliminar artículo', async () => {
    const {error} = await sb.from('inventory_items').delete().eq('id', id);
    if(error){ showToast('Error'); console.error(error); return; }
    showToast('✓ Eliminado'); await renderInventario();
  });
}

