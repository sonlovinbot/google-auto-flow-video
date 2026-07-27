# legacy/

Unreferenced files kept for reference only. Nothing in `manifest.json` or the
side panel loads them.

- `gateway.html` / `gateway.js` / `gateway.css` — an old landing page that let
  the user pick a "version" before entering the panel. `manifest.json` points
  `side_panel.default_path` straight at `sidepanel.html`, so this page was
  unreachable. It also carried its own two-language translation table, separate
  from `i18n.js`.

Safe to delete once you are sure you do not want them back.
