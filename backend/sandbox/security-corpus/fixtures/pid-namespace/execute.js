// Security-corpus fixture — reports this process's own PID. Under real `--unshare-pid`
// confinement, the sandboxed worker is PID 1 (or very low) inside its own PID namespace,
// regardless of how many other processes are running on the host — a concrete signal that
// PID-namespace isolation is actually active, not just requested on the command line.
module.exports = async function execute() {
  return { pid: process.pid };
};
