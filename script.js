/* ==========================================================================
   NERVE — script.js
   home → click → player (bounties)  |  watcher (request a bounty + feed)
   Backend-backed via /api/* serverless functions (Upstash Redis).
   ========================================================================== */

(function () {
  "use strict";

  const D = window.NERVE_DATA;
  if (!D) { console.error("NERVE_DATA missing"); return; }

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const rand = (a, b) => Math.random() * (b - a) + a;

  const PAGE_SIZE      = 4;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const IMG_MAX_DIM    = 800;
  const IMG_QUALITY    = 0.78;

  const state = { player: { page: 0 } };

  // =========================================================================
  // identity & auth
  //   voterToken = persistent random id (per-browser) → vote / submit identity
  //   mod pw     = stored only in sessionStorage (cleared on tab close)
  // =========================================================================
  const VOTER_TOKEN_KEY = "nerve_voter_token";
  const MOD_PW_KEY      = "nerve_mod_pw";

  function getVoterToken() {
    let t = "";
    try { t = localStorage.getItem(VOTER_TOKEN_KEY) || ""; } catch (_) {}
    if (!t) {
      t = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(VOTER_TOKEN_KEY, t); } catch (_) {}
    }
    return t;
  }

  function getModPassword()   { try { return sessionStorage.getItem(MOD_PW_KEY) || ""; } catch (_) { return ""; } }
  function setModPassword(pw) { try { sessionStorage.setItem(MOD_PW_KEY, pw); } catch (_) {} }
  function clearModPassword() { try { sessionStorage.removeItem(MOD_PW_KEY); } catch (_) {} }

  // =========================================================================
  // API client
  // =========================================================================
  async function apiGet(path) {
    const r = await fetch(path, { credentials: "same-origin" });
    if (!r.ok) {
      const err = new Error("GET " + path + " — " + r.status);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  }

  async function apiPost(path, body, headers) {
    const r = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).error || ""; } catch (_) {}
      const err = new Error("POST " + path + " — " + r.status + (detail ? ": " + detail : ""));
      err.status = r.status;
      throw err;
    }
    return await r.json();
  }

  // =========================================================================
  // remote state — single source of truth for live data, refreshed from API
  // =========================================================================
  let remoteState = {
    modBounties:     [],
    bountyUrls:      {},
    deletedBounties: [],
    requests:        [],
    deletedRequests: [],
    votes:           {},
    myVotes:         {}
  };
  let remoteLoaded = false;

  async function refreshRemoteState() {
    try {
      const data = await apiGet("/api/state?voterToken=" + encodeURIComponent(getVoterToken()));
      remoteState = {
        modBounties:     data.modBounties     || [],
        bountyUrls:      data.bountyUrls      || {},
        deletedBounties: data.deletedBounties || [],
        requests:        data.requests        || [],
        deletedRequests: data.deletedRequests || [],
        votes:           data.votes           || {},
        myVotes:         data.myVotes         || {}
      };
      remoteLoaded = true;
    } catch (e) {
      remoteLoaded = false;
      console.warn("remote state unavailable — running on defaults only:", e.message);
    }
  }

  function getEffectiveBounties() {
    const defaults = (D.bounties || []).map((b) => ({ ...b, __src: "default" }));
    const mod      = (remoteState.modBounties || []).map((b) => ({ ...b, __src: "mod" }));
    const deleted  = new Set(remoteState.deletedBounties || []);
    const urls     = remoteState.bountyUrls || {};
    return [...mod, ...defaults]
      .filter((b) => !deleted.has(b.id))
      .map((b) => ({
        ...b,
        link: urls[b.id] !== undefined ? urls[b.id] : (b.link || "")
      }));
  }

  function getAllRequests() {
    const dels  = new Set(remoteState.deletedRequests || []);
    const user  = (remoteState.requests || []).filter((r) => !dels.has(r.id))
                                              .map((r) => ({ ...r, __user: true }));
    const seeds = (D.seedRequests || []).filter((s) => !dels.has(s.id))
                                        .map((s) => ({ ...s, __seed: true }));
    return [...user, ...seeds];
  }

  function getMyVote(id)  { return remoteState.myVotes[id] || null; }
  function scoreOf(req)   {
    const fromServer = remoteState.votes && remoteState.votes[req.id];
    if (fromServer) return Number(fromServer.score) || 0;
    return Number(req.baseScore || 0);
  }

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

    bootAttach._reset = showEmpty;
  }

  // =========================================================================
  // request form (watcher) — POSTs to /api/submit
  // =========================================================================
  let lastRequest = null;

  function bootRequestForm() {
    const form = $("#requestForm");
    if (!form) return;

    const submitBtn  = $(".request__submit", form);
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

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }

      const data = new FormData(form);
      const payload = {
        title:      String(data.get("title")    || "").trim(),
        brief:      String(data.get("brief")    || "").trim(),
        prize:      String(data.get("prize")    || "").trim(),
        duration:   String(data.get("duration") || "").trim(),
        contact:    String(data.get("contact")  || "").trim(),
        image:      attachedDataUrl,
        voterToken: getVoterToken()
      };

      const originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = "SUBMITTING...";

      try {
        const result = await apiPost("/api/submit", payload);
        lastRequest = result.request || payload;

        await refreshRemoteState();
        renderFeed();
        showModal(lastRequest);

        const handle   = payload.contact;
        const duration = payload.duration;
        form.reset();
        $("#reqContact").value  = handle;
        $("#reqDuration").value = duration;
        if (bootAttach._reset) bootAttach._reset();
        updateCount();
      } catch (err) {
        console.error("submit failed", err);
        alert("Could not submit request.\n" + (err.message || err) + "\n\nIf this keeps happening, the backend may not be configured yet.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
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
  // feed rendering & voting (POSTs to /api/vote)
  // =========================================================================
  function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000)        return "JUST NOW";
    if (diff < 3_600_000)     return Math.floor(diff / 60_000) + "M AGO";
    if (diff < 86_400_000)    return Math.floor(diff / 3_600_000) + "H AGO";
    return Math.floor(diff / 86_400_000) + "D AGO";
  }

  function pulse(el) {
    el.classList.remove("is-pulse");
    void el.offsetWidth;
    el.classList.add("is-pulse");
    setTimeout(() => el.classList.remove("is-pulse"), 340);
  }

  function renderFeed() {
    const list  = $("#feedList");
    const empty = $("#feedEmpty");
    const count = $("#feedCount");
    const clear = $("#feedClear");
    if (!list) return;

    const all = getAllRequests();

    list.innerHTML = "";
    count.textContent = String(all.length);
    if (clear) clear.hidden = true;       // backend now enforces 1-per-token; manual clear is unnecessary

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

      const upBtn   = $(".vote--up",   card);
      const downBtn = $(".vote--down", card);
      const countEl = $(".vote__count", card);

      function refreshVoteUI() {
        const my = getMyVote(r.id);
        const sc = scoreOf(r);
        countEl.textContent = String(sc);
        countEl.classList.toggle("is-pos", sc > 0);
        countEl.classList.toggle("is-neg", sc < 0);
        upBtn.classList.toggle("is-on",   my === "up");
        downBtn.classList.toggle("is-on", my === "down");
      }
      refreshVoteUI();

      async function castVote(targetDir) {
        const cur = getMyVote(r.id);
        const newDir = cur === targetDir ? null : targetDir;

        // optimistic local update
        const prevScore = scoreOf(r);
        const delta = (newDir === "up" ? 1 : newDir === "down" ? -1 : 0) -
                      (cur     === "up" ? 1 : cur     === "down" ? -1 : 0);
        if (!remoteState.votes) remoteState.votes = {};
        if (!remoteState.votes[r.id]) remoteState.votes[r.id] = { score: prevScore };
        remoteState.votes[r.id].score = prevScore + delta;
        if (newDir) remoteState.myVotes[r.id] = newDir; else delete remoteState.myVotes[r.id];
        refreshVoteUI();
        pulse(targetDir === "up" ? upBtn : downBtn);

        try {
          const res = await apiPost("/api/vote", {
            requestId:  r.id,
            voterToken: getVoterToken(),
            dir:        newDir
          });
          remoteState.votes[r.id] = { score: res.score };
          if (res.dir) remoteState.myVotes[r.id] = res.dir;
          else         delete remoteState.myVotes[r.id];
          refreshVoteUI();
        } catch (e) {
          console.error("vote failed, reverting", e);
          // revert optimistic update
          remoteState.votes[r.id].score = prevScore;
          if (cur) remoteState.myVotes[r.id] = cur; else delete remoteState.myVotes[r.id];
          refreshVoteUI();
        }
      }

      upBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        castVote("up");
      });
      downBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        castVote("down");
      });

      list.appendChild(card);
    });
  }

  function bootFeed() {
    const clearBtn = $("#feedClear");
    if (clearBtn) clearBtn.hidden = true;

    setInterval(() => {
      if (document.body.dataset.view === "watcher") renderFeed();
    }, 30_000);

    // periodic background sync so clients see each other's changes
    setInterval(async () => {
      const v = document.body.dataset.view;
      if (v === "watcher" || v === "player") {
        await refreshRemoteState();
        if (v === "watcher") renderFeed();
        if (v === "player")  renderBounties();
      }
    }, 20_000);
  }

  // =========================================================================
  // MOD VIEW — promote requests, edit ACCEPT links, delete things
  //   Open with SHIFT + M  or visit  index.html#mod
  //   First action this session prompts for the mod password.
  // =========================================================================
  async function modAction(action, payload) {
    let pw = getModPassword();
    if (!pw) {
      pw = window.prompt("Enter mod password:");
      if (!pw) throw new Error("Cancelled");
      setModPassword(pw);
    }
    try {
      return await apiPost("/api/mod", { action, payload }, { Authorization: "Bearer " + pw });
    } catch (e) {
      if (e.status === 401) {
        clearModPassword();
        alert("Wrong mod password — try again.");
      }
      throw e;
    }
  }

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

      $(".modbtn--promote", item).addEventListener("click", async () => {
        try {
          await modAction("promote", {
            title: r.title, brief: r.brief, prize: r.prize, image: r.image
          });
          item.classList.add("is-promoted");
          $(".modbtn--promote", item).textContent = "PROMOTED";
          await refreshRemoteState();
          renderBounties();
          renderModBounties();
        } catch (e) {
          if (e.message !== "Cancelled") alert("Promote failed: " + e.message);
        }
      });

      $(".modbtn--delete", item).addEventListener("click", async () => {
        try {
          await modAction("deleteRequest", { id: r.id });
          item.style.opacity = "0";
          await refreshRemoteState();
          setTimeout(() => {
            renderModRequests();
            renderFeed();
          }, 180);
        } catch (e) {
          if (e.message !== "Cancelled") alert("Delete failed: " + e.message);
        }
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
      const srcCls   = b.__src === "mod" ? "is-mod"    : "is-seed";
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
        saveBtn.textContent      = "SAVED";
        saveBtn.style.background = "var(--cyan)";
        saveBtn.style.color      = "#000";
        setTimeout(() => {
          saveBtn.textContent      = orig;
          saveBtn.style.background = "";
          saveBtn.style.color      = "";
        }, 1100);
      }

      saveBtn.addEventListener("click", async () => {
        try {
          await modAction("setBountyLink", { id: b.id, url: urlInput.value.trim() });
          flashSaved();
          await refreshRemoteState();
          renderBounties();
        } catch (e) {
          if (e.message !== "Cancelled") alert("Save failed: " + e.message);
        }
      });
      urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); saveBtn.click(); }
      });

      $(".modbtn--delete", item).addEventListener("click", async () => {
        try {
          await modAction("deleteBounty", { id: b.id });
          item.style.opacity = "0";
          await refreshRemoteState();
          setTimeout(() => {
            renderModBounties();
            renderBounties();
          }, 180);
        } catch (e) {
          if (e.message !== "Cancelled") alert("Delete failed: " + e.message);
        }
      });

      pane.appendChild(item);
    });
  }

  function bootMod() {
    const view = $("#modView");
    if (!view) return;

    async function open() {
      view.hidden = false;
      await refreshRemoteState();
      renderModRequests();
      renderModBounties();
    }
    function close() { view.hidden = true; }
    function toggle() { if (view.hidden) open(); else close(); }

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
  document.addEventListener("DOMContentLoaded", async () => {
    bootTopbar();
    bootRouting();
    bootAudio();
    bootGlobalHearts();
    bootAttach();
    bootRequestForm();
    bootModal();
    bootFeed();
    bootMod();

    // initial render with defaults so the page is usable immediately
    renderFeed();
    renderBounties();

    // then fetch live state in the background and re-render
    await refreshRemoteState();
    renderFeed();
    renderBounties();
  });
})();
