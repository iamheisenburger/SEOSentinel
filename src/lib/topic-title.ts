const ACRONYMS = /\b(ai|seo|crm|saas|b2b|b2c|api|faq|roi|kpi|ux|ui|llm|mdx|cms|ppc|smb|hr|it)\b/gi;

/** Sentence-case topic label with common acronyms kept upper case ("AI sales automation"). */
export const topicTitle = (label: string) =>
  label.replace(ACRONYMS, (m) => m.toUpperCase()).replace(/^./, (c) => c.toUpperCase());
