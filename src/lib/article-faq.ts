/** Questions and answers from an article's "Frequently asked questions" section, as plain
 * text for FAQPage structured data. Only that section counts: a question-shaped heading
 * elsewhere in the article is not an FAQ entry. */
export function articleFaq(markdown: string): { question: string; answer: string }[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(?:frequently asked questions|faqs?)\b/i.test(line.trim()));
  if (start < 0) return [];
  const faqs: { question: string; answer: string }[] = [];
  let question: string | null = null;
  let answer: string[] = [];
  const flush = () => {
    const text = plain(answer.join(" "));
    if (question && text) faqs.push({ question, answer: text.length > 600 ? `${text.slice(0, 597).trimEnd()}…` : text });
    question = null;
    answer = [];
  };
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^##\s/.test(line)) break; // next top-level section ends the FAQ
    const heading = line.match(/^#{3,4}\s+(.+?\?)\s*$/);
    const bold = line.match(/^\*\*(.+?\?)\*\*\s*(.*)$/);
    if (heading || bold) {
      flush();
      question = plain((heading ?? bold)![1]);
      if (bold?.[2]) answer.push(bold[2]);
    } else if (question && line) {
      answer.push(line);
    }
  }
  flush();
  return faqs.slice(0, 10);
}

function plain(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s*\[\d+\]/g, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
