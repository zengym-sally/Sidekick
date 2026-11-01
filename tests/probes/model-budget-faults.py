import argparse
import concurrent.futures
import importlib.util
import inspect
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from unittest import mock

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("model_budget", Path(__file__).resolve().parents[2] / "scripts/probes/model_budget.py")
mb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mb)


def temporary():
    directory = Path(tempfile.mkdtemp(prefix="sidekick-model-budget-", dir=str(Path("/tmp").resolve())))
    os.chmod(directory, 0o700)
    return directory


def locked_identity():
    base = temporary()
    succeeded = False
    try:
        mb.initialize(base)
        budget = mb.Budget(base)
        database = base / "model-budget.sqlite"
        child = """import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1],timeout=0,isolation_level=None)
try:
 c.execute('BEGIN IMMEDIATE')
 print(json.dumps({'writer_acquired':True}))
 c.rollback()
except sqlite3.OperationalError:
 print(json.dumps({'writer_acquired':False}))
finally:
 c.close()
"""
        def another_writer():
            result = subprocess.run([sys.executable, "-B", "-c", child, str(database)], env={"PATH": os.environ.get("PATH", "")}, capture_output=True, check=True)
            return json.loads(result.stdout)["writer_acquired"]
        with budget.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            assert not another_writer(), "the independent writer must initially be blocked"
            for _ in range(3):
                budget.verify_files()
                assert connection.in_transaction, "the first writer must retain its transaction"
                assert not another_writer(), "identity verification released an active SQLite writer lock"
            connection.rollback()
        assert another_writer(), "the independent writer must proceed after rollback"
        succeeded = True
        print(json.dumps({"case": "locked-identity", "blocked_checks": 4, "real_model_requests": 0}))
    except BaseException as error:
        raise AssertionError(f"{error}; synthetic evidence retained: {base}") from error
    finally:
        if succeeded:
            shutil.rmtree(base)


def deadline_after_identity():
    base = temporary()
    succeeded = False
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    listener.settimeout(2)
    received = []
    def receive():
        connection, _ = listener.accept()
        with connection:
            connection.settimeout(2)
            received.append(connection.recv(4096))
    thread = threading.Thread(target=receive, daemon=True)
    thread.start()
    relay = None
    try:
        mb.initialize(base)
        budget = mb.Budget(base, cutoff=time.time() + 0.3)
        slot = budget.reserve("test")
        budget.mark(slot, "forwarded")
        relay = mb.Relay(budget, base, f"http://127.0.0.1:{listener.getsockname()[1]}/v1", mb.FAKE_KEY, "synthetic")
        verify = budget.verify_files
        blocked = []
        def blocking_identity():
            verify()
            in_send = any(frame.function == "send" and Path(frame.filename) == Path(mb.__file__) for frame in inspect.stack())
            if in_send and not blocked:
                blocked.append(True)
                threading.Event().wait(max(0, budget.cutoff - time.time()) + 0.08)
        with mock.patch.object(budget, "verify_files", side_effect=blocking_identity):
            try:
                relay.forward(b"{}", {"tools": []})
            except (mb.BudgetError, OSError):
                pass
            else:
                raise AssertionError("the expired forward must be rejected")
        thread.join(timeout=3)
        assert blocked, "the identity fault must execute inside the actual HTTP Connection.send"
        assert received == [b""], "HTTP bytes escaped after blocking identity verification crossed the deadline"
        assert mb.Budget(base).inspect()["reserved"] == 1, "the deadline must not refund the reserved slot"
        print(json.dumps({"case": "deadline-after-identity", "upstream_bytes": 0, "reserved": 1}))
        succeeded = True
    except BaseException as error:
        raise AssertionError(f"{error}; synthetic evidence retained: {base}") from error
    finally:
        if relay:
            relay.server_close()
        listener.close()
        if succeeded:
            shutil.rmtree(base)


def event(delta, terminal=None):
    return "data: " + json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": terminal}]}) + "\n\n"


def scanner_mutation():
    secret = mb.FAKE_KEY
    normal = '{"candidates":[]}'
    business = json.dumps({"candidates": [{"title": secret}]})
    split = business.index(secret) + 12
    escaped = '{"candidates":[{"title":"' + "".join("\\u%04x" % ord(char) for char in secret) + '"}]}'
    done = "data: [DONE]\n\n"
    cases = {
        "plain": event({"content": business}) + event({}, "stop") + done,
        "events": event({"content": business[:split]}) + event({"content": business[split:]}) + event({}, "stop") + done,
        "unicode": event({"content": escaped}) + event({}, "stop") + done,
        "reasoning": event({"reasoning_content": secret[:12]}) + event({"reasoning_text": secret[12:]}) + event({"content": normal}) + event({}, "stop") + done,
        "arguments": event({"tool_calls": [{"index": 0, "id": "call-controlled", "type": "function", "function": {"name": "mcp_" + "a" * 56, "arguments": '{"text":"' + secret[:12]}}]}) + event({"tool_calls": [{"index": 0, "function": {"arguments": secret[12:] + '"}'}}]}) + event({}, "tool_calls") + done,
    }
    for name, value in cases.items():
        try:
            mb.checked_sse(value.encode(), secret)
        except mb.BudgetError:
            pass
        else:
            raise AssertionError(f"the scanner did not reject {name}")
        with mock.patch.object(mb, "secret_scan", return_value=None):
            output = mb.checked_sse(value.encode(), secret).decode()
        decoded = [json.loads(block[6:]) for block in output.split("\n\n") if block.startswith("data: {")]
        deltas = [choice["delta"] for item in decoded for choice in item["choices"]]
        if name == "reasoning":
            exposed = "".join(delta.get("reasoning_content", "") + delta.get("reasoning_text", "") for delta in deltas)
        elif name == "arguments":
            exposed = json.loads("".join(tool["function"].get("arguments", "") for delta in deltas for tool in delta.get("tool_calls", [])))["text"]
        else:
            exposed = json.loads("".join(delta.get("content", "") for delta in deltas))["candidates"][0]["title"]
        assert exposed == secret, f"{name} must expose the canary when only secret_scan is removed"
        safe = value.replace(secret, "harmless-control") if name != "unicode" else event({"content": normal}) + event({}, "stop") + done
        if name in ("events", "reasoning", "arguments"):
            safe = value.replace(secret[:12], "harmless-").replace(secret[12:], "control")
        mb.checked_sse(safe.encode(), secret)
    print(json.dumps({"case": "scanner-mutation", "scanner_removed_canaries_exposed": len(cases), "safe_controls": len(cases)}))


class CommitProxy:
    def __init__(self, connection, operation, when):
        self.connection, self.operation, self.when = connection, operation, when

    def __getattr__(self, name):
        return getattr(self.connection, name)

    def execute_fault(self, function, *args):
        if self.when == "before":
            raise sqlite3.OperationalError("synthetic precommit fault")
        value = function(*args)
        raise sqlite3.OperationalError("synthetic ambiguous commit fault")

    def commit(self):
        return self.execute_fault(self.connection.commit) if self.operation == "commit" else self.connection.commit()

    def executescript(self, value):
        return self.execute_fault(self.connection.executescript, value) if self.operation == "initialize" else self.connection.executescript(value)


def initialization_faults():
    tested = 0
    connect = mb.sqlite3.connect
    for kind, total in [("write", 2), ("fsync", 4), ("database-open", 1), ("initialize-commit", 1)]:
        for position in range(1, total + 1):
            for when in ["before", "after"]:
                base, succeeded = temporary(), False
                original = getattr(mb.os, kind) if kind in ("write", "fsync") else mb.os.open
                calls = []
                def injected(*args, **kwargs):
                    applies = kind != "database-open" or Path(args[0]).name == "model-budget.sqlite"
                    if applies:
                        calls.append(True)
                    if applies and len(calls) == position and when == "before":
                        raise OSError("synthetic initialization fault")
                    value = original(*args, **kwargs)
                    if applies and len(calls) == position and when == "after":
                        if kind == "database-open":
                            os.close(value)
                        raise OSError("synthetic initialization fault")
                    return value
                patch = mock.patch.object(mb.sqlite3, "connect", side_effect=lambda *args, **kwargs: CommitProxy(connect(*args, **kwargs), "initialize", when)) if kind == "initialize-commit" else mock.patch.object(mb.os, "open" if kind == "database-open" else kind, side_effect=injected)
                try:
                    with patch:
                        try:
                            mb.initialize(base)
                        except (OSError, sqlite3.Error):
                            pass
                        else:
                            raise AssertionError(f"{kind}/{position}/{when} was not injected")
                    assert (base / "model-budget.enrollment.json").exists(), "the partial enrollment must remain"
                    try:
                        mb.initialize(base)
                    except mb.BudgetError:
                        pass
                    else:
                        raise AssertionError("a partial initialization was reset")
                    tested += 1
                    succeeded = True
                except BaseException as error:
                    raise AssertionError(f"{kind}/{position}/{when}: {error}; synthetic evidence retained: {base}") from error
                finally:
                    if succeeded:
                        shutil.rmtree(base)
    print(json.dumps({"case": "initialization-faults", "faults_refused_without_reinitialization": tested}))


def commit_faults():
    connect, tested = mb.sqlite3.connect, 0
    for operation in ["reserve", "forwarded", "completed"]:
        for when in ["before", "after"]:
            base, succeeded = temporary(), False
            try:
                mb.initialize(base)
                budget = mb.Budget(base)
                slot = budget.reserve("test") if operation != "reserve" else None
                if operation == "completed":
                    budget.mark(slot, "forwarded")
                with mock.patch.object(mb.sqlite3, "connect", side_effect=lambda *args, **kwargs: CommitProxy(connect(*args, **kwargs), "commit", when)):
                    try:
                        budget.reserve("test") if operation == "reserve" else budget.mark(slot, operation)
                    except sqlite3.Error:
                        pass
                    else:
                        raise AssertionError("the commit fault must be reported")
                expected = 0 if operation == "reserve" and when == "before" else 1
                reopened = mb.Budget(base)
                assert reopened.inspect()["reserved"] == expected, "a committed reservation was lost"
                for _ in range(mb.LIMIT - expected):
                    reopened.reserve("test")
                try:
                    reopened.reserve("test")
                except mb.BudgetError as error:
                    assert error.args == ("BUDGET_EXHAUSTED",)
                else:
                    raise AssertionError("commit fault allowed an eleventh reservation")
                tested += 1
                succeeded = True
            except BaseException as error:
                raise AssertionError(f"{operation}/{when}: {error}; synthetic evidence retained: {base}") from error
            finally:
                if succeeded:
                    shutil.rmtree(base)
    print(json.dumps({"case": "commit-faults", "faults_refused_without_refund": tested}))


def listener_burst():
    base, succeeded = temporary(), False
    relays, clients, backlogs = [], [], []
    class ListenerSocket(socket.socket):
        def listen(self, backlog):
            backlogs.append(backlog)
            return super().listen(backlog)
    try:
        mb.initialize(base)
        for inherited in (5, 128):
            with mock.patch.object(mb.http.server.ThreadingHTTPServer, "request_queue_size", inherited), mock.patch.object(mb.socket, "socket", ListenerSocket):
                spec.loader.exec_module(mb)
                relay = mb.Relay(mb.Budget(base), base, "http://127.0.0.1:1/v1", mb.FAKE_KEY, "synthetic")
                relays.append(relay)
            assert backlogs[-1] >= 16, "the listener must queue the existing sixteen-handler capacity"
            assert backlogs[-1] >= inherited, "a higher inherited listener capacity must be retained"
            for _ in range(16):
                clients.append(socket.create_connection(relay.server_address, timeout=0.5))
        assert mb.Budget(base).inspect()["reserved"] == 0
        print(json.dumps({"case": "listener-burst", "connected": len(clients), "listen_backlogs": backlogs, "reserved": 0, "real_model_requests": 0}))
        succeeded = True
    except BaseException as error:
        raise AssertionError(f"{error}; synthetic evidence retained: {base}") from error
    finally:
        for client in clients:
            client.close()
        for relay in relays:
            relay.server_close()
        if succeeded:
            shutil.rmtree(base)


def header_limits():
    base, succeeded = temporary(), False
    relay = None
    clients = []
    original_setup, original_finish = mb.Handler.setup, mb.Handler.finish
    active, maximum, timeouts = set(), [0], []
    lock = threading.Lock()
    def setup(handler):
        original_setup(handler)
        with lock:
            active.add(id(handler))
            maximum[0] = max(maximum[0], len(active))
            configured = handler.connection.gettimeout()
            timeouts.append(configured)
        if configured is not None:
            handler.connection.settimeout(min(configured, 0.15))
    def finish(handler):
        try:
            original_finish(handler)
        finally:
            with lock:
                active.discard(id(handler))
    try:
        mb.initialize(base)
        relay = mb.Relay(mb.Budget(base), base, "http://127.0.0.1:1/v1", mb.FAKE_KEY, "synthetic")
        with mock.patch.object(mb.Handler, "setup", setup), mock.patch.object(mb.Handler, "finish", finish):
            thread = threading.Thread(target=relay.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
            thread.start()
            def open_partial(_):
                try:
                    client = socket.create_connection(relay.server_address, timeout=0.5)
                    client.sendall(b"POST /v1/chat/completions HTTP/1.1\r\nX-Incomplete:")
                    return client
                except OSError:
                    return None
            with concurrent.futures.ThreadPoolExecutor(max_workers=48) as pool:
                clients = [client for client in pool.map(open_partial, range(48)) if client]
            threading.Event().wait(0.3)
            assert timeouts, "the actual partial-header sockets must reach handlers"
            assert all(value is not None and 0 < value <= 10 for value in timeouts), "request headers reached a handler without a finite parse timeout"
            assert maximum[0] <= 32, f"unbounded simultaneous partial-header handlers: {maximum[0]}"
            assert not active, "partial-header sockets did not close within their controlled parse timeout"
            assert mb.Budget(base).inspect()["reserved"] == 0
        print(json.dumps({"case": "header-limits", "accepted_handlers": len(timeouts), "maximum_active_handlers": maximum[0], "reserved": 0}))
        succeeded = True
    except BaseException as error:
        raise AssertionError(f"{error}; synthetic evidence retained: {base}") from error
    finally:
        for client in clients:
            client.close()
        if relay:
            relay.shutdown()
            relay.server_close()
        if succeeded:
            shutil.rmtree(base)


def private_model_metadata():
    valid = {"key": mb.FAKE_KEY, "url": "https://controlled.example/v1", "model": "synthetic"}
    rejected = 0
    cases = [dict(valid, model=mb.FAKE_KEY), dict(valid, url="https://controlled.example/" + mb.FAKE_KEY), dict(valid, key=mb.FAKE_KEY + "\r\ninvalid-header")]
    for value in cases:
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps(value).encode())
        with mock.patch.object(mb.subprocess, "run", return_value=result) as execute:
            try:
                mb.private_model(Path("/synthetic-node"))
            except mb.BudgetError:
                rejected += 1
            assert execute.call_count == 1
    assert rejected == len(cases), "private model credentials must not escape as public metadata or invalid headers"
    result = subprocess.CompletedProcess([], 0, stdout=json.dumps(valid).encode())
    with mock.patch.object(mb.subprocess, "run", return_value=result):
        assert mb.private_model(Path("/synthetic-node")) == valid
    print(json.dumps({"case": "private-model-metadata", "rejected": rejected, "safe_control": True, "actual_node_executions": 0, "real_env_reads": 0}))


def revised_configuration():
    import datetime
    assert mb.NIGHT == mb.REPOSITORY / "build/p5-revise-20261101/budget"
    assert mb.CUTOFF == datetime.datetime(2026, 11, 1, 4, tzinfo=datetime.timezone.utc).timestamp()
    assert mb.RUN_LABEL == "p5-revise-20261101" and mb.LIMIT == 10
    with mock.patch.object(mb, "private_json", side_effect=AssertionError("old enrollment must not be read")) as read:
        try:
            mb.Budget(mb.REPOSITORY / "build/night-20261031", True)
        except mb.BudgetError:
            pass
        else:
            raise AssertionError("old real directory was accepted")
        assert read.call_count == 0
    print(json.dumps({"old_enrollment_reads": 0, "rejected_old_directory": True}))


@mock.patch.object(mb.time, "time", return_value=mb.CUTOFF - 60)
def real_initialization_admission(clock):
    approved = b'{"version":1,"conclusion":"pass"}\n'
    failures = [subprocess.CompletedProcess([], 1, stdout=b"") for _ in ["missing", "source", "core", "native", "reviewer", "independent"]]
    failures += [subprocess.CompletedProcess([], code, stdout=data) for code, data in [(1, approved), (0, b'{}'), (0, b'{"version":true,"conclusion":"pass"}'), (0, b'{"version":1,"conclusion":"fail"}'), (0, b'{"version":1,"conclusion":"pass","extra":0}'), (0, b'{"version":1,"version":1,"conclusion":"pass"}'), (0, b"x" * 1025)]]
    failures += [subprocess.TimeoutExpired(["controlled-check"], 10), OSError("synthetic private checker exception")]
    for failure in failures:
        base = temporary()
        base.chmod(0o755)
        try:
            with mock.patch.object(mb, "NIGHT", base), mock.patch.object(mb.subprocess, "run", side_effect=failure if isinstance(failure, BaseException) else None, return_value=failure) as execute, mock.patch.object(mb.os, "chmod", wraps=os.chmod) as chmod:
                try:
                    mb.initialize(base, real=True)
                except mb.BudgetError as error:
                    assert error.args == ("BUDGET_ADMISSION_REQUIRED",)
                else:
                    raise AssertionError("unapproved real initialization created a ledger")
                assert execute.call_count == 1, "initialization must invoke the read-only admission gate"
                assert chmod.call_count == 0, "admission must precede chmod"
                assert not list(base.iterdir()), "admission failure must retain zero created files"
                assert base.stat().st_mode & 0o777 == 0o755
        finally:
            shutil.rmtree(base)
    base = temporary()
    try:
        with mock.patch.object(mb, "NIGHT", base), mock.patch.object(mb.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=approved)) as execute:
            state = mb.initialize(base, real=True)
            assert state["reserved"] == 0 and state["remaining"] == 10
            args, kwargs = execute.call_args
            assert args[0] == [sys.executable, "-B", str(mb.REPOSITORY / "scripts/probes/run-mcp-live.py"), "--check-admission"]
            assert set(kwargs["env"]) == {"PATH", "HOME"} and kwargs["stderr"] == subprocess.DEVNULL
            assert 0 < kwargs["timeout"] <= 10
            original = {path.name: path.read_bytes() for path in base.iterdir()}
            try:
                mb.initialize(base, real=True)
            except mb.BudgetError:
                pass
            else:
                raise AssertionError("an existing admitted ledger was reset")
            assert execute.call_count == 1
            assert {path.name: path.read_bytes() for path in base.iterdir()} == original
    finally:
        shutil.rmtree(base)
    base = temporary()
    base.chmod(0o755)
    def approve_after_cutoff(*_args, **_kwargs):
        clock.return_value = mb.CUTOFF + 1
        return subprocess.CompletedProcess([], 0, stdout=approved)
    try:
        with mock.patch.object(mb, "NIGHT", base), mock.patch.object(mb.subprocess, "run", side_effect=approve_after_cutoff) as execute, mock.patch.object(mb.os, "chmod", wraps=os.chmod) as chmod:
            try:
                mb.initialize(base, real=True)
            except mb.BudgetError as error:
                assert error.args == ("BUDGET_UNAVAILABLE",)
            else:
                raise AssertionError("admission crossed the cutoff and created a ledger")
            assert execute.call_count == 1
            assert chmod.call_count == 0 and not list(base.iterdir())
            assert base.stat().st_mode & 0o777 == 0o755
    finally:
        shutil.rmtree(base)
    print(json.dumps({"refused_before_write": len(failures), "approved_initialized": True, "reset_refused": True, "cutoff_crossing_refused": True, "actual_admission_processes": 0, "real_env_reads": 0}))


def real_initialization_admission_future():
    with mock.patch.object(mb.time, "time", return_value=mb.CUTOFF + 1):
        real_initialization_admission()
        assert mb.time.time() == mb.CUTOFF + 1, "the internal fixed clock must restore the external future clock"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    cases = {"locked-identity": locked_identity, "deadline-after-identity": deadline_after_identity, "scanner-mutation": scanner_mutation, "initialization-faults": initialization_faults, "commit-faults": commit_faults, "listener-burst": listener_burst, "header-limits": header_limits, "private-model-metadata": private_model_metadata, "revised-configuration": revised_configuration, "real-initialization-admission": real_initialization_admission, "real-initialization-admission-future": real_initialization_admission_future}
    parser.add_argument("case", choices=cases)
    args = parser.parse_args()
    cases[args.case]()
