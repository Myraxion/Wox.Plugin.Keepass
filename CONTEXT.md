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

**Field Prefix**:
A query syntax prefix (e.g., `u:`, `t:`, `url:`, `g:`) used in searches, supporting double-quoted phrases for spaces (e.g., `u:"John Doe"`).
_Avoid_: Search filter, Search tag, Modifier

**Lock State**:
The runtime state where the database is not decrypted or in-memory credentials have been purged due to timeout or reload.
_Avoid_: Closed state, Sealed state

**Preview Card**:
The right-hand markdown pane displaying formatted entry credentials, entry tags, notes, dynamic TOTP, and metadata badges.
_Avoid_: Details view, Inspector, Sidebar

**Action**:
An executable keyboard command bound to an entry (e.g., Copy Password, Copy TOTP, Open URL).
_Avoid_: Command, Operation, Task

**Auto-lock Timeout**:
The configurable idle duration of inactivity after which the in-memory decrypted database is purged.
_Avoid_: Expiration, TTL, Sleep time

**Exclusion Rule**:
A comma-separated setting pattern with strict prefixes (`t:` for tags, `g:` for group paths) and double-quoted values (e.g., `g:"Recycle Bin"`) to hide entries.
_Avoid_: Blacklist, Ignore filter, Omission

**Tokenizer**:
A lightweight parser splitting queries and rules into terms, quoted phrases, and prefixed attributes while respecting whitespace and quotes.
_Avoid_: Lexer, Query parser, Splitter
