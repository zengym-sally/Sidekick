use super::pet_state::*;
use crate::local_store::{PetCommitKind, PetCommitReceipt, PetStoreFacts};
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn facts(count: u64) -> PetStoreFacts {
    PetStoreFacts {
        root_key: Some(PathBuf::from("synthetic-root")),
        pending_candidate_count: Some(count),
        work_mode: false,
    }
}
fn playable(state: &PetState) {
    state.observe(None, Ok(facts(0)), None, false, true);
    let mut inner = state.lock().unwrap();
    inner.view.visible = true;
    inner.client_ready = true;
    inner.page_visible = true;
    inner.reduced_motion = false;
}
fn receipt(age: Duration) -> PetCommitReceipt {
    PetCommitReceipt {
        kind: PetCommitKind::Done {
            todo_id: "synthetic-todo".into(),
            version: 2,
        },
        committed_at: Instant::now() - age,
        confirmed: true,
    }
}
#[test]
fn feedback_is_claimed_once_and_old_play_epoch_cannot_replay() {
    let state = PetState::new(false);
    playable(&state);
    let scope = state.scope();
    state.observe(
        Some(scope),
        Ok(facts(0)),
        Some(receipt(Duration::ZERO)),
        true,
        true,
    );
    let notice = state.notice().unwrap();
    assert!(state
        .claim(
            &notice.feedback_id,
            &notice.workspace_epoch,
            notice.play_epoch,
            true
        )
        .is_some());
    assert!(state
        .claim(
            &notice.feedback_id,
            &notice.workspace_epoch,
            notice.play_epoch,
            true
        )
        .is_none());
    state.lock().unwrap().barrier();
    assert!(state
        .claim(
            &notice.feedback_id,
            &notice.workspace_epoch,
            notice.play_epoch,
            true
        )
        .is_none());
}
#[test]
fn blocked_commit_expiry_failed_read_and_root_change_do_not_create_success_feedback() {
    let state = PetState::new(false);
    playable(&state);
    let scope = state.scope();
    state.lock().unwrap().barrier();
    state.observe(
        Some(scope),
        Ok(facts(0)),
        Some(receipt(Duration::ZERO)),
        true,
        true,
    );
    assert!(state.notice().is_none());
    state.observe(
        Some(state.scope()),
        Ok(facts(0)),
        Some(receipt(Duration::from_secs(3))),
        true,
        true,
    );
    assert!(state.notice().is_none());
    state.observe(Some(state.scope()), Ok(facts(3)), None, true, true);
    state.observe(None, Err(()), None, false, false);
    let snapshot = state.snapshot();
    assert_eq!(snapshot.pending_candidate_count, Some(3));
    assert!(!snapshot.facts_known);
    let old = snapshot.workspace_epoch;
    let mut other = facts(1);
    other.root_key = Some(PathBuf::from("another-synthetic-root"));
    state.observe(None, Ok(other), None, true, true);
    assert_ne!(state.snapshot().workspace_epoch, old);
    assert!(state.notice().is_none());
}
#[test]
fn unchanged_reads_do_not_emit_or_advance_revision() {
    let state = PetState::new(false);
    playable(&state);
    state.lock().unwrap().events.clear();
    let before = state.snapshot().state_revision;
    state.observe(Some(state.scope()), Ok(facts(0)), None, false, true);
    assert_eq!(state.snapshot().state_revision, before);
    assert!(state.lock().unwrap().events.is_empty());
}
#[test]
fn alpha_hit_clips_window_and_mirrors_inward_on_right_edge() {
    let state = PetState::new(true);
    let mut inner = state.lock().unwrap();
    inner.mask = vec![0; 112 * 112];
    inner.mask[10 * 112 + 3] = 1;
    inner.view.artwork_left = 40.0;
    assert!(inner.hit(43.0, 40.0));
    assert!(!inner.hit(44.0, 40.0));
    inner.view.edge = Edge::Right;
    assert!(inner.hit(148.0, 40.0));
    assert!(!inner.hit(43.0, 40.0));
    inner.view.artwork_left = 136.0;
    assert!(!inner.hit(244.0, 40.0));
}
#[test]
fn queued_stale_input_and_failed_restoration_keep_native_cache_consistent() {
    let state = PetState::new(true);
    let mut inner = state.lock().unwrap();
    inner.mask = vec![1; 112 * 112];
    inner.mask_ack = inner.view.mask_sequence;
    inner.view_ack = inner.view.sequence;
    inner.ignored = true;
    let old = inner.view.sequence;
    inner.changed();
    let mut actual = true;
    assert!(inner.sync_input(true, Some(old), |ignore| {
        actual = ignore;
        true
    }));
    assert!(!actual);
    assert!(!inner.ignored);
    inner.ignored = true;
    assert!(!inner.sync_input(false, None, |_| false));
    assert!(inner.ignored);
    assert!(inner.sync_input(false, None, |ignore| {
        actual = ignore;
        true
    }));
    assert!(!actual);
    assert!(!inner.ignored);
}
#[test]
fn degraded_menu_action_restores_input_and_full_pose_before_suspending() {
    let state = PetState::new(true);
    let mut inner = state.lock().unwrap();
    inner.view.edge = Edge::Left;
    inner.layout(true);
    inner.ignored = true;
    let mut ignored = true;
    inner.degrade("synthetic menu failure", |value| {
        ignored = value;
        true
    });
    assert!(!ignored);
    assert!(!inner.ignored);
    assert!(!inner.view.collapsed);
    assert!(inner.view.error.is_some());
}
#[test]
fn stale_position_callbacks_cannot_snap_a_new_drag_or_hidden_window() {
    let state = PetState::new(true);
    let mut inner = state.lock().unwrap();
    inner.drag_generation = 2;
    let old = inner.drag_generation;
    inner.drag_generation += 1;
    inner.view.dragging = true;
    let mut moved = false;
    assert_eq!(
        inner.position(old, || {
            moved = true;
            true
        }),
        Ok(false)
    );
    assert!(!moved);
    inner.view.dragging = false;
    inner.view.visible = false;
    inner.desired_visible = false;
    assert_eq!(
        inner.position(inner.drag_generation, || {
            moved = true;
            true
        }),
        Ok(false)
    );
    assert!(!moved);
    inner.view.visible = true;
    assert_eq!(
        inner.position(inner.drag_generation, || {
            moved = true;
            true
        }),
        Ok(true)
    );
    assert!(moved);
}
#[test]
fn native_hide_and_focus_observations_preserve_an_explicit_hidden_choice() {
    let state = PetState::new(true);
    assert!(super::pet_native::observed_visibility(&state, false));
    assert!(!state.snapshot().view.visible);
    assert!(super::pet_native::observed_visibility(&state, true));
    assert!(state.snapshot().view.visible);
    super::pet_native::visibility(&state, false);
    assert!(!super::pet_native::observed_visibility(&state, true));
    assert!(!state.snapshot().view.visible);
}
