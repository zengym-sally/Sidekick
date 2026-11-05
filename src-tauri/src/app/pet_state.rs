use crate::local_store::{PetCommitKind, PetCommitReceipt, PetStoreFacts};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Edge {
    #[default]
    Free,
    Left,
    Right,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct View {
    pub client_epoch: u64,
    pub sequence: u64,
    pub play_epoch: u64,
    pub mask_sequence: u64,
    pub policy_sequence: u64,
    pub visible: bool,
    pub edge: Edge,
    pub collapsed: bool,
    pub dragging: bool,
    pub menu_open: bool,
    pub work_mode: bool,
    pub artwork_left: f64,
    pub artwork_top: f64,
    pub error: Option<&'static str>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub workspace_epoch: String,
    pub state_revision: u64,
    pub facts_known: bool,
    pub pending_candidate_count: Option<u64>,
    pub warning: Option<&'static str>,
    pub view: View,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Notice {
    pub workspace_epoch: String,
    pub commit_revision: u64,
    pub play_epoch: u64,
    pub feedback_id: String,
    pub kind: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Grant {
    workspace_epoch: String,
    state_revision: u64,
    play_epoch: u64,
    feedback_id: String,
    kind: &'static str,
    remaining_ms: u64,
}
#[derive(Clone)]
pub(crate) struct Scope {
    root_epoch: String,
    play_epoch: u64,
    playable: bool,
}
struct Slot {
    notice: Notice,
    receipt: PetCommitReceipt,
    claimed: bool,
}
pub(crate) enum Event {
    View(View),
    State {
        workspace_epoch: String,
        invalidated_feedback_id: Option<String>,
    },
    Feedback(Notice),
}
pub(crate) struct Inner {
    pub view: View,
    pub events: Vec<Event>,
    pub mask: Vec<u8>,
    pub mask_ack: u64,
    pub view_ack: u64,
    pub ignored: bool,
    pub client_ready: bool,
    pub keyboard_focused: bool,
    pub page_visible: bool,
    pub reduced_motion: bool,
    pub stop: bool,
    pub desired_visible: bool,
    pub leave_since: Option<Instant>,
    pub drag_generation: u64,
    pub menu_token: u64,
    pub menu_prepared: Option<Instant>,
    pub menu_popping: bool,
    facts_known: bool,
    pending: Option<u64>,
    root: Option<PathBuf>,
    root_epoch: u64,
    revision: u64,
    feedback_sequence: u64,
    slot: Option<Slot>,
}
pub(crate) struct PetState {
    inner: Mutex<Inner>,
    pub wake: Condvar,
}
impl PetState {
    pub fn new(visible: bool) -> Self {
        Self {
            wake: Condvar::new(),
            inner: Mutex::new(Inner {
                view: View {
                    client_epoch: 0,
                    sequence: 1,
                    play_epoch: 1,
                    mask_sequence: 0,
                    policy_sequence: 0,
                    visible,
                    edge: Edge::Free,
                    collapsed: false,
                    dragging: false,
                    menu_open: false,
                    work_mode: true,
                    artwork_left: 40.0,
                    artwork_top: 30.0,
                    error: None,
                },
                events: vec![],
                mask: vec![],
                mask_ack: 0,
                view_ack: 0,
                ignored: false,
                client_ready: false,
                keyboard_focused: false,
                page_visible: false,
                reduced_motion: true,
                stop: false,
                desired_visible: visible,
                leave_since: None,
                drag_generation: 0,
                menu_token: 0,
                menu_prepared: None,
                menu_popping: false,
                facts_known: false,
                pending: None,
                root: None,
                root_epoch: 0,
                revision: 0,
                feedback_sequence: 0,
                slot: None,
            }),
        }
    }
    pub fn lock(&self) -> Result<MutexGuard<'_, Inner>, ()> {
        self.inner.lock().map_err(|_| ())
    }
    pub fn snapshot(&self) -> Snapshot {
        self.inner.lock().expect("pet state poisoned").snapshot()
    }
    pub fn scope(&self) -> Scope {
        let inner = self.inner.lock().expect("pet state poisoned");
        Scope {
            root_epoch: inner.epoch(),
            play_epoch: inner.view.play_epoch,
            playable: inner.playable(),
        }
    }
    pub fn source(&self) -> Option<PetCommitReceipt> {
        self.lock().ok()?.slot.as_ref().map(|s| s.receipt.clone())
    }
    #[cfg(test)]
    pub fn notice(&self) -> Option<Notice> {
        self.lock().ok()?.slot.as_ref().map(|s| s.notice.clone())
    }
    pub fn observe(
        &self,
        scope: Option<Scope>,
        facts: Result<PetStoreFacts, ()>,
        receipt: Option<PetCommitReceipt>,
        changed: bool,
        source_valid: bool,
    ) -> Vec<Event> {
        let Ok(mut inner) = self.lock() else {
            return vec![];
        };
        let event_start = inner.events.len();
        let Ok(facts) = facts else {
            if inner.facts_known {
                inner.facts_known = false;
                inner.barrier();
                inner.state_event();
            }
            return inner.events.split_off(event_start);
        };
        let root_changed = inner.root != facts.root_key;
        let count_changed = inner.pending != facts.pending_candidate_count;
        let known_changed = inner.facts_known != facts.root_key.is_some();
        if root_changed {
            inner.root = facts.root_key;
            inner.root_epoch += 1;
            inner.revision = 0;
            inner.barrier();
        }
        if inner.view.work_mode != facts.work_mode {
            inner.view.work_mode = facts.work_mode;
            inner.barrier();
        }
        inner.facts_known = inner.root.is_some();
        inner.pending = facts.pending_candidate_count;
        if changed || root_changed || count_changed || known_changed {
            inner.revision += 1;
            if !source_valid {
                inner.invalidate();
            }
            inner.state_event();
        }
        if let Some(receipt) =
            receipt.filter(|r| r.confirmed && r.committed_at.elapsed() < Duration::from_secs(2))
        {
            if scope.is_some_and(|s| {
                s.playable && s.root_epoch == inner.epoch() && s.play_epoch == inner.view.play_epoch
            }) && inner.playable()
                && source_valid
            {
                inner.invalidate();
                inner.feedback_sequence += 1;
                let notice = Notice {
                    workspace_epoch: inner.epoch(),
                    commit_revision: inner.revision,
                    play_epoch: inner.view.play_epoch,
                    feedback_id: format!("{}:{}", inner.view.client_epoch, inner.feedback_sequence),
                    kind: match receipt.kind {
                        PetCommitKind::Done { .. } => "done",
                        PetCommitKind::Found { .. } => "found",
                    },
                };
                inner.slot = Some(Slot {
                    notice: notice.clone(),
                    receipt,
                    claimed: false,
                });
                inner.events.push(Event::Feedback(notice));
            }
        }
        inner.events.split_off(event_start)
    }
    pub fn publish(&self, events: Vec<Event>) {
        if events.is_empty() {
            return;
        }
        if let Ok(mut inner) = self.lock() {
            inner.events.extend(events);
            self.wake.notify_all();
        }
    }
    pub fn claim(&self, id: &str, epoch: &str, play_epoch: u64, valid: bool) -> Option<Grant> {
        let mut inner = self.lock().ok()?;
        if !valid
            || !inner.playable()
            || inner.epoch() != epoch
            || inner.view.play_epoch != play_epoch
        {
            inner.invalidate();
            return None;
        }
        let revision = inner.revision;
        let slot = inner.slot.as_mut()?;
        if slot.claimed || slot.notice.feedback_id != id || slot.notice.play_epoch != play_epoch {
            return None;
        }
        let remaining = Duration::from_secs(2).checked_sub(slot.receipt.committed_at.elapsed())?;
        if remaining.as_millis() == 0 {
            return None;
        }
        slot.claimed = true;
        Some(Grant {
            workspace_epoch: epoch.into(),
            state_revision: revision,
            play_epoch,
            feedback_id: id.into(),
            kind: slot.notice.kind,
            remaining_ms: remaining.as_millis() as u64,
        })
    }
    pub fn stop(&self) {
        if let Ok(mut inner) = self.lock() {
            inner.stop = true;
            self.wake.notify_all();
        }
    }
}
impl Inner {
    fn epoch(&self) -> String {
        format!("pet-root-{}", self.root_epoch)
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            workspace_epoch: self.epoch(),
            state_revision: self.revision,
            facts_known: self.facts_known,
            pending_candidate_count: self.pending,
            warning: (!self.facts_known).then_some("状态暂不可确认"),
            view: self.view.clone(),
        }
    }
    pub fn playable(&self) -> bool {
        self.facts_known
            && self.client_ready
            && self.page_visible
            && !self.reduced_motion
            && self.view.visible
            && !self.view.collapsed
            && !self.view.dragging
            && !self.view.menu_open
            && !self.view.work_mode
    }
    fn invalidate(&mut self) {
        if let Some(slot) = self.slot.take() {
            self.events.push(Event::State {
                workspace_epoch: self.epoch(),
                invalidated_feedback_id: Some(slot.notice.feedback_id),
            });
        }
    }
    fn state_event(&mut self) {
        self.events.push(Event::State {
            workspace_epoch: self.epoch(),
            invalidated_feedback_id: None,
        });
    }
    pub fn barrier(&mut self) {
        self.view.play_epoch += 1;
        self.invalidate();
        self.changed();
    }
    pub fn changed(&mut self) {
        self.view.sequence += 1;
        self.events.push(Event::View(self.view.clone()));
    }
    pub fn layout(&mut self, collapsed: bool) {
        let collapsed = collapsed && self.view.edge != Edge::Free;
        if self.view.collapsed == collapsed
            && self.view.artwork_left
                == match (self.view.edge, collapsed) {
                    (Edge::Left, true) => -56.0,
                    (Edge::Left, false) => 0.0,
                    (Edge::Right, true) => 136.0,
                    (Edge::Right, false) => 80.0,
                    _ => 40.0,
                }
        {
            return;
        }
        self.view.collapsed = collapsed;
        self.view.artwork_left = match (self.view.edge, collapsed) {
            (Edge::Left, true) => -56.0,
            (Edge::Left, false) => 0.0,
            (Edge::Right, true) => 136.0,
            (Edge::Right, false) => 80.0,
            _ => 40.0,
        };
        self.leave_since = None;
        self.barrier();
    }
    pub fn hit(&self, x: f64, y: f64) -> bool {
        if !(0.0..192.0).contains(&x) || !(0.0..192.0).contains(&y) {
            return false;
        }
        let (x, y) = (x - self.view.artwork_left, y - self.view.artwork_top);
        if !(0.0..112.0).contains(&x) || !(0.0..112.0).contains(&y) {
            return false;
        }
        let x = if self.view.edge == Edge::Right {
            111 - x as usize
        } else {
            x as usize
        };
        self.mask.get(y as usize * 112 + x) == Some(&1)
    }
    pub fn position(&self, generation: u64, apply: impl FnOnce() -> bool) -> Result<bool, ()> {
        if generation != self.drag_generation
            || (!self.view.visible && !self.desired_visible)
            || self.view.dragging
            || self.stop
        {
            return Ok(false);
        }
        if apply() {
            Ok(true)
        } else {
            Err(())
        }
    }
    pub fn degrade(&mut self, message: &'static str, apply: impl FnOnce(bool) -> bool) {
        self.sync_input(false, None, apply);
        self.view.error = Some(message);
        self.view.dragging = false;
        self.drag_generation += 1;
        self.layout(false);
        self.barrier();
    }
    pub fn sync_input(
        &mut self,
        ignore: bool,
        sequence: Option<u64>,
        apply: impl FnOnce(bool) -> bool,
    ) -> bool {
        let ignore = ignore
            && sequence == Some(self.view.sequence)
            && self.painted()
            && self.view.visible
            && !self.view.dragging
            && !self.view.menu_open;
        if !apply(ignore) {
            return false;
        }
        self.ignored = ignore;
        true
    }
    pub fn painted(&self) -> bool {
        !self.mask.is_empty()
            && self.mask_ack == self.view.mask_sequence
            && self.view_ack == self.view.sequence
    }
}
