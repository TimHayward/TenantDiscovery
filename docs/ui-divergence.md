# UI component divergence: dashboard against mockup sandbox

Status: record only. This document describes the state of the two shadcn component sets at the
point `lib/ui-kit` was extracted (task T07). It deliberately does not reconcile anything.

`artifacts/m365-dashboard` and `artifacts/mockup-sandbox` each carried a full copy of the same
55-file shadcn component set. Of those 55, 36 were byte-identical and 19 had drifted. This
document classifies all 55, records what each divergence actually is, and states which of the
identical files could and could not be extracted into the shared package.

## TL;DR

- All 19 divergences are **trivial**. Not one of them changes what a component renders.
- The drift is entirely of three kinds: a `"use client"` directive present in the sandbox and
  absent from the dashboard, explanatory comments present in the dashboard and stripped from the
  sandbox, and leading or trailing whitespace inside Tailwind class strings.
- 31 of the 36 identical components were extracted into `lib/ui-kit`. The other 5 could not be,
  because each imports a component or hook that is itself diverged. Reconciling three files
  (`button.tsx`, `label.tsx` and `hooks/use-toast.ts`) would unblock all 5.
- Both applications already resolve to the **same** Radix package instances, despite declaring
  different version ranges. The sandbox is ahead only on paper.

## How this was established

Byte comparison for the identical/diverged split:

```
for f in artifacts/m365-dashboard/src/components/ui/*.tsx; do
  cmp -s "$f" "artifacts/mockup-sandbox/src/components/ui/$(basename "$f")"
done
```

To establish that the divergences are cosmetic rather than behavioural, both copies of each
diverged file were passed through esbuild with `--minify-whitespace`, which discards comments and
formatting but preserves every token of executable code. After additionally stripping the
`"use client"` directive and normalising whitespace inside string literals, all 19 pairs compare
equal. Each of the 19 raw diffs was also read individually; the normalisation only corroborates
what those diffs show.

Whitespace inside a Tailwind class string is not significant here: the strings are passed to
`clsx` and `tailwind-merge`, which tokenise on whitespace, so `" a b "` and `"a b"` produce the
same class list.

## The 55 shared components

`Location` is where the file lives after extraction. `Diff lines` counts changed lines in
`diff artifacts/m365-dashboard/... artifacts/mockup-sandbox/...` as of the pre-extraction commit.

### Identical and extracted (31)

These were byte-identical and are now single copies in `lib/ui-kit/src/`. Both applications
import them as `@workspace/ui-kit/<name>`.

| Component | Diff lines | Location |
|---|---|---|
| accordion | 0 | `lib/ui-kit` |
| alert | 0 | `lib/ui-kit` |
| aspect-ratio | 0 | `lib/ui-kit` |
| breadcrumb | 0 | `lib/ui-kit` |
| button-group | 0 | `lib/ui-kit` |
| card | 0 | `lib/ui-kit` |
| checkbox | 0 | `lib/ui-kit` |
| context-menu | 0 | `lib/ui-kit` |
| dialog | 0 | `lib/ui-kit` |
| drawer | 0 | `lib/ui-kit` |
| empty | 0 | `lib/ui-kit` |
| hover-card | 0 | `lib/ui-kit` |
| input | 0 | `lib/ui-kit` |
| input-otp | 0 | `lib/ui-kit` |
| item | 0 | `lib/ui-kit` |
| kbd | 0 | `lib/ui-kit` |
| menubar | 0 | `lib/ui-kit` |
| navigation-menu | 0 | `lib/ui-kit` |
| popover | 0 | `lib/ui-kit` |
| radio-group | 0 | `lib/ui-kit` |
| scroll-area | 0 | `lib/ui-kit` |
| separator | 0 | `lib/ui-kit` |
| skeleton | 0 | `lib/ui-kit` |
| slider | 0 | `lib/ui-kit` |
| spinner | 0 | `lib/ui-kit` |
| switch | 0 | `lib/ui-kit` |
| table | 0 | `lib/ui-kit` |
| tabs | 0 | `lib/ui-kit` |
| textarea | 0 | `lib/ui-kit` |
| toast | 0 | `lib/ui-kit` |
| toggle | 0 | `lib/ui-kit` |

### Identical but blocked (5)

Byte-identical in both applications, but each imports something that is itself diverged, so
extracting it would have forced a choice between the two versions of that dependency. Both copies
were left where they were.

| Component | Diff lines | Blocked by | Blocking dependency status |
|---|---|---|---|
| alert-dialog | 0 | `button` | diverged (trivial) |
| carousel | 0 | `button` | diverged (trivial) |
| form | 0 | `label` | diverged (trivial) |
| pagination | 0 | `button` | diverged (trivial) |
| toaster | 0 | `hooks/use-toast` | diverged (trivial, one comment) |

### Diverged (19)

All left in place, in both applications. Each sandbox copy now carries a comment at the top
pointing here.

| Component | Diff lines | What differs | Classification |
|---|---|---|---|
| avatar | 1 | Sandbox adds `"use client"` | trivial |
| badge | 6 | Dashboard carries 6 `// @replit` comment lines explaining the shadow, hover and outline choices; sandbox has them stripped | trivial |
| button | 13 | 7 `// @replit` comment lines stripped in the sandbox, plus 3 class strings that differ only by leading or trailing whitespace | trivial |
| calendar | 1 | Sandbox adds `"use client"` | trivial |
| chart | 2 | Two explanatory comments stripped in the sandbox | trivial |
| collapsible | 1 | Sandbox adds `"use client"` | trivial |
| command | 1 | Sandbox adds `"use client"` | trivial |
| dropdown-menu | 1 | Sandbox adds `"use client"` | trivial |
| field | 1 | Sandbox adds `"use client"` | trivial |
| input-group | 3 | Three section comments (alignment, focus state, error state) stripped in the sandbox | trivial |
| label | 1 | Sandbox adds `"use client"` | trivial |
| progress | 1 | Sandbox adds `"use client"` | trivial |
| resizable | 1 | Sandbox adds `"use client"` | trivial |
| select | 1 | Sandbox adds `"use client"` | trivial |
| sheet | 1 | Sandbox adds `"use client"` | trivial |
| sidebar | 14 | Sandbox adds `"use client"`; 13 comment lines stripped, including one JSX comment and the note about Tailwind v3.4 `in-` selectors | trivial |
| sonner | 1 | Sandbox adds `"use client"` | trivial |
| toggle-group | 1 | Sandbox adds `"use client"` | trivial |
| tooltip | 1 | Sandbox adds `"use client"` | trivial |

There are no substantive divergences. The pattern is consistent with the dashboard copies having
been passed through a tool that removed the `"use client"` directive and left the blank first
line behind, while the sandbox copies were passed through a tool that stripped comments.

### Related non-component divergence

| File | Diff lines | What differs | Classification |
|---|---|---|---|
| `src/hooks/use-toast.ts` | 2 | Two comment lines about the `DISMISS_TOAST` side effect stripped in the sandbox | trivial |
| `src/hooks/use-mobile.tsx` | 0 | identical | — |
| `src/lib/utils.ts` | — | Not comparable. The dashboard's exports `cn` plus currency, number and date formatters and depends on `date-fns`; the sandbox's exports `cn` only. | by design |

## Where `cn` lives

`lib/ui-kit` carries its own `cn` at `lib/ui-kit/src/utils.ts`, depending only on `clsx` and
`tailwind-merge`. It is exported as `@workspace/ui-kit/utils`.

Both applications keep their own `src/lib/utils.ts`. The dashboard's has to stay, because it also
holds formatters that are unrelated to styling and are imported across the application. The
sandbox's stays for symmetry and because its non-kit components still import `cn` from it.

The cost is three copies of a three-line function. The alternative — having the kit's components
import `@/lib/utils` and rely on each application's `@` alias resolving it — was rejected: it
would make the shared package silently depend on the private alias configuration of whichever
application happened to import it, and it would break the moment an application changed what
`@/lib/utils` exports.

## Tailwind

Both applications use Tailwind v4 with `@tailwindcss/vite`, so content detection is automatic and
scoped to the application directory. `lib/ui-kit` is outside it. Both `src/index.css` files
therefore carry:

```css
@source "../../../lib/ui-kit/src";
```

This matters more than it looks. Without it the build still succeeds and the classes used only by
kit components are silently purged. Measured, with the directive removed:

| Application | CSS with `@source` | CSS without | Purged |
|---|---|---|---|
| m365-dashboard | 124.80 kB | 104.71 kB | 20.09 kB |
| mockup-sandbox | 89.70 kB | 66.91 kB | 22.79 kB |

With the directive in place the dashboard's emitted stylesheet is byte-identical to the
pre-extraction build, down to the content hash (`index-NI2rDvOo.css`).

## Dependency versions

The sandbox declares newer Radix ranges than the dashboard — for example
`@radix-ui/react-dialog` at `^1.1.15` against the dashboard's `^1.1.7`. Because the ranges
overlap and pnpm resolves each to the newest matching version, both applications already install
the *same* instance. Checked across `react-dialog`, `react-slot`, `react-accordion`, `react-toast`
and `react-tabs`, the resolved paths under `node_modules/.pnpm` are identical.

`lib/ui-kit` therefore declares the dashboard's (lower) ranges, which both applications' existing
resolutions already satisfy. Extraction changed no installed version, and the kit resolves to the
same Radix instances as both applications, so nothing is duplicated in the bundle.

## What a human still has to decide

1. **Whether to reconcile the 19.** They are all cosmetic. Reconciling them would take the shared
   kit from 31 components to 55 and delete 24 duplicated files. The reason it was not done here is
   that it requires choosing a house style for `"use client"` and for the `// @replit` commentary,
   and that choice should be made deliberately rather than by whichever tool ran last.
2. **The three files that block five extractions.** `button.tsx`, `label.tsx` and
   `hooks/use-toast.ts` are the highest-value reconciliation: settling those three moves
   `alert-dialog`, `carousel`, `form`, `pagination` and `toaster` into the kit as pure moves.
3. **Whether the sandbox should exist at all.** It currently contains no mockups — its
   `src/components/mockups` directory does not exist and its generated component map is empty. It
   is a component preview harness with nothing to preview. See `docs/agent-runs/T07.md`.
