// Pentra blog (https://pentra.dev): one article. Pentra added this page with the blog.
import Head from "next/head";
import Link from "next/link";
import { CSS, LABEL, SITE, formatDate } from "__PENTRA_LIB__/site.js";
import { getPost, getPosts, relatedPosts, structuredData } from "__PENTRA_LIB__/posts.js";

export function getStaticPaths() {
  return { paths: getPosts().map((post) => ({ params: { slug: post.slug } })), fallback: false };
}

export function getStaticProps({ params }) {
  const post = getPost(params.slug);
  if (!post) return { notFound: true };
  return { props: { post, related: relatedPosts(post, getPosts()), schema: structuredData(post) } };
}

export default function PentraBlogPost({ post, related, schema }) {
  const title = post.metaTitle || post.title;
  return (
    <div className="pentra-blog" data-pentra-blog="post">
      <Head>
        <title>{title}</title>
        {post.description ? <meta name="description" content={post.description} /> : null}
        <link rel="canonical" href={post.canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={title} />
        <meta property="og:url" content={post.canonicalUrl} />
        {post.image ? <meta property="og:image" content={post.image} /> : null}
      </Head>
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />
    </div>
  );
}
