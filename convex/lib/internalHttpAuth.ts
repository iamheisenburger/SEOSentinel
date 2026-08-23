export function isAuthorizedInternalBearer(
  authorization: string | null,
  configuredSecrets: Array<string | undefined>,
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  if (!supplied) return false;

  return configuredSecrets.some((candidate) => {
    const secret = candidate?.trim();
    return Boolean(secret && supplied === secret);
  });
}
