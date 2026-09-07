# Strict KeePassXC Standard Compliance and Quoted Tokenizer

We restrict TOTP extraction strictly to the KeePassXC standard `otp` string field containing an `otpauth://` URI, rejecting legacy proprietary formats (e.g. `TOTP Seed`). Exclusion rules in settings require strict prefixes (`t:` for tags, `g:` for groups). Both exclusion rules and search queries employ a unified lightweight tokenizer supporting double-quoted string values (e.g., `g:"Recycle Bin"`, `u:"John Doe"`, `"multi word keyword"`) to handle spaces deterministically without complex query parsers.
