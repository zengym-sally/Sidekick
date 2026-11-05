use super::*;

fn initialized(fixture: &tests::Fixture) -> AppStore {
    let mut store = fixture.store();
    store
        .initialize(Some(fixture.0.join("workspace")), "UTC")
        .unwrap();
    store
}
fn prepared(store: &mut AppStore, label: &str) -> ImportBatch {
    store
        .begin_import(
            TextInput {
                text: format!("合成待确认资料 {label}"),
                source_at_ms: None,
                time_zone: "UTC".into(),
            },
            json!({"modelId":"fixture","apiModelId":"deployment"}),
            false,
        )
        .unwrap()
}
fn draft(title: &str) -> CandidateDraft {
    CandidateDraft {
        fields: TodoInput {
            title: title.into(),
            kind: "action".into(),
            owner: "我".into(),
            priority: "medium".into(),
            due: None,
            followup: None,
            tags: vec![],
        },
        evidence: "合成待确认资料".into(),
        due_expression: None,
        followup_expression: None,
        warnings: vec![],
        unresolved: false,
    }
}
#[test]
fn done_receipt_is_new_commit_only_and_replay_does_not_repeat() {
    let fixture = tests::Fixture::new();
    let mut store = initialized(&fixture);
    let item = store.create(tests::input(), "pet-create").unwrap();
    let entered = std::time::Instant::now();
    let done = store
        .set_completed(&item.id, item.version, true, "pet-done")
        .unwrap();
    let returned = std::time::Instant::now();
    let receipt = store.take_pet_receipt().unwrap();
    assert!(receipt.confirmed);
    assert!(store.pet_receipt_valid(&receipt).unwrap());
    assert!(matches!(receipt.kind,PetCommitKind::Done{version,..} if version==done.version));
    assert!(receipt.committed_at >= entered && receipt.committed_at <= returned);
    assert!(store.take_pet_receipt().is_none());
    let reopened = store
        .set_completed(&done.id, done.version, false, "pet-reopen")
        .unwrap();
    assert!(store.take_pet_receipt().is_none());
    assert!(!store.pet_receipt_valid(&receipt).unwrap());
    assert_eq!(
        store
            .set_completed(&item.id, item.version, true, "pet-done")
            .unwrap(),
        reopened
    );
    assert!(store.take_pet_receipt().is_none());
}
#[test]
fn failed_or_unchanged_completion_has_no_success_receipt() {
    let fixture = tests::Fixture::new();
    let mut store = initialized(&fixture);
    let item = store.create(tests::input(), "pet-failed-create").unwrap();
    assert!(store
        .set_completed(&item.id, item.version + 1, true, "pet-stale")
        .is_err());
    assert!(store.take_pet_receipt().is_none());
    let done = store
        .set_completed(&item.id, item.version, true, "pet-good")
        .unwrap();
    store.take_pet_receipt();
    assert!(store
        .set_completed(&done.id, done.version, true, "pet-unchanged")
        .is_err());
    assert!(store.take_pet_receipt().is_none());
}
#[test]
fn found_receipt_uses_inserted_candidates_and_zero_result_does_not_repeat() {
    let fixture = tests::Fixture::new();
    let mut store = initialized(&fixture);
    let batch = prepared(&mut store, "unique");
    let run = batch.run.unwrap();
    let batch = store
        .publish_candidates(&run.id, vec![draft("合成候选一"), draft("合成候选一")])
        .unwrap();
    assert_eq!(batch.candidates.len(), 1);
    let receipt = store.take_pet_receipt().unwrap();
    assert!(receipt.confirmed);
    assert!(matches!(&receipt.kind,PetCommitKind::Found{candidates} if candidates.len()==1));
    assert!(store.pet_receipt_valid(&receipt).unwrap());
    assert_eq!(store.pet_facts().unwrap().pending_candidate_count, Some(1));
    let candidate = &batch.candidates[0];
    store
        .discard_candidate(&candidate.id, candidate.version, "pet-discard")
        .unwrap();
    assert!(!store.pet_receipt_valid(&receipt).unwrap());
    assert_eq!(store.pet_facts().unwrap().pending_candidate_count, Some(0));
    let zero = prepared(&mut store, "zero");
    store
        .publish_candidates(&zero.run.unwrap().id, vec![])
        .unwrap();
    assert!(store.take_pet_receipt().is_none());
}
#[test]
fn committed_publication_with_failed_result_read_is_not_confirmed_feedback() {
    let fixture = tests::Fixture::new();
    let mut store = initialized(&fixture);
    let batch = prepared(&mut store, "read-failure");
    let run = batch.run.unwrap();
    store.pet_publish_read_fault = true;
    assert!(store
        .publish_candidates(&run.id, vec![draft("合成已提交候选")])
        .is_err());
    let receipt = store.take_pet_receipt().unwrap();
    assert!(!receipt.confirmed);
    assert!(store.pet_receipt_valid(&receipt).unwrap());
    assert_eq!(store.pet_facts().unwrap().pending_candidate_count, Some(1));
}
#[test]
fn pet_facts_count_all_pending_batches_without_creating_reminder_data() {
    let fixture = tests::Fixture::new();
    let mut store = initialized(&fixture);
    for label in ["first", "second"] {
        let batch = prepared(&mut store, label);
        store
            .publish_candidates(&batch.run.unwrap().id, vec![draft(label)])
            .unwrap();
    }
    let facts = store.pet_facts().unwrap();
    assert_eq!(facts.pending_candidate_count, Some(2));
    assert!(!facts.work_mode);
    assert_eq!(facts.root_key, Some(store.root().unwrap()));
}
