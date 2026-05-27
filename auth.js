// auth.js — Supabase Auth for Grind & Flow
// Manages session state and renders the login/signup screen.
// Calls App.init() once a valid session is confirmed.
// Kept isolated from data.js and app.js — swap Auth.signIn/signOut freely.

// ─────────────────────────────────────────────
// Configuration — fill in your Supabase project values
// ─────────────────────────────────────────────
const SUPABASE_URL      = 'https://copzqbnjoakvcrvmedev.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TY5kq56dLCyx963UGdQkpw_DyePssyd';

const Auth = (() => {
  let _client      = null;
  let _session     = null;
  let _activeTab   = 'signin';

  // ── Init: connect to Supabase and resolve the current session ──
  async function init() {
    try {
      _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      Data.setClient(_client); // inject into data.js before any load call

      const { data: { session }, error } = await _client.auth.getSession();
      if (error) throw error;
      _session = session;

      if (session) {
        _showApp();
      } else {
        _showAuthOverlay();
      }

      // Listen for session changes — covers token refresh, cross-tab sign-out, etc.
      _client.auth.onAuthStateChange((_event, session) => {
        _session = session;
        if (session) {
          _showApp();
        } else {
          _hideApp();
          _showAuthOverlay();
        }
      });
    } catch (err) {
      console.error('Auth.init failed:', err);
      // Always show the auth overlay so the page is never blank
      _showAuthOverlay();
      _showMessage('Connection error — please check your network and try again.', 'error');
    }
  }

  // ── Public session accessors ──
  function getSession()     { return _session; }
  function getCurrentUser() { return _session?.user ?? null; }

  // ── Auth actions ──
  async function signIn(email, password) {
    const { data, error } = await _client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    _session = data.session;
    return data;
  }

  async function signUp(email, password) {
    const { data, error } = await _client.auth.signUp({ email, password });
    if (error) throw error;
    _session = data.session;
    return data;
  }

  async function signOut() {
    await _client.auth.signOut();
    _session = null;
    // onAuthStateChange will handle the UI transition
  }

  // ── UI: show / hide app ──
  async function _showApp() {
    const overlay = document.getElementById('auth-overlay');
    const app     = document.getElementById('app');
    if (overlay) overlay.style.display = 'none';
    if (app)     app.style.display = '';   // restores CSS flex
    // Guard so DOMContentLoaded + onAuthStateChange don't double-init
    if (typeof App !== 'undefined' && !App._initialized) {
      await App.init(); // App.init() is async — awaits Data.load()
    }
  }

  function _hideApp() {
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    // Allow App to re-initialize on next login
    if (typeof App !== 'undefined') App._initialized = false;
  }

  // ── UI: auth overlay ──
  function _showAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      _renderForm();
    }
  }

  function showTab(tab) {
    _activeTab = tab;
    document.getElementById('atab-in')?.classList.toggle('active', tab === 'signin');
    document.getElementById('atab-up')?.classList.toggle('active', tab === 'signup');
    _renderForm();
    _clearMessage();
  }

  function _renderForm() {
    const container = document.getElementById('auth-form');
    if (!container) return;
    const isSignIn = _activeTab === 'signin';
    container.innerHTML = `
      <div class="auth-field">
        <label class="auth-label">Email</label>
        <input type="email" id="auth-email" class="auth-input"
          placeholder="you@example.com" autocomplete="email" />
      </div>
      <div class="auth-field">
        <label class="auth-label">Password</label>
        <input type="password" id="auth-password" class="auth-input"
          placeholder="${isSignIn ? '••••••••' : '8+ characters'}"
          autocomplete="${isSignIn ? 'current-password' : 'new-password'}"
          onkeydown="if(event.key==='Enter')Auth.handleSubmit()" />
      </div>
      <button class="auth-submit" onclick="Auth.handleSubmit()">
        ${isSignIn ? 'Sign In →' : 'Create Account →'}
      </button>`;
    setTimeout(() => document.getElementById('auth-email')?.focus(), 50);
  }

  async function handleSubmit() {
    const email    = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    if (!email || !password) { _showMessage('Please fill in all fields.', 'error'); return; }

    const btn = document.querySelector('.auth-submit');
    if (btn) {
      btn.disabled    = true;
      btn.textContent = _activeTab === 'signin' ? 'Signing in…' : 'Creating account…';
    }
    _clearMessage();

    try {
      if (_activeTab === 'signin') {
        await signIn(email, password);
      } else {
        const data = await signUp(email, password);
        // Supabase requires email confirmation by default — handle gracefully
        if (!data.session) {
          _showMessage('Account created — check your email to confirm, then sign in.', 'note');
          if (btn) { btn.disabled = false; btn.textContent = 'Create Account →'; }
          showTab('signin');
          return;
        }
      }
      // onAuthStateChange and/or _showApp handle the rest
    } catch (err) {
      _showMessage(err.message || 'Something went wrong. Please try again.', 'error');
      if (btn) {
        btn.disabled    = false;
        btn.textContent = _activeTab === 'signin' ? 'Sign In →' : 'Create Account →';
      }
    }
  }

  async function handleLogout() {
    await signOut();
    // onAuthStateChange fires → _hideApp() + _showAuthOverlay()
  }

  function _showMessage(msg, type) {
    const el = document.getElementById('auth-message');
    if (!el) return;
    el.textContent    = msg;
    el.className      = 'auth-message ' + (type || 'error');
    el.style.display  = 'block';
  }

  function _clearMessage() {
    const el = document.getElementById('auth-message');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  }

  return {
    init,
    getSession, getCurrentUser,
    signIn, signUp, signOut,
    showTab, handleSubmit, handleLogout,
  };
})();

document.addEventListener('DOMContentLoaded', () => Auth.init());
