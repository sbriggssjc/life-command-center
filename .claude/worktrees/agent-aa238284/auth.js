// ============================================================================
// Frontend Auth Module — Supabase JWT Authentication
// Life Command Center — Production Readiness
//
// Handles browser-side authentication:
//   1. Supabase Auth sign-in (email/password or magic link)
//   2. JWT session management with auto-refresh
//   3. Authenticated API call wrapper
//   4. Login/logout UI rendering
//   5. Graceful dev-mode fallback
//
// Usage:
//   await LCC_AUTH.init();  // Call on page load
//   const data = await LCC_AUTH.apiFetch('/api/queue?_version=v2&view=my_work');
//   LCC_AUTH.signOut();
//
// The module reads config from /api/admin?_route=auth-config which returns
// the public Supabase URL and anon key (never the service role key).
// ============================================================================

const LCC_AUTH = (() => {
  // State
  let supabase = null;
  let session = null;
  let user = null;
  let lccUser = null; // resolved LCC user with workspace info
  let initialized = false;
  let authMode = 'unknown'; // 'jwt', 'dev-fallback', 'loading'

  // Config (loaded from server)
  let config = {
    supabaseUrl: null,
    supabaseAnonKey: null,
    lccApiKey: null,  // Phase 6b: API key fallback for single-user deployments
    env: 'development'
  };

  // ---- Init: load Supabase client + restore session ----

  async function init() {
    if (initialized) return;
    authMode = 'loading';

    // 1. Load auth config from server
    try {
      const resp = await fetch('/api/admin?_route=auth-config');
      if (resp.ok) {
        const data = await resp.json();
        config.supabaseUrl = data.supabase_url || null;
        config.supabaseAnonKey = data.supabase_anon_key || null;
        config.lccApiKey = data.lcc_api_key || null;
        config.env = data.env || 'development';
      }
    } catch (e) {
      console.warn('[LCC Auth] Could not load auth config:', e.message);
    }

    // 2. If no Supabase config, fall back to dev mode
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.info('[LCC Auth] No Supabase auth config — running in dev fallback mode');
      authMode = 'dev-fallback';
      initialized = true;
      renderAuthState();
      return;
    }

    // 3. Initialize Supabase client
    if (typeof window.supabase === 'undefined') {
      // Load Supabase JS v2 from CDN
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
    }

    supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true // for magic link callback
      }
    });

    // 4. Check for existing session
    const { data: { session: existingSession } } = await supabase.auth.getSession();
    if (existingSession) {
      session = existingSession;
      user = existingSession.user;
      authMode = 'jwt';
      await resolveLccUser();
    } else {
      authMode = config.env === 'development' ? 'dev-fallback' : 'unauthenticated';
    }

    // 5. Listen for auth state changes
    supabase.auth.onAuthStateChange((event, newSession) => {
      session = newSession;
      user = newSession?.user || null;

      if (event === 'SIGNED_IN') {
        authMode = 'jwt';
        resolveLccUser().then(renderAuthState);
      } else if (event === 'SIGNED_OUT') {
        lccUser = null;
        authMode = config.env === 'development' ? 'dev-fallback' : 'unauthenticated';
        renderAuthState();
      } else if (event === 'TOKEN_REFRESHED') {
        // Session auto-refreshed — update silently
        session = newSession;
      }
    });

    initialized = true;
    renderAuthState();
  }

  // ---- Resolve LCC user from the API using the JWT ----

  async function resolveLccUser() {
    if (!session?.access_token) return;

    try {
      const resp = await fetch('/api/admin?_route=me', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      if (resp.ok) {
        lccUser = await resp.json();
        // Update the global LCC_USER object (used by app.js)
        if (typeof LCC_USER !== 'undefined') {
          Object.assign(LCC_USER, {
            id: lccUser.id,
            email: lccUser.email,
            display_name: lccUser.display_name,
            avatar_url: lccUser.avatar_url,
            first_name: lccUser.display_name?.split(' ')[0] || '',
            workspace_id: lccUser.memberships?.[0]?.workspace_id,
            workspace_name: lccUser.memberships?.[0]?.workspace_name,
            role: lccUser.memberships?.[0]?.role,
            memberships: lccUser.memberships || [],
            _loaded: true
          });
        }
      }
    } catch (e) {
      console.warn('[LCC Auth] Could not resolve LCC user:', e.message);
    }
  }

  // ---- Authenticated API fetch wrapper ----

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };

    // Attach JWT if we have a session
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    // Always set content type for POST/PATCH
    if ((options.method === 'POST' || options.method === 'PATCH') && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const resp = await fetch(url, { ...options, headers });

    // Handle 401 — session may have expired
    if (resp.status === 401 && session) {
      // Try to refresh the session
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      if (refreshed) {
        session = refreshed;
        headers['Authorization'] = `Bearer ${refreshed.access_token}`;
        return fetch(url, { ...options, headers });
      } else {
        // Refresh failed — sign out
        await signOut();
        showLoginModal();
        throw new Error('Session expired — please sign in again');
      }
    }

    return resp;
  }

  // ---- Sign in with email/password ----

  async function signInWithPassword(email, password) {
    if (!supabase) throw new Error('Auth not initialized');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    session = data.session;
    user = data.user;
    authMode = 'jwt';
    await resolveLccUser();
    renderAuthState();
    return data;
  }

  // ---- Sign in with magic link ----

  async function signInWithMagicLink(email) {
    if (!supabase) throw new Error('Auth not initialized');

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin
      }
    });
    if (error) throw error;
    return { message: 'Check your email for a sign-in link' };
  }

  // ---- Sign out ----

  async function signOut() {
    if (supabase) {
      await supabase.auth.signOut();
    }
    session = null;
    user = null;
    lccUser = null;
    authMode = config.env === 'development' ? 'dev-fallback' : 'unauthenticated';
    renderAuthState();
  }

  // ---- UI: Render auth state in the header ----

  function renderAuthState() {
    const container = document.getElementById('auth-status');
    if (!container) return;

    if (authMode === 'jwt' && user) {
      const name = lccUser?.display_name || user.email?.split('@')[0] || 'User';
      const avatar = lccUser?.avatar_url
        ? `<img src="${lccUser.avatar_url}" class="auth-avatar" alt="${name}">`
        : `<div class="auth-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`;

      container.innerHTML = `
        <div class="auth-user-info">
          ${avatar}
          <span class="auth-user-name">${name}</span>
          <button class="auth-sign-out-btn" onclick="LCC_AUTH.signOut()" title="Sign out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
          </button>
        </div>
      `;
    } else if (authMode === 'dev-fallback') {
      container.innerHTML = `
        <div class="auth-dev-badge" title="Running in dev mode — no authentication required">
          <span style="font-size:11px;opacity:0.6;">DEV MODE</span>
        </div>
      `;
    } else if (authMode === 'unauthenticated') {
      container.innerHTML = `
        <button class="auth-sign-in-btn" onclick="LCC_AUTH.showLoginModal()">Sign In</button>
      `;
    } else {
      container.innerHTML = '';
    }
  }

  // ---- UI: Login modal ----

  function showLoginModal() {
    // Remove existing modal if present
    const existing = document.getElementById('lcc-login-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'lcc-login-modal';
    modal.innerHTML = `
      <div class="login-overlay" onclick="LCC_AUTH.hideLoginModal()">
        <div class="login-card" onclick="event.stopPropagation()">
          <h2>Life Command Center</h2>
          <p style="color:var(--text3);margin-bottom:20px;">Sign in to continue</p>

          <form id="lcc-login-form" onsubmit="return LCC_AUTH._handleLoginSubmit(event)">
            <input type="email" id="lcc-login-email" placeholder="Email" required
                   style="width:100%;padding:10px;margin-bottom:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);">
            <input type="password" id="lcc-login-password" placeholder="Password (or leave blank for magic link)"
                   style="width:100%;padding:10px;margin-bottom:14px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);">
            <div id="lcc-login-error" style="color:#ef4444;font-size:13px;margin-bottom:10px;display:none;"></div>
            <button type="submit" style="width:100%;padding:10px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;">
              Sign In
            </button>
          </form>

          <div style="text-align:center;margin-top:12px;">
            <button onclick="LCC_AUTH.hideLoginModal()" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:12px;">Cancel</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Focus email field
    setTimeout(() => document.getElementById('lcc-login-email')?.focus(), 100);
  }

  function hideLoginModal() {
    const modal = document.getElementById('lcc-login-modal');
    if (modal) modal.remove();
  }

  async function _handleLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('lcc-login-email')?.value?.trim();
    const password = document.getElementById('lcc-login-password')?.value;
    const errorEl = document.getElementById('lcc-login-error');

    if (!email) return false;

    try {
      if (password) {
        await signInWithPassword(email, password);
        hideLoginModal();
      } else {
        const result = await signInWithMagicLink(email);
        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.style.color = '#22c55e';
          errorEl.textContent = result.message;
        }
      }
    } catch (e) {
      if (errorEl) {
        errorEl.style.display = 'block';
        errorEl.style.color = '#ef4444';
        errorEl.textContent = e.message || 'Sign-in failed';
      }
    }

    return false;
  }

  // ---- Utility: load external script ----

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // ---- Public API ----

  return {
    init,
    apiFetch,
    signInWithPassword,
    signInWithMagicLink,
    signOut,
    showLoginModal,
    hideLoginModal,
    _handleLoginSubmit,

    // Getters
    get isAuthenticated() { return authMode === 'jwt' && !!session; },
    get isDevMode() { return authMode === 'dev-fallback'; },
    get user() { return lccUser || user; },
    get session() { return session; },
    get authMode() { return authMode; },
    get accessToken() { return session?.access_token || null; },
    get apiKey() { return config.lccApiKey || null; }
  };
})();

// ============================================================================
// Global Fetch Interceptor — Auto-attach JWT to all /api/ requests
//
// Patches window.fetch so every existing fetch('/api/...') call across all
// frontend files (app.js, gov.js, dialysis.js, ops.js, etc.) automatically
// gets the Authorization header when the user is authenticated.
// This eliminates the need to update hundreds of individual fetch calls.
// Only intercepts same-origin /api/ requests — external fetches are untouched.
// ============================================================================
(function() {
  const _originalFetch = window.fetch;

  window.fetch = function(input, init) {
    // Determine the URL string
    const url = (input instanceof Request) ? input.url : String(input);

    // Only intercept /api/ calls (same-origin API requests)
    if (url.startsWith('/api/') || url.startsWith(location.origin + '/api/')) {
      if (typeof LCC_AUTH !== 'undefined') {
        init = init || {};
        init.headers = init.headers || {};

        const isHeaders = init.headers instanceof Headers;
        const hasAuth = isHeaders
          ? init.headers.has('Authorization')
          : (init.headers['Authorization'] || init.headers['authorization']);

        if (!hasAuth) {
          // 1. Prefer JWT if available
          if (LCC_AUTH.accessToken) {
            if (isHeaders) {
              init.headers.set('Authorization', 'Bearer ' + LCC_AUTH.accessToken);
            } else {
              init.headers['Authorization'] = 'Bearer ' + LCC_AUTH.accessToken;
            }
          }
          // 2. Fall back to API key if configured (Phase 6b)
          else if (LCC_AUTH.apiKey) {
            if (isHeaders) {
              init.headers.set('X-LCC-Key', LCC_AUTH.apiKey);
            } else {
              init.headers['X-LCC-Key'] = LCC_AUTH.apiKey;
            }
          }
        }

        // Auto-inject workspace header if available and not already set
        if (typeof LCC_USER !== 'undefined' && LCC_USER.workspace_id) {
          const hasWs = isHeaders
            ? init.headers.has('x-lcc-workspace')
            : (init.headers['x-lcc-workspace']);
          if (!hasWs) {
            if (isHeaders) {
              init.headers.set('x-lcc-workspace', LCC_USER.workspace_id);
            } else {
              init.headers['x-lcc-workspace'] = LCC_USER.workspace_id;
            }
          }
        }
      }
    }

    return _originalFetch.call(window, input, init);
  };
})();
