import { ANNUAL_MONTHS_FREE, PENTRA_PLAN, formatUsd } from "@/lib/pricing";
import { HONESTY_LINE, SNAPSHOT, SUPPORT_EMAIL } from "@/lib/product-facts";

/** Landing FAQ. Plain text answers, so the same copy feeds the accordion and the FAQPage JSON-LD. */
export const LANDING_FAQ: { id: string; question: string; answer: string }[] = [
  {
    id: "assistants",
    question: "Which AI assistants does Pentra check?",
    answer:
      "Five: ChatGPT, Perplexity, Gemini, and Google's AI, meaning both AI Mode and the AI Overviews at the top of Google results.",
  },
  {
    id: "method",
    question: "How do you ask them?",
    answer:
      "We send each question to each assistant's live product from a fresh session with web search, from your country, the way a new customer would. Answers vary between runs, so every count shows both numbers, like 23 of 150, and every answer is stored in full.",
  },
  {
    id: "guarantee",
    question: "Can you guarantee I'll be recommended?",
    answer: `No. ${HONESTY_LINE} What Pentra does is publish accurate pages that answer your buyers' questions, tell search engines they're live, and keep checking.`,
  },
  {
    id: "access",
    question: "Do you need access to my site?",
    answer:
      "Not for the free snapshot: Pentra reads your public pages, the way a search engine does. To publish, you connect WordPress, Webflow, Shopify, Ghost or GitHub, use a signed webhook for any other CMS, or point answers.yourdomain.com at Pentra with one DNS record.",
  },
  {
    id: "not-named",
    question: "What do I see when an assistant names someone else?",
    answer:
      "Every answer in full: the competitors it named, the sources it cited and the question it answered. The questions where you can win are the ones Pentra writes pages for first.",
  },
  {
    id: "page-accuracy",
    question: "Will the pages say things about me that aren't true?",
    answer:
      "Pages are written from the facts you confirmed and your live site, and every fact keeps its source, so you can check each one. Published pages keep their words until Pentra rewrites them.",
  },
  {
    id: "cost",
    question: "What does it cost?",
    answer: `The snapshot is free and needs no card: about ${SNAPSHOT.questions} questions, ${SNAPSHOT.assistants} assistants, about ${SNAPSHOT.answers} answers and ${SNAPSHOT.draftPages} draft pages. The plan is ${formatUsd(PENTRA_PLAN.monthly)} a month, or ${formatUsd(PENTRA_PLAN.annual)} a year (${ANNUAL_MONTHS_FREE} months free).`,
  },
  {
    id: "cancel",
    question: "Can I cancel anytime?",
    answer: `Yes. Cancel from Billing and your plan stays active until the end of the period you paid for. The pages Pentra published stay yours. Questions? Email ${SUPPORT_EMAIL}.`,
  },
];
