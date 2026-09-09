# Shared Wall-Clock Aligned TOTP Ticker with Targeted UI Updates

To support real-time TOTP countdowns without UI truncation or background waste, we introduce a single in-memory TOTP ticker aligned to natural seconds (`1000 - (Date.now() % 1000)`). Left-side search result tails display only the formatted TOTP code (`123 456`) to fit within compact launcher chips, while the right-side preview card displays the live ticking seconds (`28s` down to `0s`). Both sides switch to a `"warning"` category during the final 5 seconds before token rotation.

Rather than re-executing full searches via `RefreshQuery`, the ticker dispatches targeted incremental `UpdateResult` calls to all visible TOTP entries returned by the latest query. A monotonic query sequence guard and multi-event lifecycle teardown (`OnLeavePluginQuery`, window hide, database lock, or empty TOTP result set) guarantee immediate timer destruction and prevent ghost updates across rapid keystrokes.
