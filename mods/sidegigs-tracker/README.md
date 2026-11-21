# Sidegigs tracker

A pane beside the chat with two sections. Files lists everything in the project's shared folder, grouped by folder with counts, sizes and last change (Reel source code, fonts and uploads are left out). Artifacts lists the project's published artifacts with title, link and last update. It refreshes every minute, after file writes and publishes, and on the Refresh button. Type /tracker to open it.

## Install

```
/plugin marketplace add bconolly/bc-guides-mods
/plugin install sidegigs-tracker@bc-guides-mods
```

Licence: MIT. It reads the project folder `/mnt/project-files` and calls the project's artifact list, so it is written for the Sidegigs project.
