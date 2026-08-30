# Packaging

AUR `-bin` and Homebrew files are in this directory.
They wrap GitHub Release binaries.
A later ticket publishes the packages.

## AUR `-bin`

`packaging/aur/omatune-bin` holds a PKGBUILD for Arch Linux.
Set `pkgver` to the Release tag without the `v` prefix.
Set the sha256 fields to the Linux binary hashes.
Do not strip the binary.

## Homebrew tap

`packaging/homebrew/omatune.rb` holds a formula for macOS.
Set `version` to the Release tag without the `v` prefix.
Set each `sha256` to the macOS binary hash.
Point each `url` at the GitHub Release asset.

## Publish

Do not publish from this ticket.
The Release workflow only attaches binaries to a tag.
A captain creates the tag.
