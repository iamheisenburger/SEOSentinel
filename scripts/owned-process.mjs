// Only accepts a ChildProcess returned by this harness's own spawn call. Never
// discovers or signals processes by port/name, and never removes a database.
export async function stopOwnedProcess(child, graceMs = 2000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  async function wait(ms) {
    let timer;
    const stopped = await Promise.race([exited.then(() => true), new Promise(resolve => {
      timer = setTimeout(() => resolve(false), ms);
    })]);
    clearTimeout(timer);
    return stopped;
  }
  child.kill('SIGTERM');
  if (await wait(graceMs)) return;
  // The retained ChildProcess has not emitted exit, so this is still our child.
  child.kill('SIGKILL');
  if (!await wait(graceMs)) throw new Error('Owned fixture child did not exit after bounded shutdown');
}
