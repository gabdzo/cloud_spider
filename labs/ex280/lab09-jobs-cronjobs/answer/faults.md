# Faults

## batch

The Job asks for 3 completions and parallelism 2, which already matches the requirement. The container command is `exit 1`. Pods fail, the Job hits `backoffLimit`, and `.status.succeeded` never reaches 3.

A Job's pod template is immutable. `oc apply` or `oc edit` of the command is rejected. Delete the Job and create it again with `exit 0`.

## tick

The CronJob is suspended, the schedule is `0 0 31 2 *` (a day that does not occur), history limits are 1 and 4, and the container command exits 1. No successful child Job appears.

Set `suspend: false`, schedule `*/1 * * * *`, `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 1`, and a command that exits 0. CronJob templates can be updated in place. Child Jobs created from the old template keep the old command. Delete those Jobs if they are in the way. The next minute creates a new one.
