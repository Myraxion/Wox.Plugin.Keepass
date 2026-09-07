# WebAssembly Argon2 and Memory-Only Base64 Icon Streaming

We select a pure WebAssembly implementation for KDBX4 Argon2 key derivation instead of native Node.js C++ addons (node-gyp), and stream extracted custom entry icons directly to Wox as in-memory Base64 data URIs. Native binaries introduce heavy cross-platform packaging friction across Windows, macOS, and Linux, whereas WASM provides seamless portability. Streaming custom icons via Base64 eliminates all disk I/O, preventing sensitive service identities and icon footprints from leaking onto persistent storage.
