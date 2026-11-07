// Pentra blog (https://pentra.dev): the blog's own sitemap, served at <blog>/sitemap.xml. Pentra submits it to Google
// Search Console when Search Console is connected.
import { SITE } from "./_pentra/site.js";
import { getPosts } from "./_pentra/posts.js";

export default function sitemap() {
  const posts = getPosts();
  return [
    { url: `${SITE.origin}${SITE.path}`, ...(posts[0] ? { lastModified: new Date(posts[0].updatedAt || posts[0].date) } : {}) },
    ...posts.map((post) => ({ url: post.canonicalUrl, lastModified: new Date(post.updatedAt || post.date) })),
  ];
}
