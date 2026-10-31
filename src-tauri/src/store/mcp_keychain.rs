use super::mcp_config::valid_id;
use super::mcp_security::{valid_value, McpCredentialBackend, McpCredentialFailure};
use keyring_core::Error;

trait KeychainPort {
    fn read(&self, service: &str, account: &str) -> keyring_core::Result<String>;
    fn write(&self, service: &str, account: &str, value: &str) -> keyring_core::Result<()>;
}

struct NativeKeychainPort;

#[cfg(not(test))]
impl KeychainPort for NativeKeychainPort {
    fn read(&self, service: &str, account: &str) -> keyring_core::Result<String> {
        use apple_native_keyring_store::keychain::Store;
        use keyring_core::api::CredentialStoreApi;
        Store::new()?.build(service, account, None)?.get_password()
    }
    fn write(&self, service: &str, account: &str, value: &str) -> keyring_core::Result<()> {
        use apple_native_keyring_store::keychain::Store;
        use keyring_core::api::CredentialStoreApi;
        Store::new()?
            .build(service, account, None)?
            .set_password(value)
    }
}

#[cfg(test)]
impl KeychainPort for NativeKeychainPort {
    fn read(&self, _: &str, _: &str) -> keyring_core::Result<String> {
        panic!("native MCP Keychain reads are forbidden in unit tests")
    }
    fn write(&self, _: &str, _: &str, _: &str) -> keyring_core::Result<()> {
        panic!("native MCP Keychain writes are forbidden in unit tests")
    }
}

struct McpKeychain<P> {
    enabled: bool,
    port: P,
}

pub(super) fn production_credentials() -> impl McpCredentialBackend {
    McpKeychain {
        enabled: false,
        port: NativeKeychainPort,
    }
}

fn hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn service(scope: &str, reference: &str) -> Option<String> {
    if !hex64(scope) || reference.len() > 512 {
        return None;
    }
    let mut parts = reference.split(':');
    if parts.next()? != "mcp1"
        || parts.next()? != scope
        || !valid_id(parts.next()?)
        || !hex64(parts.next()?)
        || !hex64(parts.next()?)
        || parts.next().is_some()
    {
        return None;
    }
    Some(format!("com.sidekick.mcp.credentials.v1.{scope}"))
}

impl<P: KeychainPort> McpCredentialBackend for McpKeychain<P> {
    fn available(&self) -> bool {
        self.enabled
    }
    fn get(&self, scope: &str, reference: &str) -> Result<String, McpCredentialFailure> {
        if !self.enabled {
            return Err(McpCredentialFailure::Unavailable);
        }
        let service = service(scope, reference).ok_or(McpCredentialFailure::Unavailable)?;
        match self.port.read(&service, reference) {
            Ok(value) if value.is_empty() => Err(McpCredentialFailure::Missing),
            Ok(value) if valid_value(&value) => Ok(value),
            Err(Error::NoEntry) => Err(McpCredentialFailure::Missing),
            _ => Err(McpCredentialFailure::Unavailable),
        }
    }
    fn put(&self, scope: &str, reference: &str, value: &str) -> Result<(), McpCredentialFailure> {
        if !self.enabled || !valid_value(value) {
            return Err(McpCredentialFailure::Unavailable);
        }
        let service = service(scope, reference).ok_or(McpCredentialFailure::Unavailable)?;
        // An empty existing entry is still a collision. The native write is an
        // upsert; this preflight is not an atomic insert against hostile peers.
        if !matches!(self.port.read(&service, reference), Err(Error::NoEntry)) {
            return Err(McpCredentialFailure::Unavailable);
        }
        self.port
            .write(&service, reference, value)
            .map_err(|_| McpCredentialFailure::Unavailable)
    }
}

#[cfg(test)]
#[path = "mcp_keychain_tests.rs"]
mod tests;
