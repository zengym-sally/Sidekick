use super::*;
use rusqlite::OptionalExtension;
use std::time::Instant;

#[derive(Clone, Debug)]
pub(crate) enum PetCommitKind {
    Done { todo_id: String, version: i64 },
    Found { candidates: Vec<(String, i64)> },
}
#[derive(Clone, Debug)]
pub(crate) struct PetCommitReceipt {
    pub kind: PetCommitKind,
    pub committed_at: Instant,
    pub confirmed: bool,
}
#[derive(Clone, Debug)]
pub(crate) struct PetStoreFacts {
    pub root_key: Option<PathBuf>,
    pub pending_candidate_count: Option<u64>,
    pub work_mode: bool,
}

impl AppStore {
    #[cfg(feature = "pet-ui-verification")]
    pub(crate) fn open_pet_fixture(app_dir: PathBuf, workspace: PathBuf) -> Result<Self> {
        if app_dir
            .join("bootstrap.json")
            .try_exists()
            .map_err(io_error)?
        {
            return Err(invalid());
        }
        let mut store = Self::open_empty(app_dir)?;
        store.initialize(Some(workspace), "UTC")?;
        Ok(store)
    }

    pub(crate) fn clear_pet_receipt(&mut self) {
        self.pet_receipt = None;
    }
    pub(crate) fn take_pet_receipt(&mut self) -> Option<PetCommitReceipt> {
        self.pet_receipt.take()
    }
    pub(crate) fn pet_change_count(&self) -> Option<u64> {
        self.workspace.as_ref().map(|w| w.db.total_changes())
    }
    pub(crate) fn pet_facts(&self) -> Result<PetStoreFacts> {
        let Some(workspace) = &self.workspace else {
            return Ok(PetStoreFacts {
                root_key: None,
                pending_candidate_count: None,
                work_mode: true,
            });
        };
        let pending = workspace
            .db
            .query_row(
                "SELECT COUNT(*) FROM candidates WHERE status='pending'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(db_error)?;
        Ok(PetStoreFacts {
            root_key: Some(workspace.root.clone()),
            pending_candidate_count: Some(pending as u64),
            work_mode: self.desktop_preferences()?.work_mode,
        })
    }
    pub(crate) fn pet_receipt_valid(&self, receipt: &PetCommitReceipt) -> Result<bool> {
        match &receipt.kind {
            PetCommitKind::Done { todo_id, version } => {
                let current = self
                    .db()?
                    .query_row(
                        "SELECT status,version FROM todos WHERE id=?1",
                        [todo_id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                    )
                    .optional()
                    .map_err(db_error)?;
                Ok(current.is_some_and(|(status, current_version)| {
                    status == "completed" && current_version == *version
                }))
            }
            PetCommitKind::Found { candidates } => {
                for (id, version) in candidates {
                    let current = self
                        .db()?
                        .query_row(
                            "SELECT status,version FROM candidates WHERE id=?1",
                            [id],
                            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                        )
                        .optional()
                        .map_err(db_error)?;
                    if current.is_some_and(|(status, current_version)| {
                        status == "pending" && current_version == *version
                    }) {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
        }
    }
}
