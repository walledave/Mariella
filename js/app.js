/* Mariellas Wunschliste – Frontend gegen die Supabase-REST-API */
(function () {
  "use strict";

  var CFG = window.WUNSCHLISTE_CONFIG || {};
  var URL_BASE = (CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  var KEY = CFG.SUPABASE_ANON_KEY || "";
  var CONFIGURED = /^https:\/\/.+\.supabase\.co$/.test(URL_BASE) && KEY.length > 20;
  var STORE_KEY = "wl-admin-pw";

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    list: $("list"), empty: $("empty"), notice: $("notice"),
    stats: $("stats"), total: $("stat-total"), open: $("stat-open"), taken: $("stat-taken"),
    toolbar: $("toolbar"), hideTaken: $("hide-taken"),
    adminbar: $("adminbar"), adminToggle: $("admin-toggle"), logout: $("logout"),
    panel: $("admin-panel"), form: $("wish-form"), heading: $("form-heading"),
    msg: $("form-msg"), submit: $("submit-btn"), cancel: $("cancel-edit"), editId: $("edit-id"),
    fTitle: $("f-title"), fLink: $("f-link"), fPrice: $("f-price"), fImage: $("f-image"),
    imgStatus: $("image-status"), imgPreview: $("image-preview"),
    imgText: $("image-status-text"), imgManual: $("image-manual"),
    imgRefresh: $("image-refresh"), imgRow: $("image-row"),
    login: $("login"), loginOpen: $("login-open"), loginForm: $("login-form"),
    loginPw: $("login-pw"), loginCancel: $("login-cancel"), loginMsg: $("login-msg")
  };

  var wishes = [];
  var busy = {};
  var admin = false;
  var pw = "";

  /* ---------- Speicher ---------- */

  function storedPw() {
    try { return localStorage.getItem(STORE_KEY) || ""; } catch (e) { return ""; }
  }
  function storePw(value) {
    try {
      if (value) localStorage.setItem(STORE_KEY, value);
      else localStorage.removeItem(STORE_KEY);
    } catch (e) {}
  }

  /* ---------- Hilfsfunktionen ---------- */

  function safeUrl(raw) {
    if (!raw) return null;
    try {
      var u = new window.URL(raw, window.location.href);
      return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null;
    } catch (e) { return null; }
  }

  function hostOf(href) {
    try { return new window.URL(href).hostname.replace(/^www\./, ""); }
    catch (e) { return "Link"; }
  }

  // "133" -> "133 €";  "133 €", "ca. 133", "" bleiben unverändert
  function formatPrice(raw) {
    var v = (raw || "").trim();
    if (!v) return "";
    return /^\d+([.,]\d{1,2})?$/.test(v) ? v + " €" : v;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function api(path, options) {
    options = options || {};
    return fetch(URL_BASE + "/rest/v1/" + path, {
      method: options.method || "GET",
      headers: {
        "apikey": KEY,
        "Authorization": "Bearer " + KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!res.ok) {
          var err = new Error((data && data.message) || ("HTTP " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function rpc(name, args) {
    return api("rpc/" + name, { method: "POST", body: args });
  }

  function showNotice(html) {
    el.notice.innerHTML = html;
    el.notice.hidden = false;
  }

  function setMsg(text, kind) {
    el.msg.textContent = text || "";
    el.msg.className = "form-msg" + (kind ? " " + kind : "");
  }

  /* ---------- Bild automatisch aus dem Shop-Link ---------- */

  var lastLookedUp = "";

  function lookupImage(pageUrl) {
    var ctrl = new AbortController();
    var timer = window.setTimeout(function () { ctrl.abort(); }, 9000);
    return fetch("https://api.microlink.io/?url=" + encodeURIComponent(pageUrl), { signal: ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var d = (j && j.data) || {};
        var found = (d.image && d.image.url) || (d.logo && d.logo.url) || null;
        return safeUrl(found);
      })
      .catch(function () { return null; })
      .then(function (v) { window.clearTimeout(timer); return v; });
  }

  function setImageStatus(state, text, imageUrl) {
    el.imgStatus.hidden = false;
    el.imgStatus.className = "imgstatus" + (state ? " " + state : "");
    el.imgText.textContent = text;
    if (imageUrl) {
      el.imgPreview.src = imageUrl;
      el.imgPreview.hidden = false;
    } else {
      el.imgPreview.removeAttribute("src");
      el.imgPreview.hidden = true;
    }
    el.imgManual.hidden = (state === "found");
    el.imgRefresh.hidden = !safeUrl(el.fLink.value);
  }

  function clearImageStatus() {
    el.imgStatus.hidden = true;
    el.imgStatus.className = "imgstatus";
    el.imgPreview.removeAttribute("src");
    el.imgPreview.hidden = true;
    el.imgRow.hidden = true;
    lastLookedUp = "";
  }

  function tryLookup() {
    var link = safeUrl(el.fLink.value);
    if (!link) { if (!el.fImage.value) clearImageStatus(); return Promise.resolve(); }
    if (link === lastLookedUp) return Promise.resolve();
    lastLookedUp = link;

    setImageStatus("", "Suche das Produktbild …", null);
    return lookupImage(link).then(function (img) {
      if (safeUrl(el.fLink.value) !== link) return;   // Link wurde inzwischen geändert
      if (img) {
        el.fImage.value = img;
        setImageStatus("found", "Bild gefunden", img);
      } else {
        setImageStatus("failed", "Kein Bild gefunden – du kannst eins selbst eintragen.", null);
        el.imgRow.hidden = false;
      }
    });
  }

  el.fLink.addEventListener("change", function () { tryLookup(); });
  el.fLink.addEventListener("blur", function () { tryLookup(); });

  el.imgRefresh.addEventListener("click", function () {
    el.fImage.value = "";
    lastLookedUp = "";
    el.imgRow.hidden = true;
    tryLookup();
  });

  el.imgManual.addEventListener("click", function () {
    el.imgRow.hidden = false;
    el.fImage.focus();
  });

  el.fImage.addEventListener("change", function () {
    var v = safeUrl(el.fImage.value);
    if (v) setImageStatus("found", "Bild gesetzt", v);
  });

  /* ---------- Admin-Modus ---------- */

  function enterAdmin(password) {
    admin = true;
    pw = password;
    storePw(password);
    el.adminbar.hidden = false;
    el.login.hidden = true;
    render();
  }

  function leaveAdmin() {
    admin = false;
    pw = "";
    storePw("");
    el.adminbar.hidden = true;
    el.panel.hidden = true;
    el.login.hidden = false;
    el.loginForm.hidden = true;
    el.loginOpen.hidden = false;
    el.loginPw.value = "";
    el.loginMsg.textContent = "";
    render();
  }

  el.loginOpen.addEventListener("click", function () {
    el.loginForm.hidden = false;
    el.loginOpen.hidden = true;
    el.loginPw.focus();
  });

  el.loginCancel.addEventListener("click", function () {
    el.loginForm.hidden = true;
    el.loginOpen.hidden = false;
    el.loginPw.value = "";
    el.loginMsg.textContent = "";
  });

  el.loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var value = el.loginPw.value;
    if (!value) return;
    el.loginMsg.className = "login-msg";
    el.loginMsg.textContent = "Prüfe …";
    rpc("check_login", { pw: value })
      .then(function (ok) {
        if (ok === true) {
          el.loginMsg.textContent = "";
          el.loginPw.value = "";
          enterAdmin(value);
          el.adminbar.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          el.loginMsg.className = "login-msg error";
          el.loginMsg.textContent = "Falsches Passwort.";
        }
      })
      .catch(function (err) {
        el.loginMsg.className = "login-msg error";
        el.loginMsg.textContent = "Fehler: " + err.message;
      });
  });

  el.logout.addEventListener("click", leaveAdmin);

  /* ---------- Rendern ---------- */

  function renderStats() {
    var taken = wishes.filter(function (w) { return w.reserved; }).length;
    el.total.textContent = wishes.length;
    el.open.textContent = wishes.length - taken;
    el.taken.textContent = taken;
    el.stats.hidden = false;
  }

  function wishNode(w) {
    var link = safeUrl(w.link);
    var img = safeUrl(w.image_url);

    var card = document.createElement("article");
    card.className = "wish" + (w.reserved ? " taken" : "") + (img ? "" : " no-image");

    if (img) {
      var thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.src = img;
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.referrerPolicy = "no-referrer";
      thumb.addEventListener("error", function () {
        thumb.remove();
        card.classList.add("no-image");
      });
      card.appendChild(thumb);
    }

    var body = document.createElement("div");
    body.className = "wish-body";

    var h3 = document.createElement("h3");
    h3.className = "wish-title";
    h3.textContent = w.title;
    body.appendChild(h3);

    var meta = document.createElement("p");
    meta.className = "wish-meta";

    var priceText = formatPrice(w.price);
    if (priceText) {
      var price = document.createElement("span");
      price.className = "price";
      price.textContent = priceText;
      meta.appendChild(price);
    }
    if (link) {
      var a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = hostOf(link) + " ↗";
      meta.appendChild(a);
    }
    if (w.reserved) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "schon vergeben";
      meta.appendChild(badge);
    }
    if (meta.childNodes.length) body.appendChild(meta);
    card.appendChild(body);

    var actions = document.createElement("div");
    actions.className = "wish-actions";

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = w.reserved ? "ghost" : "primary";
    toggle.textContent = w.reserved ? "Wunsch aufheben" : "Wunsch reservieren";
    toggle.disabled = !!busy[w.id];
    toggle.addEventListener("click", function () { onToggle(w); });
    actions.appendChild(toggle);

    if (admin) {
      var row = document.createElement("div");
      row.className = "admin-row";

      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "icon-btn";
      edit.textContent = "Bearbeiten";
      edit.addEventListener("click", function () { startEdit(w); });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn";
      del.textContent = "Löschen";
      del.addEventListener("click", function () { onDelete(w); });

      row.appendChild(edit);
      row.appendChild(del);
      actions.appendChild(row);
    }

    card.appendChild(actions);
    return card;
  }

  function render() {
    var hide = el.hideTaken.checked;
    var visible = hide ? wishes.filter(function (w) { return !w.reserved; }) : wishes;

    el.list.textContent = "";
    visible.forEach(function (w) { el.list.appendChild(wishNode(w)); });

    el.empty.hidden = visible.length > 0;
    el.empty.textContent = wishes.length === 0
      ? "Noch keine Wünsche eingetragen."
      : "Alles schon vergeben. 🎉";

    renderStats();
  }

  /* ---------- Daten ---------- */

  function load() {
    return api("wishes?select=*&order=reserved.asc,created_at.desc")
      .then(function (rows) {
        wishes = rows || [];
        el.toolbar.hidden = false;
        el.notice.hidden = true;
        render();
      })
      .catch(function (err) {
        el.list.textContent = "";
        el.empty.hidden = true;
        showNotice("<strong>Die Liste konnte nicht geladen werden.</strong><br>" +
          escapeHtml(err.message));
      });
  }

  function onToggle(w) {
    if (busy[w.id]) return;
    if (w.reserved && !window.confirm("Reservierung wieder aufheben?")) return;

    busy[w.id] = true;
    var next = !w.reserved;
    w.reserved = next;
    render();

    rpc("set_reserved", { p_id: w.id, p_value: next })
      .then(function () { delete busy[w.id]; return load(); })
      .catch(function (err) {
        delete busy[w.id];
        w.reserved = !next;
        render();
        window.alert("Das hat nicht geklappt: " + err.message);
      });
  }

  function onDelete(w) {
    if (!admin) return;
    if (!window.confirm('"' + w.title + '" wirklich löschen?')) return;
    rpc("delete_wish", { pw: pw, p_id: w.id })
      .then(load)
      .catch(function (err) { handleAdminError(err, "Löschen fehlgeschlagen"); });
  }

  function handleAdminError(err, prefix) {
    if (/Passwort/i.test(err.message || "")) {
      window.alert("Das Passwort stimmt nicht mehr. Bitte neu anmelden.");
      leaveAdmin();
    } else {
      window.alert(prefix + ": " + err.message);
    }
  }

  /* ---------- Formular ---------- */

  function openPanel() {
    el.panel.hidden = false;
    el.adminToggle.textContent = "Formular schließen";
    el.fTitle.focus();
  }

  function closePanel() {
    el.panel.hidden = true;
    el.adminToggle.textContent = "Wunsch hinzufügen";
    resetForm();
  }

  function resetForm() {
    el.form.reset();
    clearImageStatus();
    el.editId.value = "";
    el.heading.textContent = "Neuer Wunsch";
    el.submit.textContent = "Hinzufügen";
    el.cancel.hidden = true;
    setMsg("");
  }

  function startEdit(w) {
    el.panel.hidden = false;
    el.adminToggle.textContent = "Formular schließen";
    el.editId.value = w.id;
    el.fTitle.value = w.title || "";
    el.fLink.value = w.link || "";
    el.fPrice.value = w.price || "";
    el.fImage.value = w.image_url || "";
    clearImageStatus();
    if (safeUrl(w.image_url)) {
      lastLookedUp = safeUrl(w.link) || "";
      setImageStatus("found", "Bild vorhanden", safeUrl(w.image_url));
    } else {
      lastLookedUp = "";
    }
    el.heading.textContent = "Wunsch bearbeiten";
    el.submit.textContent = "Speichern";
    el.cancel.hidden = false;
    setMsg("");
    el.fTitle.focus();
    el.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!admin) return;

    el.submit.disabled = true;
    var pending = (!el.fImage.value && safeUrl(el.fLink.value))
      ? (setMsg("Suche das Produktbild …"), tryLookup())
      : Promise.resolve();

    pending.then(doSave);
  });

  function doSave() {
    var id = el.editId.value;
    var args = {
      pw: pw,
      p_title: el.fTitle.value,
      p_link: el.fLink.value,
      p_price: formatPrice(el.fPrice.value),
      p_image_url: el.fImage.value
    };

    setMsg("Speichern …");

    var call = id
      ? rpc("edit_wish", Object.assign({ p_id: id }, args))
      : rpc("add_wish", args);

    call.then(function () {
        setMsg(id ? "Gespeichert." : "Hinzugefügt.", "ok");
        resetForm();
        return load();
      })
      .catch(function (err) {
        if (/Passwort/i.test(err.message || "")) {
          setMsg("Das Passwort stimmt nicht mehr – bitte neu anmelden.", "error");
          leaveAdmin();
        } else {
          setMsg("Fehler: " + err.message, "error");
        }
      })
      .then(function () { el.submit.disabled = false; });
  }

  el.cancel.addEventListener("click", resetForm);

  el.adminToggle.addEventListener("click", function () {
    if (el.panel.hidden) openPanel(); else closePanel();
  });

  el.hideTaken.addEventListener("change", render);

  /* ---------- Start ---------- */

  if (!CONFIGURED) {
    showNotice(
      "<strong>Es fehlen noch die Supabase-Zugangsdaten.</strong><br>" +
      "Trage in <code>js/config.js</code> die <code>Project URL</code> und den " +
      "<code>anon public</code>-Key ein."
    );
    el.empty.hidden = true;
    el.login.hidden = true;
    return;
  }

  el.list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  load().then(function () {
    var saved = storedPw();
    if (!saved) return;
    return rpc("check_login", { pw: saved })
      .then(function (ok) { if (ok === true) enterAdmin(saved); else storePw(""); })
      .catch(function () {});
  });

  window.setInterval(function () { if (!document.hidden) load(); }, 25000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
