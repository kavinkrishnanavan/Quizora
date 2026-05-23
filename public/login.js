(function () {
  "use strict";

  var state = {
    initPromise: null,
    ready: false,
    user: null,
    listeners: [],
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(el, text) {
    if (!el) return;
    el.innerText = text || "";
  }

  function show(el, visible) {
    if (!el) return;
    el.style.display = visible ? "block" : "none";
  }

  function openAccountModal() {
    var modal = byId("accountModal");
    if (modal) {
      modal.style.display = "block";
      document.body.style.overflow = "hidden";
      return;
    }

    try {
      var returnTo = window.location.pathname.split("/").pop() || "index.html";
      var qs = window.location.search || "";
      var hash = window.location.hash || "";
      var full = returnTo + qs + hash;
      window.location.href = "login.html?returnTo=" + encodeURIComponent(full);
    } catch (_) {}
  }

  function closeAccountModal() {
    var modal = byId("accountModal");
    if (!modal) return;
    modal.style.display = "none";
    document.body.style.overflow = "";
  }

  function updateAuthUi(user) {
    var signedOut = byId("accountSignedOut");
    var signedIn = byId("accountSignedIn");
    var emailDisplay = byId("accountEmailDisplay");
    var status = byId("authStatus");
    var signOutBtn = byId("signOutBtn");
    var navSignOutBtn = byId("navSignOutBtn");

    if (navSignOutBtn) navSignOutBtn.hidden = !user;

    if (!signedOut || !signedIn) return;

    if (user) {
      setText(status, "");
      show(signedOut, false);
      show(signedIn, true);
      setText(emailDisplay, user.email || "");
      if (signOutBtn) signOutBtn.disabled = false;
    } else {
      setText(status, "Enter email and password to sign in.");
      show(signedOut, true);
      show(signedIn, false);
      setText(emailDisplay, "");
      if (signOutBtn) signOutBtn.disabled = true;
    }
  }

  function emitAuthChange(user) {
    state.user = user || null;
    updateAuthUi(state.user);

    for (var i = 0; i < state.listeners.length; i++) {
      try {
        state.listeners[i](state.user);
      } catch (err) {
        // eslint-disable-next-line no-console
        if (err == "Firebase: Password should be at least 6 characters (auth/weak-password).") {

          console.error("Password should be at least 6 characters.")

        }
        else if (err == "Firebase: The supplied auth credential is incorrect, malformed or has expired. (auth/invalid-credential).") {
          console.log("Incorrect Credentials.")

        }
        
        else {

          console.log("Unexpected Error");

          console.log(err);


        }
        
      }
    }
  }

  async function fetchFirebaseConfig() {
    var res = await fetch("/.netlify/functions/firebase-config");
    var data = null;
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok || !data || !data.config) {
      throw new Error((data && data.error) || "Missing Firebase config.");
    }
    return data.config;
  }

  async function init() {
    if (state.initPromise) return state.initPromise;

    state.initPromise = (async function () {
      if (!window.firebase || !firebase.initializeApp || !firebase.auth) {
        throw new Error("Firebase SDK not loaded.");
      }

      var config = await fetchFirebaseConfig();

      try {
        if (firebase.apps && firebase.apps.length) {
          // already initialised
        } else {
          firebase.initializeApp(config);
        }
      } catch (_) {
        // ignore double-init errors
      }

      state.ready = true;

      firebase.auth().onAuthStateChanged(function (user) {
        emitAuthChange(user || null);
      });

      return true;
    })().catch(function (err) {
      state.ready = false;
      emitAuthChange(null);
      var status = byId("authStatus");
      if (status) setText(status, err && err.message ? err.message : "Auth unavailable.");
      throw err;
    });

    return state.initPromise;
  }

  async function signUp() {
    await init();
    var email = String((byId("authEmail") && byId("authEmail").value) || "").trim();
    var password = String((byId("authPassword") && byId("authPassword").value) || "");
    if (!email || !password) throw new Error("Enter an email and password.");
    await firebase.auth().createUserWithEmailAndPassword(email, password);
    closeAccountModal();
    redirectAfterAuth();
  }

  async function signIn() {
    await init();
    var email = String((byId("authEmail") && byId("authEmail").value) || "").trim();
    var password = String((byId("authPassword") && byId("authPassword").value) || "");
    if (!email || !password) throw new Error("Enter an email and password.");
    await firebase.auth().signInWithEmailAndPassword(email, password);
    closeAccountModal();
    redirectAfterAuth();
  }

  async function signOut() {
    await init();
    await firebase.auth().signOut();
    closeAccountModal();
  }

  function getReturnTo() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      var raw = String(params.get("returnTo") || "").trim();
      if (!raw) return "";
      if (/^https?:\/\//i.test(raw)) return "";
      if (raw.indexOf("\n") >= 0 || raw.indexOf("\r") >= 0) return "";
      return raw;
    } catch (_) {
      return "";
    }
  }

  function redirectAfterAuth() {
    var returnTo = getReturnTo();
    if (!returnTo) {
      if (window.location.pathname.split("/").pop() === "login.html") {
        window.location.href = "profile.html";
      }
      return;
    }

    try {
      var url = new URL(returnTo, window.location.origin);
      if (url.origin !== window.location.origin) return;
      window.location.href = url.pathname.replace(/^\//, "") + url.search + url.hash;
    } catch (_) {}
  }

  async function getAuthToken() {
    try {
      await init();
    } catch (_) {
      return "";
    }
    if (!state.user || !firebase.auth().currentUser) return "";
    return firebase.auth().currentUser.getIdToken();
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    state.listeners.push(listener);
    try {
      listener(state.user);
    } catch (_) {}
    return function () {
      var idx = state.listeners.indexOf(listener);
      if (idx >= 0) state.listeners.splice(idx, 1);
    };
  }

  function wireUi() {
    var accountBtn = byId("accountBtn");
    var backdrop = byId("accountBackdrop");
    var closeBtn = byId("accountClose");
    var signUpBtn = byId("signUpBtn");
    var signInBtn = byId("signInBtn");
    var signOutBtn = byId("signOutBtn");
    var navSignOutBtn = byId("navSignOutBtn");

    if (accountBtn) accountBtn.addEventListener("click", openAccountModal);
    if (backdrop) backdrop.addEventListener("click", closeAccountModal);
    if (closeBtn) closeBtn.addEventListener("click", closeAccountModal);

    if (signUpBtn)
      signUpBtn.addEventListener("click", function () {
        signUp().catch(function (e) {
          alert((e && e.message) || "Sign up failed.");
        });
      });

    if (signInBtn)
      signInBtn.addEventListener("click", function () {
        signIn().catch(function (e) {
          alert((e && e.message) || "Sign in failed.");
        });
      });

    if (signOutBtn)
      signOutBtn.addEventListener("click", function () {
        signOut().catch(function (e) {
          alert((e && e.message) || "Sign out failed.");
        });
      });

    if (navSignOutBtn)
      navSignOutBtn.addEventListener("click", function () {
        signOut().catch(function (e) {
          alert((e && e.message) || "Sign out failed.");
        });
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireUi();
    init().catch(function () {
      // Keep the page usable even when auth isn't configured.
    });
  });

  window.QuizWizAuth = {
    init: init,
    onChange: onChange,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    getAuthToken: getAuthToken,
    isReady: function () {
      return !!state.ready;
    },
    getUser: function () {
      return state.user;
    },
    openAccountModal: openAccountModal,
    closeAccountModal: closeAccountModal,
  };
})();
