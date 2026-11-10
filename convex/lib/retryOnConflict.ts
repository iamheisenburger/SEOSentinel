/** P404: a write that lost a race (HTTP 409: nothing was written) is tried again after a short, growing wait. Any other
 * answer, success or refusal, is returned at once. Pure apart from the wait. */
export async function retryOnConflict<T extends { status: number }>(attempt: () => Promise<T>, tries = 4,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  let last = await attempt();
  for (let i = 1; i < tries && last.status === 409; i++) {
    await wait(400 * i + Math.floor(Math.random() * 300));
    last = await attempt();
  }
  return last;
}
