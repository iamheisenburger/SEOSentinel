// Pentra blog (https://pentra.dev): the list of articles. Pentra added this page with the blog.
import Link from "next/link";
import { CSS, LABEL, SITE, formatDate } from "./_pentra/site.js";
import { getPosts } from "./_pentra/posts.js";

export const metadata = {
  title: LABEL.blog,
  description: `${LABEL.blog}: ${SITE.name}`,
  alternates: { canonical: `${SITE.origin}${SITE.path}` },
};

export default function PentraBlogIndex() {
  const posts = getPosts();
  return (
    <div className="pentra-blog" data-pentra-blog="index">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <p className="pentra-crumb">
        <Link href="/">{SITE.name}</Link>
      </p>
      <h1>{`${SITE.name} ${LABEL.blog.toLowerCase()}`}</h1>
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
