use super::pet_state::{Edge, Event, PetState, View};
use crate::local_store::StoreError;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewWindow};

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}
pub(crate) fn button_down() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { CGEventSourceButtonState(0, 0) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
pub(crate) fn failure() -> StoreError {
    StoreError {
        code: "PET_WINDOW",
        message: "班班窗口暂不可操作，请从菜单栏重新显示。",
    }
}
#[derive(Clone, Copy, Debug)]
struct Area {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}
impl Area {
    fn distance(self, x: f64, y: f64) -> f64 {
        let dx = (self.left - x).max(0.0).max(x - self.left - self.width);
        let dy = (self.top - y).max(0.0).max(y - self.top - self.height);
        dx * dx + dy * dy
    }
    fn clamp(self, x: f64, y: f64) -> (f64, f64) {
        let x = if self.width >= 192.0 {
            x.clamp(self.left, self.left + self.width - 192.0)
        } else {
            self.left + (self.width - 192.0) / 2.0
        };
        let y = if self.height >= 192.0 {
            y.clamp(self.top, self.top + self.height - 192.0)
        } else {
            self.top + self.height / 2.0 - 86.0
        };
        (x, y)
    }
}
fn geometry(window: &WebviewWindow) -> Option<(f64, f64, Area)> {
    let point = window
        .outer_position()
        .ok()?
        .to_logical::<f64>(window.scale_factor().ok()?);
    let current = window.current_monitor().ok().flatten();
    let monitors = window.available_monitors().ok()?;
    let areas = monitors
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let p = m.work_area().position.to_logical::<f64>(scale);
            let s = m.work_area().size.to_logical::<f64>(scale);
            Area {
                left: p.x,
                top: p.y,
                width: s.width,
                height: s.height,
            }
        })
        .collect::<Vec<_>>();
    let mut best: Option<(Area, f64, bool)> = None;
    for (index, area) in areas.iter().enumerate() {
        let distance = area.distance(point.x + 96.0, point.y + 86.0);
        let preferred = current
            .as_ref()
            .is_some_and(|m| m.position() == monitors[index].position());
        if best.is_none_or(|(_, old, priority)| {
            distance < old || (distance == old && preferred && !priority)
        }) {
            best = Some((*area, distance, preferred));
        }
    }
    Some((point.x, point.y, best?.0))
}
fn release_edge(previous: Edge, x: f64, area: Area) -> Edge {
    if area.width < 192.0 {
        return Edge::Free;
    }
    let left = x - area.left;
    let right = area.left + area.width - x - 192.0;
    match (
        left <= if previous == Edge::Left { 32.0 } else { 20.0 },
        right <= if previous == Edge::Right { 32.0 } else { 20.0 },
    ) {
        (true, true) => {
            if left.abs() <= right.abs() {
                Edge::Left
            } else {
                Edge::Right
            }
        }
        (true, false) => Edge::Left,
        (false, true) => Edge::Right,
        _ => Edge::Free,
    }
}
pub(crate) fn recover(
    window: &WebviewWindow,
    state: &Arc<PetState>,
    showing: bool,
) -> Result<(), StoreError> {
    let (x, y, area) = geometry(window).ok_or_else(failure)?;
    let (next_x, next_y) = area.clamp(x, y);
    let generation = {
        let mut inner = state.lock().map_err(|_| failure())?;
        if inner.view.dragging && !showing {
            return Ok(());
        }
        inner.drag_generation += 1;
        if showing {
            inner.desired_visible = true;
        }
        inner.view.dragging = false;
        inner.view.error = None;
        if x != next_x || y != next_y {
            inner.view.edge = Edge::Free;
        }
        inner.layout(false);
        inner.barrier();
        inner.drag_generation
    };
    input(window, state, false, None)?;
    if x != next_x || y != next_y {
        position(window, state, generation, next_x, next_y)?;
    }
    state.wake.notify_all();
    Ok(())
}
pub(crate) fn position(
    window: &WebviewWindow,
    state: &Arc<PetState>,
    generation: u64,
    x: f64,
    y: f64,
) -> Result<(), StoreError> {
    let target = window.clone();
    let state = state.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(mut inner) = state.lock() {
                if inner
                    .position(generation, || {
                        target.set_position(LogicalPosition::new(x, y)).is_ok()
                    })
                    .is_err()
                {
                    inner.degrade(
                        "班班位置暂不可确认，请从菜单栏重新显示。",
                        |ignore| target.set_ignore_cursor_events(ignore).is_ok(),
                    );
                }
                state.wake.notify_all();
            }
        })
        .map_err(|_| failure())
}
pub(crate) fn visibility(state: &PetState, visible: bool) {
    if let Ok(mut inner) = state.lock() {
        inner.desired_visible = visible;
        inner.view.visible = visible;
        if !visible {
            inner.view.dragging = false;
            inner.view.menu_open = false;
            inner.menu_prepared = None;
            inner.drag_generation += 1;
        }
        inner.layout(false);
        inner.barrier();
        state.wake.notify_all();
    }
}
pub(crate) fn observed_visibility(state: &PetState, visible: bool) -> bool {
    let Ok(mut inner) = state.lock() else {
        return false;
    };
    if inner.view.visible == visible || visible && !inner.desired_visible {
        return false;
    }
    inner.view.visible = visible;
    if !visible {
        inner.view.dragging = false;
        inner.drag_generation += 1;
        inner.keyboard_focused = false;
    }
    inner.layout(false);
    inner.barrier();
    state.wake.notify_all();
    true
}
pub(crate) fn start(app: AppHandle, state: Arc<PetState>) {
    std::thread::spawn(move || {
        let Some(window) = app.get_webview_window("pet") else {
            return;
        };
        let mut last_recover = Instant::now();
        loop {
            let events = {
                let Ok(mut inner) = state.lock() else {
                    break;
                };
                while !inner.stop
                    && inner.events.is_empty()
                    && (!inner.view.visible || inner.menu_popping || inner.view.error.is_some())
                {
                    let Ok(next) = state.wake.wait(inner) else {
                        return;
                    };
                    inner = next;
                }
                if inner.stop {
                    break;
                }
                std::mem::take(&mut inner.events)
            };
            for event in events {
                match event {
                    Event::View(view) => {
                        let _ = app.emit_to("pet", "pet-view-changed", view);
                    }
                    Event::State {
                        workspace_epoch,
                        invalidated_feedback_id,
                    } => {
                        let _=app.emit_to("pet","pet-state-changed",serde_json::json!({"workspaceEpoch":workspace_epoch,"invalidatedFeedbackId":invalidated_feedback_id}));
                    }
                    Event::Feedback(notice) => {
                        let _ = app.emit_to("pet", "pet-feedback", notice);
                    }
                }
            }
            let (view, prepared, popping, generation) = match state.lock() {
                Ok(inner) => (
                    inner.view.clone(),
                    inner.menu_prepared,
                    inner.menu_popping,
                    inner.drag_generation,
                ),
                Err(_) => break,
            };
            if !view.visible || popping || view.error.is_some() {
                continue;
            }
            if prepared.is_some_and(|at| at.elapsed() > Duration::from_secs(2)) {
                if let Ok(mut inner) = state.lock() {
                    if inner.menu_prepared == prepared && !inner.menu_popping {
                        inner.menu_prepared = None;
                        inner.view.menu_open = false;
                        inner.barrier();
                    }
                }
            }
            if view.dragging {
                if !button_down() {
                    let current = geometry(&window);
                    let target = {
                        let Ok(mut inner) = state.lock() else {
                            break;
                        };
                        if inner.drag_generation != generation
                            || !inner.view.dragging
                            || button_down()
                        {
                            None
                        } else {
                            inner.view.dragging = false;
                            let target = current.map(|(x, y, area)| {
                                let previous_left = inner.view.artwork_left;
                                inner.view.edge = release_edge(inner.view.edge, x, area);
                                inner.layout(false);
                                let x = match inner.view.edge {
                                    Edge::Left => area.left,
                                    Edge::Right => area.left + area.width - 192.0,
                                    Edge::Free => x + previous_left - inner.view.artwork_left,
                                };
                                area.clamp(x, y)
                            });
                            if target.is_none() {
                                inner.view.edge = Edge::Free;
                                inner.layout(false);
                                inner.view.error = Some("位置暂不可确认，请从菜单栏重新显示班班。");
                            }
                            inner.barrier();
                            target
                        }
                    };
                    if let Some((x, y)) = target {
                        if position(&window, &state, generation, x, y).is_err() {
                            suspend(&window, &state);
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            match window.is_visible() {
                Ok(false) => {
                    observed_visibility(&state, false);
                    continue;
                }
                Err(_) => {
                    suspend(&window, &state);
                    continue;
                }
                Ok(true) => {}
            }
            if last_recover.elapsed() >= Duration::from_secs(2) {
                last_recover = Instant::now();
                if let Some((x, y, area)) = geometry(&window) {
                    let (nx, ny) = area.clamp(x, y);
                    if x != nx || y != ny {
                        let _ = recover(&window, &state, false);
                    }
                } else {
                    suspend(&window, &state);
                }
            }
            let pointer = (|| {
                let primary = window.primary_monitor().ok()??;
                let cursor = window
                    .cursor_position()
                    .ok()?
                    .to_logical::<f64>(primary.scale_factor());
                let point = window
                    .outer_position()
                    .ok()?
                    .to_logical::<f64>(window.scale_factor().ok()?);
                Some((cursor.x - point.x, cursor.y - point.y))
            })();
            let desired = {
                let Ok(mut inner) = state.lock() else {
                    break;
                };
                if inner.view.sequence != view.sequence
                    || inner.view.menu_open
                    || inner.view.dragging
                    || !inner.view.visible
                {
                    None
                } else if let Some((x, y)) = pointer {
                    let inside = inner.hit(x, y);
                    if inner.painted()
                        && inner.view.error.is_none()
                        && inner.view.edge != Edge::Free
                    {
                        if inner.view.collapsed && inside {
                            inner.layout(false);
                        } else if !inner.view.collapsed {
                            let within = (inner.view.artwork_left
                                ..=inner.view.artwork_left + 112.0)
                                .contains(&x)
                                && (inner.view.artwork_top..=inner.view.artwork_top + 112.0)
                                    .contains(&y);
                            if within || inner.keyboard_focused {
                                inner.leave_since = None;
                            } else if inner
                                .leave_since
                                .is_some_and(|at| at.elapsed() >= Duration::from_millis(450))
                            {
                                inner.layout(true);
                            } else {
                                inner.leave_since.get_or_insert_with(Instant::now);
                            }
                        }
                    }
                    let ignore = inner.painted() && inner.view.error.is_none() && !inner.hit(x, y);
                    (ignore != inner.ignored).then_some((ignore, inner.view.sequence))
                } else {
                    drop(inner);
                    suspend(&window, &state);
                    None
                }
            };
            if let Some((ignore, sequence)) = desired {
                let _ = input(&window, &state, ignore, Some(sequence));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    });
}
pub(crate) fn input(
    window: &WebviewWindow,
    state: &Arc<PetState>,
    ignore: bool,
    sequence: Option<u64>,
) -> Result<(), StoreError> {
    input_update(window, state, ignore, sequence, None)
}
fn input_update(
    window: &WebviewWindow,
    state: &Arc<PetState>,
    ignore: bool,
    sequence: Option<u64>,
    warning: Option<&'static str>,
) -> Result<(), StoreError> {
    let target = window.clone();
    let state = state.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(mut inner) = state.lock() {
                if let Some(message) = warning {
                    inner.degrade(message, |value| {
                        target.set_ignore_cursor_events(value).is_ok()
                    });
                } else if !inner.sync_input(ignore, sequence, |value| {
                    target.set_ignore_cursor_events(value).is_ok()
                }) && inner.view.error.is_none()
                {
                    inner.view.error = Some("班班的透明命中暂不可确认，请从菜单栏重新显示。");
                    inner.layout(false);
                    inner.barrier();
                }
                state.wake.notify_all();
            }
        })
        .map_err(|_| failure())
}
pub(crate) fn degrade(window: &WebviewWindow, state: &Arc<PetState>, message: &'static str) {
    let _ = input_update(window, state, false, None, Some(message));
}
fn suspend(window: &WebviewWindow, state: &Arc<PetState>) {
    degrade(
        window,
        state,
        "班班的透明命中暂不可确认，请从菜单栏重新显示。",
    );
}
pub(crate) fn view(state: &PetState) -> Result<View, StoreError> {
    state.lock().map(|i| i.view.clone()).map_err(|_| failure())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_detaches_both_edges_and_only_snaps_near_work_area() {
        let area = Area {
            left: -1000.0,
            top: 30.0,
            width: 1000.0,
            height: 800.0,
        };
        assert_eq!(release_edge(Edge::Left, -500.0, area), Edge::Free);
        assert_eq!(release_edge(Edge::Right, -500.0, area), Edge::Free);
        assert_eq!(release_edge(Edge::Left, -969.0, area), Edge::Left);
        assert_eq!(release_edge(Edge::Left, -967.0, area), Edge::Free);
        assert_eq!(release_edge(Edge::Free, -980.0, area), Edge::Left);
        assert_eq!(release_edge(Edge::Free, -979.0, area), Edge::Free);
        assert_eq!(release_edge(Edge::Free, -212.0, area), Edge::Right);
        assert_eq!(release_edge(Edge::Free, -213.0, area), Edge::Free);
        assert_eq!(area.clamp(-2000.0, 1000.0), (-1000.0, 638.0));
    }
}
