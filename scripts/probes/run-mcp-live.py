import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import select
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve()
if sys.argv[0] != str(SCRIPT):
    os.execv(sys.executable, [sys.executable, str(SCRIPT), *sys.argv[1:]])

import model_budget as gate

CASE = "runtime_host::mcp_formal_tests::formal_live_roundtrip_matrix"
CRITICAL = [
    "package.json", "scripts/build/bundle-runtime.mjs", "tests/probes/pi-source.json",
    "build/s0-runtime/node", "build/s0-runtime/organizer.mjs",
    "build/s0-runtime/mcp-guardian.mjs", "build/s0-runtime/skills-manager.mjs",
    "build/s0-runtime/bash-worker.mjs",
    "scripts/probes/model_budget.py", "scripts/probes/run-mcp-live.py",
    "runtime/entries/organizer-entry.mjs", "runtime/lib/mcp-control.mjs",
    "runtime/lib/mcp-trial.mjs", "runtime/lib/managed-mcp.mjs",
    "src-tauri/src/host/runtime_host.rs", "src-tauri/src/host/mcp_trial.rs",
    "src-tauri/src/host/mcp_formal_tests.rs", "src-tauri/src/store/mcp_calls.rs",
    "src-tauri/src/store/ingestion.rs", "src-tauri/src/store/local_store.rs",
    "tests/fixtures/mcp-trial.mjs", "tests/integration/model-budget.test.mjs",
    "tests/integration/mcp-launcher.test.mjs",
    "tests/probes/model-budget-faults.py",
]
ADMISSION = gate.REPOSITORY / "build/p5-formal-20261101/budget-admission.json"
PLAN = "docs/product/05-第一阶段实施计划.md"
DESIGN_SHA256 = "8961b453f91bc7927c2855a4bd9d9e156a2f879dfb3655aeeda72c8baa056ea9"


def input_bytes(path, executable=False):
    try:
        if path.resolve() != path or not path.is_relative_to(gate.REPOSITORY):
            gate.fail("LIVE_INPUT_INVALID")
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1 or (executable and not before.st_mode & stat.S_IXUSR):
                gate.fail("LIVE_INPUT_INVALID")
            data = stream.read()
            fields = ["st_dev", "st_ino", "st_uid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"]
            identity = tuple(getattr(before, field) for field in fields)
            if any(tuple(getattr(metadata, field) for field in fields) != identity for metadata in [os.fstat(stream.fileno()), path.lstat()]):
                gate.fail("LIVE_INPUT_CHANGED")
            return data
    except (OSError, ValueError):
        gate.fail("LIVE_INPUT_UNAVAILABLE")


def hashes():
    result = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "runtime", "shared", "scripts", "tests", "src-tauri", ".cargo", "package.json", "package-lock.json", "index.html", "tsconfig*", "vite.config*", ".gitignore", ".gitattributes"], cwd=gate.REPOSITORY, env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
    if result.returncode:
        gate.fail("LIVE_SOURCE_MANIFEST_INVALID")
    paths = set(CRITICAL)
    for name in result.stdout.decode("utf-8", errors="strict").split("\0"):
        path = Path(name)
        if name and not any(part in {"target", "node_modules"} for part in path.parts) and not (path.name.startswith(".env") and path.name != ".env.example"):
            paths.add(name)
    return {name: hashlib.sha256(input_bytes(gate.REPOSITORY / name)).hexdigest() for name in sorted(paths)}


def core_hash():
    lines = input_bytes(gate.REPOSITORY / PLAN).splitlines(keepends=True)
    starts = [index for index, line in enumerate(lines) if line.startswith(b"### 16.25 ")]
    if len(starts) != 1:
        gate.fail("LIVE_CORE_INVALID")
    start = starts[0]
    end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith(b"### ")), len(lines))
    return hashlib.sha256(b"".join(lines[start:end]).rstrip(b"\n") + b"\n").hexdigest()


def native_binding(executable):
    path = Path(executable)
    if path.parent != gate.REPOSITORY / "src-tauri/target/debug/deps" or not path.name.startswith("sidekick_lib-"):
        gate.fail("LIVE_NATIVE_INPUT_INVALID")
    return {"path": str(path.relative_to(gate.REPOSITORY)), "sha256": hashlib.sha256(input_bytes(path, executable=True)).hexdigest()}


def admission(executable=None):
    value = gate.private_json(ADMISSION, 65536)
    design = DESIGN_SHA256
    current = hashes()
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("conclusion") != "pass" or value.get("sources") != current or value.get("designSha256") != design or core_hash() != design or value.get("deliveryApproved") is not True or value.get("syntheticVerified") is not True:
        gate.fail("LIVE_ADMISSION_REQUIRED")
    approved = value.get("nativeExecutable")
    if not isinstance(approved, dict) or set(approved) != {"path", "sha256"} or not isinstance(approved["path"], str) or Path(approved["path"]).is_absolute():
        gate.fail("LIVE_NATIVE_INPUT_INVALID")
    native = native_binding(gate.REPOSITORY / approved["path"])
    if native != approved or (executable is not None and gate.REPOSITORY / native["path"] != executable):
        gate.fail("LIVE_NATIVE_INPUT_INVALID")
    delivery = value.get("deliveryEvidence")
    if not isinstance(delivery, list) or len(delivery) != 2:
        gate.fail("LIVE_ADMISSION_REQUIRED")
    paths = set()
    for reference, kind in [(item, "delivery") for item in delivery] + [(value.get("syntheticEvidence"), "synthetic")]:
        if not isinstance(reference, dict) or set(reference) != {"path", "sha256"} or not isinstance(reference["path"], str):
            gate.fail("LIVE_ADMISSION_REQUIRED")
        relative = Path(reference["path"])
        path = gate.REPOSITORY / relative
        if relative.is_absolute() or not path.is_relative_to(ADMISSION.parent) or path.resolve() != path or path.suffix != ".json" or path in paths or path == ADMISSION:
            gate.fail("LIVE_ADMISSION_REQUIRED")
        paths.add(path)
        descriptor, metadata = gate.private_open(path)
        try:
            data = os.read(descriptor, 262145)
            if len(data) > 262144 or gate.identity(os.fstat(descriptor)) != gate.identity(metadata) or gate.identity(path.lstat()) != gate.identity(metadata) or hashlib.sha256(data).hexdigest() != reference["sha256"]:
                gate.fail("LIVE_ADMISSION_REQUIRED")
            report = json.loads(data)
        finally:
            os.close(descriptor)
        if not isinstance(report, dict) or report.get("sources") != current or report.get("designSha256") != design or report.get("nativeExecutable") != native:
            gate.fail("LIVE_ADMISSION_REQUIRED")
        if kind == "delivery" and report.get("verdict") != "APPROVE":
            gate.fail("LIVE_ADMISSION_REQUIRED")
        if kind == "synthetic" and (report.get("conclusion") != "pass" or type(report.get("realModelRequests")) is not int or report["realModelRequests"] != 0):
            gate.fail("LIVE_ADMISSION_REQUIRED")
    return native


def private_write(path, value):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        data = (json.dumps(value, ensure_ascii=False) + "\n").encode()
        if os.write(descriptor, data) != len(data):
            gate.fail()
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    gate.sync_directory(path.parent)


def inventory():
    result = subprocess.run(["/bin/ps", "-wwaxo", "pid=,ppid=,pgid=,stat=,command="], env={"PATH": "/usr/bin:/bin"}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, text=True, timeout=5)
    processes = {}
    for line in result.stdout.splitlines():
        fields = line.split(None, 4)
        if len(fields) == 5 and not fields[3].startswith("Z"):
            processes[int(fields[0])] = {"parent": int(fields[1]), "group": int(fields[2]), "state": fields[3], "command": fields[4]}
    return processes


def register(child, owned):
    processes = inventory()
    if child.pid in processes and (processes[child.pid]["parent"] != os.getpid() or processes[child.pid]["group"] != child.pid or processes[child.pid]["command"] != " ".join(child.args)):
        try:
            child.wait(timeout=0.05)
        except subprocess.TimeoutExpired:
            pass
        else:
            return processes
        actual = processes[child.pid]
        try:
            gate.fail("LIVE_CHILD_IDENTITY_INVALID")
        except BaseException as error:
            error.identity = {"pid": child.pid, "state": actual.get("state"), "parentMatches": actual["parent"] == os.getpid(), "groupMatches": actual["group"] == child.pid, "commandMatches": actual["command"] == " ".join(child.args), "commandSha256": hashlib.sha256(actual["command"].encode()).hexdigest()}
            raise
    parents = {child.pid}
    changed = True
    while changed:
        changed = False
        for pid, value in processes.items():
            if value["parent"] in parents and pid not in parents:
                parents.add(pid)
                owned[pid] = value
                changed = True
    return processes


def remaining(owned):
    processes = inventory()
    return {pid: value for pid, value in owned.items() if pid in processes and processes[pid]["group"] == value["group"] and processes[pid]["command"] == value["command"]}


def cleanup(child, owned):
    failed = False
    running = child is not None
    if running:
        try:
            running = child.poll() is None
        except BaseException:
            failed = True
    if running:
        try:
            register(child, owned)
        except BaseException:
            failed = True
        try:
            child.kill()
        except BaseException:
            failed = True
        try:
            child.wait(timeout=5)
        except BaseException:
            failed = True
    for _ in range(3):
        try:
            survivors = remaining(owned)
        except BaseException:
            failed = True
            continue
        if not survivors:
            break
        for group in {value["group"] for value in survivors.values()}:
            if group > 1 and group != os.getpgrp():
                try:
                    current = inventory()
                    if any(pid in current and current[pid]["group"] == group and current[pid]["command"] == value["command"] for pid, value in survivors.items()):
                        os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except BaseException:
                    failed = True
        time.sleep(0.1)
    if failed or remaining(owned):
        gate.fail("LIVE_CLEANUP_UNKNOWN")


def prepare(evidence):
    result = subprocess.run(["npm", "run", "--silent", "probe:mcp-live:prepare"], cwd=gate.REPOSITORY, env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ["HOME"]}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    (evidence / "prepare.log").write_bytes(result.stdout + result.stderr)
    if result.returncode:
        gate.fail("LIVE_PREPARE_FAILED")
    executables = []
    for line in result.stdout.splitlines():
        if line.startswith(b"{"):
            item = json.loads(line)
            if item.get("reason") == "compiler-artifact" and item.get("executable") and item.get("profile", {}).get("test") and item.get("target", {}).get("name") == "sidekick_lib":
                executables.append(Path(item["executable"]).resolve())
    if len(executables) != 1 or executables[0].parent != (gate.REPOSITORY / "src-tauri/target/debug/deps").resolve():
        gate.fail("LIVE_PREPARE_FAILED")
    return executables[0]


def model_ready(model, timeout=5):
    deadline = time.monotonic() + timeout
    data = b""
    while time.monotonic() < deadline:
        if model.poll() is not None:
            gate.fail("LIVE_CANARY_EXITED")
        readable, _, _ = select.select([model.stdout], [], [], max(0, deadline - time.monotonic()))
        if readable:
            block = os.read(model.stdout.fileno(), 4096)
            if not block or len(data) + len(block) > 8192:
                gate.fail("LIVE_CANARY_INVALID")
            data += block
            if b"\n" in data:
                return data.split(b"\n", 1)[0].decode("utf-8", errors="strict")
    gate.fail("LIVE_CANARY_DEADLINE")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--real", action="store_true")
    mode.add_argument("--synthetic", action="store_true")
    arguments = parser.parse_args()
    layer = "real-budgeted" if arguments.real else "synthetic-budgeted"
    evidence = gate.REPOSITORY / "build/p5-formal-20261101" / f"{layer}-{time.time_ns()}"
    evidence.mkdir(mode=0o700, parents=True)
    directory = gate.REPOSITORY / "build/s0-runtime"
    relay = relay_thread = reader = model = child = budget = None
    stop_reader, relay_failed = threading.Event(), threading.Event()
    owned, captured = {}, []
    captured_size = 0
    secret = ""
    before = {"reserved": 0, "forwarded": 0, "completed": 0}
    outcome = {"layer": layer, "conclusion": "fail", "realModelRequests": 0, "realModelRequestUpperBound": 0}
    initial = None
    design = native = executable = approved_native = None
    succeeded = False
    try:
        outcome["failureStage"] = "admission"
        initial = hashes()
        outcome["sourceHashes"] = initial
        design = core_hash()
        outcome["designSha256"] = design
        if design != DESIGN_SHA256:
            gate.fail("LIVE_CORE_CHANGED")
        if arguments.real:
            approved_native = admission()
            budget = gate.Budget(gate.NIGHT, True)
            budget.deadline()
        else:
            counter = Path(tempfile.mkdtemp(prefix="sidekick-model-budget-", dir=Path("/tmp").resolve()))
            outcome["syntheticCounter"] = str(counter)
            gate.initialize(counter)
            budget = gate.Budget(counter)
        before = budget.inspect()
        outcome["before"] = before
        outcome["failureStage"] = "prepare"
        executable = prepare(evidence)
        native = native_binding(executable)
        outcome["nativeExecutable"] = native
        if arguments.real and native != approved_native:
            gate.fail("LIVE_NATIVE_INPUT_CHANGED")
        if hashes() != initial or core_hash() != design:
            gate.fail("LIVE_SOURCE_CHANGED")
        nonce = secrets.token_hex(24)
        base = Path("/tmp").resolve() / f"sidekick-p5-live-{os.getpid()}-{nonce}"
        base.mkdir(mode=0o700)
        gate.private_directory(base)
        outcome["base"] = str(base)
        outcome["failureStage"] = "model"
        if arguments.real:
            admission(executable)
            budget.deadline()
            private = gate.private_model(directory / "node")
            upstream, secret, model_id = private["url"], private["key"], private["model"]
        else:
            model = subprocess.Popen([str(directory / "node"), str(gate.REPOSITORY / "tests/fixtures/mcp-trial.mjs"), "model", str(base / "model.jsonl"), "normal"], cwd=gate.REPOSITORY, env={"PATH": "/usr/bin:/bin"}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            upstream = model_ready(model)
            secret, model_id = gate.FAKE_KEY, "synthetic"
        relay = gate.Relay(budget, base, upstream, secret, model_id, "P5" if arguments.real else "test")
        def serve():
            try:
                relay.serve_forever(poll_interval=0.1)
            except BaseException:
                relay_failed.set()

        relay_thread = threading.Thread(target=serve, daemon=True)
        relay_thread.start()
        info = {"version": 1, "parentPid": os.getpid(), "nonce": nonce, "base": str(base), "exe": str(executable), "case": CASE, "port": relay.server_address[1], "relayToken": f"sidekick-p5-relay-{nonce}", "modelId": model_id}
        private_write(base / "live-info.json", info)
        gate.private_directory(base)
        if gate.private_json(base / "live-info.json", 65536) != info:
            gate.fail("LIVE_INFO_INVALID")
        outcome["failureStage"] = "native"
        child = subprocess.Popen([str(executable), "--exact", CASE, "--test-threads=1", "--nocapture"], cwd=gate.REPOSITORY, env={"PATH": "/usr/bin:/bin", "SIDEKICK_P5_LIVE_INFO": str(base / "live-info.json")}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)

        def collect():
            nonlocal captured_size
            try:
                while not stop_reader.is_set():
                    readable, _, _ = select.select([child.stdout], [], [], 0.1)
                    if readable:
                        block = os.read(child.stdout.fileno(), 16384)
                        if not block:
                            return
                        captured_size += len(block)
                        if captured_size > 2_000_000:
                            return
                        captured.append(block)
            except BaseException:
                captured_size = 2_000_001

        reader = threading.Thread(target=collect, daemon=True)
        reader.start()
        deadline = time.monotonic() + 420
        next_status = time.monotonic() + 30
        while child.poll() is None:
            register(child, owned)
            if time.monotonic() >= deadline or (arguments.real and time.time() >= gate.CUTOFF) or captured_size > 2_000_000 or relay_failed.is_set() or not relay_thread.is_alive():
                gate.fail("LIVE_DEADLINE")
            if time.monotonic() >= next_status:
                try:
                    status = budget.inspect()
                    print(json.dumps({"layer": layer, "occupiedSlots": status["reserved"], "possiblyForwarded": status["forwarded"], "completed": status["completed"], "remaining": gate.LIMIT - status["reserved"], "realModelRequestUpperBound": status["forwarded"] - before["forwarded"] if arguments.real else 0}), flush=True)
                except BaseException:
                    print("Controlled verification state is pending.", flush=True)
                next_status = time.monotonic() + 30
            time.sleep(0.05)
        reader.join(timeout=5)
        outcome["nativeCapture"] = {"bytes": captured_size, "readerAlive": reader.is_alive(), "relayAlive": relay_thread.is_alive(), "relayFailed": relay_failed.is_set()}
        if reader.is_alive() or captured_size > 2_000_000 or relay_failed.is_set() or not relay_thread.is_alive():
            gate.fail("LIVE_COLLECTOR_OR_RELAY_FAILED")
        output = b"".join(captured).decode("utf-8", errors="strict")
        gate.secret_scan(output, secret)
        (evidence / "native-test.log").write_text(output)
        outcome["exitCode"] = child.returncode
        if child.returncode:
            gate.fail("LIVE_NATIVE_FAILED")
        items = [json.loads(line.split("P5_LIVE_EVIDENCE ", 1)[1]) for line in output.splitlines() if "P5_LIVE_EVIDENCE " in line]
        if len(items) != 1 or len(items[0]["calls"]) != 3 or items[0]["serviceCounts"]["lookup"] != 3 or items[0]["trialBusinessUnchanged"] is not True:
            gate.fail("LIVE_EVIDENCE_INVALID")
        outcome["native"] = items[0]
        cutoff = time.monotonic() + 5
        while remaining(owned) and time.monotonic() < cutoff:
            time.sleep(0.05)
        if remaining(owned):
            gate.fail("LIVE_NATURAL_CLEANUP_FAILED")
        if model is not None and model.poll() is not None:
            gate.fail("LIVE_CANARY_EXITED")
        if hashes() != initial or core_hash() != design or native_binding(executable) != native:
            gate.fail("LIVE_SOURCE_CHANGED")
        after = budget.inspect()
        reserved = after["reserved"] - before["reserved"]
        if after["reserved"] > gate.LIMIT or reserved < 6 or after["forwarded"] - before["forwarded"] != reserved or after["completed"] - before["completed"] != reserved:
            gate.fail("LIVE_BUDGET_EVIDENCE_INVALID")
        outcome.update({"conclusion": "pass", "after": after, "realModelRequests": after["completed"] - before["completed"] if arguments.real else 0, "realModelRequestUpperBound": reserved if arguments.real else 0, "naturalCleanup": True})
        succeeded = True
        outcome.pop("failureStage", None)
    except BaseException as failure:
        outcome["conclusion"] = "fail"
        code = failure.args[0] if isinstance(failure, gate.BudgetError) and failure.args else ""
        outcome["failureCode"] = code if isinstance(code, str) and code.startswith("LIVE_") and code.replace("_", "").isalpha() and code.isupper() else type(failure).__name__
        if isinstance(failure, gate.BudgetError) and hasattr(failure, "identity"):
            outcome["childIdentity"] = failure.identity
        try:
            if budget is None:
                raise RuntimeError("BUDGET_NOT_OPENED")
            outcome["after"] = budget.inspect()
            forwarded = outcome["after"]["forwarded"] - before["forwarded"]
            outcome["realModelRequestUpperBound"] = forwarded if arguments.real else 0
            outcome["realModelRequests"] = None if arguments.real and forwarded else 0
        except BaseException:
            outcome["budgetState"] = "unknown; no reset permitted"
        raise
    finally:
        cleanup_errors = []
        try:
            cleanup(child, owned)
        except BaseException:
            cleanup_errors.append("ownedProcesses")
        if relay is not None:
            try:
                if relay_thread is not None and relay_thread.is_alive():
                    relay.shutdown()
            except BaseException:
                cleanup_errors.append("relayShutdown")
            try:
                relay.server_close()
            except BaseException:
                cleanup_errors.append("relayClose")
            if getattr(relay, "shutdown_unknown", False):
                outcome["budgetState"] = "unknown; no reset permitted"
                cleanup_errors.append("relayHandlersUnknown")
        if relay_thread is not None:
            try:
                relay_thread.join(timeout=5)
                if relay_thread.is_alive() or relay_failed.is_set():
                    gate.fail("LIVE_RELAY_CLEANUP_FAILED")
            except BaseException:
                cleanup_errors.append("relayThread")
        if model is not None:
            try:
                if model.poll() is None:
                    model.kill()
            except BaseException:
                cleanup_errors.append("modelKill")
            try:
                model.wait(timeout=5)
            except BaseException:
                cleanup_errors.append("modelWait")
        stop_reader.set()
        if reader is not None:
            try:
                reader.join(timeout=5)
                if reader.is_alive():
                    gate.fail("LIVE_COLLECTOR_CLEANUP_FAILED")
            except BaseException:
                cleanup_errors.append("collector")
        for process in [child, model]:
            if process is not None and process.stdout is not None:
                try:
                    process.stdout.close()
                except BaseException:
                    cleanup_errors.append("outputPipe")
        if budget is not None:
            try:
                after = budget.inspect()
                outcome["after"] = after
                forwarded = after["forwarded"] - before["forwarded"]
                outcome["realModelRequestUpperBound"] = forwarded if arguments.real else 0
                outcome["realModelRequests"] = (forwarded if succeeded and not cleanup_errors else None) if arguments.real and forwarded else 0
                outcome.update({"occupiedSlots": after["reserved"], "possiblyForwarded": after["forwarded"], "completed": after["completed"], "remaining": gate.LIMIT - after["reserved"]})
                reserved = after["reserved"] - before["reserved"]
                if succeeded and (after["reserved"] > gate.LIMIT or reserved < 6 or after["forwarded"] - before["forwarded"] != reserved or after["completed"] - before["completed"] != reserved):
                    gate.fail("LIVE_BUDGET_EVIDENCE_INVALID")
            except BaseException:
                outcome["budgetState"] = "unknown; no reset permitted"
                outcome["realModelRequests"] = None if arguments.real else 0
                outcome["realModelRequestUpperBound"] = None if arguments.real else 0
                cleanup_errors.append("budgetFinalState")
        if relay is not None and getattr(relay, "shutdown_unknown", False):
            outcome["finalCountsStable"] = False
            outcome["realModelRequests"] = None if arguments.real else 0
            outcome["realModelRequestUpperBound"] = gate.LIMIT - before["reserved"] if arguments.real else 0
        try:
            outcome["sourceHashesAfter"] = hashes()
            if initial is None or outcome["sourceHashesAfter"] != initial:
                gate.fail("LIVE_SOURCE_CHANGED")
        except BaseException:
            cleanup_errors.append("sourceSnapshot")
        try:
            outcome["designSha256After"] = core_hash()
            if design is None or outcome["designSha256After"] != design:
                gate.fail("LIVE_CORE_CHANGED")
        except BaseException:
            cleanup_errors.append("coreSnapshot")
        if native is not None:
            try:
                outcome["nativeExecutableAfter"] = native_binding(executable)
                if outcome["nativeExecutableAfter"] != native:
                    gate.fail("LIVE_NATIVE_INPUT_CHANGED")
            except BaseException:
                cleanup_errors.append("nativeSnapshot")
        if cleanup_errors:
            succeeded = False
            outcome.update({"conclusion": "fail", "cleanupErrors": cleanup_errors})
            if arguments.real and outcome["realModelRequestUpperBound"] != 0:
                outcome["realModelRequests"] = None
        try:
            gate.secret_scan(outcome, secret)
        except BaseException:
            succeeded = False
            outcome = {"layer": layer, "conclusion": "fail", "failureStage": "summarySanitization", "realModelRequests": None if arguments.real else 0, "realModelRequestUpperBound": None if arguments.real else 0}
        private_write(evidence / "summary.json", outcome)
        print(json.dumps({"layer": layer, "conclusion": outcome.get("conclusion", "fail"), **{key: outcome.get(key) for key in ["occupiedSlots", "possiblyForwarded", "completed", "remaining", "realModelRequests", "realModelRequestUpperBound"]}, "evidence": str(evidence.relative_to(gate.REPOSITORY))}), flush=True)
        if not succeeded:
            sys.stderr.write("Controlled verification failed; isolated evidence and budget were retained.\n")
            gate.fail("LIVE_VERIFICATION_FAILED")


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        sys.stderr.write("Controlled MCP verification refused or failed.\n")
        sys.exit(1)
