# Lab 09 — Jobs and CronJobs

## Scenario

Project `ex280-lab09` has a Job that never finishes and a CronJob that does not produce successful runs.

## Objective

Make the Job complete and the CronJob produce successful runs on the required schedule.

## Requirements

Job `batch`:

- completions: `3`
- parallelism: `2`
- the Job succeeds

CronJob `tick`:

- schedule: `*/1 * * * *`
- suspend: `false`
- successfulJobsHistoryLimit: `3`
- failedJobsHistoryLimit: `1`
- at least one successful Job has been created by the CronJob

## Success criteria

- Job `batch` reports success for 3 completions
- CronJob `tick` matches the schedule, suspend, and history settings
- A successful Job from `tick` exists
