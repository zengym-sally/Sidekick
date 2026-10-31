use super::super::*;
use crate::local_store::{AppStore, McpServerInput, ModelConfigInput, TodoInput};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::process::{Child, ExitStatus};

const CHILD_INFO: &str = "SIDEKICK_P4_HOST_CHILD_INFO";
const CASE: &str = "runtime_host::mcp_recovery_tests::host_crash::host_crash_recovery_matrix";
const PREFIX: &str = "P4_HOST_CRASH ";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    case: String,
    exe: PathBuf,
    parent: u32,
    nonce: String,
    base: PathBuf,
    device: u64,
    inode: u64,
    uid: u32,
    model_port: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildInfo {
    binding: Binding,
    phase: String,
    variant: String,
    run: Option<String>,
}

#[derive(Clone, Debug)]
struct Process {
    pid: u32,
    parent: u32,
    group: u32,
    command: String,
}

fn owner_nonce_is_uuid_v4(nonce: &str) -> bool {
    let bytes = nonce.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)
            }
        })
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

fn processes() -> Vec<Process> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,pgid=,stat=,command="])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "controlled process inventory failed"
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse().ok()?;
            let parent = fields.next()?.parse().ok()?;
            let group = fields.next()?.parse().ok()?;
            if fields.next()?.starts_with('Z') {
                return None;
            }
            Some(Process {
                pid,
                parent,
                group,
                command: fields.collect::<Vec<_>>().join(" "),
            })
        })
        .collect()
}

fn current_uid() -> u32 {
    let output = Command::new("/usr/bin/id")
        .arg("-u")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

fn private_file(path: &Path, uid: u32) {
    let metadata = fs::symlink_metadata(path).expect("controlled private file missing");
    assert!(metadata.is_file() && !metadata.file_type().is_symlink());
    assert_eq!(metadata.mode() & 0o7777, 0o600);
    assert_eq!(metadata.uid(), uid);
    assert_eq!(metadata.nlink(), 1);
}

fn private_json(path: &Path, value: &impl Serialize) {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    serde_json::to_writer(&mut file, value).unwrap();
    file.sync_all().unwrap();
}

fn fixed_paths() -> (PathBuf, PathBuf) {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .canonicalize()
        .unwrap();
    (
        repository.join("build/s0-runtime").canonicalize().unwrap(),
        repository
            .join("tests/fixtures/mcp-trial.mjs")
            .canonicalize()
            .unwrap(),
    )
}

fn guarded_info(path: &Path) -> ChildInfo {
    assert!(path.is_absolute(), "child info must be absolute");
    let base = path.parent().expect("child info parent");
    let temp = Path::new("/tmp").canonicalize().unwrap();
    assert_eq!(base.parent(), Some(temp.as_path()));
    assert_eq!(base.canonicalize().unwrap(), base);
    assert!(matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some("start-info.json" | "reopen-info.json")
    ));
    let name = base.file_name().unwrap().to_str().unwrap();
    let suffix = name
        .strip_prefix("sidekick-p4-host-")
        .expect("private base name");
    let (parent, nonce) = suffix.split_once('-').expect("private base identity");
    let parent: u32 = parent.parse().expect("private parent identity");
    assert!(parent > 1);
    assert_eq!(nonce.len(), 48);
    assert!(nonce
        .bytes()
        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
    let metadata = fs::symlink_metadata(base).unwrap();
    assert!(metadata.is_dir() && !metadata.file_type().is_symlink());
    assert_eq!(metadata.mode() & 0o7777, 0o700);
    let uid = current_uid();
    assert_eq!(metadata.uid(), uid);
    private_file(path, uid);
    let info: ChildInfo = serde_json::from_reader(File::open(path).unwrap()).unwrap();
    let binding = &info.binding;
    assert_eq!(binding.parent, parent, "P4_GUARD_PARENT");
    assert_eq!(binding.nonce, nonce);
    assert_eq!(binding.base, base);
    assert_eq!(binding.device, metadata.dev());
    assert_eq!(binding.inode, metadata.ino());
    assert_eq!(binding.uid, uid);
    assert_ne!(binding.model_port, 0, "P4_GUARD_PORT");
    assert_eq!(binding.case, CASE);
    let exe = std::env::current_exe().unwrap().canonicalize().unwrap();
    assert_eq!(binding.exe, exe);
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert_eq!(args, ["--exact", CASE, "--test-threads=1", "--nocapture"]);
    let inventory = processes();
    let me = inventory
        .iter()
        .find(|process| process.pid == std::process::id())
        .expect("controlled child identity");
    assert_eq!(me.parent, parent);
    let owner = inventory
        .iter()
        .find(|process| process.pid == parent)
        .expect("controlled parent must be alive");
    assert!(owner.command.starts_with(exe.to_str().unwrap()));
    let marker = base.join("owner.json");
    private_file(&marker, uid);
    let marker: Binding = serde_json::from_reader(File::open(marker).unwrap()).unwrap();
    assert_eq!(&marker, binding, "P4_GUARD_MARKER");
    match info.phase.as_str() {
        "start" => {
            assert_eq!(path.file_name().unwrap(), "start-info.json");
            assert!(info.run.is_none());
            assert!(matches!(
                info.variant.as_str(),
                "before-begin"
                    | "after-begin"
                    | "before-response"
                    | "after-response"
                    | "after-response-error"
                    | "after-ack"
            ));
            for name in ["app", "workspace"] {
                assert!(
                    fs::symlink_metadata(base.join(name)).is_err(),
                    "P4_GUARD_PREEXISTING"
                );
            }
        }
        "reopen" => {
            assert_eq!(path.file_name().unwrap(), "reopen-info.json");
            assert!(info.run.as_ref().is_some_and(|run| {
                !run.is_empty()
                    && run.len() <= 128
                    && run.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            }));
            verify_bootstrap(binding);
        }
        _ => panic!("unrecognized controlled child phase"),
    }
    info
}

fn verify_bootstrap(binding: &Binding) {
    for path in [binding.base.join("app"), binding.base.join("workspace")] {
        let metadata = fs::symlink_metadata(&path).unwrap();
        assert!(metadata.is_dir() && !metadata.file_type().is_symlink());
        assert_eq!(metadata.uid(), binding.uid);
        assert_eq!(metadata.mode() & 0o077, 0);
        assert_eq!(path.canonicalize().unwrap(), path);
    }
    assert!(fs::symlink_metadata(binding.base.join("app/workspace-init.json")).is_err());
    let pointer = binding.base.join("app/bootstrap.json");
    private_file(&pointer, binding.uid);
    let pointer: Value = serde_json::from_reader(File::open(pointer).unwrap()).unwrap();
    assert_eq!(pointer["app"], "sidekick");
    assert_eq!(pointer["version"], 1);
    assert_eq!(pointer["timeZone"], "UTC");
    assert_eq!(
        pointer["root"],
        binding.base.join("workspace").to_str().unwrap(),
        "P4_GUARD_BOOTSTRAP"
    );
}

fn emit(value: Value) {
    println!("{PREFIX}{value}");
    std::io::stdout().flush().unwrap();
}

fn calls(workspace: &Path) -> Value {
    let db = Connection::open_with_flags(
        workspace.join("data/sidekick.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .unwrap();
    let mut statement = db.prepare("SELECT id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,response_category,response_summary FROM tool_calls ORDER BY created_at_ms,id").unwrap();
    let rows = statement
        .query_map([], |row| {
            Ok(json!({"id":row.get::<_,String>(0)?,"agentRunId":row.get::<_,String>(1)?,"modelCallId":row.get::<_,String>(2)?,"revision":row.get::<_,String>(3)?,"schemaSha256":row.get::<_,String>(4)?,"serverId":row.get::<_,String>(5)?,"toolName":row.get::<_,String>(6)?,"argumentsSha256":row.get::<_,String>(7)?,"state":row.get::<_,String>(8)?,"category":row.get::<_,Option<String>>(9)?,"summary":row.get::<_,Option<String>>(10)?}))
        })
        .unwrap()
        .map(|row| row.unwrap())
        .collect::<Vec<_>>();
    json!(rows)
}

fn child_main(info: ChildInfo) {
    let binding = info.binding;
    let app = binding.base.join("app");
    let workspace = binding.base.join("workspace");
    if info.phase == "reopen" {
        let store = AppStore::open(app).unwrap();
        let run = store.agent_run(info.run.as_ref().unwrap()).unwrap();
        emit(
            json!({"type":"read_summary","run":run,"calls":calls(&workspace),"tables":super::table_snapshot(&workspace)}),
        );
        return;
    }
    let (directory, fixture) = fixed_paths();
    let key = format!("SIDEKICK_P4_SYNTHETIC_{}", binding.nonce);
    std::env::set_var(&key, "p4-synthetic-token");
    let local = LocalState::new(app);
    local.access(|store| {
        store.initialize(Some(workspace.clone()), "UTC")?;
        store.upgrade_mcp_storage()?;
        store.save_models(ModelConfigInput {
            expected_revision: None,
            providers: json!({"providers":[{"id":"controlled","apiFormat":"openai-compatible","baseUrl":format!("http://127.0.0.1:{}/v1",binding.model_port),"auth":{"type":"bearer","apiKeyEnv":key},"enabled":true,"network":{"timeoutMs":10000,"retry":{"maxRetries":0}}}]}),
            models: json!({"models":[{"id":"controlled","providerId":"controlled","apiModelId":"synthetic","capabilities":{"toolCall":true,"input":["text"]}}]}),
            default_model_id: "controlled".into(),
            api_keys: Default::default(),
        })?;
        for index in 0..2 {
            let mode = if index == 0 && info.variant == "after-response-error" { "error" } else { "normal" };
            store.save_mcp_server(McpServerInput {
                id: None,
                expected_revision: store.mcp_configuration()?.revision,
                server: serde_json::from_value(json!({"name":format!("service-{index}"),"transport":"stdio","enabled":true,"command":directory.join("node"),"args":[fixture,"service",binding.base.join(format!("service-{index}.jsonl")),mode,binding.base.join("forbidden-marker")],"cwd":null,"env":[],"connectTimeoutMs":3000,"toolTimeoutMs":1000})).unwrap(),
            })?;
        }
        Ok(())
    }).unwrap();
    let empty = super::table_snapshot(&workspace);
    for table in ["sources", "candidates", "todos", "todo_events", "runs"] {
        assert!(empty[table].as_array().unwrap().is_empty());
    }
    local
        .access(|store| {
            store.create(
                TodoInput {
                    title: "Synthetic recovery baseline".into(),
                    kind: "action".into(),
                    owner: "fixture".into(),
                    priority: "medium".into(),
                    due: None,
                    followup: None,
                    tags: vec!["p4".into()],
                },
                "p4-host-baseline",
            )?;
            Ok(())
        })
        .unwrap();
    let baseline = super::table_snapshot(&workspace);
    assert_ne!(baseline, empty, "baseline seed must be observable");
    for table in ["sources", "candidates", "runs"] {
        assert_eq!(baseline[table], empty[table]);
    }
    for table in ["todos", "todo_events"] {
        assert_eq!(baseline[table].as_array().unwrap().len(), 1);
    }
    emit(json!({"type":"baseline","empty":empty,"tables":baseline}));
    let runtime = RuntimeState::default();
    *runtime.trial_policy.lock().unwrap() = match info.variant.as_str() {
        "before-begin" => Some("hold-before-begin"),
        "after-begin" => Some("hold-after-begin"),
        "before-response" => Some("hold-before-response"),
        "after-response" | "after-response-error" => Some("hold-after-response"),
        "after-ack" => None,
        _ => unreachable!(),
    };
    let run = runtime
        .start_trial(
            local,
            directory,
            "organizer",
            TextInput {
                text: "我整理合成清单。".into(),
                source_at_ms: None,
                time_zone: "UTC".into(),
            },
            Arc::new(|_, _| {}),
        )
        .unwrap();
    emit(json!({"type":"started","runId":run.id}));
    let until = Instant::now() + Duration::from_secs(25);
    loop {
        let events = std::mem::take(&mut *runtime.trial_events.lock().unwrap());
        for event in events {
            emit(json!({"type":"checkpoint","event":event}));
        }
        let inventory = processes();
        if Instant::now() >= until
            || !inventory
                .iter()
                .any(|process| process.pid == binding.parent)
            || !inventory.iter().any(|process| {
                process.pid == std::process::id() && process.parent == binding.parent
            })
        {
            std::process::exit(78);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn jsonl(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

struct Fixture {
    binding: Binding,
    directory: PathBuf,
    fixture: PathBuf,
    model: Child,
    host: Option<Child>,
    receive: Option<mpsc::Receiver<String>>,
    transcript: Vec<String>,
    events: Vec<Value>,
    registered: Vec<Process>,
    owners: Vec<crate::mcp_host::Owner>,
    run: Option<String>,
    baseline: Option<Value>,
    evidence: PathBuf,
}

impl Fixture {
    fn new(variant: &str) -> Self {
        let (directory, fixture) = fixed_paths();
        let nonce = crate::mcp_host::nonce();
        assert_eq!(nonce.len(), 48);
        let parent = std::process::id();
        let base = Path::new("/tmp")
            .canonicalize()
            .unwrap()
            .join(format!("sidekick-p4-host-{parent}-{nonce}"));
        fs::DirBuilder::new().mode(0o700).create(&base).unwrap();
        let metadata = fs::symlink_metadata(&base).unwrap();
        let mut model = Command::new(directory.join("node"))
            .args([
                fixture.as_os_str(),
                "model".as_ref(),
                base.join("model.jsonl").as_os_str(),
                if variant == "after-ack" {
                    "recovery-hold-final"
                } else {
                    "normal"
                }
                .as_ref(),
                base.join("forbidden-marker").as_os_str(),
            ])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut url = String::new();
        BufReader::new(model.stdout.take().unwrap())
            .read_line(&mut url)
            .unwrap();
        let port: u16 = url
            .trim()
            .strip_prefix("http://127.0.0.1:")
            .unwrap()
            .strip_suffix("/v1")
            .unwrap()
            .parse()
            .unwrap();
        assert_ne!(port, 0);
        let binding = Binding {
            case: CASE.into(),
            exe: std::env::current_exe().unwrap().canonicalize().unwrap(),
            parent,
            nonce,
            base,
            device: metadata.dev(),
            inode: metadata.ino(),
            uid: current_uid(),
            model_port: port,
        };
        private_json(&binding.base.join("owner.json"), &binding);
        let evidence = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../build/p4-recovery-20261101/host-crash")
            .join(format!("{variant}-{}", binding.nonce));
        fs::create_dir_all(&evidence).unwrap();
        Self {
            binding,
            directory,
            fixture,
            model,
            host: None,
            receive: None,
            transcript: Vec::new(),
            events: Vec::new(),
            registered: Vec::new(),
            owners: Vec::new(),
            run: None,
            baseline: None,
            evidence,
        }
    }

    fn info(&self, phase: &str, variant: &str) -> ChildInfo {
        ChildInfo {
            binding: self.binding.clone(),
            phase: phase.into(),
            variant: variant.into(),
            run: self.run.clone(),
        }
    }

    fn spawn(&mut self, info: &ChildInfo) {
        assert!(self.host.is_none());
        let info_path = self.binding.base.join(format!("{}-info.json", info.phase));
        private_json(&info_path, info);
        let stderr = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(self.binding.base.join(format!("{}.stderr", info.phase)))
            .unwrap();
        let mut host = Command::new(&self.binding.exe)
            .args(["--exact", CASE, "--test-threads=1", "--nocapture"])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env(CHILD_INFO, &info_path)
            .stdout(Stdio::piped())
            .stderr(stderr)
            .spawn()
            .unwrap();
        let (send, receive) = mpsc::channel();
        let stdout = host.stdout.take().unwrap();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if send.send(line).is_err() {
                    break;
                }
            }
        });
        self.host = Some(host);
        self.receive = Some(receive);
    }

    fn drain(&mut self) {
        let lines: Vec<_> = self.receive.as_ref().unwrap().try_iter().collect();
        self.record_lines(lines);
    }

    fn record_lines(&mut self, lines: Vec<String>) {
        for line in lines {
            if let Some(raw) = line.find(PREFIX).map(|start| &line[start + PREFIX.len()..]) {
                let event: Value = serde_json::from_str(raw).unwrap();
                if event["type"] == "started" {
                    self.run = Some(event["runId"].as_str().unwrap().into());
                }
                if event["type"] == "baseline" {
                    assert_ne!(event["empty"], event["tables"]);
                    self.baseline = Some(event["tables"].clone());
                }
                self.events.push(event);
            }
            self.transcript.push(line);
        }
    }

    fn service_events(&self, index: usize) -> Vec<Value> {
        jsonl(&self.binding.base.join(format!("service-{index}.jsonl")))
    }

    fn counter(&self) -> [usize; 2] {
        std::array::from_fn(|index| {
            self.service_events(index)
                .iter()
                .filter(|event| event["type"] == "call")
                .count()
        })
    }

    fn ready(&self, variant: &str) -> bool {
        let point = match variant {
            "before-begin" => "before_begin",
            "after-begin" => "after_begin",
            "before-response" => "before_response",
            "after-response" | "after-response-error" => "after_response",
            "after-ack" => "after_response",
            _ => unreachable!(),
        };
        self.events
            .iter()
            .any(|event| event["event"]["point"] == point)
            && self
                .events
                .iter()
                .filter(|event| event["event"]["point"] == "owner")
                .count()
                == 2
            && (0..2).all(|index| {
                self.service_events(index)
                    .iter()
                    .filter(|event| event["type"] == "pid")
                    .count()
                    == 2
            })
            && (variant != "after-ack"
                || jsonl(&self.binding.base.join("model.jsonl"))
                    .iter()
                    .any(|event| {
                        event["request"] == 2
                            && event["results"]
                                .as_array()
                                .is_some_and(|results| results.len() == 1)
                    }))
    }

    fn wait_ready(&mut self, variant: &str) {
        let until = Instant::now() + Duration::from_secs(18);
        loop {
            self.drain();
            if self.ready(variant) {
                return;
            }
            assert!(
                self.host.as_mut().unwrap().try_wait().unwrap().is_none(),
                "controlled host exited before checkpoint: {:?}",
                self.transcript
            );
            assert!(
                Instant::now() < until,
                "controlled checkpoint timed out: {:?}",
                self.events
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn register(&mut self) {
        let inventory = processes();
        let host = inventory
            .iter()
            .find(|process| process.pid == self.host.as_ref().unwrap().id())
            .unwrap();
        assert_eq!(host.parent, self.binding.parent);
        assert!(host.command.starts_with(self.binding.exe.to_str().unwrap()));
        assert!(host.command.contains(CASE));
        private_file(&self.binding.base.join("owner.json"), self.binding.uid);
        let marker: Binding =
            serde_json::from_reader(File::open(self.binding.base.join("owner.json")).unwrap())
                .unwrap();
        assert_eq!(marker, self.binding);
        let runtime = self
            .events
            .iter()
            .find(|event| event["event"]["point"] == "runtime_started")
            .unwrap()["event"]["detail"]["pid"]
            .as_u64()
            .unwrap() as u32;
        let runtime = inventory
            .iter()
            .find(|process| process.pid == runtime)
            .unwrap();
        assert_eq!(runtime.parent, host.pid);
        assert_eq!(runtime.group, runtime.pid);
        assert!(runtime
            .command
            .contains(self.directory.join("organizer.mjs").to_str().unwrap()));
        assert!(runtime
            .command
            .contains(&format!("--run {}", self.run.as_ref().unwrap())));
        self.registered.push(runtime.clone());
        for event in self
            .events
            .iter()
            .filter(|event| event["event"]["point"] == "owner")
        {
            let owner: crate::mcp_host::Owner =
                serde_json::from_value(event["event"]["detail"]["owner"].clone()).unwrap();
            assert_eq!(owner.run, self.run.as_ref().unwrap().as_str());
            assert_ne!(owner.guardian, owner.keeper);
            assert!(owner_nonce_is_uuid_v4(&owner.nonce));
            for pid in [owner.guardian, owner.keeper] {
                let process = inventory.iter().find(|process| process.pid == pid).unwrap();
                assert_eq!(process.group, owner.guardian);
                assert_eq!(
                    process.parent,
                    if pid == owner.guardian {
                        runtime.pid
                    } else {
                        owner.guardian
                    }
                );
                assert!(process
                    .command
                    .contains(self.directory.join("mcp-guardian.mjs").to_str().unwrap()));
                assert!(process.command.contains(&format!("--run {} ", owner.run)));
                assert!(process
                    .command
                    .contains(&format!("--nonce {} ", owner.nonce)));
                assert!(process.command.contains(if pid == owner.guardian {
                    "--mode guardian "
                } else {
                    "--mode keeper "
                }));
                self.registered.push(process.clone());
            }
            self.owners.push(owner);
        }
        assert_eq!(self.owners.len(), 2);
        for index in 0..2 {
            let events = self.service_events(index);
            let mut service = None;
            for event in events.iter().filter(|event| event["type"] == "pid") {
                assert_eq!(event["modelKeyPresent"], false);
                let pid = event["pid"].as_u64().unwrap() as u32;
                let process = inventory.iter().find(|process| process.pid == pid).unwrap();
                assert!(process.command.contains(self.fixture.to_str().unwrap()));
                assert!(process.command.contains(
                    self.binding
                        .base
                        .join(format!("service-{index}.jsonl"))
                        .to_str()
                        .unwrap()
                ));
                assert!(self
                    .owners
                    .iter()
                    .any(|owner| owner.guardian == process.group));
                if event["role"] == "service" {
                    assert!(self
                        .owners
                        .iter()
                        .any(|owner| owner.guardian == process.parent));
                    service = Some(pid);
                }
                self.registered.push(process.clone());
            }
            let service = service.unwrap();
            assert!(events
                .iter()
                .filter(|event| event["type"] == "pid" && event["role"] == "child")
                .all(|event| inventory.iter().any(|process| process.pid
                    == event["pid"].as_u64().unwrap() as u32
                    && process.parent == service)));
        }
        assert_eq!(self.registered.len(), 9);
        assert_eq!(
            self.registered
                .iter()
                .map(|process| process.pid)
                .collect::<BTreeSet<_>>()
                .len(),
            9
        );
        assert_eq!(
            self.registered
                .iter()
                .map(|process| process.group)
                .collect::<BTreeSet<_>>()
                .len(),
            3
        );
        self.assert_model();
        let proof: Vec<_> = self.registered.iter().map(|process| json!({"pid":process.pid,"parent":process.parent,"group":process.group,"command":process.command})).collect();
        private_json(&self.binding.base.join("registered.json"), &proof);
    }

    fn assert_model(&self) {
        let inventory = processes();
        let model = inventory
            .iter()
            .find(|process| process.pid == self.model.id())
            .expect("unrelated model must remain non-zombie");
        assert_eq!(model.parent, self.binding.parent);
        assert!(model.command.contains(self.fixture.to_str().unwrap()));
        assert!(model
            .command
            .contains(self.binding.base.join("model.jsonl").to_str().unwrap()));
    }

    fn kill_host(&mut self) {
        let inventory = processes();
        let host = self.host.as_mut().unwrap();
        let process = inventory
            .iter()
            .find(|process| process.pid == host.id())
            .unwrap();
        assert_eq!(process.parent, self.binding.parent);
        assert!(process
            .command
            .starts_with(self.binding.exe.to_str().unwrap()));
        assert!(process.command.contains(CASE));
        let marker: Binding =
            serde_json::from_reader(File::open(self.binding.base.join("owner.json")).unwrap())
                .unwrap();
        assert_eq!(marker, self.binding);
        host.kill().unwrap();
        let status = host.wait().unwrap();
        use std::os::unix::process::ExitStatusExt;
        assert_eq!(
            status.signal(),
            Some(9),
            "the actual Rust host must be SIGKILLed"
        );
        self.host.take();
        self.drain();
    }

    fn assert_natural_cleanup(&self) {
        let groups: BTreeSet<_> = self
            .registered
            .iter()
            .map(|process| process.group)
            .collect();
        let pids: BTreeSet<_> = self.registered.iter().map(|process| process.pid).collect();
        let until = Instant::now() + Duration::from_secs(7);
        loop {
            let inventory = processes();
            let alive: Vec<_> = inventory
                .iter()
                .filter(|process| groups.contains(&process.group) || pids.contains(&process.pid))
                .collect();
            if alive.is_empty() {
                self.assert_model();
                private_json(
                    &self.binding.base.join("natural-cleanup.json"),
                    &json!({"registeredPids":pids,"registeredGroups":groups,"alive":[],"modelAlive":self.model.id(),"beforeFinally":true}),
                );
                return;
            }
            assert!(
                Instant::now() < until,
                "product cleanup left live processes before finally: {alive:?}"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_exit(&mut self) -> ExitStatus {
        let until = Instant::now() + Duration::from_secs(10);
        loop {
            self.drain();
            if let Some(status) = self.host.as_mut().unwrap().try_wait().unwrap() {
                self.host.take();
                loop {
                    match self
                        .receive
                        .as_ref()
                        .unwrap()
                        .recv_timeout(Duration::from_millis(100))
                    {
                        Ok(line) => self.record_lines(vec![line]),
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            assert!(
                                Instant::now() < until,
                                "controlled child stdout did not close"
                            );
                        }
                    }
                }
                return status;
            }
            assert!(
                Instant::now() < until,
                "controlled read/guard child timed out"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn preserve(&self) {
        for entry in fs::read_dir(&self.binding.base).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            if metadata.is_file() && !metadata.file_type().is_symlink() {
                let _ = fs::copy(&path, self.evidence.join(entry.file_name()));
            }
        }
        fs::write(
            self.evidence.join("child-stdout.log"),
            self.transcript.join("\n"),
        )
        .unwrap();
        fs::write(
            self.evidence.join("events.json"),
            serde_json::to_vec_pretty(&self.events).unwrap(),
        )
        .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let inventory = processes();
        if let Some(host) = self.host.as_mut() {
            if inventory.iter().any(|process| {
                process.pid == host.id()
                    && process.parent == self.binding.parent
                    && process
                        .command
                        .starts_with(self.binding.exe.to_str().unwrap())
                    && process.command.contains(CASE)
            }) {
                let _ = host.kill();
                let _ = host.wait();
            }
        }
        for registered in &self.registered {
            if inventory.iter().any(|process| {
                process.pid == registered.pid
                    && process.group == registered.group
                    && process.command == registered.command
            }) {
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", &registered.pid.to_string()])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
        if inventory.iter().any(|process| {
            process.pid == self.model.id()
                && process.parent == self.binding.parent
                && process
                    .command
                    .contains(self.binding.base.join("model.jsonl").to_str().unwrap())
        }) {
            let _ = self.model.kill();
            let _ = self.model.wait();
        }
        self.preserve();
        if std::thread::panicking() {
            eprintln!(
                "retained controlled host recovery evidence: {}",
                self.evidence.display()
            );
        }
    }
}

fn assert_receipt(rows: &Value, run: &str, expected: Option<(&str, Option<&str>)>) {
    let rows = rows.as_array().unwrap();
    let Some((state, category)) = expected else {
        assert!(rows.is_empty());
        return;
    };
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row["agentRunId"], run);
    assert!(!row["id"].as_str().unwrap().is_empty());
    assert_eq!(row["modelCallId"], "synthetic-call-0");
    assert!(!row["revision"].as_str().unwrap().is_empty());
    assert!(!row["serverId"].as_str().unwrap().is_empty());
    assert_eq!(row["toolName"], "lookup");
    assert_eq!(
        row["argumentsSha256"],
        format!("{:x}", Sha256::digest(br#"{"text":"controlled"}"#))
    );
    let schema = row["schemaSha256"].as_str().unwrap();
    assert_eq!(schema.len(), 64);
    assert!(schema
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    let expected_schema = json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false});
    assert_eq!(
        schema,
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&expected_schema).unwrap())
        )
    );
    assert_eq!(row["state"], state);
    assert_eq!(row["category"], json!(category));
    assert!(
        row["summary"].is_null(),
        "raw arguments or results must not enter a summary"
    );
    assert!(!serde_json::to_string(row)
        .unwrap()
        .contains("p4-synthetic-token"));
}

fn matrix_case(variant: &str) {
    let mut fixture = Fixture::new(variant);
    fixture.spawn(&fixture.info("start", variant));
    fixture.wait_ready(variant);
    fixture.register();
    let run = fixture.run.clone().unwrap();
    let workspace = fixture.binding.base.join("workspace");
    let baseline = fixture.baseline.clone().unwrap();
    assert_eq!(super::table_snapshot(&workspace), baseline);
    let count = if matches!(variant, "before-begin" | "after-begin") {
        [0, 0]
    } else {
        [1, 0]
    };
    assert_eq!(fixture.counter(), count);
    let pre_state = match variant {
        "before-begin" => None,
        "after-begin" | "before-response" => Some(("possibly_sent", None)),
        "after-response-error" => Some(("responded", Some("tool_error"))),
        _ => Some(("responded", Some("success"))),
    };
    let before = calls(&workspace);
    assert_receipt(&before, &run, pre_state);
    if !before.as_array().unwrap().is_empty() {
        let checkpoint = fixture
            .events
            .iter()
            .find(|event| event["event"]["point"] == "before_begin")
            .unwrap();
        assert_eq!(before[0]["id"], checkpoint["event"]["detail"]["callId"]);
    }
    fixture.kill_host();
    fixture.assert_natural_cleanup();
    assert_eq!(fixture.counter(), count);
    assert_eq!(super::table_snapshot(&workspace), baseline);
    verify_bootstrap(&fixture.binding);
    fixture.spawn(&fixture.info("reopen", variant));
    assert!(
        fixture.wait_exit().success(),
        "controlled cold reopen failed: {:?}",
        fixture.transcript
    );
    let summary = fixture
        .events
        .iter()
        .rev()
        .find(|event| event["type"] == "read_summary")
        .unwrap();
    let unknown = matches!(variant, "after-begin" | "before-response");
    assert_eq!(summary["run"]["id"], run);
    assert_eq!(
        summary["run"]["status"],
        if unknown { "failed" } else { "interrupted" }
    );
    assert_eq!(
        summary["run"]["errorCode"],
        if unknown {
            "MCP_RESULT_UNKNOWN"
        } else {
            "INTERRUPTED"
        }
    );
    let post_state = if unknown {
        Some(("unknown", None))
    } else {
        pre_state
    };
    assert_receipt(&summary["calls"], &run, post_state);
    if !before.as_array().unwrap().is_empty() {
        for field in [
            "id",
            "agentRunId",
            "modelCallId",
            "revision",
            "schemaSha256",
            "serverId",
            "toolName",
            "argumentsSha256",
        ] {
            assert_eq!(summary["calls"][0][field], before[0][field]);
        }
        assert_eq!(
            summary["calls"][0]["revision"],
            summary["run"]["snapshot"]["mcp"]["revision"]
        );
    }
    assert_eq!(summary["tables"], baseline);
    assert_eq!(super::table_snapshot(&workspace), baseline);
    assert_eq!(
        fixture.counter(),
        count,
        "cold reopen must not replay a tool"
    );
    assert_eq!(
        jsonl(&fixture.binding.base.join("model.jsonl")).len(),
        if variant == "after-ack" { 2 } else { 1 }
    );
    assert!(!fixture.binding.base.join("forbidden-marker").exists());
    fixture.assert_model();
    private_json(
        &fixture.binding.base.join("result.json"),
        &json!({"variant":variant,"tables":baseline,"summary":summary,"serviceCounters":count,"naturalCleanupBeforeFinally":true}),
    );
}

fn guard_case(variant: &str) {
    let mut fixture = Fixture::new(variant);
    let mut info = fixture.info("start", "before-begin");
    match variant {
        "guard-marker" => {
            let mut marker = fixture.binding.clone();
            marker.nonce = "0".repeat(48);
            let path = fixture.binding.base.join("owner.json");
            let mut file = OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(path)
                .unwrap();
            serde_json::to_writer(&mut file, &marker).unwrap();
            file.sync_all().unwrap();
        }
        "guard-parent" => info.binding.parent += 1,
        "guard-port" => info.binding.model_port = 0,
        "guard-preexisting" => {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(fixture.binding.base.join("app"))
                .unwrap();
            private_json(
                &fixture.binding.base.join("app/sentinel.json"),
                &json!({"untouched":true}),
            );
        }
        _ => unreachable!(),
    }
    fixture.spawn(&info);
    assert!(
        !fixture.wait_exit().success(),
        "invalid child info must hard fail"
    );
    let rejection = fs::read_to_string(fixture.binding.base.join("start.stderr")).unwrap();
    let reason = match variant {
        "guard-marker" => "P4_GUARD_MARKER",
        "guard-parent" => "P4_GUARD_PARENT",
        "guard-port" => "P4_GUARD_PORT",
        "guard-preexisting" => "P4_GUARD_PREEXISTING",
        _ => unreachable!(),
    };
    assert!(
        rejection.contains(reason),
        "wrong guard rejection: {rejection}"
    );
    assert!(!fixture.binding.base.join("workspace").exists());
    assert!(!fixture.binding.base.join("app/.sidekick-app.lock").exists());
    assert_eq!(fixture.counter(), [0, 0]);
    assert!(jsonl(&fixture.binding.base.join("model.jsonl")).is_empty());
    assert!(fixture.events.is_empty());
    if variant == "guard-preexisting" {
        let sentinel: Value = serde_json::from_reader(
            File::open(fixture.binding.base.join("app/sentinel.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(sentinel, json!({"untouched":true}));
    }
    fixture.assert_model();
}

fn bootstrap_guard_case() {
    let mut fixture = Fixture::new("guard-bootstrap");
    fixture.spawn(&fixture.info("start", "before-begin"));
    fixture.wait_ready("before-begin");
    fixture.register();
    fixture.kill_host();
    fixture.assert_natural_cleanup();
    verify_bootstrap(&fixture.binding);
    let workspace = fixture.binding.base.join("workspace");
    let baseline = fixture.baseline.clone().unwrap();
    let foreign = fixture.binding.base.join("foreign");
    fs::DirBuilder::new().mode(0o700).create(&foreign).unwrap();
    private_json(&foreign.join("sentinel.json"), &json!({"untouched":true}));
    let pointer_path = fixture.binding.base.join("app/bootstrap.json");
    let mut pointer: Value = serde_json::from_reader(File::open(&pointer_path).unwrap()).unwrap();
    pointer["root"] = json!(foreign);
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&pointer_path)
        .unwrap();
    serde_json::to_writer(&mut file, &pointer).unwrap();
    file.sync_all().unwrap();
    drop(file);
    fixture.spawn(&fixture.info("reopen", "before-begin"));
    assert!(
        !fixture.wait_exit().success(),
        "replaced bootstrap must be rejected"
    );
    let rejection = fs::read_to_string(fixture.binding.base.join("reopen.stderr")).unwrap();
    assert!(
        rejection.contains("P4_GUARD_BOOTSTRAP"),
        "wrong bootstrap rejection: {rejection}"
    );
    let entries: Vec<_> = fs::read_dir(&foreign)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(entries, ["sentinel.json"]);
    let sentinel: Value =
        serde_json::from_reader(File::open(foreign.join("sentinel.json")).unwrap()).unwrap();
    assert_eq!(sentinel, json!({"untouched":true}));
    assert_eq!(super::table_snapshot(&workspace), baseline);
    assert_eq!(fixture.counter(), [0, 0]);
    assert_eq!(jsonl(&fixture.binding.base.join("model.jsonl")).len(), 1);
    assert!(!fixture
        .events
        .iter()
        .any(|event| event["type"] == "read_summary"));
    fixture.assert_model();
}

#[test]
fn host_crash_recovery_matrix() {
    if let Some(path) = std::env::var_os(CHILD_INFO) {
        child_main(guarded_info(Path::new(&path)));
        return;
    }
    assert!(owner_nonce_is_uuid_v4(
        "70e805a2-1b35-440f-86fa-029d09e7685c"
    ));
    for invalid in [
        "70e805a21b35440f86fa029d09e7685c0000000000000000",
        "70e805a2x1b35-440f-86fa-029d09e7685c",
        "70e805a2-1b35-140f-86fa-029d09e7685c",
        "70e805a2-1b35-440f-76fa-029d09e7685c",
        "70e805a2-1b35-440f-86fa-029d09e7685g",
    ] {
        assert!(!owner_nonce_is_uuid_v4(invalid));
    }
    for variant in [
        "before-begin",
        "after-begin",
        "before-response",
        "after-response",
        "after-response-error",
        "after-ack",
    ] {
        matrix_case(variant);
    }
    for variant in [
        "guard-marker",
        "guard-parent",
        "guard-port",
        "guard-preexisting",
    ] {
        guard_case(variant);
    }
    bootstrap_guard_case();
}
