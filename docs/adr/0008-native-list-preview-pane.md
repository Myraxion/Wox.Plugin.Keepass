# Native List Preview Pane for Structured Credential Inspection

We replace the legacy Markdown preview card for entry inspection with Wox's native `list` preview component (`WoxPreviewListData`), superseding the preview layout decision in ADR 0002 while retaining keyboard-driven actions. Native list preview renders credentials as structured, aligned row items with distinct database icons, eliminating markdown rendering artifacts and providing a uniform layout across desktop themes.

The list preview organizes credentials into well-defined rows: username and masked password (12 bullets) are always visible with localized empty placeholders; dynamic TOTP renders with a remaining countdown in row tails; URL, tags, and notes are dynamically included only when populated to eliminate redundant empty rows. Group hierarchy and last modification timestamps are preserved in compact `PreviewTags` at the bottom.
