#!/usr/bin/env python3
"""Talks to a running Unreal Editor over its built-in Python remote execution.

No plugin to compile: Unreal's Python Editor Script Plugin joins a UDP multicast
group, answers pings, and connects back to a TCP endpoint we host; commands and
results are single JSON objects. unreal/Config/DefaultEngine.ini already turns it on
for this project (Project Settings > Plugins > Python > Enable Remote Execution).

    python3 tools/unreal_bridge.py ping                     # list editors on this machine
    python3 tools/unreal_bridge.py build                    # import assets + build the Four Cities level
    python3 tools/unreal_bridge.py run some_script.py       # run a file inside the editor
    python3 tools/unreal_bridge.py exec "unreal.log('hi')"  # one statement
    python3 tools/unreal_bridge.py eval "len(unreal.EditorLevelLibrary.get_all_level_actors())"

Options: --project NAME picks one editor when several are open; --timeout SECONDS.
Standard library only, Python 3.8+. The same protocol UEMCP and Epic's own
remote_execution.py speak, so the editor needs nothing beyond the plugin toggle.
"""
import argparse
import json
import os
import socket
import sys
import time
import uuid

MAGIC, VERSION = "ue_py", 1
GROUP, PORT = os.environ.get("UE_MULTICAST_GROUP", "239.0.0.1"), int(os.environ.get("UE_MULTICAST_PORT", "6766"))
BIND = os.environ.get("UE_MULTICAST_BIND", "0.0.0.0")
HOST = os.environ.get("UE_COMMAND_HOST", "127.0.0.1")


def message(kind, node, dest=None, data=None):
    m = {"version": VERSION, "magic": MAGIC, "source": node, "type": kind}
    if dest:
        m["dest"] = dest
    if data is not None:
        m["data"] = data
    return json.dumps(m).encode()


def multicast_socket():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except OSError:
            pass
    s.bind((BIND, PORT))
    s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(GROUP) + socket.inet_aton(BIND))
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_LOOP, 1)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 0)
    return s


def discover(node, timeout=2.0):
    s = multicast_socket()
    found = {}
    try:
        s.sendto(message("ping", node), (GROUP, PORT))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            s.settimeout(max(0.05, deadline - time.monotonic()))
            try:
                payload, _ = s.recvfrom(65536)
            except socket.timeout:
                break
            try:
                m = json.loads(payload.decode())
            except ValueError:
                continue
            if m.get("magic") == MAGIC and m.get("type") == "pong" and m.get("dest") in (None, node):
                found[m["source"]] = m.get("data") or {}
    finally:
        s.close()
    return found


class Editor:
    def __init__(self, project=None, timeout=2.0):
        self.node = str(uuid.uuid4())
        self.timeout = timeout
        self.project = project
        self.sock = None
        self.remote = None

    def connect(self):
        editors = discover(self.node, self.timeout)
        if not editors:
            raise SystemExit("No Unreal Editor answered. Open unreal/CookingForStrangers.uproject (or any project with the Python plugin "
                             "and 'Enable Remote Execution' on) on this machine, then try again.")
        remote = None
        for nid, info in editors.items():
            if not self.project or info.get("project_name", "").lower() == self.project.lower():
                remote = nid
                break
        if remote is None:
            raise SystemExit(f"No editor for project {self.project!r}; found: " + ", ".join(i.get("project_name", "?") for i in editors.values()))
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((HOST, 0))
        listener.listen(1)
        host, port = listener.getsockname()[:2]
        mc = multicast_socket()
        try:
            mc.sendto(message("open_connection", self.node, remote, {"command_ip": host, "command_port": port}), (GROUP, PORT))
            listener.settimeout(self.timeout + 3)
            self.sock, _ = listener.accept()
        except socket.timeout:
            raise SystemExit("Unreal saw the request but did not connect back; check the firewall for the editor process.")
        finally:
            mc.close()
            listener.close()
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.remote = remote
        return editors[remote]

    def command(self, code, mode="ExecuteStatement", timeout=600.0):
        self.sock.sendall(message("command", self.node, self.remote, {"command": code, "unattended": True, "exec_mode": mode}))
        self.sock.settimeout(timeout)
        buf = b""
        while True:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise SystemExit("Unreal closed the connection")
            buf += chunk
            try:
                m = json.loads(buf.decode())
            except ValueError:
                continue
            if m.get("type") == "command_result":
                return m.get("data") or {}
            buf = b""

    def close(self):
        if self.sock:
            try:
                self.sock.sendall(message("close_connection", self.node, self.remote))
            except OSError:
                pass
            self.sock.close()
            self.sock = None


def show(result):
    for line in result.get("output") or []:
        kind = line.get("type", "Info")
        text = line.get("output", "").rstrip("\n")
        print(("" if kind == "Info" else f"[{kind}] ") + text)
    if result.get("result") not in (None, "", "None"):
        print(result["result"])
    return 0 if result.get("success") else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["ping", "build", "run", "exec", "eval"])
    ap.add_argument("arg", nargs="?", help="file for run, code for exec/eval")
    ap.add_argument("--project", help="pick the editor running this project (default: first found)")
    ap.add_argument("--timeout", type=float, default=2.0, help="discovery timeout in seconds")
    a = ap.parse_args()
    if a.action == "ping":
        node = str(uuid.uuid4())
        editors = discover(node, a.timeout)
        if not editors:
            print("no editor found (is 'Enable Remote Execution' on under Project Settings > Plugins > Python?)")
            return 1
        for nid, info in editors.items():
            print(f"{info.get('project_name', '?')}  UE {info.get('engine_version', '?')}  {info.get('machine', '')}  {info.get('project_root', '')}  [{nid}]")
        return 0
    ed = Editor(a.project, a.timeout)
    info = ed.connect()
    print(f"connected to {info.get('project_name', '?')} (UE {info.get('engine_version', '?')})", file=sys.stderr)
    try:
        if a.action == "build":
            return show(ed.command("import importlib, cfs_build; importlib.reload(cfs_build); print(cfs_build.run())", "ExecuteStatement", timeout=3600))
        if a.action == "run":
            if not a.arg or not os.path.exists(a.arg):
                raise SystemExit("run needs a Python file")
            return show(ed.command(os.path.abspath(a.arg), "ExecuteFile", timeout=3600))
        if a.action == "exec":
            return show(ed.command(a.arg or "", "ExecuteStatement"))
        return show(ed.command(a.arg or "", "EvaluateStatement"))
    finally:
        ed.close()


if __name__ == "__main__":
    sys.exit(main())
