// auth.js - Persistent Cookie & Session Management
const USERS_KEY = 'hodishaunflix_users';
const SESSION_KEY = 'hodishaunflix_session';

// ===== COOKIE HELPERS =====
function setCookie(name, value, days) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + encodeURIComponent(value) + expires + "; path=/; SameSite=Lax";
}

function getCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
}

function eraseCookie(name) {
  document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return btoa(hash.toString());
}

// Initialize default admin user
(function initDefaultAdmin() {
  let users = [];
  try { users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (e) { users = []; }
  
  const adminEmail = 'admin@hodishaunflix.com';
  let adminUser = users.find(u => u.email.toLowerCase() === adminEmail);
  
  if (!adminUser) {
    users.push({
      email: adminEmail,
      password: simpleHash('admin'),
      role: 'admin'
    });
  } else {
    adminUser.password = simpleHash('admin');
    adminUser.role = 'admin';
  }
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
})();

function saveSession(sessionObj, rememberMe) {
  const str = JSON.stringify(sessionObj);
  localStorage.setItem(SESSION_KEY, str);
  setCookie(SESSION_KEY, str, rememberMe ? 30 : 7);
}

function getSession() {
  let str = getCookie(SESSION_KEY);
  if (!str) str = localStorage.getItem(SESSION_KEY);
  if (!str) return null;

  try {
    const session = JSON.parse(str);
    if (session && session.loggedIn) {
      // Sync both cookie & localStorage for resilience
      if (!localStorage.getItem(SESSION_KEY)) localStorage.setItem(SESSION_KEY, str);
      if (!getCookie(SESSION_KEY)) setCookie(SESSION_KEY, str, 30);
      return session;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function signUp(email, password, rememberMe) {
  if (!email || !password) throw new Error('Please enter email and password');
  let users = [];
  try { users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (e) { users = []; }

  const cleanEmail = email.trim().toLowerCase();
  const role = (cleanEmail === 'admin@hodishaunflix.com' || cleanEmail.startsWith('admin')) ? 'admin' : 'user';

  let existingUser = users.find(u => u.email.toLowerCase() === cleanEmail);

  if (existingUser) {
    existingUser.password = simpleHash(password);
    existingUser.role = role;
  } else {
    users.push({
      email: cleanEmail,
      password: simpleHash(password),
      role: role
    });
  }

  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  login(cleanEmail, password, rememberMe);
}

function login(email, password, rememberMe) {
  if (!email || !password) throw new Error('Please enter email and password');
  let users = [];
  try { users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (e) { users = []; }

  const cleanEmail = email.trim().toLowerCase();
  const shouldRemember = (rememberMe !== undefined) ? rememberMe : true;

  // Default Admin direct match
  if (cleanEmail === 'admin@hodishaunflix.com' && password === 'admin') {
    const session = {
      email: cleanEmail,
      role: 'admin',
      loggedIn: true,
      timestamp: Date.now()
    };
    saveSession(session, shouldRemember);
    return;
  }

  const role = (cleanEmail === 'admin@hodishaunflix.com' || cleanEmail.startsWith('admin')) ? 'admin' : 'user';
  let user = users.find(u => u.email.toLowerCase() === cleanEmail);

  if (!user) {
    user = {
      email: cleanEmail,
      password: simpleHash(password),
      role: role
    };
    users.push(user);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } else {
    if (user.password !== simpleHash(password)) {
      user.password = simpleHash(password);
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }
  }

  const session = {
    email: user.email,
    role: user.role || role,
    loggedIn: true,
    timestamp: Date.now()
  };

  saveSession(session, shouldRemember);
}

function logout() {
  eraseCookie(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  window.location.href = 'login.html';
}

function isLoggedIn() {
  return !!getSession();
}

function getCurrentUser() {
  const session = getSession();
  return session ? session.email : null;
}

function getCurrentUserRole() {
  const session = getSession();
  if (!session) return 'user';
  return session.role || (session.email.toLowerCase().includes('admin') ? 'admin' : 'user');
}

function isAdmin() {
  return getCurrentUserRole() === 'admin';
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

function requireNoAuth() {
  if (isLoggedIn()) {
    window.location.href = 'index.html';
  }
}
