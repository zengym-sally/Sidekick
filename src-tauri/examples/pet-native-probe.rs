use serde::{Deserialize, Serialize};
use serde_json::json;
use std::borrow::Cow;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{
    Assets, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Wry,
};

#[path = "../src/app/tray_icon.rs"]
mod tray_icon;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}

#[derive(Default)]
struct Shape {
    mask: Vec<u8>,
    left: f64,
    top: f64,
    dock: i8,
    collapsed: bool,
    ignored: bool,
    pose: String,
    drag_generation: u64,
}
#[derive(Clone, Copy)]
struct ProbeArea {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}
fn dock_after_release(previous: i8, x: f64, width: f64, area: ProbeArea) -> i8 {
    if area.width < width {
        return 0;
    }
    let left = x - area.left;
    let right = area.left + area.width - x - width;
    let near_left = left <= if previous < 0 { 32.0 } else { 20.0 };
    let near_right = right <= if previous > 0 { 32.0 } else { 20.0 };
    match (near_left, near_right) {
        (true, true) => {
            if left.abs() <= right.abs() {
                -1
            } else {
                1
            }
        }
        (true, false) => -1,
        (false, true) => 1,
        (false, false) => 0,
    }
}
impl Shape {
    fn hit(&self, window_x: f64, window_y: f64) -> bool {
        if !(0.0..192.0).contains(&window_x) || !(0.0..192.0).contains(&window_y) {
            return false;
        }
        let (x, y) = (window_x - self.left, window_y - self.top);
        (0.0..112.0).contains(&x)
            && (0.0..112.0).contains(&y)
            && self.mask.get(y as usize * 112 + x as usize) == Some(&1)
    }
    fn refresh(
        &mut self,
        pointer: Option<(f64, f64)>,
        mut apply: impl FnMut(bool) -> bool,
    ) -> Option<bool> {
        let Some((x, y)) = pointer else {
            if apply(false) {
                self.ignored = false;
            }
            return None;
        };
        let inside = self.hit(x, y);
        if self.ignored == inside {
            if !apply(!inside) {
                return None;
            }
            self.ignored = !inside;
        }
        Some(inside)
    }
}
struct Probe {
    shape: Mutex<Shape>,
    dragging: AtomicBool,
    menu: AtomicBool,
    stop: AtomicBool,
    hit_enabled: AtomicBool,
    cancel_next: AtomicBool,
    paused: Mutex<bool>,
    wake: Condvar,
    started: Instant,
}
impl Probe {
    fn new() -> Self {
        Self {
            shape: Mutex::new(Shape {
                left: 40.0,
                top: 30.0,
                pose: "idle".into(),
                ..Default::default()
            }),
            dragging: AtomicBool::new(false),
            menu: AtomicBool::new(false),
            stop: AtomicBool::new(false),
            hit_enabled: AtomicBool::new(false),
            cancel_next: AtomicBool::new(false),
            paused: Mutex::new(false),
            wake: Condvar::new(),
            started: Instant::now(),
        }
    }
    fn request_stop(&self) {
        let _paused = self.paused.lock().unwrap();
        self.stop.store(true, Ordering::SeqCst);
        self.wake.notify_all();
    }
}
fn supervise_deadline(
    started: Instant,
    budget: Duration,
    grace: Duration,
    request_exit: impl FnOnce() + Send + 'static,
) {
    let soft = budget
        .saturating_sub(grace)
        .saturating_sub(started.elapsed());
    std::thread::sleep(soft);
    let _request = std::thread::Builder::new()
        .name("pet-probe-exit".into())
        .spawn(request_exit);
    std::thread::sleep(budget.saturating_sub(started.elapsed()));
    std::process::exit(124);
}
fn note(probe: &Probe, event: &str, detail: serde_json::Value) {
    println!(
        "{}",
        json!({"event":event,"elapsedMs":probe.started.elapsed().as_millis(),"detail":detail})
    );
}
fn button_down() -> bool {
    unsafe { CGEventSourceButtonState(0, 0) }
}
fn layout(window: &WebviewWindow, shape: &mut Shape, collapsed: bool) {
    shape.collapsed = collapsed;
    shape.left = match (shape.dock, collapsed) {
        (-1, true) => -56.0,
        (-1, false) => 0.0,
        (1, true) => 136.0,
        (1, false) => 80.0,
        _ => 40.0,
    };
    let _ = window.eval(format!("window.probeView?.({},{});", shape.left, shape.top));
}
fn hide_probe(app: &tauri::AppHandle, expected: Option<u64>, event: &str) -> Result<(), String> {
    let state = app.state::<Arc<Probe>>();
    let pet = app.get_webview_window("pet").ok_or("pet missing")?;
    let mut shape = state.shape.lock().unwrap();
    let down = button_down();
    if state.stop.load(Ordering::SeqCst)
        || expected.is_some_and(|generation| {
            generation != shape.drag_generation || !state.dragging.load(Ordering::SeqCst) || !down
        })
    {
        return Ok(());
    }
    pet.hide().map_err(|e| e.to_string())?;
    shape.drag_generation += 1;
    state.dragging.store(false, Ordering::SeqCst);
    *state.paused.lock().unwrap() = true;
    drop(shape);
    note(
        &state,
        event,
        json!({"buttonDown":down,"expectedGeneration":expected}),
    );
    Ok(())
}
#[tauri::command]
fn probe_note(window: WebviewWindow, state: State<'_, Arc<Probe>>, event: String) {
    if window.label() == "main" && event == "underlay-click" {
        note(&state, &event, json!({}));
    }
}
#[tauri::command]
fn probe_mask(
    window: WebviewWindow,
    state: State<'_, Arc<Probe>>,
    mask: Vec<u8>,
    pose: String,
) -> Result<(), String> {
    if window.label() != "pet" || mask.len() != 112 * 112 || mask.iter().any(|v| *v > 1) {
        return Err("invalid probe mask".into());
    }
    let opaque = {
        let mut shape = state.shape.lock().unwrap();
        if shape.pose != pose {
            return Err("stale probe pose".into());
        }
        shape.mask = mask;
        shape.mask.iter().filter(|v| **v == 1).count()
    };
    note(
        &state,
        "mask-ready",
        json!({"width":112,"height":112,"opaque":opaque,"pose":pose}),
    );
    Ok(())
}
#[tauri::command]
async fn probe_action(
    window: WebviewWindow,
    action: String,
    input: Option<ProbeInput>,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    let state = app.state::<Arc<Probe>>();
    let pet = app.get_webview_window("pet").ok_or("pet missing")?;
    match action.as_str() {
        "drag" if window.label() == "pet" => {
            let age = input.as_ref().map(|event| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .saturating_sub(event.sent_at_ms as u128)
            });
            note(
                &state,
                "drag-request",
                json!({"buttonDown":button_down(),"input":input,"messageAgeMs":age}),
            );
            if !button_down() || state.menu.load(Ordering::SeqCst) {
                return Err("drag without held button".into());
            }
            let (generation, superseded) = {
                let mut shape = state.shape.lock().unwrap();
                layout(&pet, &mut shape, false);
                let superseded = state
                    .dragging
                    .load(Ordering::SeqCst)
                    .then_some(shape.drag_generation);
                shape.drag_generation += 1;
                state.dragging.store(true, Ordering::SeqCst);
                (shape.drag_generation, superseded)
            };
            if let Some(previous) = superseded {
                note(&state, "drag-superseded", json!({"generation":previous}));
            }
            note(
                &state,
                "drag-start",
                json!({"buttonDown":true,"position":pet.outer_position().ok(),"generation":generation}),
            );
            if let Err(error) = pet.start_dragging() {
                state.dragging.store(false, Ordering::SeqCst);
                note(&state, "drag-error", json!({}));
                return Err(error.to_string());
            }
            note(
                &state,
                "drag-api-return",
                json!({"buttonDown":button_down()}),
            );
            if state.cancel_next.swap(false, Ordering::SeqCst) {
                let cancel_app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(500));
                    let _ = hide_probe(&cancel_app, Some(generation), "drag-cancelled");
                });
            }
        }
        "menu" if window.label() == "pet" => {
            if state.menu.swap(true, Ordering::SeqCst) {
                return Ok(());
            }
            let result = (|| -> Result<(), String> {
                pet.set_ignore_cursor_events(false)
                    .map_err(|e| e.to_string())?;
                state.shape.lock().unwrap().ignored = false;
                let expand =
                    MenuItem::with_id(&app, "probe-dock-left", "靠左半隐", true, None::<&str>)
                        .map_err(|e| e.to_string())?;
                let right =
                    MenuItem::with_id(&app, "probe-dock-right", "靠右半隐", true, None::<&str>)
                        .map_err(|e| e.to_string())?;
                let hide = MenuItem::with_id(&app, "probe-hide", "隐藏班班", true, None::<&str>)
                    .map_err(|e| e.to_string())?;
                let menu =
                    Menu::with_items(&app, &[&expand, &right, &hide]).map_err(|e| e.to_string())?;
                note(&state, "menu-open", json!({}));
                pet.popup_menu(&menu).map_err(|e| e.to_string())
            })();
            state.menu.store(false, Ordering::SeqCst);
            note(&state, "menu-closed", json!({"ok":result.is_ok()}));
            result?;
        }
        "show" if window.label() == "main" => {
            pet.set_ignore_cursor_events(false)
                .map_err(|e| e.to_string())?;
            {
                let mut shape = state.shape.lock().unwrap();
                shape.ignored = false;
                shape.drag_generation += 1;
                state.dragging.store(false, Ordering::SeqCst);
            }
            pet.show().map_err(|e| e.to_string())?;
            *state.paused.lock().unwrap() = false;
            state.wake.notify_all();
            note(&state, "shown", json!({}));
        }
        "quit" if window.label() == "main" => {
            state.request_stop();
            app.exit(0);
        }
        "hit" if window.label() == "pet" || window.label() == "main" => {
            state.hit_enabled.store(true, Ordering::SeqCst);
            note(&state, "hit-enabled", json!({}));
        }
        "arm-cancel" if window.label() == "main" => {
            state.cancel_next.store(true, Ordering::SeqCst);
            note(&state, "cancel-armed", json!({}));
        }
        "pose-idle" | "pose-found" | "pose-remind" | "pose-done" if window.label() == "main" => {
            let pose = action.strip_prefix("pose-").unwrap();
            pet.set_ignore_cursor_events(false)
                .map_err(|e| e.to_string())?;
            {
                let mut shape = state.shape.lock().unwrap();
                shape.pose = pose.into();
                shape.mask.clear();
                shape.ignored = false;
            }
            pet.eval(format!(
                "window.probePose?.({});",
                serde_json::to_string(pose).unwrap()
            ))
            .map_err(|e| e.to_string())?;
            note(&state, "pose-request", json!({"pose":pose}));
        }
        _ => return Err("invalid probe action".into()),
    }
    Ok(())
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProbeInput {
    buttons: u16,
    client_x: f64,
    client_y: f64,
    sent_at_ms: u64,
    trusted: bool,
}
struct ProbeAssets;
impl Assets<Wry> for ProbeAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let bytes: &[u8] = match key.as_ref() {
            "/index.html" => include_bytes!("../../tests/fixtures/pet-native/index.html"),
            "/probe.js" => include_bytes!("../../tests/fixtures/pet-native/probe.js"),
            "/banban.svg" => include_bytes!("../../src/assets/brand/banban-idle.svg"),
            "/banban-found.svg" => include_bytes!("../../src/assets/brand/banban-found.svg"),
            "/banban-remind.svg" => include_bytes!("../../src/assets/brand/banban-remind.svg"),
            "/banban-done.svg" => include_bytes!("../../src/assets/brand/banban-done.svg"),
            _ => return None,
        };
        Some(Cow::Borrowed(bytes))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
fn main() {
    let lifetime = Instant::now();
    let app_slot = Arc::new(OnceLock::<tauri::AppHandle>::new());
    let deadline_app = app_slot.clone();
    std::thread::spawn(move || {
        supervise_deadline(
            lifetime,
            Duration::from_secs(600),
            Duration::from_secs(2),
            move || {
                if let Some(app) = deadline_app.get() {
                    app.exit(124);
                }
            },
        )
    });
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = None;
    context.set_assets(Box::new(ProbeAssets));
    tauri::Builder::default()
        .manage(Arc::new(Probe::new()))
        .invoke_handler(tauri::generate_handler![probe_note,probe_mask,probe_action])
        .on_menu_event(|app,event|{
            let state=app.state::<Arc<Probe>>();
            let Some(pet)=app.get_webview_window("pet") else{return};
            match event.id.as_ref(){
                "probe-quit"=>{state.request_stop();app.exit(0);}
                "probe-hide"=>{let _=hide_probe(app,None,"hidden");}
                "probe-dock-left" | "probe-dock-right"=>{
                    if let Ok(Some(monitor))=pet.current_monitor(){
                        let area=monitor.work_area().position.to_logical::<f64>(monitor.scale_factor());
                        let position=pet.outer_position().unwrap().to_logical::<f64>(pet.scale_factor().unwrap());
                        let size=monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
                        let right=event.id.as_ref()=="probe-dock-right";
                        let x=if right{area.x+size.width-192.0}else{area.x};
                        let y=position.y.clamp(area.y,(area.y+size.height-192.0).max(area.y));
                        let _=pet.set_position(LogicalPosition::new(x,y));
                        let mut shape=state.shape.lock().unwrap();shape.dock=if right{1}else{ -1 };layout(&pet,&mut shape,true);
                        note(&state,if right{"docked-right"}else{"docked-left"},json!({}));
                    }
                }
                _=>{}
            }
        })
        .setup(move|app|{
            let _=app_slot.set(app.handle().clone());
            let quit=MenuItem::with_id(app,"probe-quit","结束班班探针",true,None::<&str>)?;
            let menu=Menu::with_items(app,&[&quit])?;
            tauri::tray::TrayIconBuilder::new().icon(tray_icon::image()).icon_as_template(true).tooltip("班班隔离原生探针").menu(&menu).build(app)?;
            let underlay=WebviewWindowBuilder::new(app,"main",WebviewUrl::App("index.html?underlay".into())).title("班班隔离原生探针").position(100.0,150.0).inner_size(720.0,600.0).visible(false).incognito(true).build()?;
            if let Some(monitor)=underlay.primary_monitor()?{
                let area=monitor.work_area();let scale=monitor.scale_factor();
                let position=area.position.to_logical::<f64>(scale);let size=area.size.to_logical::<f64>(scale);
                let outer=underlay.outer_size()?.to_logical::<f64>(underlay.scale_factor()?);let inner=underlay.inner_size()?.to_logical::<f64>(underlay.scale_factor()?);
                underlay.set_position(position)?;underlay.set_size(LogicalSize::new((size.width-(outer.width-inner.width)).max(320.0),(size.height-(outer.height-inner.height)).max(240.0)))?;
            }
            underlay.show()?;
            let pet=WebviewWindowBuilder::new(app,"pet",WebviewUrl::App("index.html".into())).title("班班原生命中探针").position(300.0,350.0).inner_size(192.0,192.0).resizable(false).decorations(false).transparent(true).shadow(false).always_on_top(true).skip_taskbar(true).incognito(true).build()?;
            let monitors=pet.available_monitors()?;
            note(&app.state::<Arc<Probe>>(),"ready",json!({"pid":std::process::id(),"monitors":monitors.iter().map(|m|json!({"scale":m.scale_factor(),"workArea":m.work_area()})).collect::<Vec<_>>()}));
            let handle=app.handle().clone();
            std::thread::spawn(move||{
                loop{
                    std::thread::sleep(Duration::from_millis(50));
                    let state=handle.state::<Arc<Probe>>();
                    let mut paused=state.paused.lock().unwrap();
                    while *paused && !state.stop.load(Ordering::SeqCst){paused=state.wake.wait(paused).unwrap();}
                    drop(paused);
                    if state.stop.load(Ordering::SeqCst){break;}
                    if state.dragging.load(Ordering::SeqCst){
                        let generation=state.shape.lock().unwrap().drag_generation;
                        if !button_down(){
                            let position=pet.outer_position().ok();
                            let geometry=position.and_then(|physical|{
                                let monitor=pet.current_monitor().ok()??;let scale=monitor.scale_factor();
                                let origin=monitor.work_area().position.to_logical::<f64>(scale);let size=monitor.work_area().size.to_logical::<f64>(scale);
                                Some((physical.to_logical::<f64>(pet.scale_factor().ok()?),ProbeArea{left:origin.x,top:origin.y,width:size.width,height:size.height}))
                            });
                            let mut shape=state.shape.lock().unwrap();
                            if shape.drag_generation==generation && !button_down() && state.dragging.swap(false,Ordering::SeqCst){
                                if let Some((point,area))=geometry{
                                    let previous_left=shape.left;
                                    shape.dock=dock_after_release(shape.dock,point.x,192.0,area);
                                    let next_left=if shape.dock<0{0.0}else if shape.dock>0{80.0}else{40.0};
                                    let x=if shape.dock<0{area.left}else if shape.dock>0{area.left+area.width-192.0}else{point.x+previous_left-next_left};
                                    let x=if area.width>=192.0{x.clamp(area.left,area.left+area.width-192.0)}else{area.left+(area.width-192.0)/2.0};
                                    let y=if area.height>=192.0{point.y.clamp(area.top,area.top+area.height-192.0)}else{area.top+area.height/2.0-86.0};
                                    if pet.set_position(LogicalPosition::new(x,y)).is_err(){shape.dock=0;state.hit_enabled.store(false,Ordering::SeqCst);shape.refresh(None,|ignored|pet.set_ignore_cursor_events(ignored).is_ok());}
                                }
                                else{shape.dock=0;state.hit_enabled.store(false,Ordering::SeqCst);shape.refresh(None,|ignored|pet.set_ignore_cursor_events(ignored).is_ok());}
                                layout(&pet,&mut shape,false);let dock=shape.dock;
                                drop(shape);note(&state,"drag-released",json!({"buttonDown":false,"position":position,"generation":generation,"dock":dock}));
                            }
                        }
                        continue;
                    }
                    if !state.hit_enabled.load(Ordering::SeqCst) || state.menu.load(Ordering::SeqCst) || !pet.is_visible().unwrap_or(false){continue;}
                    let geometry=(||{
                        let primary=pet.primary_monitor().ok()??;
                        let cursor=pet.cursor_position().ok()?.to_logical::<f64>(primary.scale_factor());
                        let position=pet.outer_position().ok()?.to_logical::<f64>(pet.scale_factor().ok()?);
                        Some((cursor.x-position.x,cursor.y-position.y))
                    })();
                    let mut shape=state.shape.lock().unwrap();
                    if shape.mask.is_empty(){continue;}
                    let old_ignored=shape.ignored;
                    let Some(inside)=shape.refresh(geometry,|ignored|pet.set_ignore_cursor_events(ignored).is_ok()) else{
                        state.hit_enabled.store(false,Ordering::SeqCst);layout(&pet,&mut shape,false);note(&state,"hit-suspended",json!({}));continue;
                    };
                    if old_ignored!=shape.ignored{note(&state,if inside{"hit-restored"}else{"transparent"},json!({}));}
                    let (local_x,local_y)=geometry.unwrap();
                    let hover=if shape.collapsed{inside}else{let full_left=if shape.dock<0{0.0}else{80.0};local_x>=full_left&&local_x<=full_left+112.0&&local_y>=shape.top&&local_y<=shape.top+112.0};
                    if shape.dock!=0 && shape.collapsed==hover{layout(&pet,&mut shape,!hover);note(&state,if hover{"expanded"}else{"collapsed"},json!({}));}
                }
            });
            Ok(())
        })
        .build(context).expect("pet native probe failed")
        .run(|app,event|{if matches!(event,tauri::RunEvent::Exit){app.state::<Arc<Probe>>().request_stop();}});
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> ProbeArea {
        ProbeArea {
            left: 0.0,
            top: 33.0,
            width: 1000.0,
            height: 800.0,
        }
    }
    #[test]
    fn dragging_away_from_left_edge_releases_docking() {
        assert_eq!(dock_after_release(-1, 300.0, 192.0, area()), 0);
    }
    #[test]
    fn dragging_away_from_right_edge_releases_docking() {
        assert_eq!(dock_after_release(1, 300.0, 192.0, area()), 0);
    }
    #[test]
    fn released_docking_uses_detachment_hysteresis() {
        assert_eq!(dock_after_release(-1, 31.0, 192.0, area()), -1);
        assert_eq!(dock_after_release(-1, 33.0, 192.0, area()), 0);
        assert_eq!(dock_after_release(1, 777.0, 192.0, area()), 1);
        assert_eq!(dock_after_release(1, 775.0, 192.0, area()), 0);
    }
    #[test]
    fn a_free_drop_only_snaps_within_the_work_area_threshold() {
        assert_eq!(dock_after_release(0, 20.0, 192.0, area()), -1);
        assert_eq!(dock_after_release(0, 21.0, 192.0, area()), 0);
        assert_eq!(dock_after_release(0, 788.0, 192.0, area()), 1);
        assert_eq!(dock_after_release(0, 787.0, 192.0, area()), 0);
    }

    #[test]
    fn cropped_artwork_cannot_capture_points_outside_its_window() {
        let mut shape = Shape {
            mask: vec![1; 112 * 112],
            left: -56.0,
            top: 30.0,
            ..Default::default()
        };
        assert!(shape.hit(20.0, 50.0));
        assert!(!shape.hit(-1.0, 50.0));
        shape.left = 136.0;
        assert!(shape.hit(180.0, 50.0));
        assert!(!shape.hit(193.0, 50.0));
    }
    #[test]
    fn transparent_artwork_remains_outside_the_hit_region() {
        let mut shape = Shape {
            mask: vec![1; 112 * 112],
            left: 40.0,
            top: 30.0,
            ..Default::default()
        };
        shape.mask[20 * 112 + 20] = 0;
        assert!(!shape.hit(60.0, 50.0));
        assert!(shape.hit(61.0, 50.0));
    }

    #[test]
    fn unavailable_coordinates_restore_both_cached_and_native_input() {
        let mut shape = Shape {
            mask: vec![1; 112 * 112],
            left: 40.0,
            top: 30.0,
            ignored: true,
            ..Default::default()
        };
        let mut native_ignored = true;
        assert_eq!(
            shape.refresh(None, |value| {
                native_ignored = value;
                true
            }),
            None
        );
        assert!(!shape.ignored && !native_ignored);
        assert_eq!(
            shape.refresh(Some((0.0, 0.0)), |value| {
                native_ignored = value;
                true
            }),
            Some(false)
        );
        assert!(shape.ignored && native_ignored);
        assert_eq!(shape.refresh(Some((60.0, 50.0)), |_| false), None);
        assert!(shape.ignored);
    }

    #[test]
    fn watchdog_finishes_after_graceful_shutdown() {
        watchdog_child_status("graceful", 0);
    }

    #[test]
    #[ignore = "executed only by the bounded watchdog parent"]
    fn watchdog_forced_exit_child() {
        let mode = std::env::var("SIDEKICK_PET_WATCHDOG_CHILD").unwrap();
        assert!(["graceful", "blocked", "stopped", "startup"].contains(&mode.as_str()));
        if mode == "graceful" {
            supervise_deadline(
                Instant::now(),
                Duration::from_millis(200),
                Duration::from_millis(100),
                || std::process::exit(0),
            );
        } else if mode == "startup" {
            let started = Instant::now();
            std::thread::spawn(move || {
                supervise_deadline(
                    started,
                    Duration::from_millis(200),
                    Duration::from_millis(100),
                    std::thread::park,
                )
            });
            std::thread::park();
        } else {
            let probe = Probe::new();
            if mode == "stopped" {
                probe.request_stop();
                assert!(probe.stop.load(Ordering::SeqCst));
            }
            supervise_deadline(
                Instant::now(),
                Duration::from_millis(200),
                Duration::from_millis(100),
                std::thread::park,
            );
        }
        panic!("watchdog returned without terminating a blocked probe");
    }

    #[test]
    fn watchdog_terminates_its_own_blocked_process() {
        watchdog_child_status("blocked", 124);
    }
    #[test]
    fn stopping_polling_cannot_cancel_process_deadline() {
        watchdog_child_status("stopped", 124);
    }
    #[test]
    fn blocked_startup_cannot_prevent_process_deadline() {
        watchdog_child_status("startup", 124);
    }
    fn watchdog_child_status(mode: &str, expected: i32) {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "tests::watchdog_forced_exit_child", "--ignored"])
            .env("SIDEKICK_PET_WATCHDOG_CHILD", mode)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let started = Instant::now();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert_eq!(status.code(), Some(expected));
                break;
            }
            if started.elapsed() > Duration::from_secs(3) {
                let _ = child.kill();
                let _ = child.wait();
                panic!("watchdog exceeded its test bound");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
