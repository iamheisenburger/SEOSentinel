import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { stopOwnedProcess } from "../scripts/owned-process.mjs";

test("fixture shutdown is bounded, idempotent and signals only its own child", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); process.send('ready'); setInterval(()=>{},1000)"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const sibling = spawn(process.execPath, ["-e", "process.send('ready'); setInterval(()=>{},1000)"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  try {
    await Promise.all([once(child, "message"), once(sibling, "message")]);
    await stopOwnedProcess(child, 100);
    assert.equal(child.signalCode, "SIGKILL");
    assert.equal(sibling.exitCode, null); assert.equal(sibling.signalCode, null);
    await stopOwnedProcess(child, 100);
  } finally { await stopOwnedProcess(child, 100); await stopOwnedProcess(sibling, 100); }
  assert.equal(sibling.signalCode, "SIGTERM");
});
