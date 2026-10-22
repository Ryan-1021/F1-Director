F1 Director — runtime pack (upstream jar + portable JRE)

This folder is the runtime used by F1-Director:
  - F1-RaceControl-Desktop-0.1.15_modify.jar  (upstream release 0.1.15 + local patches; MANIFEST 0.1.15_modify)
  - jre\                        (portable JRE; not in git — keep locally)
  - web\                        (published by director\Start.cmd; not in git)

Daily use (director shell):
  ..\director\Start.cmd

Bare board UI only (no director shell):
  Start.cmd
  Start-LAN.cmd   (same + --firewall)

Keep the console window open while using the bare Start.cmd path.
Share this whole folder (including jre) with others if they need a local runtime.
