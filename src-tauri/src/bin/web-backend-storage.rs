//! stdio storage adapter for the Web backend host.
//!
//! The Node backend spawns this binary and speaks the JSON-line protocol
//! implemented in `sidekick_lib::local_store::web_backend_store`. It owns the
//! business connection and the root lock for its whole lifetime.

fn main() {
    let code = sidekick_lib::local_store::web_backend_store::run_stdio();
    std::process::exit(code);
}
