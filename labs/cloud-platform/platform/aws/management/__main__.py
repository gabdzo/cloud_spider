import json
from pathlib import Path

import pulumi
import pulumi_aws as aws

POLICIES = Path(__file__).parent / "policies"

cfg = pulumi.Config()
sandbox_account_id = cfg.require("sandbox_account_id")
alert_email = cfg.require("alert_email")
budget_limit = cfg.require("budget_limit")
budget_unit = cfg.get("budget_unit") or "USD"
activate_cost_tags = cfg.get_bool("activate_cost_tags") or False


def scp_content(name: str) -> str:
    return json.dumps(json.loads((POLICIES / f"{name}.json").read_text()), separators=(",", ":"))


org = aws.organizations.get_organization()
root_id = org.roots[0].id
sandbox_account_arn = f"arn:aws:organizations::{org.master_account_id}:account/{org.id}/{sandbox_account_id}"

labs_ou = aws.organizations.OrganizationalUnit("labs", name="labs", parent_id=root_id)

for name in ("region-lock", "guardrails"):
    policy = aws.organizations.Policy(
        f"labs-{name}",
        name=f"labs-{name}",
        type="SERVICE_CONTROL_POLICY",
        content=scp_content(name),
    )
    aws.organizations.PolicyAttachment(f"labs-{name}", policy_id=policy.id, target_id=labs_ou.id)

# Created detached. Only the budget action attaches it.
deny_new_spend = aws.organizations.Policy(
    "labs-deny-new-spend",
    name="labs-deny-new-spend",
    type="SERVICE_CONTROL_POLICY",
    content=scp_content("deny-new-spend"),
)

budget = aws.budgets.Budget(
    "labs-monthly",
    name="labs-monthly",
    budget_type="COST",
    time_unit="MONTHLY",
    limit_amount=budget_limit,
    limit_unit=budget_unit,
    cost_filters=[aws.budgets.BudgetCostFilterArgs(name="LinkedAccount", values=[sandbox_account_id])],
    notifications=[
        aws.budgets.BudgetNotificationArgs(
            comparison_operator="GREATER_THAN",
            threshold=50,
            threshold_type="PERCENTAGE",
            notification_type="ACTUAL",
            subscriber_email_addresses=[alert_email],
        ),
        aws.budgets.BudgetNotificationArgs(
            comparison_operator="GREATER_THAN",
            threshold=100,
            threshold_type="PERCENTAGE",
            notification_type="FORECASTED",
            subscriber_email_addresses=[alert_email],
        ),
    ],
)

budgets_role = aws.iam.Role(
    "labs-budgets-action",
    name="labs-budgets-action",
    assume_role_policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "budgets.amazonaws.com"},
            "Action": "sts:AssumeRole",
            "Condition": {"StringEquals": {"aws:SourceAccount": org.master_account_id}},
        }],
    }),
)

budgets_role_policy = aws.iam.RolePolicy(
    "labs-budgets-action",
    role=budgets_role.id,
    policy=pulumi.Output.all(deny_new_spend.arn, labs_ou.arn).apply(lambda arns: json.dumps({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["organizations:AttachPolicy", "organizations:DetachPolicy"],
                "Resource": [arns[0], arns[1], sandbox_account_arn],
            },
            {
                "Effect": "Allow",
                "Action": ["organizations:Describe*", "organizations:List*"],
                "Resource": "*",
            },
        ],
    })),
)

# Targets the account as well as the OU, so the stop holds even if the account is outside the OU.
budget_action = aws.budgets.BudgetAction(
    "labs-hard-stop",
    budget_name=budget.name,
    action_type="APPLY_SCP_POLICY",
    approval_model="AUTOMATIC",
    notification_type="ACTUAL",
    execution_role_arn=budgets_role.arn,
    action_threshold=aws.budgets.BudgetActionActionThresholdArgs(
        action_threshold_type="PERCENTAGE",
        action_threshold_value=100,
    ),
    definition=aws.budgets.BudgetActionDefinitionArgs(
        scp_action_definition=aws.budgets.BudgetActionDefinitionScpActionDefinitionArgs(
            policy_id=deny_new_spend.id,
            target_ids=[labs_ou.id, sandbox_account_id],
        ),
    ),
    subscribers=[aws.budgets.BudgetActionSubscriberArgs(address=alert_email, subscription_type="EMAIL")],
    opts=pulumi.ResourceOptions(depends_on=[budgets_role_policy]),
)

anomaly_monitor = aws.costexplorer.AnomalyMonitor(
    "labs-anomaly",
    name="labs-services",
    monitor_type="DIMENSIONAL",
    monitor_dimension="SERVICE",
)

aws.costexplorer.AnomalySubscription(
    "labs-anomaly-email",
    name="labs-anomaly-email",
    frequency="DAILY",
    monitor_arn_lists=[anomaly_monitor.arn],
    subscribers=[aws.costexplorer.AnomalySubscriptionSubscriberArgs(type="EMAIL", address=alert_email)],
    threshold_expression=aws.costexplorer.AnomalySubscriptionThresholdExpressionArgs(
        dimension=aws.costexplorer.AnomalySubscriptionThresholdExpressionDimensionArgs(
            key="ANOMALY_TOTAL_IMPACT_ABSOLUTE",
            match_options=["GREATER_THAN_OR_EQUAL"],
            values=["5"],
        ),
    ),
)

# A tag key can only be activated after AWS has seen it on a resource, so this waits for the first lab run.
if activate_cost_tags:
    for key in ("lab_run_id", "lab_scenario"):
        aws.costexplorer.CostAllocationTag(f"cost-tag-{key}", tag_key=key, status="Active")

pulumi.export("labs_ou_id", labs_ou.id)
pulumi.export("deny_new_spend_policy_id", deny_new_spend.id)
pulumi.export("budget_action_id", budget_action.action_id)
