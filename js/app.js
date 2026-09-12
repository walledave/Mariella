/* Mariellas Wunschliste – Frontend gegen die Supabase-REST-API */
(function () {
  "use strict";

  var CFG = window.WUNSCHLISTE_CONFIG || {};
  var URL_BASE = (CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  var KEY = CFG.SUPABASE_ANON_KEY || "";
  var CONFIGURED = /^https:\/\/.+\.supabase\.co$/.test(URL_BASE) && KEY.length > 20;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    list: $("list"), empty: $("empty"), notice: $("notice"),
    stats: $("stats"), total: $("stat-total"), open: $("stat-open"), taken: $("stat-taken"),
    toolbar: $("toolbar"), hideTaken: $("hide-taken"),
    adminToggle: $("admin-toggle"), panel: $("admin-panel"),
    form: $("wish-form"), heading: $("form-heading"), msg: $("form-msg"),
    submit: $("submit-btn"), cancel: $("cancel-edit"), editId: $("edit-id"),
    fTitle: $("f-title"), fLink: $("f-link"), fPrice: $("f-price"),
    fImage: $("f-image"), fPw: $("f-pw")
  };

  var wishes = [];
  var busy = {};

  /* ---------- Hilfsfunktionen ---------- */

  function remembered() {
    try { return sessionStorage.getItem("wl-pw") || ""; } catch (e) { return ""; }
  }
  function remember(pw) {
    try { sessionStorage.setItem("wl-pw", pw); } catch (e) {}
  }

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
          err.payload = data;
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

    if (w.price) {
      var price = document.createElement("span");
      price.className = "price";
      price.textContent = w.price;
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
    toggle.textContent = w.reserved ? "Doch nicht" : "Ich nehme das";
    toggle.disabled = !!busy[w.id];
    toggle.addEventListener("click", function () { onToggle(w); });
    actions.appendChild(toggle);

    if (remembered()) {
      var admin = document.createElement("div");
      admin.className = "admin-row";

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

      admin.appendChild(edit);
      admin.appendChild(del);
      actions.appendChild(admin);
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
          escapeHtml(err.message) +
          "<br><br>Prüfe in Supabase, ob das Schema ausgeführt wurde und die Werte in " +
          "<code>js/config.js</code> stimmen.");
      });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function onToggle(w) {
    if (busy[w.id]) return;
    if (w.reserved && !window.confirm("Reservierung wieder aufheben?")) return;

    busy[w.id] = true;
    var next = !w.reserved;
    w.reserved = next;            // optimistisch
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
    var pw = remembered();
    if (!pw) return;
    if (!window.confirm('"' + w.title + '" wirklich löschen?')) return;

    rpc("delete_wish", { pw: pw, p_id: w.id })
      .then(load)
      .catch(function (err) { window.alert("Löschen fehlgeschlagen: " + err.message); });
  }

  /* ---------- Formular ---------- */

  function openPanel() {
    el.panel.hidden = false;
    el.adminToggle.textContent = "Formular schließen";
    el.fPw.value = remembered();
    (remembered() ? el.fTitle : el.fPw).focus();
  }

  function closePanel() {
    el.panel.hidden = true;
    el.adminToggle.textContent = "Wunsch hinzufügen";
    resetForm();
  }

  function resetForm() {
    el.form.reset();
    el.editId.value = "";
    el.heading.textContent = "Neuer Wunsch";
    el.submit.textContent = "Hinzufügen";
    el.cancel.hidden = true;
    el.fPw.value = remembered();
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
    el.fPw.value = remembered();
    el.heading.textContent = "Wunsch bearbeiten";
    el.submit.textContent = "Speichern";
    el.cancel.hidden = false;
    setMsg("");
    el.fTitle.focus();
    el.panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = el.fPw.value;
    var id = el.editId.value;
    var args = {
      pw: pw,
      p_title: el.fTitle.value,
      p_link: el.fLink.value,
      p_price: el.fPrice.value,
      p_image_url: el.fImage.value
    };

    el.submit.disabled = true;
    setMsg("Speichern …");

    var call = id
      ? rpc("edit_wish", Object.assign({ p_id: id }, args))
      : rpc("add_wish", args);

    call.then(function () {
        remember(pw);
        setMsg(id ? "Gespeichert." : "Hinzugefügt.", "ok");
        resetForm();
        return load();
      })
      .catch(function (err) {
        var m = err.message || "";
        setMsg(/Passwort/i.test(m) ? "Falsches Passwort." : ("Fehler: " + m), "error");
      })
      .then(function () { el.submit.disabled = false; });
  });

  el.cancel.addEventListener("click", resetForm);

  el.adminToggle.addEventListener("click", function () {
    if (el.panel.hidden) openPanel(); else closePanel();
  });

  el.hideTaken.addEventListener("change", render);

  /* ---------- Start ---------- */

  if (!CONFIGURED) {
    showNotice(
      "<strong>Fast fertig – es fehlen noch die Supabase-Zugangsdaten.</strong><br>" +
      "Trage in <code>js/config.js</code> die <code>Project URL</code> und den " +
      "<code>anon public</code>-Key aus dem Supabase-Dashboard ein " +
      "(Project Settings → API), committe und pushe."
    );
    el.empty.hidden = true;
    return;
  }

  el.list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  load();

  window.setInterval(function () {
    if (!document.hidden) load();
  }, 25000);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
  });
})();
