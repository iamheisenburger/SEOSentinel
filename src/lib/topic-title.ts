const ACRONYMS = /\b(ai|seo|crm|saas|b2b|b2c|api|faq|roi|kpi|ux|ui|llm|mdx|cms|ppc|smb|hr|it)\b/gi;

/** Sentence-case topic label with common acronyms kept upper case ("AI sales automation").
 * A label that already has capitals (an article title) keeps its own casing, so "What It Is" never becomes "What IT Is". */
export const topicTitle = (label: string) =>
  (/[A-Z]/.test(label) ? label : label.replace(ACRONYMS, (m) => m.toLowerCase() === "saas" ? "SaaS" : m.toUpperCase())).replace(/^./, (c) => c.toUpperCase());
