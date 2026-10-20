/** A repository the connected GitHub account can publish to. */
export type GithubRepositoryChoice = { owner: string; name: string; private: boolean };

/** The repositories in a GitHub `/user/repos` response that the account can
 * push to and that are not archived, in GitHub's order (most recently pushed
 * first). Anything malformed is left out. The owner picks one instead of
 * typing its owner and name after connecting GitHub (Phase 4, D3). */
export function pushableGithubRepositories(body: unknown): GithubRepositoryChoice[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry) => {
    const repo = entry as { name?: unknown; private?: unknown; archived?: unknown; owner?: { login?: unknown }; permissions?: { push?: unknown } } | null;
    return repo && typeof repo.name === "string" && typeof repo.owner?.login === "string" && repo.permissions?.push === true && repo.archived !== true
      ? [{ owner: repo.owner.login, name: repo.name, private: repo.private === true }]
      : [];
  });
}
