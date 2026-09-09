# KeePass Wox Plugin Context

A fast, secure, read-only KeePass (KDBX4) launcher plugin for Wox with in-memory credential caching and rich preview split-view.

## Language

**Database**:
A single KDBX4 database file storing the encrypted password safe on local disk.
_Avoid_: Vault, Safe, Store, Container

**Master Password**:
The user's secret passphrase used in memory to derive encryption keys and unlock the database.
_Avoid_: Passphrase, Master key, Password, Secret

**Key File**:
An optional secondary credential file required alongside the master password to unlock the database.
_Avoid_: Secret file, Auth file, Key

**Entry**:
A single credential item inside the database containing a title, username, password, URL, notes, and optional custom fields or TOTP.
_Avoid_: Record, Item, Credential, Account

**Group**:
A hierarchical folder container in the database organizing entries.
_Avoid_: Folder, Category, Directory, Collection

**TOTP**:
A time-based one-time password generated from an RFC 6238 URI stored strictly in the KeePassXC standard `otp` entry field.
_Avoid_: OTP, 2FA token, Dynamic token

**TOTP Ticker**:
A single wall-clock aligned in-memory timer refreshing live TOTP countdown tails in the preview card and rotating formatted tokens in search result tails without background polling when inactive.
_Avoid_: Interval loop, Background worker, Clock thread, Poller

**Field Prefix**:
A query syntax prefix (e.g., `u:`, `t:`, `url:`, `g:` or full-width `u：`, `t：`, `url：`, `g：`) used in searches, supporting double-quoted phrases for spaces (e.g., `u:"John Doe"` or `u：“John Doe”`).
_Avoid_: Search filter, Search tag, Modifier

**Lock State**:
The runtime state where the database is not decrypted or in-memory credentials have been purged due to timeout, reload, or explicit lock action via the Enter key.
_Avoid_: Closed state, Sealed state

**Preview Card**:
The right-hand native list preview pane displaying formatted entry credential rows, dynamic TOTP countdown tails, and metadata badges.
_Avoid_: Details view, Inspector, Sidebar

**Action**:
An executable keyboard command bound to an entry (e.g., Copy Password, Copy TOTP, Open URL, Lock Database).
_Avoid_: Command, Operation, Task

**Auto-lock Timeout**:
The configurable idle duration of inactivity (in seconds) after which the in-memory decrypted database is purged. Set to 0 to disable automatic locking.
_Avoid_: Expiration, TTL, Sleep time

**Exclusion Rule**:
A comma-separated setting pattern with strict prefixes (`t:`, `g:` or full-width `t：`, `g：`) and double-quoted values (e.g., `g:"Recycle Bin"` or `g：“Recycle Bin”`) to hide entries.
_Avoid_: Blacklist, Ignore filter, Omission

**Tokenizer**:
A lightweight parser splitting queries and rules into terms, quoted phrases (half-width `""` or full-width `“”`), and prefixed attributes while respecting whitespace and quotes.
_Avoid_: Lexer, Query parser, Splitter

**Selection Query**:
A contextual search query triggered by highlighting text in external applications. KeePass only activates when the selection is a valid URL (including protocol-less domains and localhost:port), matching against entry URLs via hostnames.
_Avoid_: Highlight search, Clipboard query, Quick search
