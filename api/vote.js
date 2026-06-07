// POST /api/vote
// Body: { requestId, voterToken, dir }   dir = "up" | "down" | null (null = clear)
// One vote per voterToken per request. Toggling the same direction clears it.

const { loadState, saveState } = require("./_lib/state");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  try {
    const { requestId, voterToken, dir } = req.body || {};

    if (typeof requestId !== "string" || !requestId || requestId.length > 100) {
      return res.status(400).json({ error: "Invalid requestId" });
    }
    if (typeof voterToken !== "string" || !voterToken || voterToken.length > 100) {
      return res.status(400).json({ error: "Invalid voterToken" });
    }
    if (dir !== null && dir !== "up" && dir !== "down" && dir !== undefined) {
      return res.status(400).json({ error: "Invalid dir" });
    }

    const state = await loadState();
    if (!state.votes) state.votes = {};
    if (!state.votes[requestId]) state.votes[requestId] = { score: 0, voters: {} };

    const v = state.votes[requestId];
    if (!v.voters) v.voters = {};

    const prev = Number(v.voters[voterToken] || 0);
    const next = dir === "up" ? 1 : dir === "down" ? -1 : 0;

    v.score = (Number(v.score) || 0) + (next - prev);

    if (next === 0) delete v.voters[voterToken];
    else v.voters[voterToken] = next;

    await saveState(state);

    res.status(200).json({
      ok:    true,
      score: v.score,
      dir:   next === 1 ? "up" : next === -1 ? "down" : null
    });
  } catch (e) {
    console.error("[/api/vote]", e);
    res.status(500).json({ error: "Server error", detail: String(e.message || e) });
  }
};
