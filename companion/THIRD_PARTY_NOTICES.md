# Wayfinder Companion Third-Party Notices

Wayfinder Companion is built with open-source software. The complete resolved
Rust dependency graph is pinned in `src-tauri/Cargo.lock`.

Direct runtime dependencies:

- [Tauri](https://github.com/tauri-apps/tauri), Apache-2.0 OR MIT.
- [tauri-plugin-shell](https://github.com/tauri-apps/plugins-workspace),
  Apache-2.0 OR MIT.
- [serde](https://github.com/serde-rs/serde), Apache-2.0 OR MIT.
- [serde_json](https://github.com/serde-rs/json), Apache-2.0 OR MIT.
- [dirs](https://github.com/dirs-dev/dirs-rs), Apache-2.0 OR MIT.

The application bundle also includes:

- `NODE_LICENSE.txt`, copied from the exact Node.js runtime embedded in the
  Wayfinder sidecar.
- `THIRD_PARTY_LICENSES.txt`, generated from the JavaScript packages bundled
  into Wayfinder Core.
- `RUST_THIRD_PARTY_LICENSES.txt`, generated from the locked Cargo dependency
  graph and the license files shipped by those crates.
