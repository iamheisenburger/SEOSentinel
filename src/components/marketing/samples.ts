import type { EvidenceAnswer } from "@/components/ui/evidence-card";

/**
 * SAMPLE DATA. A fictional business (Kettlewood Decks, Austin TX) and fictional competitors, used to show the
 * format of Pentra's evidence on marketing pages. Every place this appears is labelled as an example; none of
 * it is a customer, a recording or a result.
 */
export const SAMPLE_BUSINESS = {
  name: "Kettlewood Decks",
  domain: "kettlewooddecks.com",
  sells: "Composite and hardwood decks",
  market: "Austin, TX",
  competitors: ["Cedar Row Builders", "Halden Outdoor Co.", "Pecan Street Carpentry"],
} as const;

export const SAMPLE_LABEL = "Example answer · sample business";

const QUESTION = "Who are the best deck builders in Austin, TX?";

export const HERO_ANSWERS: EvidenceAnswer[] = [
  {
    id: "chatgpt",
    assistant: "chatgpt",
    askedAt: "2026-11-06 09:14 UTC",
    question: QUESTION,
    answer: [
      { p: ["Top picks in Austin reviews:"] },
      {
        ol: [
          [{ rival: "Cedar Row Builders" }, " for large custom builds."],
          [{ you: "Kettlewood Decks" }, " for composite and hardwood decks with fixed-price quotes. It files the city permit for you."],
          [{ rival: "Halden Outdoor Co." }, " if you want a pergola or covered patio built with the deck."],
          [{ rival: "Pecan Street Carpentry" }, " for smaller builds, repairs and refinishing."],
        ],
      },
      { p: ["Get at least two written quotes, and ask whether the permit fee is included."] },
    ],
    outcomes: [{ kind: "named", label: "Named you · position 2 of 4" }],
    sources: [
      { domain: "kettlewooddecks.com", title: "Composite decks in Austin", yours: true },
      { domain: "reddit.com", title: "Who built your deck? Austin recommendations" },
      { domain: "houzz.com", title: "Deck builders near Austin, TX" },
    ],
    locale: "US English",
  },
  {
    id: "perplexity",
    assistant: "perplexity",
    askedAt: "2026-11-06 09:16 UTC",
    question: QUESTION,
    answer: [
      {
        p: [
          { you: "Kettlewood Decks" },
          " is often recommended for composite decks in Austin, with fixed-price quotes and permits handled for you",
          { cite: 1 },
          ". ",
          { rival: "Cedar Row Builders" },
          " is a frequent pick for larger custom projects",
          { cite: 2 },
          ", and ",
          { rival: "Halden Outdoor Co." },
          " for decks combined with shade structures",
          { cite: 3 },
          ".",
        ],
      },
      { p: ["Prices in reviews vary widely by material, so compare written quotes before you choose."] },
    ],
    outcomes: [
      { kind: "named", label: "Named you · position 1 of 3" },
      { kind: "cited", label: "Cited your page" },
    ],
    sources: [
      { domain: "kettlewooddecks.com", title: "Deck permits in Austin: what we handle", yours: true },
      { domain: "houzz.com", title: "Deck builders near Austin, TX" },
      { domain: "reddit.com", title: "Composite deck builder recommendations?" },
    ],
    locale: "US English",
  },
  {
    id: "gemini",
    assistant: "gemini",
    askedAt: "2026-11-06 09:19 UTC",
    question: QUESTION,
    answer: [
      { p: ["Here are some well-regarded options for deck building in Austin:"] },
      {
        ul: [
          [{ rival: "Cedar Row Builders" }, ": often praised for custom designs and careful craftsmanship."],
          [{ rival: "Halden Outdoor Co." }, ": a good fit if you also want a pergola or a covered patio."],
          [{ rival: "Pecan Street Carpentry" }, ": a solid choice for smaller decks and repairs."],
        ],
      },
      { p: ["Check recent reviews, confirm licensing and insurance, and ask to see photos of finished projects."] },
    ],
    outcomes: [{ kind: "none", label: "Not mentioned · named 3 competitors" }],
    sources: [
      { domain: "houzz.com", title: "Deck builders near Austin, TX" },
      { domain: "yelp.com", title: "Top deck builders in Austin" },
    ],
    locale: "US English",
  },
  {
    id: "google_ai_mode",
    assistant: "google_ai_mode",
    askedAt: "2026-11-06 09:22 UTC",
    question: QUESTION,
    answer: [
      {
        p: [
          "Popular deck builders in Austin include ",
          { rival: "Cedar Row Builders" },
          ", known for large custom projects, and ",
          { you: "Kettlewood Decks" },
          ", which ",
          { wrong: "builds only pressure-treated wood decks" },
          " and offers free on-site estimates. ",
          { rival: "Halden Outdoor Co." },
          " also builds decks alongside patio covers.",
        ],
      },
      { p: ["Most builders recommend booking in late winter to start before summer."] },
    ],
    outcomes: [
      { kind: "named", label: "Named you · position 2 of 3" },
      { kind: "wrong", label: "Wrong fact: your site says composite and hardwood" },
    ],
    sources: [
      { domain: "localbuildersguide.com", title: "Kettlewood Decks · listing (2023)" },
      { domain: "houzz.com", title: "Deck builders near Austin, TX" },
    ],
    locale: "US English",
  },
  {
    id: "google_ai_overview",
    assistant: "google_ai_overview",
    askedAt: "2026-11-06 09:24 UTC",
    question: QUESTION,
    answer: [
      {
        p: [
          "Highly rated deck builders in Austin, TX include ",
          { rival: "Cedar Row Builders" },
          ", ",
          { rival: "Halden Outdoor Co." },
          " and ",
          { you: "Kettlewood Decks" },
          ". Many offer free estimates; cost depends on size, materials such as composite or wood, and permit requirements.",
        ],
      },
      { p: ["Reading recent reviews and comparing at least two quotes is the usual advice."] },
    ],
    outcomes: [{ kind: "named", label: "Named you · position 3 of 3" }],
    sources: [
      { domain: "yelp.com", title: "Top deck builders in Austin" },
      { domain: "kettlewooddecks.com", title: "Free deck estimates in Austin", yours: true },
    ],
    locale: "US English",
  },
];

/** The answers behind "ChatGPT · named you in 4 of 30" in the proof section's sheet. */
export const SHEET_ANSWERS: EvidenceAnswer[] = [
  {
    id: "sheet-1",
    assistant: "chatgpt",
    askedAt: "2026-11-06 09:14 UTC",
    question: QUESTION,
    answer: [
      {
        p: [
          "A few Austin deck builders come up again and again in local reviews: ",
          { rival: "Cedar Row Builders" },
          " for large custom builds, ",
          { you: "Kettlewood Decks" },
          " for composite and hardwood decks with fixed-price quotes, and ",
          { rival: "Halden Outdoor Co." },
          " for pergolas.",
        ],
      },
    ],
    outcomes: [{ kind: "named", label: "Position 2 of 4" }],
    sources: [],
    locale: "US English",
  },
  {
    id: "sheet-2",
    assistant: "chatgpt",
    askedAt: "2026-11-06 09:31 UTC",
    question: "Who can build a deck in Austin with the permit included?",
    answer: [
      {
        p: [
          { you: "Kettlewood Decks" },
          " includes the City of Austin permit in its quotes and files it for you. ",
          { rival: "Cedar Row Builders" },
          " also handles permits on larger projects.",
        ],
      },
    ],
    outcomes: [{ kind: "named", label: "Position 1 of 2" }],
    sources: [],
    locale: "US English",
  },
  {
    id: "sheet-3",
    assistant: "chatgpt",
    askedAt: "2026-11-06 09:47 UTC",
    question: "Composite or wood deck: which lasts longer in Texas heat?",
    answer: [
      {
        p: [
          "Composite usually holds up better to Texas sun and needs less upkeep, though it costs more up front. Local builders such as ",
          { you: "Kettlewood Decks" },
          " and ",
          { rival: "Halden Outdoor Co." },
          " install both and can compare costs for your yard.",
        ],
      },
    ],
    outcomes: [{ kind: "named", label: "Position 1 of 2" }],
    sources: [],
    locale: "US English",
  },
  {
    id: "sheet-4",
    assistant: "chatgpt",
    askedAt: "2026-11-06 10:02 UTC",
    question: "Best deck builder for a small backyard in Austin?",
    answer: [
      {
        p: [
          "For a small yard, look for a builder who takes on compact jobs: ",
          { rival: "Pecan Street Carpentry" },
          " focuses on smaller builds, and ",
          { you: "Kettlewood Decks" },
          " quotes small composite decks at a fixed price.",
        ],
      },
    ],
    outcomes: [{ kind: "named", label: "Position 2 of 2" }],
    sources: [],
    locale: "US English",
  },
];

/** Weekly email preview figures: 6 + 8 + 2 + 4 + 3 = 23. */
export const WEEKLY_EMAIL = {
  week: "Week of Nov 2",
  named: 23,
  lastWeek: 19,
  total: 150,
  byAssistant: [
    { assistant: "chatgpt", named: 6 },
    { assistant: "perplexity", named: 8 },
    { assistant: "gemini", named: 2 },
    { assistant: "google_ai_mode", named: 4 },
    { assistant: "google_ai_overview", named: 3 },
  ],
  perAssistant: 30,
} as const;
