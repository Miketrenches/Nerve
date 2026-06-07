/* ==========================================================================
   NERVE — EDITABLE CONTENT
   --------------------------------------------------------------------------
   Edit and refresh the page. No build step. No backend.
   ========================================================================== */

window.NERVE_DATA = {

  // ---- token / socials ----------------------------------------------------
  token: {
    contract: "PASTE_CONTRACT_ADDRESS_HERE",
    pumpfun:  "https://pump.fun/",
    twitter:  "https://x.com/",
    telegram: "https://t.me/"
  },

  // ---- PLAYER mode: open bounties -----------------------------------------
  // fields: id, title, brief (optional), prize, image (optional)
  bounties: [
    {
      id:    "B-001",
      title: "TRY ON THE DRESS",
      brief: "Walk into the boutique. Try on the most expensive dress. Film it.",
      prize: "$500",
      image: "assets/bounty-dress.png"
    },
    {
      id:    "B-002",
      title: "GO WITH HIM TO THE CITY",
      brief: "Meet the stranger. Get on the train. Don't ask questions.",
      prize: "$200",
      image: "assets/bounty-city.png"
    },
    {
      id:    "B-003",
      title: "JUMP THE CLIFF",
      brief: "Find the spot. Send it. No takebacks.",
      prize: "$1,000",
      image: "assets/cliff-jump.png"
    },
    {
      id:    "B-004",
      title: "CHEERLEADER FLASHMOB",
      brief: "Crash the half-time show. Thirty seconds. Make it count.",
      prize: "$750",
      image: "assets/cheerleaders.png"
    },
    {
      id:    "B-005",
      title: "OUTRUN THE PLUMBER",
      brief: "Full Mario fit. Sprint through the tunnel. Don't get caught.",
      prize: "$300",
      image: "assets/runner.png"
    },
    {
      id:    "B-006",
      title: "HACK THE FEED",
      brief: "Crack the access code. Drop the receipts on-chain.",
      prize: "$2,500",
      image: "assets/network.png"
    }
  ],

  // ---- WATCHER feed: pre-seeded example requests --------------------------
  // These are static examples (no images) that always appear under any
  // localStorage requests so the feed never looks empty on first visit.
  // Timestamps are relative to page load, so they always read as "fresh".
  // fields: id, title, brief, prize, duration, contact, image (optional), createdAt
  seedRequests: [
    {
      id:        "seed-1",
      title:     "ROBOT DANCE AT GRAND CENTRAL",
      brief:     "60 seconds, mid-rush hour, mid-concourse. No music. Crowd reaction matters more than the dance.",
      prize:     "$200",
      duration:  "3 DAYS",
      contact:   "@nyx_void",
      image:     null,
      baseScore: 24,
      createdAt: Date.now() - 2 * 60 * 1000
    },
    {
      id:        "seed-2",
      title:     "READ POETRY ON THE BUS",
      brief:     "Stand up. Read one full sonnet, loud and clear, eye contact with one stranger. Don't break.",
      prize:     "$120",
      duration:  "7 DAYS",
      contact:   "@kestrel",
      image:     null,
      baseScore: 9,
      createdAt: Date.now() - 18 * 60 * 1000
    },
    {
      id:        "seed-3",
      title:     "SWAP CARTS WITH A STRANGER",
      brief:     "Supermarket. Full cart for full cart. Smile. Walk away. They keep yours, you check out theirs.",
      prize:     "$80",
      duration:  "24 HOURS",
      contact:   "@orion_p",
      image:     null,
      baseScore: 41,
      createdAt: Date.now() - 2 * 60 * 60 * 1000
    },
    {
      id:        "seed-4",
      title:     "REPLACE A FRIEND'S PLAYLIST",
      brief:     "Their entire on-repeat playlist. Replace it with sea shanties only. Document the moment they find out.",
      prize:     "$60",
      duration:  "14 DAYS",
      contact:   "@maeve_x",
      image:     null,
      baseScore: -3,
      createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000
    }
  ]
};
