#!/usr/bin/env python3
"""Fail-closed operator bootstrap for Pentra's managed SES stack.

Inventory is the default and is read-only. ``deploy`` is deliberately gated by
an exact account id and an explicit dedicated-account acknowledgement. The
tool never requests SES production access, sends mail, changes DNS, or prints
secret material.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import secrets
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Sequence


REGION = "us-east-1"
STACK_NAME = "pentra-managed-ses-v1"
RESOURCE_PREFIX = "pentra-managed-ses-v1"


class BootstrapError(RuntimeError):
    pass


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


class Runner:
    def run(
        self,
        argv: Sequence[str],
        *,
        stdin: str | None = None,
        allow_failure: bool = False,
        cwd: pathlib.Path | None = None,
    ) -> CommandResult:
        completed = subprocess.run(
            list(argv),
            input=stdin,
            text=True,
            capture_output=True,
            cwd=cwd,
            check=False,
        )
        result = CommandResult(
            completed.returncode,
            completed.stdout,
            completed.stderr,
        )
        if result.returncode != 0 and not allow_failure:
            command = " ".join(argv[:3])
            detail = result.stderr.strip().splitlines()[-1:] or ["command failed"]
            raise BootstrapError(f"{command}: {detail[0][:240]}")
        return result


def _json(result: CommandResult) -> dict[str, Any]:
    if result.returncode != 0 or not result.stdout.strip():
        return {}
    parsed = json.loads(result.stdout)
    if not isinstance(parsed, dict):
        raise BootstrapError("AWS CLI returned an unexpected JSON shape")
    return parsed


def aws_json(
    runner: Runner,
    args: Sequence[str],
    *,
    allow_failure: bool = False,
    stdin: str | None = None,
) -> tuple[dict[str, Any], CommandResult]:
    result = runner.run(
        ["aws", *args, "--output", "json"],
        allow_failure=allow_failure,
        stdin=stdin,
    )
    return _json(result), result


def inventory(runner: Runner, region: str, stack_name: str) -> dict[str, Any]:
    identity, _ = aws_json(runner, ["sts", "get-caller-identity"])
    account, _ = aws_json(runner, ["sesv2", "get-account", "--region", region])
    identities, _ = aws_json(
        runner, ["sesv2", "list-email-identities", "--region", region]
    )
    configuration_sets, _ = aws_json(
        runner, ["sesv2", "list-configuration-sets", "--region", region]
    )
    tenants, tenants_result = aws_json(
        runner,
        ["sesv2", "list-tenants", "--region", region],
        allow_failure=True,
    )
    organization, organization_result = aws_json(
        runner,
        ["organizations", "describe-organization"],
        allow_failure=True,
    )
    stack, stack_result = aws_json(
        runner,
        [
            "cloudformation",
            "describe-stacks",
            "--stack-name",
            stack_name,
            "--region",
            region,
        ],
        allow_failure=True,
    )
    stacks = stack.get("Stacks", [])
    stack_row = stacks[0] if stacks else {}
    return {
        "version": 1,
        "accountId": identity.get("Account"),
        "callerArn": identity.get("Arn"),
        "region": region,
        "organizationMember": organization_result.returncode == 0,
        "organizationId": (organization.get("Organization") or {}).get("Id"),
        "ses": {
            "productionAccessEnabled": account.get("ProductionAccessEnabled"),
            "sendingEnabled": account.get("SendingEnabled"),
            "enforcementStatus": account.get("EnforcementStatus"),
            "identityCount": len(identities.get("EmailIdentities", [])),
            "configurationSetCount": len(
                configuration_sets.get("ConfigurationSets", [])
            ),
            "tenantCount": len(tenants.get("Tenants", []))
            if tenants_result.returncode == 0
            else None,
        },
        "stack": {
            "exists": stack_result.returncode == 0 and bool(stack_row),
            "status": stack_row.get("StackStatus"),
            "id": stack_row.get("StackId"),
        },
    }


def validate_hex_digest(value: str, label: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) != 64 or any(c not in "0123456789abcdef" for c in normalized):
        raise BootstrapError(f"{label} must be an exact lowercase SHA-256 digest")
    return normalized


def create_secret_if_absent(
    runner: Runner,
    *,
    region: str,
    name: str,
    document: dict[str, str],
) -> str:
    existing, result = aws_json(
        runner,
        ["secretsmanager", "describe-secret", "--secret-id", name, "--region", region],
        allow_failure=True,
    )
    if result.returncode == 0:
        arn = existing.get("ARN")
        if not isinstance(arn, str) or not arn:
            raise BootstrapError(f"Existing secret {name} has no ARN")
        return arn
    if "ResourceNotFoundException" not in result.stderr:
        raise BootstrapError(f"Cannot inspect existing secret {name}")
    payload = json.dumps(
        {"Name": name, "SecretString": json.dumps(document, separators=(",", ":"))},
        separators=(",", ":"),
    )
    created, _ = aws_json(
        runner,
        [
            "secretsmanager",
            "create-secret",
            "--region",
            region,
            "--cli-input-json",
            "file:///dev/stdin",
        ],
        stdin=payload,
    )
    arn = created.get("ARN")
    if not isinstance(arn, str) or not arn:
        raise BootstrapError(f"AWS did not return an ARN for {name}")
    return arn


def deploy(args: argparse.Namespace, runner: Runner) -> dict[str, Any]:
    if args.region != REGION:
        raise BootstrapError(f"Managed SES v1 is reviewed only for {REGION}")
    if not args.dedicated_account_acknowledged:
        raise BootstrapError("Refusing deploy without dedicated-account acknowledgement")
    state = inventory(runner, args.region, args.stack_name)
    if state["accountId"] != args.expected_account_id:
        raise BootstrapError("Authenticated AWS account does not match --expected-account-id")
    recipient_hash = validate_hex_digest(
        args.canary_recipient_sha256, "--canary-recipient-sha256"
    )
    operation_key = args.canary_operation_key.strip()
    if not 32 <= len(operation_key) <= 96 or not all(
        character.isalnum() or character in "_-" for character in operation_key
    ):
        raise BootstrapError(
            "--canary-operation-key must be 32..96 URL-safe opaque characters"
        )
    secret_prefix = f"pentra/{RESOURCE_PREFIX}"
    hmac_arn = create_secret_if_absent(
        runner,
        region=args.region,
        name=f"{secret_prefix}/request-hmac",
        document={
            "current": secrets.token_urlsafe(48),
            "resourceKey": secrets.token_urlsafe(48),
        },
    )
    disposition_arn = create_secret_if_absent(
        runner,
        region=args.region,
        name=f"{secret_prefix}/disposition",
        document={"key": secrets.token_urlsafe(48)},
    )
    inbound_arn = create_secret_if_absent(
        runner,
        region=args.region,
        name=f"{secret_prefix}/inbound-canary",
        document={"key": secrets.token_urlsafe(48)},
    )
    if len({hmac_arn, disposition_arn, inbound_arn}) != 3:
        raise BootstrapError("Purpose-separated secrets did not resolve to distinct ARNs")
    root = pathlib.Path(__file__).resolve().parent
    runner.run(
        ["sam", "build", "--template-file", "template.yaml"],
        cwd=root,
    )
    runner.run(
        [
            "sam",
            "deploy",
            "--template-file",
            ".aws-sam/build/template.yaml",
            "--stack-name",
            args.stack_name,
            "--region",
            args.region,
            "--capabilities",
            "CAPABILITY_NAMED_IAM",
            "--no-confirm-changeset",
            "--no-fail-on-empty-changeset",
            "--parameter-overrides",
            f"PentraWebhookUrl={args.webhook_url}",
            f"HmacSecretArn={hmac_arn}",
            f"DispositionSecretArn={disposition_arn}",
            f"InboundCanarySecretArn={inbound_arn}",
            f"AlertEmail={args.alert_email}",
            "DedicatedSesAccountAcknowledged=true",
            f"RfcMessageIdCanaryRecipientSha256={recipient_hash}",
            f"RfcMessageIdCanaryOperationKey={operation_key}",
        ],
        cwd=root,
    )
    final = inventory(runner, args.region, args.stack_name)
    final["deployReceipt"] = {
        "templateSha256": hashlib.sha256((root / "template.yaml").read_bytes()).hexdigest(),
        "secretArnsDistinct": True,
        "canaryOperationKeySha256": hashlib.sha256(
            operation_key.encode("utf-8")
        ).hexdigest(),
        "productionAccessRequested": False,
        "dnsChanged": False,
        "canarySent": False,
    }
    return final


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("command", choices=("inventory", "deploy"), nargs="?", default="inventory")
    result.add_argument("--region", default=REGION)
    result.add_argument("--stack-name", default=STACK_NAME)
    result.add_argument("--expected-account-id")
    result.add_argument("--dedicated-account-acknowledged", action="store_true")
    result.add_argument("--webhook-url")
    result.add_argument("--alert-email")
    result.add_argument("--canary-recipient-sha256")
    result.add_argument("--canary-operation-key")
    return result


def main(argv: Sequence[str] | None = None, runner: Runner | None = None) -> int:
    args = parser().parse_args(argv)
    runner = runner or Runner()
    try:
        if args.command == "inventory":
            receipt = inventory(runner, args.region, args.stack_name)
        else:
            required = {
                "--expected-account-id": args.expected_account_id,
                "--webhook-url": args.webhook_url,
                "--alert-email": args.alert_email,
                "--canary-recipient-sha256": args.canary_recipient_sha256,
                "--canary-operation-key": args.canary_operation_key,
            }
            missing = [name for name, value in required.items() if not value]
            if missing:
                raise BootstrapError(f"Missing required deploy inputs: {', '.join(missing)}")
            receipt = deploy(args, runner)
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0
    except (BootstrapError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)[:300]}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
