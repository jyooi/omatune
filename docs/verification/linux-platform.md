# Linux Platform verification

This check needs the reference Device on a Linux host.
A worker does not run it.
The captain runs the command and puts the output into Linear issue HUF-263.

## Command

Connect the reference Device.
Then run:

```
omatune devices --json
```

## What to put in the ticket

Put the full command output into the ticket.
The output is one JSON object per line.

## What to check

The object includes `serial`, `mountPoint`, `volumeFormat`, and `freeSpaceBytes`.
`volumeFormat` is `vfat`.
The Device screen shows Do not disconnect.
This command does not unmount the Device.
A later Sync unmounts the Device and shuts it down.
`--no-eject` does not unmount the Device and does not shut it down.
