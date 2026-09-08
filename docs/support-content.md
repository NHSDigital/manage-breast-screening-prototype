# Writing support content

Support pages are markdown files in `app/content/support`. Add a file, refresh the browser, and the page appears — in the left-hand nav, on the support index and at its own URL. No code changes, and no need to restart the prototype.

## Folder structure

One folder per section, one markdown file per page:

```
app/content/support/
  1-getting-started/
    1-signing-in.md
    2-finding-your-way-around.md
  2-appointments/
    1-checking-someone-in.md
  3-image-reading/
    1-reading-a-case.md
```

## Ordering

The number at the start of a folder or file name sets its position in the list. It is stripped out of the web address, so `2-signing-in.md` is served at `/support/getting-started/signing-in`.

That means you can renumber files to reorder them without breaking any links. Gaps are fine — `10-`, `20-`, `30-` leaves room to slot pages in later. Anything without a number sorts to the end, alphabetically.

## Frontmatter

Each file starts with a block between `---` lines:

```markdown
---
title: Signing in to Manage
subtitle: How to sign in with your smartcard, and what to do if you cannot
published: 2026-09-08
updated: 2026-09-10
---

Manage uses your NHS care identity to sign you in.

## Signing in

Put your smartcard in the reader before you open Manage.
```

| Field | Required | Used for |
| --- | --- | --- |
| `title` | Yes | Page heading, left-hand nav, support index |
| `subtitle` | No | One-line description under the link on the support index |
| `published` | No | Shown at the foot of the page if there is no `updated` date |
| `updated` | No | Shown at the foot of the page |
| `contents` | No | Set to `false` to hide the contents list at the top of the page |

If you leave `title` out, the file name is used instead.

## Writing the page

Everything after the frontmatter is ordinary markdown. Don't add a `#` heading for the page title — the title from the frontmatter is rendered as the `h1` for you. Start your headings at `##`.

Headings get an id automatically, so `## Signing in` can be linked to as `/support/getting-started/signing-in#signing-in`.

## Contents list

Pages with two or more `##` headings get a contents list at the top, linking to each one. It is built from the page, so there is nothing to keep up to date.

To hide it on a particular page, add `contents: false` to the frontmatter.

## Section names

A section's name comes from its folder: `2-appointments` shows as "Appointments", `1-getting-started` as "Getting started". Renaming the folder renames the section and changes the addresses of every page inside it.

## Adding a section

Make a new folder with a number prefix and put at least one markdown file in it. Empty sections are ignored.
