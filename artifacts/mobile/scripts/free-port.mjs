import fs from "fs";

const port = parseInt(process.env.PORT || "18115", 10);
const hexPort = port.toString(16).toUpperCase().padStart(4, "0");

function findInodeForPort(hexPort) {
  for (const file of ["/proc/net/tcp6", "/proc/net/tcp"]) {
    try {
      const lines = fs.readFileSync(file, "utf-8").split("\n").slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        const localPort = parts[1].split(":").pop();
        if (localPort === hexPort) return parts[9];
      }
    } catch {}
  }
  return null;
}

function findPidByInode(inode) {
  try {
    for (const pid of fs.readdirSync("/proc").filter((f) => /^\d+$/.test(f))) {
      try {
        for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
          try {
            if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === `socket:[${inode}]`)
              return parseInt(pid, 10);
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return null;
}

const inode = findInodeForPort(hexPort);
if (inode) {
  const pid = findPidByInode(inode);
  if (pid && pid !== process.pid) {
    console.log(`[free-port] killing PID ${pid} holding port ${port}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
} else {
  console.log(`[free-port] port ${port} is free`);
}
