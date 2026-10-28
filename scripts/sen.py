#!/usr/bin/env python3
"""sen — SentinelOps command-line launcher.

    sen run [--public] [--port N] [--no-build]   build + start, wait until healthy, print access info
    sen stop                                      stop everything (data is kept)
    sen restart                                   stop + run
    sen status                                    containers + health
    sen logs [service]                            follow logs (agent | dashboard | ...)
    sen password                                  show the initial admin password
    sen update                                    git pull + run
    sen help

Standard library only, works on Linux, macOS and Windows (Python 3.8+).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / ".sentinelops"
BUILD_LOG = LOG_DIR / "last-run.log"
DEFAULT_PORT = 4000
HEALTH_TIMEOUT = 240  # seconds to wait for dashboard + agent after containers start

# ── terminal styling ──────────────────────────────────────────────────────────
if os.name == "nt":
    os.system("")  # enables ANSI escape codes in Windows terminals
try:  # never crash on a terminal that cannot print a symbol
    sys.stdout.reconfigure(errors="replace")
except AttributeError:
    pass
COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
UTF = (sys.stdout.encoding or "").lower().replace("-", "") in ("utf8", "utf16")


def c(code, text):
    return f"\033[{code}m{text}\033[0m" if COLOR else text


def green(t): return c("32", t)
def red(t): return c("31", t)
def yellow(t): return c("33", t)
def blue(t): return c("36", t)
def dim(t): return c("2", t)
def bold(t): return c("1", t)


OK = "✔" if UTF else "OK"
FAIL = "✖" if UTF else "X"
FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏" if UTF else "|/-\\"


class Spinner:
    """One status line that updates in place: spinner, step label, elapsed time, latest detail."""

    def __init__(self):
        self.label = ""
        self.detail = ""
        self.started = time.time()
        self._stop = threading.Event()
        self._thread = None
        self.width = shutil.get_terminal_size((100, 20)).columns

    def start(self, label):
        self.label, self.detail, self.step_started = label, "", time.time()
        if not sys.stdout.isatty():
            print(f"... {label}")
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._spin, daemon=True)
        self._thread.start()

    def _spin(self):
        i = 0
        while not self._stop.is_set():
            secs = int(time.time() - self.step_started)
            line = f"{blue(FRAMES[i % len(FRAMES)])} {self.label} {dim(f'({secs}s)')}"
            if self.detail:
                room = self.width - len(self.label) - 14
                if room > 10:
                    d = self.detail if len(self.detail) <= room else self.detail[: room - 1] + "…"
                    line += "  " + dim(d)
            sys.stdout.write("\r\033[K" + line)
            sys.stdout.flush()
            i += 1
            time.sleep(0.1)

    def _end(self, symbol, text):
        if self._thread:
            self._stop.set()
            self._thread.join()
            self._thread = None
            sys.stdout.write("\r\033[K")
        secs = time.time() - self.step_started
        print(f"{symbol} {text} {dim(f'({secs:.0f}s)')}")

    def ok(self, text=None):
        self._end(green(OK), text or self.label)

    def fail(self, text=None):
        self._end(red(FAIL), text or self.label)


# ── helpers ───────────────────────────────────────────────────────────────────
def die(msg, hint=None):
    print(f"{red(FAIL)} {msg}")
    if hint:
        print(f"  {dim(hint)}")
    sys.exit(1)


def compose_cmd():
    """`docker compose` (v2 plugin) or the legacy `docker-compose` binary."""
    if shutil.which("docker"):
        r = subprocess.run(["docker", "compose", "version"], capture_output=True, text=True)
        if r.returncode == 0:
            return ["docker", "compose"]
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    die("Docker Compose not found.", "Install Docker Desktop (Windows/macOS) or docker-ce + docker-compose-plugin (Linux).")


def run_quiet(args, **kw):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, **kw)


def read_env():
    env = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
            if m and not line.lstrip().startswith("#"):
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def http_json(url, timeout=3):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def public_ip():
    """Public IP when running on a server (used to print a reachable URL)."""
    try:  # EC2 instance metadata (IMDSv2)
        req = urllib.request.Request("http://169.254.169.254/latest/api/token", method="PUT",
                                     headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"})
        token = urllib.request.urlopen(req, timeout=1).read().decode()
        req = urllib.request.Request("http://169.254.169.254/latest/meta-data/public-ipv4",
                                     headers={"X-aws-ec2-metadata-token": token})
        ip = urllib.request.urlopen(req, timeout=1).read().decode().strip()
        if ip:
            return ip
    except Exception:
        pass
    try:
        return urllib.request.urlopen("https://checkip.amazonaws.com", timeout=3).read().decode().strip()
    except Exception:
        return None


def initial_password(compose):
    env = read_env()
    if env.get("ADMIN_PASSWORD"):
        return env.get("ADMIN_USERNAME", "admin"), env["ADMIN_PASSWORD"], "from .env"
    r = run_quiet(compose + ["logs", "--no-color", "dashboard"])
    user = re.findall(r"username:\s*(\S+)", r.stdout)
    pwd = re.findall(r"password:\s*(\S+)", r.stdout)
    if pwd:
        return (user[-1] if user else "admin"), pwd[-1], "generated on first start, change it at first login"
    return None, None, None


def docker_ready():
    if not shutil.which("docker"):
        die("Docker is not installed.", "https://docs.docker.com/get-docker/")
    r = run_quiet(["docker", "info", "--format", "{{.ServerVersion}}"])
    if r.returncode != 0:
        die("Docker is installed but not running.", "Start Docker Desktop (or `sudo systemctl start docker`) and try again.")
    return r.stdout.strip()


# ── commands ──────────────────────────────────────────────────────────────────
def cmd_run(args):
    public = "--public" in args
    no_build = "--no-build" in args
    port = DEFAULT_PORT
    if "--port" in args:
        try:
            port = int(args[args.index("--port") + 1])
        except (IndexError, ValueError):
            die("--port needs a number, e.g. sen run --port 4001")
    env_file = read_env()
    port = int(env_file.get("DASHBOARD_PORT", port)) if "--port" not in args else port

    print(bold("SentinelOps") + dim("  starting up\n"))
    t0 = time.time()
    sp = Spinner()

    sp.start("Checking Docker")
    version = docker_ready()
    compose = compose_cmd()
    sp.ok(f"Docker {version} is running")

    child_env = dict(os.environ, DASHBOARD_PORT=str(port))
    if public:
        child_env["DASHBOARD_BIND"] = "0.0.0.0"

    LOG_DIR.mkdir(exist_ok=True)
    up = compose + ["up", "-d", "--remove-orphans"] + ([] if no_build else ["--build"])
    sp.start("Building images" if not no_build else "Starting containers")
    with open(BUILD_LOG, "w", encoding="utf-8") as log:
        proc = subprocess.Popen(up, cwd=ROOT, env=child_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", bufsize=1)
        phase_switched = False
        for line in proc.stdout:
            log.write(line)
            text = line.strip()
            if not text:
                continue
            # once compose starts creating containers, the build phase is over
            if not phase_switched and re.search(r"(Container|Network|Volume) .* (Creat|Start|Recreat|Running)", text):
                if not no_build:
                    sp.ok("Images built")
                    sp.start("Starting containers")
                phase_switched = True
            sp.detail = re.sub(r"\s+", " ", text)
        code = proc.wait()

    if code != 0:
        sp.fail("docker compose failed")
        tail = BUILD_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
        print(dim("\n".join("  " + l for l in tail)))
        port_busy = any("port is already allocated" in l or "ports are not available" in l for l in tail)
        hint = (f"Port {port} is already used. Free it or run: sen run --port {port + 1}" if port_busy
                else f"Full log: {BUILD_LOG}")
        die("Could not start SentinelOps.", hint)
    sp.ok("Containers started")

    # wait for the dashboard API, then for the agent's first heartbeat
    url = f"http://127.0.0.1:{port}/api/health"
    sp.start("Waiting for the dashboard")
    deadline = time.time() + HEALTH_TIMEOUT
    health = None
    while time.time() < deadline:
        try:
            health = http_json(url)
            if health.get("status") == "ok":
                break
        except Exception as e:
            sp.detail = f"{type(e).__name__}"
        time.sleep(1)
    else:
        sp.fail("Dashboard did not answer")
        die("The dashboard is not responding.", "Check: sen logs dashboard")
    sp.ok("Dashboard is up")

    sp.start("Waiting for the agent's first metrics")
    while time.time() < deadline:
        try:
            health = http_json(url)
            if not health.get("agent", {}).get("stale", True):
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        sp.fail("No heartbeat from the agent yet")
        print(yellow("  The dashboard works, but the collector is not reporting. Check: sen logs agent"))
    if not health.get("agent", {}).get("stale", True):
        sp.ok("Agent is collecting metrics")

    # ready banner
    user, pwd, source = initial_password(compose)
    host = (public_ip() or "<server-ip>") if public else "localhost"
    total = time.time() - t0
    line = "─" * 52
    print()
    print(green(line))
    print(green(bold(f"  {OK} SentinelOps is ready")) + dim(f"   in {total:.0f}s"))
    print(green(line))
    print(f"  Dashboard   {bold(f'http://{host}:{port}')}")
    if pwd:
        print(f"  Login       {bold(user)} / {bold(pwd)}  {dim('(' + source + ')')}")
    else:
        print(f"  Login       {dim('use your existing account')}")
    if public:
        print(yellow("  Exposed on all interfaces: make sure the firewall/security group only allows your IP."))
    print()
    print(dim("  sen status · sen logs · sen stop"))


def cmd_stop(_args):
    compose = compose_cmd()
    sp = Spinner()
    sp.start("Stopping SentinelOps")
    r = run_quiet(compose + ["down"])
    if r.returncode != 0:
        sp.fail()
        die(r.stderr.strip() or "docker compose down failed")
    sp.ok("SentinelOps stopped (data kept in the sentinelops_data volume)")


def cmd_status(_args):
    compose = compose_cmd()
    r = run_quiet(compose + ["ps", "--format", "json"])
    rows = []
    for line in r.stdout.strip().splitlines():
        try:
            data = json.loads(line)
            rows.extend(data if isinstance(data, list) else [data])
        except json.JSONDecodeError:
            pass
    if not rows:
        print(f"{yellow('●')} SentinelOps is not running  {dim('(sen run)')}")
        return
    for row in rows:
        state = row.get("State", "?")
        health = row.get("Health") or ""
        dot = green("●") if state == "running" and health in ("", "healthy") else yellow("●") if state == "running" else red("●")
        print(f"{dot} {row.get('Service', row.get('Name')):<18} {state}{(' · ' + health) if health else ''}")
    port = int(read_env().get("DASHBOARD_PORT", DEFAULT_PORT))
    try:
        h = http_json(f"http://127.0.0.1:{port}/api/health")
        agent = "reporting" if not h["agent"]["stale"] else "NOT reporting"
        print(f"\n  Dashboard http://localhost:{port} · uptime {h['uptime']}s · agent {agent}")
    except Exception:
        print(f"\n  {yellow('Dashboard not answering on port')} {port}")


def cmd_logs(args):
    compose = compose_cmd()
    try:
        subprocess.run(compose + ["logs", "-f", "--tail", "100"] + args, cwd=ROOT)
    except KeyboardInterrupt:
        pass


def cmd_password(_args):
    user, pwd, source = initial_password(compose_cmd())
    if pwd:
        print(f"{bold(user)} / {bold(pwd)}  {dim('(' + source + ')')}")
    else:
        print("No initial password found: an account already exists. Use your own credentials.")


def cmd_update(args):
    sp = Spinner()
    sp.start("Pulling the latest code")
    r = run_quiet(["git", "pull", "--ff-only"])
    if r.returncode != 0:
        sp.fail()
        die(r.stderr.strip() or "git pull failed", "Commit or stash local changes first.")
    sp.ok("Code updated")
    cmd_run(args)


def cmd_help(_args=None):
    usage = __doc__.strip().split("\n\n")[1]
    print(bold("SentinelOps launcher") + "\n\nUsage:\n" + usage + "\n")
    print(dim("  --public    listen on all interfaces (servers / EC2) and print the public URL"))
    print(dim("  --port N    dashboard port (default 4000 or DASHBOARD_PORT in .env)"))
    print(dim("  --no-build  start without rebuilding images"))


COMMANDS = {
    "run": cmd_run, "start": cmd_run, "up": cmd_run,
    "stop": cmd_stop, "down": cmd_stop,
    "restart": lambda a: (cmd_stop(a), cmd_run(a)),
    "status": cmd_status, "ps": cmd_status,
    "logs": cmd_logs,
    "password": cmd_password,
    "update": cmd_update,
    "help": cmd_help, "-h": cmd_help, "--help": cmd_help,
}


def main():
    args = sys.argv[1:]
    if not args:
        cmd_help()
        return
    fn = COMMANDS.get(args[0])
    if not fn:
        print(f"Unknown command: {args[0]}\n")
        cmd_help()
        sys.exit(2)
    try:
        fn(args[1:])
    except KeyboardInterrupt:
        print("\n" + yellow("Interrupted.") + dim(" Containers already started keep running (sen stop to stop them)."))
        sys.exit(130)


if __name__ == "__main__":
    main()
