// Pentra blog (https://pentra.dev): one article. Pentra added this page with the blog.
import Link from "next/link";
import { notFound } from "next/navigation";
import { CSS, LABEL, SITE, formatDate } from "../_pentra/site.js";
import { getPost, getPosts, relatedPosts, structuredData } from "../_pentra/posts.js";

// Next.js needs at least one address to build this page before the first article exists; that one shows "not found".
const NO_POSTS_YET = "no-posts-yet";

export function generateStaticParams() {
  const posts = getPosts();
  return posts.length ? posts.map((post) => ({ slug: post.slug })) : [{ slug: NO_POSTS_YET }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const title = post.metaTitle || post.title;
  return {
    title: { absolute: title },
    description: post.description,
    alternates: { canonical: post.canonicalUrl },
    openGraph: {
      type: "article",
      title,
      description: post.description,
      url: post.canonicalUrl,
      publishedTime: post.date,
      ...(post.updatedAt ? { modifiedTime: post.updatedAt } : {}),
      ...(post.image ? { images: [post.image] } : {}),
    },
  };
}

export default async function PentraBlogPost({ params }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const related = relatedPosts(post, getPosts());
  return (
    <div className="pentra-blog" data-pentra-blog="post">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <p className="pentra-crumb">
        <Link href={SITE.path}>{LABEL.blog}</Link>
      </p>
      <h1>{post.title}</h1>
      {post.description ? <p className="pentra-lede">{post.description}</p> : null}
      <p className="pentra-meta">{`${formatDate(post.date)} · ${post.readingTime} ${LABEL.minRead}`}</p>
      {post.image ? <img className="pentra-hero" src={post.image} alt="" /> : null}
      <article dangerouslySetInnerHTML={{ __html: post.html }} />
      {post.sources.length > 0 && !post.hasSources ? (
        <aside>
          <h2>{LABEL.sources}</h2>
          <ol>
            {post.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title || new URL(source.url).hostname}
                </a>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
      {related.length > 0 && !post.hasRelated ? (
        <aside>
          <h2>{LABEL.related}</h2>
          <ul>
            {related.map((other) => (
              <li key={other.slug}>
                <Link href={other.path}>{other.title}</Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData(post) }} />
    </div>
  );
}
