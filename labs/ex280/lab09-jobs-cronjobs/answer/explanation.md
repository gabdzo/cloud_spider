# Jobs and CronJobs

A Job runs pods until `.spec.completions` succeed. `parallelism` is how many run at once. `backoffLimit` is how many failures are tolerated before the Job is marked failed. `restartPolicy: Never` records each attempt as its own pod, which makes the failures visible. `OnFailure` restarts inside the same pod and is easier to miss.

`oc describe job` and `oc logs job/batch` show the command result. A non-zero exit is a failed pod, not a missing image.

You cannot change the template of an existing Job. Delete it. If you need the same name, delete first, then create. `oc delete job` also deletes its pods.

A CronJob creates Jobs on `schedule`. `suspend: true` stops new Jobs and leaves the object in place. History limits delete old child Jobs. They do not fix a bad command. `successfulJobsHistoryLimit` and `failedJobsHistoryLimit` are spec fields you can check directly.

A schedule of five fields is minute, hour, day of month, month, day of week. `*/1 * * * *` is every minute. After you clear suspend and fix the command, wait for the next minute and look for a child Job whose owner is the CronJob and whose `.status.succeeded` is at least 1.
