from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("managed_ses_bootstrap", ROOT / "bootstrap.py")
assert SPEC and SPEC.loader
bootstrap = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bootstrap
SPEC.loader.exec_module(bootstrap)


class FakeRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[list[str], str | None]] = []

    def run(self, argv, *, stdin=None, allow_failure=False, cwd=None):
        del cwd
        command = list(argv)
        self.calls.append((command, stdin))
        joined = " ".join(command)
        if "get-caller-identity" in joined:
            body = {"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:root"}
        elif "get-account" in joined:
            body = {"ProductionAccessEnabled": False, "SendingEnabled": True, "EnforcementStatus": "HEALTHY"}
        elif "list-email-identities" in joined:
            body = {"EmailIdentities": []}
        elif "list-configuration-sets" in joined:
            body = {"ConfigurationSets": []}
        elif "list-tenants" in joined:
            body = {"Tenants": []}
        elif "describe-organization" in joined:
            return bootstrap.CommandResult(1, "", "not in use")
        elif "describe-stacks" in joined:
            return bootstrap.CommandResult(1, "", "not found")
        else:
            raise AssertionError(joined)
        return bootstrap.CommandResult(0, json.dumps(body), "")


class BootstrapTests(unittest.TestCase):
    def test_inventory_is_read_only_and_sanitized(self) -> None:
        runner = FakeRunner()
        receipt = bootstrap.inventory(runner, "us-east-1", "pentra-managed-ses-v1")
        self.assertEqual(receipt["accountId"], "123456789012")
        self.assertEqual(receipt["ses"]["identityCount"], 0)
        self.assertEqual(receipt["ses"]["foreignIdentityCount"], 0)
        self.assertFalse(receipt["organizationMember"])
        self.assertFalse(receipt["stack"]["exists"])
        joined = " ".join(" ".join(call[0]) for call in runner.calls)
        for forbidden in ("create-", "update-", "delete-", "send-"):
            self.assertNotIn(forbidden, joined)

    def test_deploy_fails_before_aws_without_exact_acknowledgement(self) -> None:
        runner = FakeRunner()
        stderr = io.StringIO()
        with redirect_stderr(stderr), redirect_stdout(io.StringIO()):
            code = bootstrap.main(
                [
                    "deploy",
                    "--expected-account-id", "123456789012",
                    "--webhook-url", "https://deployment.convex.site/webhooks/outreach-managed-ses",
                    "--alert-email", "alerts@example.com",
                    "--canary-recipient-sha256", "a" * 64,
                    "--canary-operation-key", "canary_operation_key_123456789012345",
                ],
                runner,
            )
        self.assertEqual(code, 2)
        self.assertIn("dedicated-account acknowledgement", stderr.getvalue())
        self.assertEqual(runner.calls, [])

    def test_secret_material_uses_stdin_and_never_argv(self) -> None:
        class SecretRunner:
            def __init__(self):
                self.calls = []

            def run(self, argv, *, stdin=None, allow_failure=False, cwd=None):
                del allow_failure, cwd
                command = list(argv)
                self.calls.append((command, stdin))
                if "describe-secret" in command:
                    return bootstrap.CommandResult(
                        1, "", "ResourceNotFoundException: not found"
                    )
                return bootstrap.CommandResult(
                    0,
                    json.dumps({"ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:test"}),
                    "",
                )

        runner = SecretRunner()
        secret = "never-print-this-secret"
        arn = bootstrap.create_secret_if_absent(
            runner,
            region="us-east-1",
            name="pentra/test",
            document={"key": secret},
        )
        self.assertIn(":secret:test", arn)
        create_argv, create_stdin = runner.calls[-1]
        self.assertNotIn(secret, " ".join(create_argv))
        self.assertIn(secret, create_stdin)

    def test_digest_validation_is_exact(self) -> None:
        self.assertEqual(bootstrap.validate_hex_digest("a" * 64, "digest"), "a" * 64)
        with self.assertRaises(bootstrap.BootstrapError):
            bootstrap.validate_hex_digest("not-a-digest", "digest")


if __name__ == "__main__":
    unittest.main()
