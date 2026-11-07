# Panel design and review

## Approved legacy layout

The layout follows `references/ServiceHost/src/ServiceHost.Tui/Program.cs`: compact service rows at the top, a full-width rule, selected live output, then a full-width bottom rule and compact shortcuts/version footer. There is no title, column-heading row, named log divider or persistent connection banner.

```
> api running :3000
  worker stopped
  assets running :5173
────────────────────────────────────────────────────────────────────────────────
out  Listening on 127.0.0.1:3000
err  Optional cache is not configured

────────────────────────────────────────────────────────────────────────────────
F1 info F2 next F3 stop F4 restart PgUp/PgDn End                     live v0.2.0
```

F2 cycles selection; arrows also select. A bounded service viewport follows selection by name. F6 hides the list and its separator, freeing space for logs; F1 still identifies the selected service and shows PID/readiness/ownership/last exit. Shortcuts adapt to width; F1 provides the complete key list with scrollable, wrapping details. Selection uses reverse video and a literal `>` marker. Styling follows the terminal palette; `NO_COLOR` removes styling, not selection or separators. Below 32×8 a resize instruction replaces the layout.

Pending actions and disconnection remain clearly indicated while relevant, using log-pane space above the bottom rule rather than a permanent status row. Action results/errors and clear confirmations appear for eight seconds; F1 retains the last message. Disconnected output is explicitly cached and controls are disabled. Pending notices warn against retrying. Loading, empty and unavailable-output states remain explicit.

Only the legacy layout and keys are adopted, not its unsafe log reset or shutdown-on-close behavior. Ctrl+L clears the bounded view without truncating files; exiting cancels client work only and leaves services running. F3 start/stop and F4 restart retain the serial authenticated controller and ownership checks. F5 batch controls remain disabled. Selected logs use the existing bounded per-stream follow cursors and caches. Child terminal escapes remain neutralized; log rows are clipped by grapheme-aware approximate cell width.

## Buffered log navigation

The design keeps the approved terminal palette and monospace cell grid: normal output, dim system text/rules, yellow stderr/notices and reverse-video selection/footer. No new colors, headings or divider labels are needed. The compact footer's right edge reports `live`, `paused` or `paused (pruned)` before the version; scrolling shortcuts appear when width allows, with the complete instructions in F1. This adds state where the user already looks for navigation rather than spending another log row on chrome.

- PageUp/PageDown move by the visible log page minus one overlapping line. Home pauses at the oldest buffered line. End resumes live follow; PageDown reaching the newest page also resumes follow.
- Each cached service has its own absolute top-line anchor. New output and cursor drains do not shift a paused view. An unfinished visible line may still gain text as it arrives. Resize, list visibility and notice-space changes clamp the page to valid bounds without resuming follow.
- Each service retains at most 500 lines, with at most eight service views cached. If retention removes the anchor, the view clamps to the oldest surviving line and shows `paused (pruned)` until Home or live follow is requested. Older log files are untouched; there is no filesystem history backfill.
- Clear discards the buffered history and resumes live follow, preserving stream cursors and the existing in-flight-read discard protection. Service restart or log truncation preserves buffered history and pause state, ends the affected partial line and appends the existing reset marker. Normal retention still applies.
- Arrow keys/F2 continue selecting services. F1's arrows scroll info instead of logs; lifecycle and log-navigation keys do not act behind info. F3/F4 and ownership safety are unchanged. Mouse-wheel handling is intentionally not added.

## Evidence

`artifacts/panel-preview.txt` contains actual renderer-generated plain-text frames, not a screenshot; it is not shipped. Frames cover 100×28, 80×24, 50×16, 32×8, pending/disconnected/loading/empty states and scrolled help. Layout tests assert compact first rows, full-width separator rules, F2/version footer and absence of dashboard chrome. PTY tests verify actual PageUp/PageDown/Home/End decoding and return to live output, plus compact output, terminal restoration and safety tests. Pure buffer and renderer tests cover empty/blank/partial lines, cursor drains, stable history during appends and resets, pruning, service switching, clear, resize, help isolation and live/paused indicators.

See [validation](validation.md) for typecheck, Linux suite and installed-tarball/package checks. No emulator screenshot, real Herdr/service manipulation or native Windows terminal validation was performed. Renderer and PTY evidence do not establish owner visual approval of this implementation. Terminal fonts/emoji conventions vary, byte boundaries can split UTF-8, and stream order is not a global timeline. History navigation is limited to the bounded in-memory buffer; no destructive file retention is added.
