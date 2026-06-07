/* ==========================================================================
   NERVE — script.js
   home → click → player (bounties)  |  watcher (request a bounty + feed)
   ========================================================================== */

(function () {
  "use strict";

  const D = window.NERVE_DATA;
  if (!D) { console.error("NERVE_DATA missing"); return; }

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const rand = (a, b) => Math.random() * (b - a) + a;

  const PAGE_SIZE      = 4;
  const FEED_KEY       = "nerve_requests_v1";
  const FEED_MAX       = 30;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const IMG_MAX_DIM    = 800;
  const IMG_QUALITY    = 0.78;

  const state = { player: { page: 0 } };

  // =========================================================================
  // top bar
  // =========================================================================
  function bootTopbar() {
    const t = D.token || {};
    if (t.pumpfun) $("#lnkPump").href = t.pumpfun;
    if (t.twitter) $("#lnkX").href    = t.twitter;
  }

  // =========================================================================
  // view routing
  // =========================================================================
  function goView(view) {
    document.body.dataset.view = view;
    if (view === "player")  renderBounties();
    if (view === "watcher") {
      renderFeed();
      setTimeout(() => { const t = $("#reqTitle"); if (t) t.focus({ preventScroll: true }); }, 380);
    }
  }

  function bootRouting() {
    $$("[data-go]").forEach((el) => {
      el.addEventListener("click", () => goView(el.dataset.go));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const mv = $("#modView");
      if (mv && !mv.hidden) { mv.hidden = true; return; }
      const m = $("#confirmModal");
      if (m && !m.hidden) { hideModal(); return; }
      goView("home");
    });

    $$('.pager__btn[data-pager="player"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir   = Number(btn.dataset.dir);
        const total = getEffectiveBounties().length;
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        state.player.page = (state.player.page + dir + pages) % pages;
        renderBounties();
      });
    });
  }

  // =========================================================================
  // bounty cards (PLAYER)
  // =========================================================================
  function renderBounties() {
    const host  = $("#playerCards");
    const tmpl  = $("#tmplBounty");
    if (!host || !tmpl) return;
    const items = getEffectiveBounties();
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page  = Math.min(state.player.page, pages - 1);
    state.player.page = page;
    const slice = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    host.innerHTML = "";
    slice.forEach((b, i) => {
      const node = tmpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = b.id;
      const num = String(page * PAGE_SIZE + i + 1).padStart(2, "0");
      $(".bounty__num",   node).textContent = "BOUNTY " + num;
      $(".bounty__title", node).textContent = b.title;
      $(".bounty__brief", node).textContent = b.brief || "";
      $(".bounty__prize", node).textContent = b.prize;
      const img = $(".bounty__media img", node);
      if (b.image) { img.src = b.image; img.alt = b.title; }

      $(".bounty__cta", node).addEventListener("click", () => {
        if (b.link) {
          try { window.open(b.link, "_blank", "noopener,noreferrer"); } catch (_) {}
        }
        node.style.transition = "transform 0.18s, box-shadow 0.18s";
        node.style.boxShadow  = "0 0 40px rgba(0, 240, 255, 0.7)";
        node.style.transform  = "translateY(-3px) scale(1.02)";
        setTimeout(() => { node.style.boxShadow = ""; node.style.transform = ""; }, 240);
      });

      host.appendChild(node);
    });

    $("#playerPage").textContent  = (page + 1) + " / " + pages;
    $("#playerCount").textContent = items.length + " OPEN";
    $$('.pager__btn[data-pager="player"]').forEach((b) => { b.disabled = pages <= 1; });
  }

  // =========================================================================
  // soundtrack (plays on first WATCHER/PLAYER click)
  // =========================================================================
  function bootAudio() {
    const audio = $("#songAudio");
    const btn   = $("#audioToggle");
    if (!audio || !btn) return;

    audio.volume = 0.7;

    // tracks whether the user has explicitly silenced the song. Once true,
    // CTA clicks will NOT auto-resume — only an explicit click on the toggle.
    let userMuted = false;

    function tryPlay() {
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }

    function startFromCTA() {
      if (userMuted)     return;
      if (!audio.paused) return;
      tryPlay();
    }

    $$(".cta-btn").forEach((b) => {
      b.addEventListener("click", startFromCTA, { capture: true });
    });

    btn.addEventListener("click", () => {
      if (audio.paused) {
        userMuted = false;
        tryPlay();
      } else {
        userMuted = true;
        audio.pause();
      }
    });

    audio.addEventListener("pause", () => {
      btn.textContent = "PLAY";
      btn.classList.add("is-paused");
    });
    audio.addEventListener("playing", () => {
      btn.textContent = "MUTE";
      btn.classList.remove("is-paused");
    });
  }

  // =========================================================================
  // floating hearts
  // =========================================================================
  function spawnHeart(host, opts) {
    const h = document.createElement("span");
    h.className = "heart";
    h.textContent = "\u2665";
    if (opts) {
      if (opts.right != null) h.style.right    = opts.right + "px";
      if (opts.size  != null) h.style.fontSize = opts.size  + "px";
      if (opts.dur   != null) h.style.setProperty("--dur", opts.dur + "s");
    }
    host.appendChild(h);
    setTimeout(() => h.remove(), 6500);
  }

  function bootGlobalHearts() {
    const host = $("#hearts");
    setInterval(() => {
      const v = document.body.dataset.view;
      if (v !== "home" && v !== "watcher") return;
      spawnHeart(host, { right: rand(8, 60), size: rand(16, 26), dur: rand(3.5, 5.5) });
    }, 420);
  }

  // =========================================================================
  // image attach — drag/drop, file picker, canvas compression
  // =========================================================================
  let attachedDataUrl = null;
  let attachedName    = "";

  function readAndCompress(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const ratio = Math.min(IMG_MAX_DIM / w, IMG_MAX_DIM / h, 1);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          try { resolve(canvas.toDataURL("image/jpeg", IMG_QUALITY)); }
          catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error("invalid image"));
        img.src = ev.target.result;
      };
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  function bootAttach() {
    const zone     = $("#attachZone");
    const input    = $("#reqImage");
    const empty    = $(".attach__empty",  zone);
    const filled   = $(".attach__filled", zone);
    const thumb    = $(".attach__thumb",  zone);
    const nameEl   = $(".attach__name",   zone);
    const removeBtn= $(".attach__remove", zone);

    function showEmpty() {
      empty.hidden = false;
      filled.hidden = true;
      attachedDataUrl = null;
      attachedName    = "";
      input.value = "";
    }
    function showFilled(dataUrl, fileName) {
      empty.hidden = true;
      filled.hidden = false;
      thumb.src = dataUrl;
      nameEl.textContent = fileName;
      attachedDataUrl = dataUrl;
      attachedName    = fileName;
    }

    async function handleFile(file) {
      if (!file) return;
      if (!file.type.startsWith("image/")) { alert("Only images allowed."); return; }
      if (file.size > MAX_FILE_BYTES)      { alert("Image too large. Max 4MB."); return; }
      try {
        const dataUrl = await readAndCompress(file);
        showFilled(dataUrl, file.name);
      } catch (err) {
        alert("Could not read image: " + err.message);
      }
    }

    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showEmpty();
    });

    input.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      handleFile(f);
    });

    // drag & drop
    ["dragenter", "dragover"].forEach((ev) => {
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("is-drag");
      });
    });
    ["dragleave", "dragend"].forEach((ev) => {
      zone.addEventListener(ev, () => zone.classList.remove("is-drag"));
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-drag");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleFile(f);
    });

    // expose reset for after-submit
    bootAttach._reset = showEmpty;
  }

  // =========================================================================
  // request form (watcher)
  // =========================================================================
  let lastRequest = null;

  function bootRequestForm() {
    const form = $("#requestForm");
    if (!form) return;

    const briefEl    = $("#reqBrief");
    const briefCount = $("#reqBriefCount");
    const briefMax   = Number(briefEl.getAttribute("maxlength")) || 280;
    const updateCount = () => {
      const len = briefEl.value.length;
      briefCount.textContent = len + " / " + briefMax;
      briefCount.style.color = len > briefMax * 0.9 ? "var(--pink)" : "";
    };
    briefEl.addEventListener("input", updateCount);
    updateCount();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }

      const data = new FormData(form);
      lastRequest = {
        id:        "u" + Date.now(),
        title:     String(data.get("title")    || "").trim(),
        brief:     String(data.get("brief")    || "").trim(),
        prize:     String(data.get("prize")    || "").trim(),
        duration:  String(data.get("duration") || "").trim(),
        contact:   String(data.get("contact")  || "").trim(),
        image:     attachedDataUrl,
        createdAt: Date.now()
      };

      addUserRequest(lastRequest);
      renderFeed();
      showModal(lastRequest);

      // reset form (keep handle + duration)
      const handle   = lastRequest.contact;
      const duration = lastRequest.duration;
      form.reset();
      $("#reqContact").value  = handle;
      $("#reqDuration").value = duration;
      if (bootAttach._reset) bootAttach._reset();
      updateCount();
    });
  }

  function projectHandle() {
    const t = D.token || {};
    if (!t.twitter) return "";
    const m = String(t.twitter).match(/(?:x|twitter)\.com\/(\w+)/i);
    return m ? "@" + m[1] : "";
  }

  function formatRequestText(req) {
    const lines = [
      "BOUNTY REQUEST",
      "",
      req.title,
      "",
      req.brief,
      "",
      "Prize:    " + req.prize,
      "Duration: " + req.duration,
      "From:     " + req.contact
    ];
    const ph = projectHandle();
    if (ph) lines.push("To:       " + ph);
    return lines.join("\n");
  }

  // =========================================================================
  // confirmation modal
  // =========================================================================
  function showModal(req) {
    $("#modalTitle").textContent = req.title;
    $("#modalBrief").textContent = req.brief;
    $("#modalPrize").textContent = req.prize;
    $("#modalDur").textContent   = req.duration;
    $("#modalFrom").textContent  = req.contact;
    $("#modalShare").href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(formatRequestText(req));
    $("#confirmModal").hidden = false;
  }

  function hideModal() { $("#confirmModal").hidden = true; }

  function bootModal() {
    const modal = $("#confirmModal");
    if (!modal) return;

    $("#modalClose").addEventListener("click", hideModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) hideModal(); });

    $("#modalCopy").addEventListener("click", () => {
      if (!lastRequest) return;
      const btn = $("#modalCopy");
      const text = formatRequestText(lastRequest);
      navigator.clipboard?.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = "COPIED";
        btn.style.color = "var(--green)";
        btn.style.borderColor = "var(--green)";
        setTimeout(() => {
          btn.textContent = original;
          btn.style.color = "";
          btn.style.borderColor = "";
        }, 1500);
      }).catch(() => {
        btn.textContent = "COPY FAILED";
        setTimeout(() => { btn.textContent = "COPY"; }, 1500);
      });
    });
  }

  // =========================================================================
  // feed (recent requests) — localStorage + seeds
  // =========================================================================
  const VOTES_KEY        = "nerve_votes_v1";
  const MOD_BOUNTIES_KEY = "nerve_mod_bounties";
  const BOUNTY_URLS_KEY  = "nerve_bounty_urls";
  const DEL_BOUNTY_KEY   = "nerve_deleted_bounties";
  const DEL_REQ_KEY      = "nerve_deleted_requests";

  function readJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  function loadUserRequests() {
    try { const v = localStorage.getItem(FEED_KEY); return v ? JSON.parse(v) : []; }
    catch { return []; }
  }
  function saveUserRequests(arr) {
    try { localStorage.setItem(FEED_KEY, JSON.stringify(arr)); }
    catch (e) {
      console.warn("storage full — dropping image to retry", e);
      const slim = arr.map((r) => ({ ...r, image: null }));
      try { localStorage.setItem(FEED_KEY, JSON.stringify(slim)); } catch (_) {}
    }
  }
  // 1 request per visitor — re-submitting replaces the previous one
  function addUserRequest(req) {
    saveUserRequests([req]);
  }
  function clearUserRequests() {
    try { localStorage.removeItem(FEED_KEY); } catch (_) {}
  }

  // votes: { [requestId]: "up" | "down" }
  function loadVotes() {
    try { return JSON.parse(localStorage.getItem(VOTES_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveVotes(v) {
    try { localStorage.setItem(VOTES_KEY, JSON.stringify(v)); }
    catch (_) {}
  }
  function getMyVote(id) { return loadVotes()[id] || null; }
  function setMyVote(id, dir) {
    const v = loadVotes();
    if (dir) v[id] = dir; else delete v[id];
    saveVotes(v);
  }
  function scoreOf(req) {
    const base = Number(req.baseScore || 0);
    const my   = getMyVote(req.id);
    return base + (my === "up" ? 1 : 0) + (my === "down" ? -1 : 0);
  }
  function pulse(el) {
    el.classList.remove("is-pulse");
    void el.offsetWidth;
    el.classList.add("is-pulse");
    setTimeout(() => el.classList.remove("is-pulse"), 340);
  }

  function getAllRequests() {
    const dels  = new Set(readJSON(DEL_REQ_KEY, []));
    const user  = loadUserRequests().filter((r) => !dels.has(r.id))
                                    .map((r) => ({ ...r, __user: true }));
    const seeds = (D.seedRequests || []).filter((s) => !dels.has(s.id))
                                        .map((s) => ({ ...s, __seed: true }));
    return [...user, ...seeds];
  }

  // -------- mod state helpers ----------------------------------------------
  function getModBounties()      { return readJSON(MOD_BOUNTIES_KEY, []); }
  function setModBounties(arr)   { writeJSON(MOD_BOUNTIES_KEY, arr); }
  function getBountyUrls()       { return readJSON(BOUNTY_URLS_KEY, {}); }
  function setBountyUrls(obj)    { writeJSON(BOUNTY_URLS_KEY, obj); }
  function getDeletedBountyIds() { return new Set(readJSON(DEL_BOUNTY_KEY, [])); }
  function addDeletedBountyId(id) {
    const arr = readJSON(DEL_BOUNTY_KEY, []);
    if (!arr.includes(id)) { arr.push(id); writeJSON(DEL_BOUNTY_KEY, arr); }
  }
  function addDeletedRequestId(id) {
    const arr = readJSON(DEL_REQ_KEY, []);
    if (!arr.includes(id)) { arr.push(id); writeJSON(DEL_REQ_KEY, arr); }
  }

  // merged view: mod-added bounties first, then defaults, with deletions
  // filtered out and any per-id URL overrides applied.
  function getEffectiveBounties() {
    const defaults = (D.bounties || []).map((b) => ({ ...b, __src: "default" }));
    const mod      = getModBounties().map((b) => ({ ...b, __src: "mod" }));
    const deleted  = getDeletedBountyIds();
    const urls     = getBountyUrls();
    return [...mod, ...defaults]
      .filter((b) => !deleted.has(b.id))
      .map((b) => ({
        ...b,
        link: urls[b.id] !== undefined ? urls[b.id] : (b.link || "")
      }));
  }

  function promoteRequestToBounty(req) {
    const newBounty = {
      id:    "M-" + Date.now().toString(36),
      title: req.title || "",
      brief: req.brief || "",
      prize: req.prize || "",
      image: req.image || null,
      link:  ""
    };
    const mod = getModBounties();
    mod.unshift(newBounty);
    setModBounties(mod);
    return newBounty;
  }

  function deleteRequestEntry(req) {
    if (req.__user) {
      const all = loadUserRequests().filter((r) => r.id !== req.id);
      saveUserRequests(all);
    } else {
      addDeletedRequestId(req.id);
    }
  }

  function deleteBountyEntry(b) {
    if (b.__src === "mod") {
      const mod = getModBounties().filter((x) => x.id !== b.id);
      setModBounties(mod);
    } else {
      addDeletedBountyId(b.id);
    }
    const urls = getBountyUrls();
    if (urls[b.id] !== undefined) { delete urls[b.id]; setBountyUrls(urls); }
  }

  function setBountyLink(id, url) {
    const urls = getBountyUrls();
    if (url) urls[id] = url; else delete urls[id];
    setBountyUrls(urls);
  }

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000)        return "JUST NOW";
    if (diff < 3_600_000)     return Math.floor(diff / 60_000) + "M AGO";
    if (diff < 86_400_000)    return Math.floor(diff / 3_600_000) + "H AGO";
    return Math.floor(diff / 86_400_000) + "D AGO";
  }

  function renderFeed() {
    const list  = $("#feedList");
    const empty = $("#feedEmpty");
    const count = $("#feedCount");
    const clear = $("#feedClear");
    if (!list) return;

    const all       = getAllRequests();
    const userCount = loadUserRequests().length;

    list.innerHTML = "";
    count.textContent = String(all.length);
    clear.disabled = userCount === 0;

    if (all.length === 0) { empty.hidden = false; return; }
    empty.hidden = true;

    all.forEach((r) => {
      const card = document.createElement("article");
      card.className = "frq" + (r.image ? "" : " frq--no-image") + (r.__seed ? " frq--seed" : "");
      card.dataset.id = r.id || "";

      const ts = r.createdAt || Date.now();

      const bodyHTML =
        '<div class="frq__body">' +
          '<div class="frq__meta-top"><span class="frq__handle"></span><span class="frq__time"></span></div>' +
          '<h4 class="frq__title"></h4>' +
          '<p class="frq__brief"></p>' +
          '<div class="frq__meta-bot">' +
            '<div class="frq__money"><span class="frq__prize"></span><span class="frq__dur"></span></div>' +
            '<div class="frq__votes">' +
              '<button class="vote vote--up" type="button" aria-label="Upvote"></button>' +
              '<span class="vote__count"></span>' +
              '<button class="vote vote--down" type="button" aria-label="Downvote"></button>' +
            '</div>' +
          '</div>' +
        '</div>';

      if (r.image) {
        card.innerHTML = '<div class="frq__media"><img alt=""></div>' + bodyHTML;
        $(".frq__media img", card).src = r.image;
      } else {
        card.innerHTML = bodyHTML;
      }

      $(".frq__handle", card).textContent = r.contact  || "";
      $(".frq__time",   card).textContent = relativeTime(ts);
      $(".frq__title",  card).textContent = r.title    || "";
      $(".frq__brief",  card).textContent = r.brief    || "";
      $(".frq__prize",  card).textContent = r.prize    || "";
      $(".frq__dur",    card).textContent = r.duration || "";

      // ---- vote wiring ----
      const upBtn   = $(".vote--up",   card);
      const downBtn = $(".vote--down", card);
      const countEl = $(".vote__count", card);

      function refreshVote() {
        const my = getMyVote(r.id);
        const sc = scoreOf(r);
        countEl.textContent = String(sc);
        countEl.classList.toggle("is-pos", sc > 0);
        countEl.classList.toggle("is-neg", sc < 0);
        upBtn.classList.toggle("is-on",   my === "up");
        downBtn.classList.toggle("is-on", my === "down");
      }
      refreshVote();

      upBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = getMyVote(r.id);
        setMyVote(r.id, cur === "up" ? null : "up");
        refreshVote();
        pulse(upBtn);
      });
      downBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = getMyVote(r.id);
        setMyVote(r.id, cur === "down" ? null : "down");
        refreshVote();
        pulse(downBtn);
      });

      list.appendChild(card);
    });
  }

  function bootFeed() {
    const clearBtn = $("#feedClear");
    if (!clearBtn) return;

    let armed = false;
    let armTimer = null;

    clearBtn.addEventListener("click", () => {
      if (clearBtn.disabled) return;
      if (!armed) {
        armed = true;
        const original = clearBtn.textContent;
        clearBtn.dataset.original = original;
        clearBtn.textContent = "CONFIRM";
        clearBtn.classList.add("is-armed");
        clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armed = false;
          clearBtn.textContent = clearBtn.dataset.original;
          clearBtn.classList.remove("is-armed");
        }, 2500);
        return;
      }
      clearTimeout(armTimer);
      armed = false;
      clearBtn.textContent = clearBtn.dataset.original;
      clearBtn.classList.remove("is-armed");
      clearUserRequests();
      renderFeed();
    });

    // tick relative times every 30s while in watcher view
    setInterval(() => {
      if (document.body.dataset.view === "watcher") renderFeed();
    }, 30_000);
  }

  // =========================================================================
  // MOD VIEW — promote requests, edit ACCEPT links, delete things
  //   Open with SHIFT + M  or visit  index.html#mod
  //   Close with the CLOSE button, ESC, or click on the backdrop.
  // =========================================================================
  function renderModRequests() {
    const pane = $("#modPaneRequests");
    if (!pane) return;
    const all = getAllRequests();

    pane.innerHTML = "";
    if (all.length === 0) {
      pane.innerHTML = '<p class="modempty">NO REQUESTS YET.</p>';
      return;
    }

    all.forEach((r) => {
      const item = document.createElement("article");
      item.className = "moditem";
      const srcLabel = r.__user ? "USER" : "SEED";
      const srcCls   = r.__user ? "is-user" : "is-seed";

      item.innerHTML =
        '<div class="moditem__head">' +
          '<span class="moditem__handle"></span>' +
          '<span class="moditem__src ' + srcCls + '">' + srcLabel + '</span>' +
        '</div>' +
        '<h4 class="moditem__title"></h4>' +
        '<p class="moditem__brief"></p>' +
        '<div class="moditem__meta">' +
          '<span class="moditem__prize"></span>' +
          '<span class="moditem__dur"></span>' +
        '</div>' +
        '<div class="moditem__actions">' +
          '<button class="modbtn modbtn--promote" type="button">PROMOTE TO BOUNTY</button>' +
          '<button class="modbtn modbtn--delete"  type="button">DELETE</button>' +
        '</div>';

      $(".moditem__handle", item).textContent = r.contact || "(no handle)";
      $(".moditem__title",  item).textContent = r.title   || "";
      $(".moditem__brief",  item).textContent = r.brief   || "";
      $(".moditem__prize",  item).textContent = r.prize    ? "PRIZE " + r.prize : "";
      $(".moditem__dur",    item).textContent = r.duration ? r.duration : "";

      $(".modbtn--promote", item).addEventListener("click", () => {
        promoteRequestToBounty(r);
        item.classList.add("is-promoted");
        const btn = $(".modbtn--promote", item);
        btn.textContent = "PROMOTED";
        renderBounties();
      });

      $(".modbtn--delete", item).addEventListener("click", () => {
        deleteRequestEntry(r);
        item.style.opacity = "0";
        setTimeout(() => {
          renderModRequests();
          renderFeed();
        }, 180);
      });

      pane.appendChild(item);
    });
  }

  function renderModBounties() {
    const pane = $("#modPaneBounties");
    if (!pane) return;
    const all = getEffectiveBounties();

    pane.innerHTML = "";
    if (all.length === 0) {
      pane.innerHTML = '<p class="modempty">NO BOUNTIES.</p>';
      return;
    }

    all.forEach((b) => {
      const item = document.createElement("article");
      item.className = "moditem";
      const srcCls   = b.__src === "mod" ? "is-mod"  : "is-seed";
      const srcLabel = b.__src === "mod" ? "MOD-ADDED" : "DEFAULT";

      item.innerHTML =
        '<div class="moditem__head">' +
          '<span class="moditem__handle"></span>' +
          '<span class="moditem__src ' + srcCls + '">' + srcLabel + '</span>' +
        '</div>' +
        '<h4 class="moditem__title"></h4>' +
        '<p class="moditem__brief"></p>' +
        '<div class="moditem__meta">' +
          '<span class="moditem__prize"></span>' +
        '</div>' +
        '<div class="moditem__urlrow">' +
          '<input class="modurl" type="url" placeholder="ACCEPT button URL (https://...)" />' +
          '<button class="modbtn modbtn--save" type="button">SAVE LINK</button>' +
        '</div>' +
        '<div class="moditem__actions">' +
          '<button class="modbtn modbtn--delete" type="button">DELETE BOUNTY</button>' +
        '</div>';

      $(".moditem__handle", item).textContent = b.id;
      $(".moditem__title",  item).textContent = b.title || "";
      $(".moditem__brief",  item).textContent = b.brief || "";
      $(".moditem__prize",  item).textContent = b.prize ? "PRIZE " + b.prize : "";

      const urlInput = $(".modurl", item);
      urlInput.value = b.link || "";
      const saveBtn  = $(".modbtn--save", item);

      function flashSaved() {
        const orig = saveBtn.textContent;
        saveBtn.textContent     = "SAVED";
        saveBtn.style.background = "var(--cyan)";
        saveBtn.style.color      = "#000";
        setTimeout(() => {
          saveBtn.textContent      = orig;
          saveBtn.style.background = "";
          saveBtn.style.color      = "";
        }, 1100);
      }

      saveBtn.addEventListener("click", () => {
        setBountyLink(b.id, urlInput.value.trim());
        flashSaved();
        renderBounties();
      });
      urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); saveBtn.click(); }
      });

      $(".modbtn--delete", item).addEventListener("click", () => {
        deleteBountyEntry(b);
        item.style.opacity = "0";
        setTimeout(() => {
          renderModBounties();
          renderBounties();
        }, 180);
      });

      pane.appendChild(item);
    });
  }

  function bootMod() {
    const view = $("#modView");
    if (!view) return;

    function open() {
      view.hidden = false;
      renderModRequests();
      renderModBounties();
    }
    function close() { view.hidden = true; }
    function toggle() { if (view.hidden) open(); else close(); }
    bootMod._open  = open;
    bootMod._close = close;

    document.addEventListener("keydown", (e) => {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== "M" && e.key !== "m") return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      toggle();
    });

    function checkHash() {
      if ((location.hash || "").toLowerCase() === "#mod") open();
    }
    window.addEventListener("hashchange", checkHash);
    checkHash();

    $("#modClose").addEventListener("click", close);
    view.addEventListener("click", (e) => { if (e.target === view) close(); });

    $$(".modtab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".modtab").forEach((t) => t.classList.toggle("is-active", t === tab));
        const target = tab.dataset.tab;
        $("#modPaneRequests").classList.toggle("is-active", target === "requests");
        $("#modPaneBounties").classList.toggle("is-active", target === "bounties");
      });
    });
  }

  // =========================================================================
  // boot
  // =========================================================================
  document.addEventListener("DOMContentLoaded", () => {
    bootTopbar();
    bootRouting();
    bootAudio();
    bootGlobalHearts();
    bootAttach();
    bootRequestForm();
    bootModal();
    bootFeed();
    bootMod();
    renderFeed(); // initial render so feed is ready when user opens watcher
  });
})();
