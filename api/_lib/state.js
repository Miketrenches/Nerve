// Shared state blob. Single Redis key keeps everything atomic and simple.
// Layout:
//   modBounties:      Bounty[]                           (mod-promoted / added bounties)
//   bountyUrls:       { [bountyId]: string }             (ACCEPT button URL overrides)
//   deletedBounties:  string[]                           (default bounty ids the mod hid)
//   requests:         Request[]                          (user-submitted bounty requests)
//   deletedRequests:  string[]                           (request ids the mod hid)
//   votes:            { [requestId]: { score, voters } } (voters: { [voterToken]: 1 | -1 })

const redis = require("./redis");

const STATE_KEY = "nerve:state:v1";

const DEFAULTS = () => ({
  modBounties:     [],
  bountyUrls:      {},
  deletedBounties: [],
  requests:        [],
  deletedRequests: [],
  votes:           {}
});

async function loadState() {
  const s = await redis.get(STATE_KEY);
  if (!s || typeof s !== "object") return DEFAULTS();
  // fill in missing fields just in case
  const def = DEFAULTS();
  for (const k of Object.keys(def)) if (s[k] == null) s[k] = def[k];
  return s;
}

async function saveState(state) {
  return await redis.set(STATE_KEY, state);
}

module.exports = { loadState, saveState, STATE_KEY };
