/**
 * SYNTHETIC DATA for the dev-only harness under /e2e-acceptance/answers. A fictional business (Kettlewood Decks, the same
 * sample business the marketing pages label as an example) and fictional competitors. Never a customer, a recording or a
 * result; the harness says so on every screen and returns 404 in production.
 */

export const SYNTHETIC_NOW = Date.UTC(2026, 10, 7, 15, 0, 0);
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const SYN_SITE_ID = "site_kettlewood";
export const SYN_LEGACY_SITE_ID = "site_oakhollow";

export const SYN_BUSINESS = {
  name: "Kettlewood Decks",
  domain: "kettlewooddecks.com",
  sells: "Composite and hardwood decks in Austin, built to a fixed-price quote, with the City of Austin permit filed for you.",
  buyers: "Homeowners in Austin and nearby suburbs planning a new deck or replacing an old one.",
  offerings: ["Composite decks", "Hardwood decks", "Deck replacement", "Pergolas and shade", "Permit filing"],
  country: "US",
  location: "Austin, TX",
  trait: "builds composite and hardwood decks on a fixed-price quote and files the city permit for you",
};

export const SYN_COMPETITORS = [
  { name: "Cedar Row Builders", domain: "cedarrowbuilders.com", p: 0.3, trait: "is a frequent pick for large custom builds" },
  { name: "Halden Outdoor Co.", domain: "haldenoutdoor.com", p: 0.2, trait: "pairs decks with pergolas and covered patios" },
  { name: "Pecan Street Carpentry", domain: "pecanstreetcarpentry.com", p: 0.14, trait: "handles smaller builds, repairs and refinishing" },
  { name: "Lone Star Deck & Fence", domain: "lonestardeckfence.com", p: 0.09, trait: "builds decks and fences across Travis and Williamson counties" },
];

export const SYN_QUESTIONS: { question: string; intent: string }[] = [
  { question: "Who are the best deck builders in Austin, TX?", intent: "recommendation" },
  { question: "How much does a composite deck cost in Austin?", intent: "cost" },
  { question: "Do I need a permit to build a deck in Austin?", intent: "local" },
  { question: "Composite vs wood decking: which lasts longer in Texas heat?", intent: "comparison" },
  { question: "How long does it take to build a deck?", intent: "how_to" },
  { question: "What is the best composite decking brand for hot climates?", intent: "recommendation" },
  { question: "How do I choose a deck builder?", intent: "how_to" },
  { question: "Is Trex worth the money compared to cedar?", intent: "comparison" },
  { question: "How much does it cost to replace an old wood deck?", intent: "cost" },
  { question: "What deck material stays cool in direct sun?", intent: "problem" },
  { question: "Can you build a deck over a sloped yard?", intent: "problem" },
  { question: "How often should a cedar deck be sealed in Texas?", intent: "how_to" },
  { question: "What should I ask a deck contractor before hiring?", intent: "how_to" },
  { question: "Who builds covered patios and decks together in Austin?", intent: "local" },
  { question: "How much value does a new deck add to a house?", intent: "cost" },
  { question: "What is the cheapest way to build a deck that still looks good?", intent: "cost" },
  { question: "Should I repair or replace a deck with soft boards?", intent: "problem" },
  { question: "How far apart should deck joists be for composite boards?", intent: "how_to" },
  { question: "Do deck builders in Austin handle HOA approval?", intent: "local" },
  { question: "Which deck builders in Austin offer fixed-price quotes?", intent: "recommendation" },
  { question: "Hardwood or composite decking for a family with dogs?", intent: "comparison" },
  { question: "How do I stop a deck from getting slippery?", intent: "problem" },
  { question: "What warranty should a deck builder offer?", intent: "recommendation" },
  { question: "How much does a deck permit cost in Travis County?", intent: "local" },
  { question: "Can a deck be built in winter in Central Texas?", intent: "how_to" },
  { question: "What is the best decking for a pool area?", intent: "recommendation" },
  { question: "Pressure-treated pine or cedar for a deck in Austin?", intent: "comparison" },
  { question: "How do I know if my deck is safe?", intent: "problem" },
  { question: "Who are the best deck repair companies near Round Rock?", intent: "local" },
  { question: "Is ipe decking worth it?", intent: "comparison" },
];

export const SYN_SOURCE_POOL = [
  { domain: "reddit.com", path: "/r/Austin/comments/deck_builders", title: "Who built your deck? Austin recommendations" },
  { domain: "houzz.com", path: "/professionals/deck-builders/austin-tx", title: "Deck builders near Austin, TX" },
  { domain: "angi.com", path: "/companylist/us/tx/austin/deck-builders.htm", title: "Top deck builders in Austin" },
  { domain: "austintexas.gov", path: "/page/residential-permits", title: "Residential building permits" },
  { domain: "thisoldhouse.com", path: "/decks/composite-vs-wood-decking", title: "Composite vs. wood decking" },
  { domain: "trex.com", path: "/why-trex/heat", title: "How composite decking handles heat" },
  { domain: "homeadvisor.com", path: "/cost/outdoor-living/build-a-deck/", title: "How much does it cost to build a deck?" },
  { domain: "familyhandyman.com", path: "/project/deck-joist-spacing/", title: "Deck joist spacing explained" },
  { domain: "nextdoor.com", path: "/neighborhood/austin/deck-recommendations", title: "Deck builder recommendations" },
  { domain: "decks.com", path: "/how-to/deck-safety-checklist", title: "Deck safety checklist" },
];

/** Openers by intent, so each answer reads like the assistant answered the question it was asked. */
export const SYN_OPENERS: Record<string, string[]> = {
  recommendation: [
    "Austin homeowners and review sites most often point to these builders:",
    "Based on local reviews and guides, these are commonly recommended:",
  ],
  local: [
    "For the Austin area, local guides and the city's own pages say this:",
    "Here's how it works in Austin and the surrounding counties:",
  ],
  cost: [
    "Expect roughly $45 to $75 per square foot for composite in Austin, depending on height, stairs and railing.",
    "Costs vary with size and material; local quotes for a 300 sq ft deck usually land between $14,000 and $25,000.",
  ],
  comparison: [
    "Both work in Central Texas, but they age differently in heat and sun.",
    "The short answer depends on how much upkeep you want to do each year.",
  ],
  how_to: [
    "Most deck projects follow the same steps, and timing depends on permits.",
    "Here is what usually matters most, in order:",
  ],
  problem: [
    "This is common in Texas, and there are a few reliable fixes.",
    "Start by checking the boards and the framing underneath.",
  ],
};

export const SYN_ADVICE = [
  "Get at least two written quotes, and ask whether the permit fee is included.",
  "Ask to see a recent project of the same size, and check the labor warranty in writing.",
  "Whatever you choose, confirm the builder carries liability insurance.",
  "Prices move with lumber costs, so ask how long a quote stays valid.",
];

/** Page bodies for the harness's answer pages (fictional, with numbered source markers). */
export function synPageMarkdown(question: string, title: string): string {
  return `Most Austin homeowners asking "${question}" want a straight answer they can act on this week. Here is what matters, from the sources assistants cite most often for this question. [1]

## The short answer

${title} comes down to three things: the material you choose, whether your deck needs a permit, and how the quote is priced. A fixed-price quote protects you from overruns; a time-and-materials quote can come in lower or higher. [2]

## What to compare

- **Material.** Composite boards cost more up front but need no staining; hardwood such as ipe lasts decades with yearly oiling. [2]
- **Permits.** The City of Austin requires a permit for most decks more than 30 inches above grade or attached to the house. [3]
- **Warranty.** Look for at least two years on labor, in addition to the manufacturer's board warranty. [1]

## Where Kettlewood Decks fits

Kettlewood Decks builds composite and hardwood decks in Austin on a fixed-price quote and files the City of Austin permit for you. It does not build fences or pools.

## Questions to ask every builder

1. Is the permit fee in the quote?
2. Who is on site each day, and who do I call?
3. What happens if the inspection finds a problem?

Get at least two written quotes and compare them line by line, not only by the total. [1]`;
}

export const SYN_PAGE_SOURCES = [
  { url: "https://www.reddit.com/r/Austin/comments/deck_builders", title: "Who built your deck? Austin recommendations",
    excerpt: "Get at least two quotes. Ask if the permit is in the price; ours wasn't and it added two weeks." },
  { url: "https://www.thisoldhouse.com/decks/composite-vs-wood-decking", title: "Composite vs. wood decking",
    excerpt: "Composite decking doesn't need staining or sealing; hardwoods like ipe need oil once a year to keep their color." },
  { url: "https://www.austintexas.gov/page/residential-permits", title: "Residential building permits",
    excerpt: "A permit is required for decks more than 30 inches above grade or attached to the primary structure." },
];

export const SYN_PAGE_FACTS = [
  { text: "Kettlewood Decks builds composite and hardwood decks in Austin.", source: "business" },
  { text: "Quotes are fixed-price.", source: "business" },
  { text: "Kettlewood Decks files the City of Austin permit for the customer.", source: "business" },
  { text: "Austin requires a permit for decks more than 30 inches above grade or attached to the house.", source: "source",
    url: "https://www.austintexas.gov/page/residential-permits" },
  { text: "Composite decking needs no staining or sealing.", source: "source", url: "https://www.thisoldhouse.com/decks/composite-vs-wood-decking" },
];
