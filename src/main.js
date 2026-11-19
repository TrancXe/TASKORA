import './style.css';
import { supabase, isCloudConfigured } from './supabase.js';
import { startKhaltiCheckout, verifyKhaltiCheckout } from './api.js';

const $ = (id) => document.getElementById(id);
const STORE = 'taskora_pro_demo_v1';
const SESSION_STORE = 'taskora_pro_demo_sessions_v1';
const THEME_STORE = 'taskora_pro_theme';
const ACCENT_STORE = 'taskora_pro_accent';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const today = () => dateKey(new Date());
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const escapeHTML = (value='') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toDateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : 'No due date';
const toLocalISODate = (value) => value ? new Date(value).toLocaleDateString('en-CA') : '';

let state = {
  mode: 'auth', user: null, session: null, demo: false, profile: null,
  tasks: [], projects: [], sessions: [], paymentOrders: [], subscription: { plan: 'free', status: 'active', current_period_end: null }, syncChannel: null,
  view: 'dashboard', editingId: null, calendarDate: new Date(), timerMode: 'focus', timerRemaining: 1500,
  timerInterval: null, timerRunning: false, selectedTaskId: '', lastReminderDay: '',
  filters: { search: '', status: 'all', category: 'all', priority: 'all', project: 'all', sort: 'created' }, pricing: { monthlyNpr: 499, yearlyNpr: 4999 }, pricingLoaded: false
};

function showToast(message) {
  let toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2600);
}
function loadDemoStorage() {
  try { state.tasks = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { state.tasks = []; }
  try { state.sessions = JSON.parse(localStorage.getItem(SESSION_STORE) || '[]'); } catch { state.sessions = []; }
  state.projects = JSON.parse(localStorage.getItem(`${STORE}_projects`) || '[]');
}
function saveDemoStorage() {
  localStorage.setItem(STORE, JSON.stringify(state.tasks));
  localStorage.setItem(SESSION_STORE, JSON.stringify(state.sessions));
  localStorage.setItem(`${STORE}_projects`, JSON.stringify(state.projects));
}
function isPro() {
  return state.subscription?.plan === 'pro' && state.subscription?.status === 'active' &&
    (!state.subscription.current_period_end || new Date(state.subscription.current_period_end) > new Date());
}

function renderAuth() {
  $('app').innerHTML = `
    <div class="auth-shell">
      <section class="auth-visual">
        <div class="auth-brand">TASKORA<span>.</span></div>
        <div><h1>Make space for work that matters.</h1><p>A focused workspace for your tasks, projects and ideas. Build steady momentum, one clear step at a time.</p></div>
        <div class="visual-foot">TASKORA PRO · PLAN CLEARLY. FOCUS DEEPLY.</div>
      </section>
      <section class="auth-card-wrap"><div class="auth-card">
        <h2 id="authHeading">Welcome back</h2><p id="authSubheading">Sign in to continue to your workspace.</p>
        <div class="tabs"><button class="active" id="tabSignin" type="button">Sign in</button><button id="tabSignup" type="button">Create account</button></div>
        <form id="authForm">
          <div class="field hidden" id="nameField"><label for="authName">Your name</label><input id="authName" autocomplete="name" maxlength="70" placeholder="e.g. Alex Morgan"></div>
          <div class="field"><label for="authEmail">Email address</label><input id="authEmail" type="email" autocomplete="email" required placeholder="you@example.com"></div>
          <div class="field"><label for="authPassword">Password</label><input id="authPassword" type="password" minlength="8" autocomplete="current-password" required placeholder="At least 8 characters"></div>
          <button class="primary full" id="authSubmit" type="submit">Sign in</button>
          <button class="secondary full" id="forgotPassword" type="button" style="margin-top:8px">Forgot password?</button>
          <p class="auth-note" id="authMessage">Your account and data are secured by your configured Supabase project.</p>
        </form>
        <div class="demo-box"><p><b>Just exploring?</b> Open a local demo workspace to preview TASKORA without creating an account. Demo data stays in this browser only.</p><button class="secondary full" id="demoStart" type="button">Open demo workspace</button></div>
        ${!isCloudConfigured ? '<p class="footer-note">Cloud sign-in is not configured in this copy yet. Add your Supabase URL and public/anon key to the .env file, then restart the app. Demo mode is ready now.</p>' : ''}
      </div></section>
    </div>`;

  let authTab = 'signin';
  const setTab = (tab) => {
    authTab = tab;
    $('tabSignin').classList.toggle('active', tab === 'signin');
    $('tabSignup').classList.toggle('active', tab === 'signup');
    $('nameField').classList.toggle('hidden', tab !== 'signup');
    $('authHeading').textContent = tab === 'signup' ? 'Create your account' : 'Welcome back';
    $('authSubheading').textContent = tab === 'signup' ? 'Set up your personal productivity space.' : 'Sign in to continue to your workspace.';
    $('authSubmit').textContent = tab === 'signup' ? 'Create account' : 'Sign in';
    $('forgotPassword').classList.toggle('hidden', tab !== 'signin');
    $('authPassword').autocomplete = tab === 'signup' ? 'new-password' : 'current-password';
    $('authMessage').textContent = isCloudConfigured ? 'Your account and data are protected by Supabase authentication and database policies.' : 'Cloud accounts are unavailable until Supabase is configured. You can still explore demo mode.';
  };
  $('tabSignin').onclick = () => setTab('signin');
  $('tabSignup').onclick = () => setTab('signup');
  $('demoStart').onclick = () => { state.demo = true; state.mode = 'app'; state.user = { email: 'demo@taskora.local' }; state.profile = { full_name: 'Demo workspace' }; loadDemoStorage(); seedDemoIfEmpty(); renderApp(); };
  $('authForm').onsubmit = async (event) => {
    event.preventDefault();
    if (!isCloudConfigured || !supabase) return showToast('Configure Supabase to enable real accounts.');
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    const submit = $('authSubmit'); submit.disabled = true; submit.textContent = 'Please wait…';
    try {
      if (authTab === 'signup') {
        const fullName = $('authName').value.trim();
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
        if (error) throw error;
        if (data.session) await startCloudApp(data.session, data.user);
        else $('authMessage').textContent = 'Account created. Check your email for the confirmation link, then sign in.';
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await startCloudApp(data.session, data.user);
      }
    } catch (error) { $('authMessage').textContent = error.message || 'Authentication failed.'; }
    finally { if ($('authSubmit')) { $('authSubmit').disabled = false; $('authSubmit').textContent = authTab === 'signup' ? 'Create account' : 'Sign in'; } }
  };
  $('forgotPassword').onclick = async () => {
    if (!isCloudConfigured) return showToast('Configure Supabase first.');
    const email = $('authEmail').value.trim();
    if (!email) return showToast('Enter your email address first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
    $('authMessage').textContent = error ? error.message : 'Password reset instructions have been sent if that email is registered.';
  };
}

function seedDemoIfEmpty() {
  if (state.tasks.length) return;
  const d = new Date();
  const plus = (n) => { const x = new Date(d); x.setDate(x.getDate()+n); return dateKey(x); };
  state.projects = [{id:'demo-project-study',name:'Personal growth',color:'#7565e8',user_id:'demo'}];
  state.tasks = [
    {id:uid(),title:'Plan the week ahead',description:'Choose three priorities and block out time.',category:'Personal',priority:'high',status:'todo',due_date:plus(0),created_at:new Date().toISOString()},
    {id:uid(),title:'Finish the project outline',description:'Draft the key sections and review the notes.',category:'Work',priority:'medium',status:'in_progress',due_date:plus(1),created_at:new Date().toISOString()},
    {id:uid(),title:'Read for 25 minutes',description:'A little progress is still progress.',category:'Study',priority:'low',status:'todo',due_date:plus(2),created_at:new Date().toISOString()},
    {id:uid(),title:'Organize the workspace',description:'Clear the desk and tidy up project files.',category:'Personal',priority:'low',status:'done',due_date:plus(-1),completed_at:new Date().toISOString(),created_at:new Date().toISOString()}
  ];
  saveDemoStorage();
}

async function startCloudApp(session, user) {
  state.demo = false; state.session = session; state.user = user; state.mode = 'app';
  try { await loadCloudData(); renderApp(); await handlePaymentReturn(); }
  catch (error) { renderApp(); showToast(`Connected, but some data could not load: ${error.message}`); }
}

async function loadCloudData() {
  const [profileRes, projectsRes, tasksRes, sessionsRes, subscriptionRes, paymentsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', state.user.id).maybeSingle(),
    supabase.from('projects').select('*').eq('user_id', state.user.id).eq('archived', false).order('created_at'),
    supabase.from('tasks').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }),
    supabase.from('focus_sessions').select('*').eq('user_id', state.user.id).order('ended_at', { ascending: false }).limit(500),
    supabase.from('subscriptions').select('*').eq('user_id', state.user.id).maybeSingle(),
    supabase.from('payment_orders').select('purchase_order_id,plan_key,amount_paisa,currency,status,created_at,completed_at,transaction_id').eq('user_id', state.user.id).order('created_at', {ascending:false}).limit(10)
  ]);
  for (const result of [profileRes, projectsRes, tasksRes, sessionsRes, subscriptionRes, paymentsRes]) if (result.error) throw result.error;
  state.profile = profileRes.data || { full_name: state.user.user_metadata?.full_name || '' };
  state.projects = projectsRes.data || [];
  state.tasks = tasksRes.data || [];
  state.sessions = sessionsRes.data || [];
  state.subscription = subscriptionRes.data || { plan: 'free', status: 'active' };
  state.paymentOrders = paymentsRes.data || [];
  if (state.syncChannel) await supabase.removeChannel(state.syncChannel);
  state.syncChannel = supabase.channel(`taskora-${state.user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${state.user.id}` }, async () => {
      const { data } = await supabase.from('tasks').select('*').eq('user_id', state.user.id).order('created_at', {ascending:false});
      if (data) { state.tasks = data; renderAll(); }
    }).subscribe();
}

async function refreshSession() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) await startCloudApp(data.session, data.session.user);
  else renderAuth();
}

function renderApp() {
  const firstName = (state.profile?.full_name || state.user?.email?.split('@')[0] || 'there').split(' ')[0];
  const isDemoText = state.demo ? '<span class="status">DEMO MODE · LOCAL DATA</span>' : (isPro() ? '<span class="status">✦ PRO ACTIVE</span>' : '<span class="status">FREE PLAN</span>');
  $('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="brand-mark">T</span><span class="brand-name">taskora<span>.</span></span></div>
        <div class="nav-label">WORKSPACE</div>
        <button class="nav active" data-view="dashboard">▦ <span>Overview</span></button>
        <button class="nav" data-view="tasks">☷ <span>My tasks</span><span class="n" id="navTasks">0</span></button>
        <button class="nav" data-view="board">▤ <span>Board</span></button>
        <button class="nav" data-view="calendar">▦ <span>Calendar</span></button>
        <div class="nav-label">PRODUCTIVITY</div>
        <button class="nav" data-view="focus">◷ <span>Focus timer</span></button>
        <button class="nav" data-view="reports">↗ <span>Reports</span></button>
        <div class="nav-label">ACCOUNT</div>
        <button class="nav" data-view="billing">✧ <span>Plans & billing</span></button>
        <button class="nav" data-view="settings">⚙ <span>Settings</span></button>
        <div class="sidebar-bottom">
          <div class="quote"><b>“Great things are done by a series of small things brought together.”</b><span>— Vincent van Gogh</span></div>
          <div class="mini-profile"><div class="avatar" id="avatarInitial">T</div><div style="min-width:0"><div class="profile-name" id="profileName">${escapeHTML(state.profile?.full_name || 'TASKORA user')}</div><div class="profile-plan">${state.demo ? 'Local demo account' : escapeHTML(state.user?.email || '')}</div></div><button class="tiny" id="signout" title="Sign out">↗</button></div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar"><div class="top-left"><button class="icon-btn mobile-menu" id="mobileMenu" aria-label="Open menu">☰</button><div><div class="eyebrow" id="dateLine">YOUR PERSONAL WORKSPACE</div><h1 id="pageTitle">Overview</h1></div></div><div class="top-actions">${isDemoText}<button class="icon-btn" id="themeToggle" title="Toggle dark mode">◐</button><button class="primary" id="quickAdd">＋ New task</button></div></header>
        <section class="welcome" id="welcome"><div><h2>Good ${new Date().getHours()<12?'morning':new Date().getHours()<18?'afternoon':'evening'}, ${escapeHTML(firstName)}.</h2><p>Here’s your space to make meaningful progress today.</p></div><span class="muted" id="welcomeDate"></span></section>
        <section class="stats" id="stats">
          <div class="stat"><div class="stat-top">All tasks <span class="stat-icon">☷</span></div><strong id="statTotal">0</strong><small>Across your workspace</small></div>
          <div class="stat"><div class="stat-top">Completed <span class="stat-icon">✓</span></div><strong id="statDone">0</strong><small>Progress made</small></div>
          <div class="stat"><div class="stat-top">In progress <span class="stat-icon">◷</span></div><strong id="statDoing">0</strong><small>Currently underway</small></div>
          <div class="stat"><div class="stat-top">Completion <span class="stat-icon">↗</span></div><strong id="statRate">0%</strong><small>Overall task completion</small></div>
        </section>
        <section class="view active" id="view-dashboard"><div class="content-grid"><div class="panel"><div class="panel-head"><div><h3>Today’s priorities</h3><div class="muted">Due today or already in progress</div></div><button class="secondary" data-goto="tasks">All tasks</button></div><div id="todayList" class="task-list"></div></div><div><div class="panel"><div class="panel-head"><div><h3>Workspace progress</h3><div class="muted">A snapshot of your momentum</div></div>${isDemoText}</div><div class="progress-wrap"><div class="progress-head"><span>Tasks completed</span><b id="progressText">0%</b></div><div class="track"><div class="fill" id="progressFill" style="width:0%"></div></div></div><div class="muted" style="font-weight:800;letter-spacing:.8px">BY CATEGORY</div><div id="categoryStats"></div></div><div class="panel" style="margin-top:13px"><div class="panel-head"><h3>Coming up</h3><span class="muted">Next 7 days</span></div><div id="upcomingList" class="task-list"></div></div></div></div></section>
        <section class="view" id="view-tasks"><div class="panel"><div class="panel-head"><div><h3>Task manager</h3><div class="muted">Create, organize and track everything that matters.</div></div><button class="primary" id="taskAdd">＋ Add task</button></div><input class="search" id="taskSearch" placeholder="⌕ Search tasks, descriptions or categories…"><div class="toolbar"><select id="filterStatus"><option value="all">All statuses</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Completed</option></select><select id="filterCategory"><option value="all">All categories</option><option>Study</option><option>Work</option><option>Personal</option><option>Health</option><option>Other</option></select><select id="filterPriority"><option value="all">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><select id="filterProject"><option value="all">All projects</option></select><select id="filterSort"><option value="created">Recently added</option><option value="due">Due date</option><option value="priority">Priority</option></select></div><div id="taskList" class="task-list"></div></div></section>
        <section class="view" id="view-board"><div class="panel"><div class="panel-head"><div><h3>Project board</h3><div class="muted">Drag a task between columns to update its status.</div></div><button class="primary" id="boardAdd">＋ Add task</button></div><div class="board" id="kanban"></div></div></section>
        <section class="view" id="view-calendar"><div class="panel"><div class="calendar-head"><button class="secondary" id="monthPrev">←</button><h3 id="monthTitle">Calendar</h3><button class="secondary" id="monthNext">→</button></div><div id="calendarGrid" class="calendar-grid"></div><p class="muted">Choose a day to create a task, or select a task label to edit it.</p></div></section>
        <section class="view" id="view-focus"><div class="panel timer-wrap"><div class="panel-head"><div style="text-align:left"><h3>Focus room</h3><div class="muted">One thing at a time. Make your attention count.</div></div><span class="status" id="sessionBadge">0 sessions today</span></div><div class="mode-switch"><button class="active" data-mode="focus">Focus · 25 min</button><button data-mode="short">Short break · 5 min</button><button data-mode="long">Long break · 15 min</button></div><div class="timer" id="timerDisplay">25:00</div><div class="timer-label" id="timerLabel">Ready when you are.</div><div class="timer-actions"><button class="primary" id="timerStart">Start focus</button><button class="secondary" id="timerReset">Reset</button></div><div class="timer-task"><label class="muted" for="timerTask">What are you focusing on?</label><select class="search" id="timerTask"><option value="">No specific task</option></select></div><p class="footer-note">A completed focus session is saved to your productivity history. Keep this tab open while the timer runs.</p></div></section>
        <section class="view" id="view-reports"><div class="panel"><div class="panel-head"><div><h3>Productivity insights</h3><div class="muted">A clear view of what you have accomplished.</div></div><button class="secondary" id="exportCsv">Export CSV</button></div><div class="stats" style="margin-top:10px"><div class="stat"><div class="stat-top">Completed tasks</div><strong id="repDone">0</strong><small>All time</small></div><div class="stat"><div class="stat-top">Overdue</div><strong id="repOverdue">0</strong><small>Unfinished past due</small></div><div class="stat"><div class="stat-top">Due today</div><strong id="repToday">0</strong><small>Needs attention</small></div><div class="stat"><div class="stat-top">Focus hours</div><strong id="repHours">0</strong><small>Recorded focus time</small></div></div><h3 style="font:800 13px Manrope;margin:22px 0 0">Completed tasks · Last 7 days</h3><div id="reportChart" class="chart"></div><p class="muted">Insights are based on activity stored in this TASKORA account.</p></div></section>
        <section class="view" id="view-billing"><div class="banner"><h3>Make your workflow work harder.</h3><p>Upgrade for a more capable workspace. Pricing below is editable in the server environment before delivery.</p></div><div class="panel"><div class="panel-head"><div><h3>Your plan</h3><div class="muted">Account subscription and payment history.</div></div><span class="status" id="planStatus">FREE PLAN</span></div><p id="planDescription" class="muted">You are currently using the free workspace.</p><div id="currentPeriod" class="muted"></div></div><div class="plans" style="margin-top:12px"><div class="plan"><h4>Free</h4><div class="price">NPR 0 <small>/ forever</small></div><ul><li>Personal task workspace</li><li>Tasks, projects and calendar</li><li>Focus timer and basic reports</li><li>Local preview or cloud account</li></ul><span class="status">Included</span></div><div class="plan featured"><h4>TASKORA Pro</h4><div class="price">NPR <span id="monthlyPrice">499</span> <small>/ 30 days*</small></div><ul><li>Pro account status and billing record</li><li>Support for monthly and yearly access</li><li>Cloud data remains tied to your account</li><li>More premium tools can be added by the product owner</li></ul><button class="primary full" id="buyMonthly">Continue with Khalti · Monthly</button><button class="secondary full" id="buyYearly" style="margin-top:7px">Yearly · NPR <span id="yearlyPrice">4,999</span></button><p class="footer-note">*Example starter prices. Configure and confirm the final prices and terms with the merchant before launch. This gateway flow is one-time checkout with manual renewal, not automatic recurring billing.</p></div></div><div class="panel" style="margin-top:12px"><div class="panel-head"><div><h3>Recent payment activity</h3><div class="muted">Latest checkout records for this account.</div></div></div><div id="paymentHistory" class="task-list"></div></div><p class="footer-note">Payments are unavailable in local demo mode. Hosted checkout and server-side verification require the site owner’s approved Khalti merchant account and server secrets. Do not accept real customer payments until the merchant and deployment are approved.</p></section>
       
<section class="view" id="view-settings">
  <div class="panel">
    <h3 style="font:800 14px Manrope;margin:0 0 6px">Workspace settings</h3>
    <p class="muted">Personalize your workspace and manage your data.</p>

    <div class="setting-row">
      <div>
        <b>Profile</b>
        <p>Update your name and profile photo URL.</p>
      </div>
    </div>

    <div class="field">
      <label for="profileFullName">Full name</label>
      <input id="profileFullName" maxlength="70" placeholder="Your full name">
    </div>

    <div class="field">
      <label for="profileAvatarUrl">Profile photo URL</label>
      <input id="profileAvatarUrl" type="url" placeholder="https://example.com/photo.jpg">
    </div>

    <button class="primary" id="saveProfile">Save changes</button>

    <div class="setting-row">
      <div><b>Appearance</b><p>Switch between light and dark mode.</p></div>
      <button class="secondary" id="settingsTheme">Toggle theme</button>
    </div>

    <div class="setting-row">
      <div><b>Accent color</b><p>Choose a workspace highlight color.</p></div>
      <div class="swatches">
        <button class="swatch" data-accent="purple" style="background:#7565e8"></button>
        <button class="swatch" data-accent="blue" style="background:#4e83d6"></button>
        <button class="swatch" data-accent="rose" style="background:#cc6c91"></button>
        <button class="swatch" data-accent="green" style="background:#299b79"></button>
      </div>
    </div>

    <div class="setting-row">
      <div><b>Projects</b><p>Group related tasks in one place.</p></div>
      <button class="secondary" id="newProject">＋ New project</button>
    </div>

    <div class="setting-row">
      <div><b>Backup data</b><p>Download or restore tasks as a JSON file.</p></div>
      <div style="display:flex;gap:7px">
        <button class="secondary" id="backupExport">Export</button>
        <button class="secondary" id="backupImport">Import</button>
        <input id="backupFile" type="file" accept="application/json,.json" class="hidden">
      </div>
    </div>

    <div class="setting-row">
      <div><b>Browser reminders</b><p>Due-date alerts can appear while this website is open.</p></div>
      <button class="secondary" id="enableNotifications">Enable</button>
    </div>

    <div class="setting-row">
      <div><b>Account</b><p>${escapeHTML(state.user?.email || 'Local demo')}</p></div>
      <button class="secondary" id="accountSignout">Sign out</button>
    </div>

    <p class="footer-note">Cloud mode uses Supabase. Demo mode stores data only in this browser. Browser reminders are not guaranteed while the tab/browser is closed.</p>
  </div>
</section>

      </main>
    </div>
    <div class="modal-backdrop" id="modalBackdrop"><form class="modal" id="taskForm"><h2 id="modalHeading">Create a task</h2><input type="hidden" id="editTaskId"><div class="field"><label for="inputTitle">Task name *</label><input id="inputTitle" maxlength="140" required placeholder="What needs to get done?"></div><div class="field"><label for="inputDescription">Description</label><textarea id="inputDescription" maxlength="1200" placeholder="Add context, notes or next steps…"></textarea></div><div class="form-row"><div class="field"><label for="inputCategory">Category</label><select id="inputCategory"><option>Study</option><option>Work</option><option>Personal</option><option>Health</option><option>Other</option></select></div><div class="field"><label for="inputPriority">Priority</label><select id="inputPriority"><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div></div><div class="form-row"><div class="field"><label for="inputDue">Due date</label><input id="inputDue" type="date"></div><div class="field"><label for="inputStatus">Status</label><select id="inputStatus"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Completed</option></select></div></div><div class="field"><label for="inputProject">Project</label><select id="inputProject"><option value="">No project</option></select></div><div class="modal-actions"><button class="secondary" type="button" id="modalCancel">Cancel</button><button class="primary" type="submit">Save task</button></div></form></div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  bindAppEvents(); applySavedAppearance(); updateTopLabels(); renderAll();
  if (state.mode === 'app') checkDueReminders();
}

function updateTopLabels() {
  const date = new Date();
  $('dateLine').textContent = date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
  $('welcomeDate').textContent = date.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'});
  const avatar = $('avatarInitial');

if (state.profile?.avatar_url) {
  const img = document.createElement('img');
  img.src = state.profile.avatar_url;
  img.alt = 'Profile photo';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
  avatar.replaceChildren(img);
} else {
  avatar.textContent = (state.profile?.full_name || state.user?.email || 'T')
    .slice(0, 1).toUpperCase();
}
if ($('profileFullName')) {
  $('profileFullName').value = state.profile?.full_name || '';
}

if ($('profileAvatarUrl')) {
  $('profileAvatarUrl').value = state.profile?.avatar_url || '';
}

if ($('profileName')) {
  $('profileName').textContent = state.profile?.full_name || 'TASKORA user';
}
  $('navTasks').textContent = state.tasks.length;
}

async function saveProfile() {
  const fullName = $('profileFullName').value.trim();
  const avatarUrl = $('profileAvatarUrl').value.trim();

  if (!fullName) {
    alert('Please enter your full name.');
    return;
  }

  if (fullName.length > 70) {
    alert('Name must be 70 characters or less.');
    return;
  }

  if (avatarUrl) {
    try {
      const url = new URL(avatarUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid URL');
      }
    } catch {
      alert('Please enter a valid image URL starting with https://');
      return;
    }
  }

  try {
    if (state.demo) {
      state.profile = {
        ...state.profile,
        full_name: fullName,
        avatar_url: avatarUrl || null
      };
    } else {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          avatar_url: avatarUrl || null
        })
        .eq('id', state.user.id)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Profile not found. Please sign out and sign in again.');

      state.profile = data;
    }

    $('profileName').textContent = fullName;

    const avatar = $('avatarInitial');

    if (avatarUrl) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = 'Profile photo';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
      avatar.replaceChildren(img);
    } else {
      avatar.textContent = fullName.charAt(0).toUpperCase();
    }

    alert(state.demo
      ? 'Profile updated for this demo session!'
      : 'Profile saved successfully!');
  } catch (error) {
    console.error('Profile save error:', error);
    alert(error.message || 'Could not save your profile.');
  }
}

function bindAppEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => setView(button.dataset.goto)));
  ['quickAdd','taskAdd','boardAdd'].forEach(id => $(id)?.addEventListener('click', () => openTaskModal()));
  $('themeToggle').onclick = toggleTheme; $('settingsTheme').onclick = toggleTheme;
  $('mobileMenu').onclick = () => $('sidebar').classList.toggle('open');
  $('signout').onclick = signOut; $('accountSignout').onclick = signOut;
  $('modalCancel').onclick = closeTaskModal;
  $('modalBackdrop').onclick = (event) => { if (event.target === $('modalBackdrop')) closeTaskModal(); };
  $('taskForm').onsubmit = saveTaskFromForm;
  $('monthPrev').onclick = () => { state.calendarDate.setMonth(state.calendarDate.getMonth()-1); renderCalendar(); };
  $('monthNext').onclick = () => { state.calendarDate.setMonth(state.calendarDate.getMonth()+1); renderCalendar(); };
  $('taskSearch').oninput = (e) => { state.filters.search = e.target.value; renderTaskList(); };
  $('filterStatus').onchange = (e) => { state.filters.status=e.target.value; renderTaskList(); };
  $('filterCategory').onchange = (e) => { state.filters.category=e.target.value; renderTaskList(); };
  $('filterPriority').onchange = (e) => { state.filters.priority=e.target.value; renderTaskList(); };
  $('filterSort').onchange = (e) => { state.filters.sort=e.target.value; renderTaskList(); };
  $('filterProject').onchange = (e) => { state.filters.project=e.target.value; renderTaskList(); };
  $('timerStart').onclick = toggleTimer; $('timerReset').onclick = resetTimer;
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => setTimerMode(button.dataset.mode));
  $('timerTask').onchange = e => state.selectedTaskId = e.target.value;
  $('newProject').onclick = createProject;
  $('saveProfile').onclick = saveProfile;
  $('backupExport').onclick = exportJSON; $('backupImport').onclick = () => $('backupFile').click();
  $('backupFile').onchange = importJSON; $('exportCsv').onclick = exportCSV;
  $('enableNotifications').onclick = enableNotifications;
  $('buyMonthly').onclick = () => buyPlan('pro_monthly'); $('buyYearly').onclick = () => buyPlan('pro_yearly');
  document.querySelectorAll('[data-accent]').forEach(button => button.onclick = () => setAccent(button.dataset.accent));
  document.addEventListener('keydown', handleEscape, { once: true });
}
function handleEscape(event) { if (event.key === 'Escape') closeTaskModal(); document.addEventListener('keydown', handleEscape, { once: true }); }

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  const titles = { dashboard:'Overview', tasks:'Task manager', board:'Project board', calendar:'Calendar', focus:'Focus room', reports:'Productivity insights', billing:'Plans & billing', settings:'Settings' };
  $('pageTitle').textContent = titles[view] || 'Overview';
  $('welcome').classList.toggle('hidden', view !== 'dashboard');
  $('stats').classList.toggle('hidden', !['dashboard','tasks'].includes(view));
  $('sidebar').classList.remove('open');
  if (view === 'calendar') renderCalendar();
  if (view === 'reports') renderReports();
  if (view === 'board') renderBoard();
  if (view === 'billing') renderBilling();
  if (view === 'tasks') renderTaskList();
}

function renderAll() {
  renderStats(); renderDashboard(); renderTaskList(); renderBoard(); renderCalendar(); renderTimer(); renderReports(); renderBilling(); refreshProjectSelect();
}
function renderStats() {
  const completed = state.tasks.filter(task => task.status === 'done').length;
  const doing = state.tasks.filter(task => task.status === 'in_progress').length;
  const rate = state.tasks.length ? Math.round(completed/state.tasks.length*100) : 0;
  $('statTotal').textContent = state.tasks.length; $('statDone').textContent = completed;
  $('statDoing').textContent = doing; $('statRate').textContent = `${rate}%`;
  $('progressText').textContent = `${rate}%`; $('progressFill').style.width = `${rate}%`;
  $('navTasks').textContent = state.tasks.length;
  const categories = ['Study','Work','Personal','Health','Other'];
  const colors = ['#8b7dee','#54a6dc','#dda65b','#45b89a','#dd8199'];
  $('categoryStats').innerHTML = categories.map((category,i) => `<div class="category-row"><i class="dot" style="background:${colors[i]}"></i>${category}<span>${state.tasks.filter(t=>t.category===category).length}</span></div>`).join('');
}
function renderDashboard() {
  const dueToday = state.tasks.filter(task => task.due_date === today() && task.status !== 'done');
  const inProgress = state.tasks.filter(task => task.status === 'in_progress' && task.due_date !== today());
  const list = [...dueToday, ...inProgress].slice(0,6);
  $('todayList').innerHTML = list.length ? list.map(taskHTML).join('') : '<div class="empty">✦<br><b>No urgent items for today.</b><br>Enjoy the breathing room or add a new task.</div>';
  const upcoming = state.tasks.filter(task => task.due_date && task.due_date > today() && task.status !== 'done').sort((a,b)=>a.due_date.localeCompare(b.due_date)).slice(0,5);
  $('upcomingList').innerHTML = upcoming.length ? upcoming.map(task => `<div class="task"><div class="task-body"><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta"><span class="pill">${toDateLabel(task.due_date)}</span><span class="pill ${task.priority}">${escapeHTML(task.priority)}</span></div></div><button class="tiny" data-action="edit" data-id="${task.id}">Edit</button></div>`).join('') : '<div class="empty">Nothing scheduled yet.</div>';
}
function taskHTML(task) {
  const done = task.status === 'done';
  const statusName = task.status === 'in_progress' ? 'In progress' : done ? 'Completed' : 'To do';
  return `<article class="task ${done?'done':''}"><button class="check ${done?'checked':''}" data-action="toggle" data-id="${task.id}" aria-label="Toggle task">${done?'✓':''}</button><div class="task-body"><div class="task-title">${escapeHTML(task.title)}</div>${task.description?`<div class="task-desc">${escapeHTML(task.description)}</div>`:''}<div class="task-meta"><span class="pill">${escapeHTML(task.category)}</span><span class="pill ${task.priority}">${escapeHTML(task.priority)}</span><span class="pill">${statusName}</span>${task.due_date?`<span class="pill">◷ ${toDateLabel(task.due_date)}</span>`:''}</div></div><div class="task-actions"><button class="tiny" data-action="edit" data-id="${task.id}" title="Edit">✎</button><button class="tiny" data-action="delete" data-id="${task.id}" title="Delete">×</button></div></article>`;
}
function filteredTasks() {
  const f = state.filters; let list = [...state.tasks];
  if (f.search) list = list.filter(task => `${task.title} ${task.description||''} ${task.category}`.toLowerCase().includes(f.search.toLowerCase()));
  if (f.status !== 'all') list = list.filter(task => task.status === f.status);
  if (f.category !== 'all') list = list.filter(task => task.category === f.category);
  if (f.priority !== 'all') list = list.filter(task => task.priority === f.priority);
  if (f.project !== 'all') list = list.filter(task => task.project_id === f.project);
  if (f.sort === 'due') list.sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
  else if (f.sort === 'priority') { const order={urgent:0,high:1,medium:2,low:3}; list.sort((a,b)=>order[a.priority]-order[b.priority]); }
  else list.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return list;
}
function renderTaskList() {
  const container = $('taskList'); if (!container) return;
  const list = filteredTasks();
  container.innerHTML = list.length ? list.map(taskHTML).join('') : '<div class="empty">✦<br><b>No matching tasks.</b><br>Try changing your filters or create a new task.</div>';
}
function renderBoard() {
  const board = $('kanban'); if (!board) return;
  const columns = [['todo','To do'],['in_progress','In progress'],['done','Completed']];
  board.innerHTML = columns.map(([status,title]) => {
    const items = state.tasks.filter(task=>task.status===status);
    return `<div class="board-col" data-drop="${status}"><h3>${title}<span class="muted">${items.length}</span></h3>${items.map(task=>`<div class="board-card" draggable="true" data-drag="${task.id}"><b>${escapeHTML(task.title)}</b><div class="muted" style="margin-top:5px">${escapeHTML(task.category)} · ${escapeHTML(task.priority)}${task.due_date?' · '+toDateLabel(task.due_date):''}</div><div style="text-align:right"><button class="tiny" data-action="edit" data-id="${task.id}">Edit</button></div></div>`).join('')||'<div class="empty">Drop tasks here</div>'}</div>`;
  }).join('');
  board.querySelectorAll('[data-drag]').forEach(card => card.ondragstart = event => event.dataTransfer.setData('text/plain',card.dataset.drag));
  board.querySelectorAll('[data-drop]').forEach(column => {
    column.ondragover = event => { event.preventDefault(); column.classList.add('dragover'); };
    column.ondragleave = () => column.classList.remove('dragover');
    column.ondrop = async event => { event.preventDefault(); column.classList.remove('dragover'); const task=state.tasks.find(t=>t.id===event.dataTransfer.getData('text/plain')); if(task){task.status=column.dataset.drop;task.completed_at=task.status==='done'?new Date().toISOString():null;await persistTask(task);renderAll();showToast('Task moved.');} };
  });
}

function renderCalendar() {
  const grid = $('calendarGrid'); if (!grid) return;
  const year=state.calendarDate.getFullYear(),month=state.calendarDate.getMonth();
  $('monthTitle').textContent=state.calendarDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const first=new Date(year,month,1),start=new Date(year,month,1-first.getDay());
  let html=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<div class="cal-name">${day}</div>`).join('');
  for(let index=0;index<42;index++){
    const day=new Date(start);day.setDate(start.getDate()+index);const key=dateKey(day);
    const items=state.tasks.filter(task=>task.due_date===key);
    html+=`<div class="cal-cell ${day.getMonth()!==month?'other':''} ${key===today()?'today':''}" data-date="${key}"><div class="cal-num">${day.getDate()}</div>${items.slice(0,3).map(task=>`<button class="cal-event" data-edit="${task.id}" title="${escapeHTML(task.title)}">${escapeHTML(task.title)}</button>`).join('')}${items.length>3?`<small>+${items.length-3} more</small>`:''}</div>`;
  }
  grid.innerHTML=html;
  grid.onclick=event=>{const item=event.target.closest('[data-edit]');if(item){const task=state.tasks.find(t=>t.id===item.dataset.edit);if(task)openTaskModal(task);return;}const cell=event.target.closest('[data-date]');if(cell)openTaskModal(null,cell.dataset.date);};
}

function renderTimer() {
  const seconds=state.timerRemaining;
  $('timerDisplay').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('timerLabel').textContent=state.timerMode==='focus'?'Time to focus on one thing.':state.timerMode==='short'?'Take a short pause and reset.':'Step away for a longer break.';
  $('timerStart').textContent=state.timerRunning?'Pause':(state.timerRemaining===timerDurations[state.timerMode]?'Start':'Resume');
  $('sessionBadge').textContent=`${state.sessions.filter(s=>new Date(s.ended_at||s.created_at).toDateString()===new Date().toDateString()).length} sessions today`;
  const select=$('timerTask'), selected=state.selectedTaskId;
  select.innerHTML='<option value="">No specific task</option>'+state.tasks.filter(t=>t.status!=='done').map(t=>`<option value="${t.id}">${escapeHTML(t.title)}</option>`).join('');
  select.value=selected;
  document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('active',button.dataset.mode===state.timerMode));
}
const timerDurations={focus:1500,short:300,long:900};
function setTimerMode(mode) { pauseTimer(); state.timerMode=mode;state.timerRemaining=timerDurations[mode];renderTimer(); }
function toggleTimer() {
  if(state.timerRunning){pauseTimer();renderTimer();return;}
  state.timerRunning=true;renderTimer();
  state.timerInterval=setInterval(async()=>{
    state.timerRemaining--;
    if(state.timerRemaining<=0){pauseTimer();if(state.timerMode==='focus')await saveFocusSession();showToast(state.timerMode==='focus'?'Focus session complete. Take a break!':'Break finished. Ready for another round?');if('Notification'in window&&Notification.permission==='granted')new Notification('TASKORA',{body:state.timerMode==='focus'?'Focus session complete — time for a break.':'Break finished — ready to focus?' });state.timerRemaining=0;}
    renderTimer();
  },1000);
}
function pauseTimer(){state.timerRunning=false;if(state.timerInterval)clearInterval(state.timerInterval);state.timerInterval=null;}
function resetTimer(){pauseTimer();state.timerRemaining=timerDurations[state.timerMode];renderTimer();}
async function saveFocusSession(){
  const row={user_id:state.demo?undefined:state.user.id,task_id:state.selectedTaskId||null,duration_seconds:timerDurations.focus,completed:true,started_at:new Date(Date.now()-timerDurations.focus*1000).toISOString(),ended_at:new Date().toISOString()};
  if(state.demo){state.sessions.unshift({...row,id:uid()});saveDemoStorage();}
  else {const {data,error}=await supabase.from('focus_sessions').insert(row).select().single();if(error){showToast(`Could not save focus session: ${error.message}`);return;}state.sessions.unshift(data);}
}

function renderReports(){
  if(!$('reportChart'))return;
  const completed=state.tasks.filter(t=>t.status==='done');
  const overdue=state.tasks.filter(t=>t.status!=='done'&&t.due_date&&t.due_date<today());
  const due=state.tasks.filter(t=>t.status!=='done'&&t.due_date===today());
  const hours=state.sessions.reduce((sum,s)=>sum+(s.duration_seconds||0),0)/3600;
  $('repDone').textContent=completed.length;$('repOverdue').textContent=overdue.length;$('repToday').textContent=due.length;$('repHours').textContent=hours.toFixed(1);
  const days=[];for(let back=6;back>=0;back--){const d=new Date();d.setDate(d.getDate()-back);const key=dateKey(d);const count=completed.filter(t=>t.completed_at&&dateKey(new Date(t.completed_at))===key).length;days.push({label:d.toLocaleDateString(undefined,{weekday:'short'}),count});}
  const max=Math.max(1,...days.map(d=>d.count));$('reportChart').innerHTML=days.map(day=>`<div class="bar-wrap"><span class="bar-value">${day.count}</span><div class="bar" style="height:${Math.max(3,day.count/max*118)}px"></div><span class="bar-label">${day.label}</span></div>`).join('');
}
function renderBilling(){
  if(!$('planStatus'))return;
  if (!state.pricingLoaded && !state.demo && isCloudConfigured) { state.pricingLoaded = true; fetch('/api/config').then(r=>r.ok?r.json():null).then(config=>{if(config){state.pricing=config;$('monthlyPrice').textContent=Number(config.monthlyNpr).toLocaleString();$('yearlyPrice').textContent=Number(config.yearlyNpr).toLocaleString();}}).catch(()=>{}); }
  $('planStatus').textContent=isPro()?'✦ PRO ACTIVE':'FREE PLAN';
  $('planDescription').textContent=isPro()?'Your TASKORA Pro access is active.':'You are using the TASKORA free plan.';
  $('currentPeriod').textContent=state.subscription?.current_period_end?`Access until ${new Date(state.subscription.current_period_end).toLocaleDateString()}`:'No paid plan is active.';
  $('buyMonthly').disabled=state.demo||!isCloudConfigured||isPro();$('buyYearly').disabled=state.demo||!isCloudConfigured||isPro();
  const history = $('paymentHistory');
  if (history) history.innerHTML = state.paymentOrders?.length ? state.paymentOrders.map(order => `<div class="task"><div class="task-body"><div class="task-title">${order.plan_key === 'pro_yearly' ? 'TASKORA Pro · Yearly' : 'TASKORA Pro · Monthly'}</div><div class="task-meta"><span class="pill">NPR ${(Number(order.amount_paisa)/100).toFixed(2)}</span><span class="pill">${escapeHTML(order.status)}</span><span class="pill">${new Date(order.created_at).toLocaleDateString()}</span></div></div></div>`).join('') : '<div class="empty">No payment records yet.</div>';
}

function openTaskModal(task=null,date=''){
  if (!state.demo && !isPro() && !task && state.tasks.filter(t=>t.status!=='done').length >= 50) { showToast('Free plan limit: 50 active tasks. Upgrade to Pro for unlimited tasks.'); setView('billing'); return; }
  state.editingId=task?.id||null;
  $('taskForm').reset(); $('editTaskId').value=task?.id||''; $('modalHeading').textContent=task?'Edit task':'Create a task';
  $('inputTitle').value=task?.title||'';$('inputDescription').value=task?.description||'';$('inputCategory').value=task?.category||'Personal';$('inputPriority').value=task?.priority||'medium';$('inputDue').value=task?.due_date||date;$('inputStatus').value=task?.status||'todo';
  refreshProjectSelect();$('inputProject').value=task?.project_id||'';
  $('modalBackdrop').classList.add('show');setTimeout(()=>$('inputTitle').focus(),40);
}
function closeTaskModal(){ $('modalBackdrop')?.classList.remove('show');state.editingId=null; }
async function saveTaskFromForm(event){
  event.preventDefault();
  const title=$('inputTitle').value.trim();if(!title)return;
  const existing=state.tasks.find(t=>t.id===state.editingId);
  const task={id:state.editingId||uid(),user_id:state.demo?undefined:state.user.id,title,description:$('inputDescription').value.trim(),category:$('inputCategory').value,priority:$('inputPriority').value,status:$('inputStatus').value,due_date:$('inputDue').value||null,project_id:$('inputProject').value||null,sort_order:existing?.sort_order||0,created_at:existing?.created_at||new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:$('inputStatus').value==='done'?(existing?.completed_at||new Date().toISOString()):null};
  try{await persistTask(task);closeTaskModal();renderAll();showToast(existing?'Task updated.':'Task created.');}catch(error){showToast(error.message||'Could not save task.');}
}

function friendlyError(error) {
  const message = String(error?.message || '').toLowerCase();

  if (
    !navigator.onLine ||
    message.includes('failed to fetch') ||
    message.includes('network')
  ) {
    return "You're offline or your connection was interrupted. Your change wasn't saved. Please reconnect and try again.";
  }

  return error?.message || 'Something went wrong. Please try again.';
}

async function persistTask(task){
  if(state.demo){const index=state.tasks.findIndex(t=>t.id===task.id);if(index>=0)state.tasks[index]=task;else state.tasks.unshift(task);saveDemoStorage();return task;}
  const clean={...task};delete clean.id;if(state.tasks.some(t=>t.id===task.id)){
    const {data,error}=await supabase.from('tasks').update(clean).eq('id',task.id).select().single();if(error)throw error;Object.assign(task,data);
  }else{
    const {data,error}=await supabase.from('tasks').insert(clean).select().single();if(error)throw error;Object.assign(task,data);state.tasks.unshift(data);
  }
  const index=state.tasks.findIndex(t=>t.id===task.id);if(index>=0)state.tasks[index]=task;else state.tasks.unshift(task);return task;
}
async function deleteTask(taskId){
  if(!confirm('Delete this task? This cannot be undone.'))return;
  if(state.demo){state.tasks=state.tasks.filter(t=>t.id!==taskId);saveDemoStorage();}
  else{const {error}=await supabase.from('tasks').delete().eq('id',taskId);if(error)return showToast(error.message);state.tasks=state.tasks.filter(t=>t.id!==taskId);}
  renderAll();showToast('Task deleted.');
}
async function toggleTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const previousStatus = task.status;
  const previousCompletedAt = task.completed_at;

  task.status = previousStatus === 'done' ? 'todo' : 'done';
  task.completed_at = task.status === 'done'
    ? new Date().toISOString()
    : null;

  try {
    await persistTask(task);
    renderAll();

    showToast(
      task.status === 'done'
        ? 'Task completed. Nice work!'
        : 'Task reopened.'
    );
  } catch (error) {
    task.status = previousStatus;
    task.completed_at = previousCompletedAt;

    renderAll();
    showToast(friendlyError(error));
  }
}


async function createProject(){
  if (!state.demo && !isPro() && state.projects.length >= 2) { showToast('Free plan limit: 2 active projects. Upgrade to Pro for unlimited projects.'); setView('billing'); return; }
  const name=prompt('Name your new project (up to 70 characters):');if(name===null)return;const clean=name.trim().slice(0,70);if(!clean)return;
  try{
    let project={id:uid(),name:clean,color:'#7565e8',archived:false,user_id:state.demo?undefined:state.user.id,created_at:new Date().toISOString()};
    if(!state.demo){const {data,error}=await supabase.from('projects').insert({name:clean,color:project.color,user_id:state.user.id}).select().single();if(error)throw error;project=data;}
    state.projects.push(project);if(state.demo)saveDemoStorage();refreshProjectSelect();showToast('Project created.');
  }catch(error){showToast(error.message||'Could not create project.');}
}
function refreshProjectSelect(){
  const select=$('inputProject');if(select){const selected=select.value;select.innerHTML='<option value="">No project</option>'+state.projects.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');select.value=selected;}
  const filter=$('filterProject');if(filter){const selected=filter.value;filter.innerHTML='<option value="all">All projects</option>'+state.projects.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');filter.value=selected;}
}

function applySavedAppearance(){
  if(localStorage.getItem(THEME_STORE)==='dark')document.body.classList.add('dark');
  const accent=localStorage.getItem(ACCENT_STORE)||'purple';document.body.dataset.accent=accent;
  document.querySelectorAll('[data-accent]').forEach(b=>b.classList.toggle('selected',b.dataset.accent===accent));
}
function toggleTheme(){document.body.classList.toggle('dark');localStorage.setItem(THEME_STORE,document.body.classList.contains('dark')?'dark':'light');}
function setAccent(accent){document.body.dataset.accent=accent;localStorage.setItem(ACCENT_STORE,accent);document.querySelectorAll('[data-accent]').forEach(b=>b.classList.toggle('selected',b.dataset.accent===accent));}
async function enableNotifications(){
  if(!('Notification'in window))return showToast('This browser does not support notifications.');
  const permission=await Notification.requestPermission();showToast(permission==='granted'?'Browser notifications enabled. Keep TASKORA open for due-date alerts.':'Notification permission was not granted.');
}
function checkDueReminders(){
  if(!('Notification'in window)||Notification.permission!=='granted')return;
  if(state.lastReminderDay===today())return;
  const due=state.tasks.filter(t=>t.status!=='done'&&t.due_date===today());
  if(due.length){new Notification('TASKORA · Daily reminder',{body:`You have ${due.length} unfinished task${due.length===1?'':'s'} due today.`});state.lastReminderDay=today();}
}

function exportJSON(){
  const payload={app:'TASKORA Pro',version:1,exportedAt:new Date().toISOString(),tasks:state.tasks,projects:state.projects,sessions:state.sessions};
  downloadFile(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`taskora-backup-${today()}.json`);
  showToast('Backup downloaded.');
}
function importJSON(event){
  const file=event.target.files?.[0];if(!file)return;
  const reader=new FileReader();reader.onload=async()=>{
    try{
      const data=JSON.parse(reader.result);if(!Array.isArray(data.tasks))throw new Error('This is not a TASKORA backup.');
      if(!confirm(`Import ${data.tasks.length} tasks? Existing tasks will be kept; imported tasks will be added.`))return;
      for(const item of data.tasks){const task={...item,id:uid(),user_id:state.demo?undefined:state.user.id};delete task.createdAt; if(!task.title&&task.name)task.title=task.name;if(!task.title)continue;task.status=['todo','in_progress','done'].includes(task.status)?task.status:((task.completed||task.done)?'done':'todo');task.category=task.category||'Personal';task.priority=['low','medium','high','urgent'].includes(task.priority)?task.priority:'medium';task.due_date=task.due_date||task.dueDate||null;task.project_id=null;task.user_id=state.demo?undefined:state.user.id;delete task.name;delete task.completed;delete task.done;await persistTask(task);}
      renderAll();showToast('Backup imported.');
    }catch(error){showToast(error.message||'Could not import this backup.');}
  };reader.readAsText(file);event.target.value='';
}
function exportCSV(){
  if (!isPro() && !state.demo) { showToast('CSV export is a TASKORA Pro feature. Upgrade to unlock it.'); setView('billing'); return; }
  if (state.demo) { showToast('CSV export is available after setting up a Pro account.'); return; }
  const rows=[['Task','Description','Category','Priority','Status','Due date','Created'],...state.tasks.map(t=>[t.title,t.description,t.category,t.priority,t.status,t.due_date,t.created_at])];
  const csv=rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  downloadFile(new Blob([csv],{type:'text/csv;charset=utf-8'}),`taskora-tasks-${today()}.csv`);showToast('CSV report downloaded.');
}
function downloadFile(blob,name){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1200);}

async function buyPlan(plan){
  if(state.demo)return showToast('Payments are disabled in demo mode.');
  if(!state.session?.access_token)return showToast('Please sign in again before checkout.');
  try{
    $('buyMonthly').disabled=true;$('buyYearly').disabled=true;
    const checkout=await startKhaltiCheckout(plan,state.session.access_token);
    if(!checkout.paymentUrl)throw new Error('Khalti did not provide a checkout link.');
    location.assign(checkout.paymentUrl);
  }catch(error){showToast(error.message||'Could not start payment.');renderBilling();}
}
async function handlePaymentReturn(){
  const params=new URLSearchParams(location.search);const pidx=params.get('pidx');const payment=params.get('payment');
  if(payment!=='return'||!pidx||!state.session?.access_token)return;
  history.replaceState({},'',location.pathname);
  try{const result=await verifyKhaltiCheckout(pidx,state.session.access_token);await loadCloudData();renderAll();renderBilling();showToast(result.message||'Payment verified. TASKORA Pro is active.');}
  catch(error){showToast(error.message||'Payment could not be verified.');}
}

async function signOut(){
  pauseTimer();
  if(!state.demo&&supabase)await supabase.auth.signOut();
  if (state.syncChannel && supabase) { await supabase.removeChannel(state.syncChannel); state.syncChannel = null; }
  state={...state,mode:'auth',user:null,session:null,demo:false,profile:null,tasks:[],projects:[],sessions:[],paymentOrders:[],subscription:{plan:'free',status:'active'},view:'dashboard',pricingLoaded:false,pricing:{monthlyNpr:499,yearlyNpr:4999}};
  renderAuth();
}

// Delegated actions for dynamically rendered task cards and calendar labels.
document.addEventListener('click', async (event) => {
  const button=event.target.closest('[data-action]');if(!button)return;
  const {action,id}=button.dataset;
  if(action==='edit'){const task=state.tasks.find(t=>t.id===id);if(task)openTaskModal(task);}
  if(action==='delete')await deleteTask(id);
  if(action==='toggle')await toggleTask(id);
});

async function init(){
  if(localStorage.getItem(THEME_STORE)==='dark')document.body.classList.add('dark');
  if(supabase){
    const {data:{session}}=await supabase.auth.getSession();
    supabase.auth.onAuthStateChange((_event,newSession)=>{
      if (newSession) { state.session = newSession; state.user = newSession.user; }
      else if(state.mode==='app'&&!state.demo){state.mode='auth';renderAuth();}
    });
    if(session){await startCloudApp(session,session.user);return;}
  }
  renderAuth();
}

init().catch(error=>{console.error(error);$('app').innerHTML=`<div class="auth-card-wrap"><div class="auth-card"><h2>Could not start TASKORA</h2><p>${escapeHTML(error.message)}</p><button class="secondary" onclick="location.reload()">Reload</button></div></div>`;});
