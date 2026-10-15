// @ts-check
// Ctrl-C / SIGTERM with a stack running. Pulumi takes a lock on its stack
// for up and destroy and releases it when it ends; killed mid-run it leaves
// the lock (and an orphaned provider plugin) and the next RUN says "the
// stack is currently locked". So: the first signal asks every pulumi to
// cancel (SIGINT: it finishes the resource operations in flight, writes its
// state and releases the lock), says what it waits for, and exits once they
// are gone. A second signal, or graceMs without them ending, forces
// (SIGKILL to each pulumi's process group, its plugins with it); the lock
// that leaves is cleared by the next RUN (src/pulumi-locks.js).
// upgrade: { children() -> [{ pid, text, stack }], stop(), force() }.
/**
 * @param {{ upgrade?: any, write?: (text: string) => any, save?: () => Promise<any>, exit?: (code: number) => void, graceMs?: number, tickMs?: number, pollMs?: number }} [opts]
 */
export function createShutdown({ upgrade, write = (text) => process.stdout.write(text), save = async () => {}, exit = (code) => process.exit(code), graceMs = 60_000, tickMs = 10_000, pollMs = 250 } = {}) {
  let stopping = false;
  let finished = false;
  let wake = null;
  const list = () => upgrade?.children?.() || [];
  const named = (items) => items.map((c) => `  ${c.text}${c.stack ? ` [stack ${c.stack}]` : ""} (pid ${c.pid})`).join("\n");
  async function end(code) {
    if (finished) return;
    finished = true;
    wake?.();
    await Promise.resolve(save()).catch(() => {});
    exit(code);
  }
  function forceNow(why) {
    const items = list();
    upgrade?.force?.();
    write(`${why}: forced ${items.length} pulumi run(s) to stop (SIGKILL, with their plugins). Their stacks may keep a lock: the next RUN removes a lock left by a run that died on this computer.\n`);
  }
  async function signal(name = "SIGINT") {
    if (finished) return;
    if (stopping) {
      forceNow(`${name} again`);
      await end(130);
      return;
    }
    stopping = true;
    const items = list();
    if (!items.length) {
      await end(0);
      return;
    }
    upgrade.stop();
    const seconds = Math.round(graceMs / 1000);
    write(`stopping: asked ${items.length} pulumi run(s) to cancel cleanly so their stack locks are released; waiting up to ${seconds} s for:\n${named(items)}\nPress Ctrl-C again to stop now.\n`);
    const started = Date.now();
    let lastTick = started;
    await new Promise((resolve) => {
      wake = resolve;
      const poll = setInterval(() => {
        const left = list();
        const at = Date.now();
        if (!left.length) {
          clearInterval(poll);
          write("pulumi stopped; locks released.\n");
          resolve();
          return;
        }
        if (at - started >= graceMs) {
          clearInterval(poll);
          forceNow(`pulumi did not stop within ${seconds} s`);
          resolve("timeout");
          return;
        }
        if (at - lastTick >= tickMs) {
          lastTick = at;
          write(`still waiting (${Math.round((at - started) / 1000)} s of ${seconds} s) for:\n${named(left)}\n`);
        }
      }, pollMs);
    }).then((why) => end(why === "timeout" ? 1 : 0));
  }
  return { signal, get stopping() { return stopping; } };
}
