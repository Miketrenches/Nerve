// POST /api/mod
// Header: Authorization: Bearer <MOD_PASSWORD>
// Body:   { action, payload }
//
// actions:
//   "promote"        payload: { id?, title, brief, prize, image? }   → adds a mod bounty
//   "deleteRequest"  payload: { id }                                  → hides a request, removes user copy
//   "deleteBounty"   payload: { id }                                  → hides default OR removes mod bounty
//   "setBountyLink"  payload: { id, url }                             → sets/clears ACCEPT URL override

const { loadState, saveState } = require("./_lib/state");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  // ---- auth ----
  const expected = process.env.MOD_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: "MOD_PASSWORD env var not set" });
  }
  const auth     = req.headers.authorization || "";
  const password = auth.replace(/^Bearer\s+/i, "");
  if (password !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { action, payload } = req.body || {};
    if (!action || typeof action !== "string") {
      return res.status(400).json({ error: "Missing action" });
    }

    const state = await loadState();

    switch (action) {
      case "promote": {
        const r = payload || {};
        if (!r.title || !r.prize) {
          return res.status(400).json({ error: "promote requires title + prize" });
        }
        const newBounty = {
          id:    "M-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: String(r.title).slice(0, 200),
          brief: String(r.brief || "").slice(0, 1000),
          prize: String(r.prize).slice(0, 100),
          image: r.image || null,
          link:  ""
        };
        state.modBounties = state.modBounties || [];
        state.modBounties.unshift(newBounty);
        break;
      }

      case "deleteRequest": {
        const id = payload && payload.id;
        if (!id) return res.status(400).json({ error: "Missing id" });
        state.deletedRequests = state.deletedRequests || [];
        if (!state.deletedRequests.includes(id)) state.deletedRequests.push(id);
        state.requests = (state.requests || []).filter((r) => r.id !== id);
        if (state.votes && state.votes[id]) delete state.votes[id];
        break;
      }

      case "deleteBounty": {
        const id = payload && payload.id;
        if (!id) return res.status(400).json({ error: "Missing id" });
        const before = (state.modBounties || []).length;
        state.modBounties = (state.modBounties || []).filter((b) => b.id !== id);
        if (state.modBounties.length === before) {
          state.deletedBounties = state.deletedBounties || [];
          if (!state.deletedBounties.includes(id)) state.deletedBounties.push(id);
        }
        if (state.bountyUrls && state.bountyUrls[id]) delete state.bountyUrls[id];
        break;
      }

      case "setBountyLink": {
        const id  = payload && payload.id;
        const url = (payload && payload.url) || "";
        if (!id) return res.status(400).json({ error: "Missing id" });
        state.bountyUrls = state.bountyUrls || {};
        if (url) state.bountyUrls[id] = String(url).slice(0, 500);
        else delete state.bountyUrls[id];
        break;
      }

      default:
        return res.status(400).json({ error: "Unknown action: " + action });
    }

    await saveState(state);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[/api/mod]", e);
    res.status(500).json({ error: "Server error", detail: String(e.message || e) });
  }
};
