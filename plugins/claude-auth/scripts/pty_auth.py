#!/usr/bin/env python3
import pty
import os
import sys
import select
import re
import signal
import time
import json
import subprocess
import tempfile
import shutil

AUTH_URL_PREFIX = "AUTH_URL:"
CODE_PREFIX = "CODE:"
SUCCESS_PREFIX = "SUCCESS:"
ERROR_PREFIX = "ERROR:"
CANCEL_CMD = "CANCEL"

SERVICE_NAME = "Claude Code-credentials"
LINUX_CREDENTIALS_PATH = os.path.expanduser("~/.claude/.credentials.json")

def read_platform_credentials():
    """Reads raw JSON credentials from macOS Keychain or Linux credentials file / Secret Service."""
    if sys.platform == "darwin":
        try:
            res = subprocess.run(
                ["security", "find-generic-password", "-s", SERVICE_NAME, "-w"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except Exception:
            pass
    elif sys.platform.startswith("linux"):
        # On Linux/WSL, Claude Code stores credentials in ~/.claude/.credentials.json
        try:
            if os.path.exists(LINUX_CREDENTIALS_PATH):
                with open(LINUX_CREDENTIALS_PATH, "r") as f:
                    content = f.read().strip()
                    if content:
                        return content
        except Exception:
            pass
        # Fallback to secret-tool if available
        if shutil.which("secret-tool"):
            try:
                res = subprocess.run(
                    ["secret-tool", "lookup", "service", SERVICE_NAME],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip()
            except Exception:
                pass
    return None

def delete_platform_credentials():
    """Deletes stored credentials from macOS Keychain or Linux credentials file / Secret Service."""
    if sys.platform == "darwin":
        subprocess.run(["security", "delete-generic-password", "-s", SERVICE_NAME], capture_output=True)
    elif sys.platform.startswith("linux"):
        try:
            if os.path.exists(LINUX_CREDENTIALS_PATH):
                os.remove(LINUX_CREDENTIALS_PATH)
        except Exception:
            pass
        if shutil.which("secret-tool"):
            subprocess.run(["secret-tool", "clear", "service", SERVICE_NAME], capture_output=True)

def get_auth_status():
    """Inspects claude auth status and system credential store (macOS Keychain or Linux file / Secret Service)."""
    status = {
        "loggedIn": False,
        "authMethod": "none",
        "accountEmail": None,
        "subscriptionType": None,
        "expiresAt": None,
        "expiresInMinutes": None,
        "refreshTokenExpiresAt": None,
        "hasRefreshToken": False,
        "isExpired": True,
        "deadFlag": False,
    }
    
    # 1. Read claude auth status
    try:
        res = subprocess.run(["claude", "auth", "status"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            data = json.loads(res.stdout)
            status["loggedIn"] = bool(data.get("loggedIn"))
            status["authMethod"] = data.get("authMethod", "none")
    except Exception:
        pass

    # 2. Read ~/.claude.json
    try:
        claude_json_path = os.path.expanduser("~/.claude.json")
        if os.path.exists(claude_json_path):
            with open(claude_json_path, "r") as f:
                cdata = json.load(f)
                oauth = cdata.get("oauthAccount") or {}
                if oauth.get("emailAddress"):
                    status["accountEmail"] = oauth.get("emailAddress")
                if oauth.get("organizationType"):
                    status["subscriptionType"] = oauth.get("organizationType")
                if cdata.get("bridgeOauthDeadExpiresAt"):
                    status["deadFlag"] = True
    except Exception:
        pass

    # 3. Read platform credentials
    raw_creds = read_platform_credentials()
    if raw_creds:
        try:
            kdata = json.loads(raw_creds)
            oauth = kdata.get("claudeAiOauth") or {}
            
            exp = oauth.get("expiresAt")
            if isinstance(exp, (int, float)) and exp > 0:
                # normalize to ms if in seconds
                exp_ms = exp if exp > 1e11 else exp * 1000
                status["expiresAt"] = exp_ms
                now_ms = time.time() * 1000
                status["expiresInMinutes"] = max(0, int((exp_ms - now_ms) / 60000))
                status["isExpired"] = exp_ms <= now_ms
            else:
                status["isExpired"] = True

            rt = oauth.get("refreshToken")
            status["hasRefreshToken"] = bool(rt and isinstance(rt, str) and len(rt.strip()) > 0)
            
            rt_exp = oauth.get("refreshTokenExpiresAt")
            if isinstance(rt_exp, (int, float)) and rt_exp > 0:
                status["refreshTokenExpiresAt"] = rt_exp if rt_exp > 1e11 else rt_exp * 1000
                
            if oauth.get("subscriptionType") and not status["subscriptionType"]:
                status["subscriptionType"] = oauth.get("subscriptionType")
        except Exception:
            pass
    elif sys.platform.startswith("linux"):
        # Fallback for Linux/WSL if credentials file is inaccessible but CLI confirms logged in
        if status["loggedIn"]:
            status["isExpired"] = False

    return status

def cmd_status():
    st = get_auth_status()
    print(json.dumps(st))

def cmd_clean():
    """Removes Keychain/keyring entry and atomically clears dead OAuth flags from ~/.claude.json."""
    delete_platform_credentials()

    try:
        claude_json_path = os.path.expanduser("~/.claude.json")
        if os.path.exists(claude_json_path):
            with open(claude_json_path, "r") as f:
                cdata = json.load(f)
            changed = False
            for k in ["bridgeOauthDeadExpiresAt", "bridgeOauthDeadFailCount"]:
                if k in cdata:
                    del cdata[k]
                    changed = True
            if changed:
                dir_name = os.path.dirname(claude_json_path)
                with tempfile.NamedTemporaryFile("w", dir=dir_name, delete=False) as tf:
                    json.dump(cdata, tf, indent=2)
                    temp_name = tf.name
                os.replace(temp_name, claude_json_path)
    except Exception:
        pass
    print(json.dumps({"cleaned": True}))

def cmd_login():
    """Runs claude auth login in a pty, outputs AUTH_URL, waits for CODE on stdin, feeds it."""
    # Ensure stdout is line-buffered
    sys.stdout.reconfigure(line_buffering=True)
    
    master, slave = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        os.close(slave)
        os.execvp("claude", ["claude", "auth", "login"])

    os.close(slave)
    buf = ""
    auth_url = None

    start_time = time.time()
    # Step 1: Extract Auth URL
    while time.time() - start_time < 15:
        r, _, _ = select.select([master], [], [], 0.5)
        if r:
            try:
                chunk = os.read(master, 1024).decode("utf-8", errors="replace")
                buf += chunk
                m = re.search(r"https://claude\.com/cai/oauth/authorize\?[^\s\r\n]+", buf)
                if m:
                    auth_url = m.group(0)
                    break
            except OSError:
                break
        else:
            # Check if child died early
            ret = os.waitpid(pid, os.WNOHANG)
            if ret and ret[0] != 0:
                break

    if not auth_url:
        print(f"{ERROR_PREFIX} Could not get authorization URL from Claude CLI", flush=True)
        try:
            os.kill(pid, signal.SIGKILL)
        except Exception:
            pass
        os.close(master)
        sys.exit(1)

    print(f"{AUTH_URL_PREFIX} {auth_url}", flush=True)

    # Step 2: Read command from stdin
    # Expect: CODE: <auth_code> OR CANCEL
    line = sys.stdin.readline()
    if not line or line.strip() == CANCEL_CMD:
        try:
            os.kill(pid, signal.SIGKILL)
        except Exception:
            pass
        os.close(master)
        print("CANCELLED", flush=True)
        sys.exit(0)

    code = line.strip()
    if code.startswith(CODE_PREFIX):
        code = code[len(CODE_PREFIX):].strip()

    # Step 3: Write code to PTY
    os.write(master, (code + "\n").encode("utf-8"))

    # Step 4: Wait for completion from claude CLI process
    result_buf = ""
    start_time = time.time()
    success = False
    error_msg = None

    while time.time() - start_time < 30:
        r, _, _ = select.select([master], [], [], 0.5)
        if r:
            try:
                chunk = os.read(master, 1024).decode("utf-8", errors="replace")
                if not chunk:
                    # EOF from child
                    break
                result_buf += chunk
                lower = result_buf.lower()
                if "invalid code" in lower or "oauth error" in lower or "failed to authenticate" in lower:
                    error_msg = "Invalid authorization code. Please make sure the full code was copied."
                    break
                if "logged in as" in lower or "login successful" in lower:
                    success = True
                    break
            except OSError:
                break

        ret = os.waitpid(pid, os.WNOHANG)
        if ret and ret[0] != 0:
            exit_code = os.waitstatus_to_exitcode(ret[1]) if hasattr(os, "waitstatus_to_exitcode") else ret[1]
            if exit_code == 0:
                success = True
            else:
                if not error_msg:
                    error_msg = f"Claude login process exited with code {exit_code}"
            break

    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass
    os.close(master)

    # Step 5: Report outcome
    if success:
        # Fetch verified status once on success
        time.sleep(0.3)
        st = get_auth_status()
        print(f"{SUCCESS_PREFIX} {json.dumps(st)}", flush=True)
    elif error_msg:
        print(f"{ERROR_PREFIX} {error_msg}", flush=True)
    else:
        print(f"{ERROR_PREFIX} Authentication timed out or code was rejected", flush=True)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "status":
            cmd_status()
        elif cmd == "clean":
            cmd_clean()
        elif cmd == "login":
            cmd_login()
        else:
            print("Usage: pty_auth.py [status|clean|login]")
    else:
        cmd_status()
