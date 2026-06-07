// POST /api/submit
// Body: { title, brief, prize, duration, contact, image?, voterToken }
// 1 active request per voterToken — re-submitting replaces the previous one.

const { loadState, saveState } = require("./_lib/state");

const FIELD_LIMITS = {
  title:    { min: 1,   max: 200  },
  brief:    { min: 1,   max: 1000 },
  prize:    { min: 1,   max: 100  },
  duration: { min: 1,   max: 50   },
  contact:  { min: 1,   max: 100  }
};

const IMG_MAX_BYTES   = 250 * 1024;     // base64 size cap
const REQUESTS_MAX    = 100;            // most-recent N kept

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  try {
    const body = req.body || {};

    if (!body.voterToken || typeof body.voterToken !== "string" || body.voterToken.length > 100) {
      return res.status(400).json({ error: "Missing voterToken" });
    }

    for (const [field, { min, max }] of Object.entries(FIELD_LIMITS)) {
      const v = body[field];
      if (typeof v !== "string" || v.trim().length < min || v.length > max) {
        return res.status(400).json({ error: `Invalid field: ${field}` });
      }
    }

    if (body.image && (typeof body.image !== "string" || body.image.length > IMG_MAX_BYTES)) {
      return res.status(400).json({ error: "Image too large or invalid" });
    }

    const state = await loadState();

    // 1-per-voter: drop any prior request from this token
    state.requests = (state.requests || []).filter((r) => r.voterToken !== body.voterToken);

    const newReq = {
      id:        "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title:     body.title.trim(),
      brief:     body.brief.trim(),
      prize:     body.prize.trim(),
      duration:  body.duration.trim(),
      contact:   body.contact.trim(),
      image:     body.image || null,
      voterToken: body.voterToken,
      createdAt: Date.now()
    };

    state.requests.unshift(newReq);
    if (state.requests.length > REQUESTS_MAX) {
      state.requests = state.requests.slice(0, REQUESTS_MAX);
    }

    await saveState(state);

    // strip voter token from response
    const { voterToken, ...safe } = newReq;
    res.status(200).json({ ok: true, request: safe });
  } catch (e) {
    console.error("[/api/submit]", e);
    res.status(500).json({ error: "Server error", detail: String(e.message || e) });
  }
};
