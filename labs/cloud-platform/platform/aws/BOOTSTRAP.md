# AWS bootstrap (manual, once)

Done by you, in order. Nothing here is automated, because it creates accounts and identities.
Pulumi takes over at step 10.

1. **Management account.** Sign up a new AWS account with a fresh email alias
   (for example `you+cp-mgmt@…`). Do not use your existing personal account. Enable root MFA.
   Create no root access keys. In Account settings, enable "IAM user and role access to Billing information".
2. **Organization.** In the management account, open AWS Organizations, then
   Create organization (all features).
3. **SCPs.** Organizations → Policies → Service control policies → Enable.
4. **Sandbox account.** Organizations → Add an AWS account → Create. Name it `labs-sandbox`, with
   email `you+cp-labs@…` and the default role name `OrganizationAccountAccessRole`.
   Write down the 12-digit account ID.
5. **Member root credentials.** IAM → Root access management → enable centralized root access for
   member accounts. Then delete the root credentials of `labs-sandbox`. That account then has no root
   password to protect.
6. **IAM Identity Center.** Enable it in `eu-central-1` (organization instance). Create a user for
   yourself with MFA required.
7. **Permission sets.** Create both with session duration 8 hours:
   - `MgmtAdmin`, using `AdministratorAccess`, assigned to you in the **management** account.
   - `LabOperator`, using `AdministratorAccess`, assigned to you in **labs-sandbox**.
8. **CLI profiles.** Run `aws configure sso` twice. Use SSO session name `cp`, region
   `eu-central-1`, profile `cp-mgmt` (management, MgmtAdmin), and profile `cp-lab` (labs-sandbox, LabOperator).
   Check:
   `aws sts get-caller-identity --profile cp-lab` must show an ARN containing `AWSReservedSSO_LabOperator_`.
9. **Pulumi passphrase.**
   `security add-generic-password -a "$USER" -s cloud-platform-pulumi -w "$(openssl rand -base64 32)"`.
   Back it up in your password manager. Without it, the local Pulumi state cannot be decrypted.
10. **Hand back to the agent** with the sandbox account ID and the alert email address. It runs Task 5 of
    the platform guardrails plan.

## After the management stack exists

11. **Move the sandbox into the `labs` OU:**
    ```
    ROOT=$(aws organizations list-roots --profile cp-mgmt --query 'Roots[0].Id' --output text)
    OU=$(cd platform/aws/management && pulumi stack output labs_ou_id --stack main)
    aws organizations move-account --profile cp-mgmt --account-id <sandbox-id> \
      --source-parent-id "$ROOT" --destination-parent-id "$OU"
    ```

## After the first lab run

12. **Cost allocation tags.** AWS only lists a tag key after it has seen it, so these can't be activated earlier:
    ```
    cd platform/aws/management
    AWS_PROFILE=cp-mgmt pulumi config set activate_cost_tags true --stack main
    AWS_PROFILE=cp-mgmt pulumi up --stack main
    ```
