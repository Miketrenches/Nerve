// GET /api/state                 → full live state
// GET /api/state?voterToken=xxx  → also includes "myVotes" for that voter
//
// Public read endpoint. Voter details are stripped from the response,
// only net score per request is exposed (plus your own votes if a token is provided).

const { loadState } = require("./_lib/state");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  try {
    const state = await loadState();

    const myToken = (req.query && req.query.voterToken) || "";
    const slimVotes = {};
    const myVotes   = {};

    for (const [id, v] of Object.entries(state.votes || {})) {
      slimVotes[id] = { score: Number(v.score) || 0 };
      if (myToken && v.voters && v.voters[myToken]) {
        myVotes[id] = v.voters[myToken] === 1 ? "up" : "down";
      }
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      modBounties:     state.modBounties     || [],
      bountyUrls:      state.bountyUrls      || {},
      deletedBounties: state.deletedBounties || [],
      requests:        (state.requests || []).map(stripVoterToken),
      deletedRequests: state.deletedRequests || [],
      votes:           slimVotes,
      myVotes
    });
  } catch (e) {
    console.error("[/api/state]", e);
    res.status(500).json({ error: "Server error", detail: String(e.message || e) });
  }
};

// don't expose voter tokens to other clients
function stripVoterToken(r) {
  const { voterToken, ...rest } = r || {};
  return rest;
}
