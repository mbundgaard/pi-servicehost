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
F1 info F2 next F3 stop F4 restart F6 list ^L clear q quit                v0.2.0
```

F2 cycles selection; arrows also select. A bounded service viewport follows selection by name. F6 hides the list and its separator, freeing space for logs; F1 still identifies the selected service and shows PID/readiness/ownership/last exit. Shortcuts adapt to width; F1 provides the complete key list with scrollable, wrapping details. Selection uses reverse video and a literal `>` marker. Styling follows the terminal palette; `NO_COLOR` removes styling, not selection or separators. Below 32×8 a resize instruction replaces the layout.

Pending actions and disconnection remain clearly indicated while relevant, using log-pane space above the bottom rule rather than a permanent status row. Action results/errors and clear confirmations appear for eight seconds; F1 retains the last message. Disconnected output is explicitly cached and controls are disabled. Pending notices warn against retrying. Loading, empty and unavailable-output states remain explicit.

Only the legacy layout and keys are adopted, not its unsafe log reset or shutdown-on-close behavior. Ctrl+L clears the bounded view without truncating files; exiting cancels client work only and leaves services running. F3 start/stop and F4 restart retain the serial authenticated controller and ownership checks. F5 batch controls remain disabled. Selected logs use the existing bounded per-stream follow cursors and caches. Child terminal escapes remain neutralized; log rows are clipped by grapheme-aware approximate cell width.

## Evidence

`artifacts/panel-preview.txt` contains actual renderer-generated plain-text frames, not a screenshot; it is not shipped. Frames cover 100×28, 80×24, 50×16, 32×8, pending/disconnected/loading/empty states and scrolled help. Layout tests assert compact first rows, full-width separator rules, F2/version footer and absence of dashboard chrome. PTY tests verify actual key decoding and compact output, alongside terminal restoration and safety tests.

See [validation](validation.md) for typecheck, Linux suite and installed-tarball/package checks. No emulator screenshot, real Herdr/service manipulation or native Windows terminal validation was performed. Renderer and PTY evidence do not establish owner visual approval of this implementation. Terminal fonts/emoji conventions vary, byte boundaries can split UTF-8, and stream order is not a global timeline. No log history browser or destructive retention is added.
