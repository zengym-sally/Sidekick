use super::{desktop, pet_commands};
use crate::{
    local_store::{CandidateDraft, SignChoice, StoreError, TextInput, TodoInput},
    pet_ui_root::PetUiRoot,
    store_commands::{self, LocalState},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Listener, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Read,
    UnderlayClick,
    Show,
    Hide,
    Found,
    DelayedFound,
    DelayedDone,
    SignOne,
    DiscardOne,
    DiscardAll,
    Done,
    ReplayDone,
    Reopen,
    WorkMode,
    Quit,
}
struct Fixture {
    sequence: u64,
    pending: Vec<(String, i64)>,
    completed: Option<(String, i64, String)>,
    work_mode: bool,
}
fn input(title: &str) -> TodoInput {
    TodoInput {
        title: title.into(),
        kind: "action".into(),
        owner: "我".into(),
        priority: "medium".into(),
        due: None,
        followup: None,
        tags: vec![],
    }
}
fn refused() -> StoreError {
    StoreError {
        code: "PET_VERIFY_CALLER",
        message: "隔离验收操作不匹配。",
    }
}
#[tauri::command]
async fn pet_ui_action(
    window: WebviewWindow,
    state: State<'_, LocalState>,
    fixture: State<'_, Arc<std::sync::Mutex<Fixture>>>,
    action: Action,
) -> Result<Value, StoreError> {
    let url = window.url().map_err(|_| refused())?;
    if window.label() != "main"
        || url.path() != "/pet-console.html"
        || url.host_str() != Some("localhost")
        || url.scheme() != "tauri"
    {
        return Err(refused());
    }
    let app = window.app_handle();
    match action {
        Action::Show => desktop::perform(app, desktop::WindowAction::ShowPet)?,
        Action::Hide => desktop::perform(app, desktop::WindowAction::HidePet)?,
        Action::Quit => {
            desktop::stop_pet(app);
            app.exit(0);
            return Ok(json!({"stopping":true}));
        }
        Action::Read => {
            state.access(|_| Ok(()))?;
        }
        Action::UnderlayClick => {
            let pet = app
                .state::<desktop::DesktopState>()
                .pet
                .clone()
                .ok_or_else(refused)?;
            println!(
                "{}",
                json!({"event":"pet-ui-underlay-click","snapshot":pet.snapshot()})
            );
        }
        Action::DelayedFound | Action::DelayedDone => {
            let state = state.inner().clone();
            let fixture = fixture.inner().clone();
            let next = if matches!(action, Action::DelayedFound) {
                Action::Found
            } else {
                Action::Done
            };
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                let result = fixture_action(&state, &fixture, next);
                println!(
                    "{}",
                    json!({"event":"pet-ui-delayed-commit","ok":result.is_ok(),"code":result.err().map(|e|e.code)})
                );
            });
        }
        _ => fixture_action(&state, &fixture, action)?,
    }
    let pet = app
        .state::<desktop::DesktopState>()
        .pet
        .clone()
        .ok_or_else(refused)?;
    let policy = {
        let inner = pet.lock().map_err(|_| refused())?;
        json!({"clientReady":inner.client_ready,"pageVisible":inner.page_visible,"reducedMotion":inner.reduced_motion,"painted":inner.painted(),"keyboardFocused":inner.keyboard_focused})
    };
    Ok(
        json!({"policy":policy,"pet":pet.snapshot(),"mainVisible":app.get_webview_window("main").is_some_and(|w|w.is_visible().unwrap_or(false)),"quickVisible":app.get_webview_window("quick").is_some_and(|w|w.is_visible().unwrap_or(false))}),
    )
}

fn fixture_action(
    state: &LocalState,
    fixture: &std::sync::Mutex<Fixture>,
    action: Action,
) -> Result<(), StoreError> {
    let mut fixture = fixture.lock().map_err(|_| refused())?;
    fixture.sequence += 1;
    let seq = fixture.sequence;
    state.access(|store| {
        match action {
            Action::Found => {
                let batch = store.begin_import(
                    TextInput {
                        text: format!("合成待确认资料 {seq}"),
                        source_at_ms: None,
                        time_zone: "UTC".into(),
                    },
                    json!({"modelId":"fixture","apiModelId":"deployment"}),
                    false,
                )?;
                let draft = CandidateDraft {
                    fields: input(&format!("合成候选 {seq}")),
                    evidence: "合成待确认资料".into(),
                    due_expression: None,
                    followup_expression: None,
                    warnings: vec![],
                    unresolved: false,
                };
                let published =
                    store.publish_candidates(&batch.run.ok_or_else(refused)?.id, vec![draft])?;
                fixture
                    .pending
                    .extend(published.candidates.into_iter().map(|c| (c.id, c.version)));
            }
            Action::SignOne => {
                if let Some((id, version)) = fixture.pending.first().cloned() {
                    let candidate = store.candidate(&id)?;
                    store.sign_candidates(
                        vec![SignChoice {
                            candidate_id: id,
                            expected_version: version,
                            fields: candidate.draft.fields,
                            time_reviewed: true,
                            target: None,
                        }],
                        &format!("sign-{seq}"),
                    )?;
                    fixture.pending.remove(0);
                }
            }
            Action::DiscardOne | Action::DiscardAll => {
                let count = if matches!(action, Action::DiscardOne) {
                    fixture.pending.len().min(1)
                } else {
                    fixture.pending.len()
                };
                for _ in 0..count {
                    let (id, version) = fixture.pending[0].clone();
                    store.discard_candidate(&id, version, &format!("discard-{seq}-{id}"))?;
                    fixture.pending.remove(0);
                }
            }
            Action::Done => {
                let todo = store.create(
                    input(&format!("合成完成事项 {seq}")),
                    &format!("create-{seq}"),
                )?;
                let op = format!("complete-{seq}");
                store.set_completed(&todo.id, todo.version, true, &op)?;
                fixture.completed = Some((todo.id, todo.version, op));
            }
            Action::ReplayDone => {
                if let Some((id, version, op)) = &fixture.completed {
                    store.set_completed(id, *version, true, op)?;
                }
            }
            Action::Reopen => {
                if let Some((id, _, _)) = &fixture.completed {
                    let current = store
                        .list()?
                        .into_iter()
                        .find(|todo| &todo.id == id)
                        .ok_or_else(refused)?;
                    store.set_completed(id, current.version, false, &format!("reopen-{seq}"))?;
                }
            }
            Action::WorkMode => {
                let current = store.desktop_preferences()?;
                fixture.work_mode = !fixture.work_mode;
                store.save_desktop_preferences(crate::local_store::DesktopPreferencesInput {
                    preferences: crate::local_store::DesktopPreferences {
                        work_mode: fixture.work_mode,
                        ..current.clone()
                    },
                    expected: current,
                })?;
            }
            _ => {}
        }
        Ok(())
    })?;
    Ok(())
}
pub(crate) fn run() {
    let started = Instant::now();
    let slot = Arc::new(OnceLock::<tauri::AppHandle>::new());
    let deadline = slot.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(1798).saturating_sub(started.elapsed()));
        std::thread::spawn(move || {
            if let Some(app) = deadline.get() {
                app.exit(124);
            }
        });
        std::thread::sleep(Duration::from_secs(1800).saturating_sub(started.elapsed()));
        std::process::exit(124);
    });
    if cfg!(feature = "s33-mcp-verification")
        || cfg!(feature = "s33-mcp-ui-verification")
        || std::env::args().skip(1).collect::<Vec<_>>() != ["--pet-ui-verify"]
    {
        eprintln!("Pet UI verification requires its dedicated entry and cannot mix S33 features");
        std::process::exit(2);
    }
    let (root, state) = PetUiRoot::create().expect("Fresh pet UI root failed");
    println!(
        "{}",
        json!({"event":"pet-ui-root","pid":std::process::id(),"directory":root.directory,"retained":true})
    );
    let mut context = super::context();
    if context.config().build.dev_url.is_some() || !context.config().app.windows.is_empty() {
        eprintln!("Pet UI requires prepared local assets and no configured windows");
        std::process::exit(2);
    }
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(root)
        .manage(state)
        .manage(Arc::new(std::sync::Mutex::new(Fixture {
            sequence: 0,
            pending: vec![],
            completed: None,
            work_mode: false,
        })))
        .invoke_handler(tauri::generate_handler![
            pet_ui_action,
            desktop::desktop_window_action,
            desktop::read_desktop_status,
            desktop::read_desktop_preferences,
            pet_commands::read_pet_state,
            pet_commands::attach_pet_client,
            pet_commands::set_pet_hit_mask,
            pet_commands::confirm_pet_presentation,
            pet_commands::set_pet_policy,
            pet_commands::claim_pet_feedback,
            pet_commands::prepare_pet_menu,
            pet_commands::popup_pet_menu,
            pet_commands::prepare_pet_drag,
            pet_commands::start_pet_drag,
            store_commands::workspace_info,
            store_commands::read_application_settings,
            store_commands::create_todo
        ])
        .setup(move |app| {
            let _ = slot.set(app.handle().clone());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("pet-console.html".into()))
                .title("班班正式 UI 隔离验收")
                .inner_size(920.0, 720.0)
                .incognito(true)
                .build()?;
            desktop::setup(app)?;
            desktop::perform(app.handle(), desktop::WindowAction::ShowPet)
                .map_err(|e| std::io::Error::other(e.message))?;
            for name in ["pet-view-changed", "pet-state-changed", "pet-feedback"] {
                app.listen_any(name, move |event| {
                    println!("{}", json!({"event":name,"payload":event.payload()}))
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(_)) {
                desktop::sync_pet_visibility(window.app_handle());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.hide().is_ok() && window.label() == "pet" {
                    desktop::pet_hidden(window.app_handle());
                }
            }
        })
        .build(context)
        .expect("Pet UI verification failed")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                desktop::stop_pet(app);
            }
        });
}
