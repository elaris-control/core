// public/i18n.js
// Minimal i18n — EN / EL
// Usage: t("dashboard.title") → "Dashboard" or "Πίνακας Ελέγχου"

const TRANSLATIONS = {
  en: {
    // Nav
    "nav.dashboard":   "Dashboard",
    "nav.logs":        "Logs",
    "nav.heat_cool":   "Heat / Cool",
    "nav.lighting":    "Lighting",
    "nav.shutters":    "Shutters / Blinds",
    "nav.awnings":     "Awnings",
    "nav.other1":      "Other 1",
    "nav.other2":      "Other 2",
    "nav.settings":    "Settings",
    "nav.entities":    "Entities",
    "nav.tools":       "Tools",
    "nav.modules":     "Modules",
    "nav.installer":   "Installer",
    "nav.admin":       "Admin",

    // Dashboard
    "dash.site":       "Site",
    "dash.device":     "Device",
    "dash.ws":         "WS",
    "dash.last_update":"Last update",
    "dash.now":        "now",
    "dash.inputs":     "Inputs / Status",
    "dash.quick":      "Quick Actions",
    "dash.refresh":    "Refresh",
    "dash.no_data":    "No data",

    // Relay
    "relay.on":        "ON",
    "relay.off":       "OFF",
    "relay.pending":   "…",

    // Login
    "login.signin":    "Sign in",
    "login.register":  "Register",
    "login.email":     "Email",
    "login.name":      "Name",
    "login.password":  "Password",
    "login.password_hint": "(min 8 characters)",
    "login.create_account": "Create account",
    "login.or_continue": "or continue with",
    "login.err_fields": "Please fill in email and password.",
    "login.err_short":  "Password must be at least 8 characters.",
    "login.err_creds":  "Invalid email or password.",
    "login.err_taken":  "This email is already in use.",
    "login.err_server": "Server connection error.",

    // Modules
    "mod.title":       "Modules",
    "mod.subtitle":    "Pick & Configure Modules",
    "mod.active":      "Active Modules",
    "mod.add":         "Add Module",
    "mod.empty":       "No modules added yet.",
    "mod.name_label":  "Instance Name",
    "mod.map_inputs":  "Map Inputs",
    "mod.save":        "Save Module",
    "mod.cancel":      "Cancel",
    "mod.auto":        "auto",
    "mod.optional":    "(optional)",
    "mod.required":    "*",
    "mod.no_site":     "No site found.",
    "mod.select_relay":"— Select relay —",
    "mod.select_sensor":"— Select sensor —",
    "mod.unmapped":    "— not set —",
    "mod.deleted":     "Module deleted",
    "mod.saved":       "Module saved",
    "mod.updated":     "Module updated",
    "mod.err":         "Error",

    // Admin
    "admin.title":     "Admin",
    "admin.users":     "Users",
    "admin.role":      "Role",
    "admin.last_login":"Last Login",
    "admin.registered":"Registered",
    "admin.deactivate":"Deactivate",
    "admin.reactivate":"Reactivate",
    "admin.logout":    "Logout",
    "admin.you":       "(you)",
    "admin.confirm_deactivate": "Are you sure you want to deactivate",
    "admin.confirm_role": "Are you sure you want to change the role of",

    // General
    "general.save":    "Save",
    "general.cancel":  "Cancel",
    "general.delete":  "Delete",
    "general.edit":    "Edit",
    "general.loading": "Loading...",
    "general.back":    "← Back",
    "general.dashboard":"← Dashboard",
    "general.no_zone": "(No zone)",
  },

  el: {
    // Nav
    "nav.dashboard":   "Πίνακας Ελέγχου",
    "nav.logs":        "Αρχείο",
    "nav.heat_cool":   "Θέρμανση / Κλιματισμός",
    "nav.lighting":    "Φωτισμός",
    "nav.shutters":    "Ρολά / Στόρια",
    "nav.awnings":     "Τέντες",
    "nav.other1":      "Άλλο 1",
    "nav.other2":      "Άλλο 2",
    "nav.settings":    "Ρυθμίσεις",
    "nav.entities":    "Οντότητες",
    "nav.tools":       "Εργαλεία",
    "nav.modules":     "Modules",
    "nav.installer":   "Installer",
    "nav.admin":       "Admin",

    // Dashboard
    "dash.site":       "Τοποθεσία",
    "dash.device":     "Συσκευή",
    "dash.ws":         "WS",
    "dash.last_update":"Τελ. ενημέρωση",
    "dash.now":        "τώρα",
    "dash.inputs":     "Είσοδοι / Κατάσταση",
    "dash.quick":      "Γρήγορες Ενέργειες",
    "dash.refresh":    "Ανανέωση",
    "dash.no_data":    "Χωρίς δεδομένα",

    // Relay
    "relay.on":        "ΕΝΩ",
    "relay.off":       "ΑΠΟ",
    "relay.pending":   "…",

    // Login
    "login.signin":    "Σύνδεση",
    "login.register":  "Εγγραφή",
    "login.email":     "Email",
    "login.name":      "Όνομα",
    "login.password":  "Password",
    "login.password_hint": "(min 8 χαρακτήρες)",
    "login.create_account": "Δημιουργία λογαριασμού",
    "login.or_continue": "ή συνέχισε με",
    "login.err_fields": "Συμπλήρωσε email και password.",
    "login.err_short":  "Το password πρέπει να έχει τουλάχιστον 8 χαρακτήρες.",
    "login.err_creds":  "Λάθος email ή password.",
    "login.err_taken":  "Αυτό το email χρησιμοποιείται ήδη.",
    "login.err_server": "Σφάλμα σύνδεσης με τον server.",

    // Modules
    "mod.title":       "Modules",
    "mod.subtitle":    "Επιλογή & Ρύθμιση Modules",
    "mod.active":      "Ενεργά Modules",
    "mod.add":         "Πρόσθεσε Module",
    "mod.empty":       "Δεν έχεις προσθέσει modules ακόμα.",
    "mod.name_label":  "Όνομα Instance",
    "mod.map_inputs":  "Σύνδεση Εισόδων",
    "mod.save":        "💾 Αποθήκευση Module",
    "mod.cancel":      "Άκυρο",
    "mod.auto":        "auto",
    "mod.optional":    "(προαιρετικό)",
    "mod.required":    "*",
    "mod.no_site":     "Δεν βρέθηκε site.",
    "mod.select_relay":"— Επίλεξε relay —",
    "mod.select_sensor":"— Επίλεξε sensor —",
    "mod.unmapped":    "— δεν έχει οριστεί —",
    "mod.deleted":     "Module διαγράφηκε",
    "mod.saved":       "✓ Module προστέθηκε",
    "mod.updated":     "✓ Module ενημερώθηκε",
    "mod.err":         "Σφάλμα",

    // Admin
    "admin.title":     "Admin",
    "admin.users":     "Χρήστες",
    "admin.role":      "Role",
    "admin.last_login":"Τελευταία σύνδεση",
    "admin.registered":"Εγγραφή",
    "admin.deactivate":"Απενεργοποίηση",
    "admin.reactivate":"Επανενεργ.",
    "admin.logout":    "Logout",
    "admin.you":       "(εσύ)",
    "admin.confirm_deactivate": "Σίγουρα θες να απενεργοποιήσεις τον",
    "admin.confirm_role": "Σίγουρα θες να αλλάξεις το role του",

    // General
    "general.save":    "Αποθήκευση",
    "general.cancel":  "Άκυρο",
    "general.delete":  "Διαγραφή",
    "general.edit":    "Επεξεργασία",
    "general.loading": "Φόρτωση...",
    "general.back":    "← Πίσω",
    "general.dashboard":"← Dashboard",
    "general.no_zone": "(Χωρίς ζώνη)",
  }
};

// ── Core API ──────────────────────────────────────────────────────────────

const LANG_KEY = "elaris_lang";

function getLang() {
  try { return localStorage.getItem(LANG_KEY) || "el"; } catch { return "el"; }
}

function setLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  applyLang(lang);
}

function toggleLang() {
  const next = getLang() === "el" ? "en" : "el";
  setLang(next);
  // Reload to re-render all strings
  location.reload();
}

function t(key) {
  const lang   = getLang();
  const dict   = TRANSLATIONS[lang] || TRANSLATIONS["el"];
  return dict[key] ?? TRANSLATIONS["el"][key] ?? key;
}

// Apply data-i18n attributes on page load
function applyLang(lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS["el"];
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
  // Update lang toggle button if present
  const btn = document.getElementById("langToggle");
  if (btn) btn.textContent = lang === "el" ? "EN" : "ΕΛ";
  // Update <html lang>
  document.documentElement.lang = lang;
}

// Auto-apply on DOMContentLoaded
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyLang(getLang()));
  } else {
    applyLang(getLang());
  }
}
