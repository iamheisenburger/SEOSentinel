// Pentra blog (https://pentra.dev): the list of articles. Pentra added this page with the blog.
import Head from "next/head";
import Link from "next/link";
import { CSS, LABEL, SITE, formatDate } from "__PENTRA_LIB__/site.js";
import { getPosts } from "__PENTRA_LIB__/posts.js";

export function getStaticProps() {
  return { props: { posts: getPosts() } };
}

export default function PentraBlogIndex({ posts }) {
  const title = `${SITE.name} ${LABEL.blog.toLowerCase()}`;
  return (
    <div className="pentra-blog" data-pentra-blog="index">
      <Head>
        <title>{title}</title>
        <meta name="description" content={`${LABEL.blog}: ${SITE.name}`} />
        <link rel="canonical" href={`${SITE.origin}${SITE.path}`} />
      </Head>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <p className="pentra-crumb">
        <Link href="/">{SITE.name}</Link>
      </p>
      <h1>{title}</h1>
      {posts.length === 0 ? (
        <p>{LABEL.empty}</p>
      ) : (
        <ul className="pentra-list">
          {posts.map((post) => (
            <li key={post.slug}>
              <p className="pentra-meta">{formatDate(post.date)}</p>
              <h2>
                <Link href={post.path}>{post.title}</Link>
              </h2>
              {post.description ? <p>{post.description}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
