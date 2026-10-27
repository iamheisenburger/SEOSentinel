#!/bin/bash
# Vercel "Ignored Build Step" for pentra.dev (P224, Oct 27 2026): exit 0 skips the build, any other exit builds.
# pentra.dev's blog renders from Convex. Its article files under content/ are the publication records Pentra commits
# for every article and link repair; a build for them changes nothing on the site, yet it spends one of the account's
# 100 daily deploys and purges Next's data cache (each purge re-reads the 2.4 MB blog listing and sitemap from Convex).
# Only a commit that changes nothing outside content/ since the last deployed commit is skipped; when in doubt, it builds.
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$prev" ] || exit 1
git cat-file -e "${prev}^{commit}" 2>/dev/null || git fetch --quiet --depth=100 origin 2>/dev/null
git cat-file -e "${prev}^{commit}" 2>/dev/null || exit 1
if git diff --quiet "$prev" HEAD -- . ':(exclude)content'; then
  echo "Only content/ changed since ${prev}: build skipped (pentra.dev's blog renders from Convex)."
  exit 0
fi
exit 1
