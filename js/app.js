/* Mariellas Wunschliste – Frontend gegen die Supabase-REST-API */
(function () {
  "use strict";

  /* ---------- Bewegung: Einblenden, Parallaxe ----------------------------
     Rein visuell. Fällt alles weg, bleibt die Seite voll bedienbar.       */

  document.documentElement.classList.add("js");

  var reduceMotion = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var revealObserver = (!reduceMotion && "IntersectionObserver" in window)
    ? new window.IntersectionObserver(function (entries, obs) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("in"); obs.unobserve(e.target); }
        });
      }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 })
    : null;

  function reveal(node) {
    if (!node) return;
    if (revealObserver) revealObserver.observe(node);
    else node.classList.add("in");
  }

  function revealScan() {
    var nodes = document.querySelectorAll(".reveal:not(.in)");
    for (var i = 0; i < nodes.length; i++) reveal(nodes[i]);
  }

  // Sicherheitsnetz: nach 2 s ist alles sichtbar, egal was der Observer macht
  window.setTimeout(function () {
    var nodes = document.querySelectorAll(".reveal:not(.in)");
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("in");
  }, 2000);

  /* Parallaxe auf dem Titelblock, nicht auf dem Bild: das Wandbild soll in
     jeder Fensterbreite unbeschnitten und unverschoben stehen bleiben.     */
  var heroText = document.querySelector(".hero-text");
  if (heroText && !reduceMotion) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        var y = window.scrollY || window.pageYOffset || 0;
        if (y < 560) {
          heroText.style.transform = "translate3d(0," + (y * 0.18).toFixed(1) + "px,0)";
          heroText.style.opacity = Math.max(0, 1 - y / 420).toFixed(3);
        }
        ticking = false;
      });
    }, { passive: true });
  }

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
    fNote: $("f-note"),
    imgStatus: $("image-status"), imgPreview: $("image-preview"),
    imgText: $("image-status-text"), imgManual: $("image-manual"), imgRow: $("image-row"),
    login: $("login"), loginOpen: $("login-open"), loginForm: $("login-form"),
    loginPw: $("login-pw"), loginCancel: $("login-cancel"), loginMsg: $("login-msg")
  };

  var wishes = [];
  var seenWishes = {};
  var lastJson = "";
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

  /* ---------- Gemerkte Reservierungs-Passwörter ---------- */

  function lockStore() {
    try { return JSON.parse(localStorage.getItem("wl-locks") || "{}"); }
    catch (e) { return {}; }
  }
  function rememberLock(id, value) {
    try { var m = lockStore(); m[id] = value; localStorage.setItem("wl-locks", JSON.stringify(m)); }
    catch (e) {}
  }
  function forgetLock(id) {
    try { var m = lockStore(); delete m[id]; localStorage.setItem("wl-locks", JSON.stringify(m)); }
    catch (e) {}
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

  // Viele Shops hinterlegen ihr Firmenlogo als Vorschaubild – das ist kein Produktbild.
  function looksLikeLogo(url) {
    if (!url) return false;
    var u = url.toLowerCase();
    if (/\.(ico|svg)(\?|$)/.test(u)) return true;
    return /(^|[\/_\-.])(logo|favicon|sprite|placeholder|no[_\-]?image|dummy|brand)([\/_\-.]|$)/.test(u);
  }

  function lookupImage(pageUrl) {
    var ctrl = new AbortController();
    var timer = window.setTimeout(function () { ctrl.abort(); }, 9000);
    return fetch("https://api.microlink.io/?url=" + encodeURIComponent(pageUrl), { signal: ctrl.signal })
      .then(function (r) {
        return r.json().then(function (j) { return { http: r.status, j: j }; });
      })
      .then(function (res) {
        var j = res.j || {};
        if (res.http === 429 || j.code === "ERATE") return { code: "limit" };
        var d = j.data || {};
        var found = safeUrl((d.image && d.image.url) || null);
        if (found && !looksLikeLogo(found)) return { code: "ok", url: found };
        return { code: "none" };
      })
      .catch(function () { return { code: "error" }; })
      .then(function (v) { window.clearTimeout(timer); return v; });
  }

  function setImageStatus(state, text, imageUrl) {
    if (!el.imgStatus) return;
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
    if (el.imgManual) el.imgManual.hidden = false;   // immer anbieten
  }

  function clearImageStatus() {
    if (!el.imgStatus) { lastLookedUp = ""; return; }
    el.imgStatus.hidden = true;
    el.imgStatus.className = "imgstatus";
    el.imgPreview.removeAttribute("src");
    el.imgPreview.hidden = true;
    if (el.imgRow) el.imgRow.hidden = true;
    lastLookedUp = "";
  }

  function tryLookup() {
    var link = safeUrl(el.fLink.value);
    if (!link) { if (!el.fImage.value) clearImageStatus(); return Promise.resolve(); }
    if (link === lastLookedUp) return Promise.resolve();
    lastLookedUp = link;

    setImageStatus("", "Suche das Produktbild …", null);
    return lookupImage(link).then(function (res) {
      if (safeUrl(el.fLink.value) !== link) return;   // Link wurde inzwischen geändert

      if (res.code === "ok") {
        el.fImage.value = res.url;
        setImageStatus("found", "Bild gefunden", res.url);
        return;
      }

      setImageStatus("failed",
        res.code === "limit" ? "Tageslimit der automatischen Bildsuche erreicht – bitte Bild selbst angeben."
      : res.code === "error" ? "Bildsuche nicht erreichbar – bitte Bild selbst angeben."
      :                        "Kein Produktbild gefunden – bitte Bild selbst angeben.", null);
      if (el.imgRow) el.imgRow.hidden = false;
      el.fImage.focus();
    }).catch(function () {});
  }

  el.fLink.addEventListener("change", function () { tryLookup(); });
  el.fLink.addEventListener("blur", function () { tryLookup(); });

  if (el.imgManual) el.imgManual.addEventListener("click", function () {
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
    var fresh = !seenWishes[w.id];
    seenWishes[w.id] = true;
    card.className = "wish" + (w.reserved ? " taken" : "") + (img ? "" : " no-image")
                   + (fresh ? " reveal" : "");

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

    if (w.note) {
      var note = document.createElement("p");
      note.className = "wish-note";
      note.textContent = w.note;
      body.appendChild(note);
    }

    card.appendChild(body);

    var actions = document.createElement("div");
    actions.className = "wish-actions";

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = w.reserved ? "ghost" : "primary";
    toggle.textContent = w.reserved ? "Wunsch aufheben" : "Wunsch reservieren";
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

      if (w.reserved) {
        var rel = document.createElement("button");
        rel.type = "button";
        rel.className = "icon-btn";
        rel.textContent = "Freigeben";
        rel.title = "Reservierung ohne fremdes Passwort aufheben";
        rel.addEventListener("click", function () { onAdminRelease(w); });
        row.appendChild(rel);
      }
      actions.appendChild(row);
    }

    card.appendChild(actions);
    card.appendChild(lockForm(w, toggle));
    return card;
  }

  /* ---------- Reservieren und Aufheben mit eigenem Passwort ---------- */

  function closeLocks(except) {
    var forms = document.querySelectorAll(".wish-lock");
    for (var i = 0; i < forms.length; i++) {
      if (forms[i] !== except) forms[i].hidden = true;
    }
  }

  function lockForm(w, toggle) {
    var form = document.createElement("form");
    form.className = "wish-lock";
    form.hidden = true;
    form.autocomplete = "off";

    var hint = document.createElement("p");
    hint.className = "lock-hint";
    hint.textContent = w.reserved
      ? "Gib das Passwort ein, mit dem dieser Wunsch reserviert wurde."
      : "Denk dir ein Passwort aus. Du brauchst es, falls du die Reservierung wieder aufheben möchtest.";

    var line = document.createElement("div");
    line.className = "lock-line";

    var input = document.createElement("input");
    input.type = "password";
    input.autocomplete = w.reserved ? "current-password" : "new-password";
    input.placeholder = w.reserved ? "Passwort" : "Passwort ausdenken";
    input.maxLength = 80;

    var go = document.createElement("button");
    go.type = "submit";
    go.className = "primary small";
    go.textContent = w.reserved ? "Aufheben" : "Reservieren";

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "linkish";
    cancel.textContent = "Abbrechen";
    cancel.addEventListener("click", function () { form.hidden = true; });

    var msg = document.createElement("p");
    msg.className = "lock-msg";

    line.appendChild(input);
    line.appendChild(go);
    line.appendChild(cancel);
    form.appendChild(hint);
    form.appendChild(line);
    form.appendChild(msg);

    function say(text, kind) {
      msg.textContent = text || "";
      msg.className = "lock-msg" + (kind ? " " + kind : "");
    }

    toggle.addEventListener("click", function () {
      var wasOpen = !form.hidden;
      closeLocks(form);
      form.hidden = wasOpen;
      if (!wasOpen) {
        say("");
        input.value = w.reserved ? (lockStore()[w.id] || "") : "";
        input.focus();
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = (input.value || "").trim();
      var reserving = !w.reserved;

      if (reserving && value.length < 3) { say("Bitte mindestens 3 Zeichen.", "error"); return; }
      if (!reserving && !value) { say("Bitte das Passwort eingeben.", "error"); return; }

      go.disabled = true;
      say(reserving ? "Reserviere …" : "Hebe auf …");

      rpc(reserving ? "reserve_wish" : "release_wish", { p_id: w.id, pw: value })
        .then(function () {
          if (reserving) rememberLock(w.id, value); else forgetLock(w.id);
          lastJson = "";
          return load();
        })
        .catch(function (err) {
          go.disabled = false;
          var m = err.message || "";
          say(/zu kurz/i.test(m)          ? "Das Passwort ist zu kurz."
            : /Falsches Passwort/i.test(m) ? "Falsches Passwort."
            : /Schon reserviert/i.test(m)  ? "Diesen Wunsch hat gerade jemand anderes reserviert."
            : "Fehler: " + m, "error");
        });
    });

    return form;
  }

  function onAdminRelease(w) {
    if (!admin) return;
    if (!window.confirm('Reservierung für "' + w.title + '" ohne das fremde Passwort aufheben?')) return;
    rpc("admin_release", { pw: pw, p_id: w.id })
      .then(function () { forgetLock(w.id); lastJson = ""; return load(); })
      .catch(function (err) { handleAdminError(err, "Freigeben fehlgeschlagen"); });
  }

  function render() {
    var hide = el.hideTaken.checked;
    var visible = hide ? wishes.filter(function (w) { return !w.reserved; }) : wishes;

    el.list.textContent = "";
    visible.forEach(function (w) { el.list.appendChild(wishNode(w)); });
    revealScan();

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
        var json = JSON.stringify(rows);
        wishes = rows || [];
        el.toolbar.hidden = false;
        el.notice.hidden = true;
        if (json !== lastJson) { lastJson = json; render(); }
        revealScan();
      })
      .catch(function (err) {
        el.list.textContent = "";
        el.empty.hidden = true;
        showNotice("<strong>Die Liste konnte nicht geladen werden.</strong><br>" +
          escapeHtml(err.message));
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
    el.fNote.value = w.note || "";
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

    pending.catch(function () {}).then(doSave);
  });

  function doSave() {
    var id = el.editId.value;
    var args = {
      pw: pw,
      p_title: el.fTitle.value,
      p_link: el.fLink.value,
      p_price: formatPrice(el.fPrice.value),
      p_image_url: safeUrl(el.fImage.value) || "",
      p_note: el.fNote.value
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
