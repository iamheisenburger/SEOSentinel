from __future__ import annotations

import contextlib
import io
import json
import pathlib
import sys
import unittest

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import adapter  # noqa: E402
import events  # noqa: E402
from common import (  # noqa: E402
    AdapterInputError,
    AdapterRetryableError,
    deterministic_json,
    disposition_signature,
    response_signature,
)


class FakeAwsError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__("redacted")
        self.response = {"Error": {"Code": code}}


def decode(item):
    result = {}
    for key, value in item.items():
        if "S" in value:
            result[key] = value["S"]
        elif "N" in value:
            result[key] = int(value["N"])
        elif "BOOL" in value:
            result[key] = bool(value["BOOL"])
    return result


def encode(item):
    result = {}
    for key, value in item.items():
        if isinstance(value, bool):
            result[key] = {"BOOL": value}
        elif isinstance(value, int):
            result[key] = {"N": str(value)}
        else:
            result[key] = {"S": str(value)}
    return result


class FakeDynamoDb:
    def __init__(self) -> None:
        self.items = {}
        self.fail_next_transact = False
        self.before_next_transact = None

    def get_item(self, **kwargs):
        key = kwargs["Key"]["pk"]["S"]
        item = self.items.get(key)
        return {"Item": encode(item)} if item is not None else {}

    def put_item(self, **kwargs):
        item = decode(kwargs["Item"])
        if kwargs.get("ConditionExpression") and item["pk"] in self.items:
            raise FakeAwsError("ConditionalCheckFailedException")
        self.items[item["pk"]] = item
        return {}

    def update_item(self, **kwargs):
        key = kwargs["Key"]["pk"]["S"]
        item = self.items.get(key)
        if item is None:
            raise FakeAwsError("ConditionalCheckFailedException")
        expression = kwargs["UpdateExpression"]
        values = {key: decode({"v": value})["v"] for key, value in kwargs.get("ExpressionAttributeValues", {}).items()}

        if "provisionLeaseToken=:token" in expression:
            if item.get("state") != "provisioning":
                raise FakeAwsError("ConditionalCheckFailedException")
            lease = item.get("provisionLeaseExpiresAt")
            if isinstance(lease, int) and lease > values[":now"]:
                raise FakeAwsError("ConditionalCheckFailedException")
            item["provisionLeaseToken"] = values[":token"]
            item["provisionLeaseExpiresAt"] = values[":expires"]
            item["provisionExternalAttemptedAt"] = values[":now"]
            item["updatedAt"] = values[":now"]
        elif "resourceReceipt=:receipt" in expression:
            if (
                item.get("state") != "provisioning"
                or item.get("provisionLeaseToken") != values[":token"]
            ):
                raise FakeAwsError("ConditionalCheckFailedException")
            item["state"] = "ready"
            item["resourceReceipt"] = values[":receipt"]
            item["verifiedAt"] = values[":now"]
            item["updatedAt"] = values[":now"]
            item.pop("provisionLeaseToken", None)
            item.pop("provisionLeaseExpiresAt", None)
        elif "#state=:blocked" in expression:
            item["state"] = "blocked"
            item["code"] = values[":code"]
            item["updatedAt"] = values[":now"]
            item.pop("provisionLeaseToken", None)
            item.pop("provisionLeaseExpiresAt", None)
        elif "#state=:releasing" in expression:
            if item.get("unsettledSendCount") != 0:
                raise FakeAwsError("ConditionalCheckFailedException")
            lease = item.get("provisionLeaseExpiresAt")
            if isinstance(lease, int) and lease > values[":now"]:
                raise FakeAwsError("ConditionalCheckFailedException")
            item["state"] = "releasing"
            item["updatedAt"] = values[":now"]
        elif "#state=:verifying" in expression:
            if item.get("state") != "releasing":
                raise FakeAwsError("ConditionalCheckFailedException")
            item["state"] = "release_verifying"
            item["releaseVerifyAfter"] = values[":verifyAfter"]
            item["updatedAt"] = values[":now"]
            item.pop("provisionLeaseToken", None)
            item.pop("provisionLeaseExpiresAt", None)
        elif "#state=:released" in expression:
            if item.get("state") != "release_verifying":
                raise FakeAwsError("ConditionalCheckFailedException")
            item["state"] = "released"
            item["releasedAt"] = values[":now"]
            item["updatedAt"] = values[":now"]
            for field in ("tenantName", "fromEmail", "resourceReceipt", "releaseVerifyAfter"):
                item.pop(field, None)
        elif "releaseVerifyAfter=:next" in expression:
            item["releaseVerifyAfter"] = values[":next"]
            item["updatedAt"] = values[":now"]
        elif "#state=:confirmed" in expression:
            if item.get("state") != values[":quarantined"]:
                raise FakeAwsError("ConditionalCheckFailedException")
            item["state"] = values[":confirmed"]
            item["providerMessageIdDigest"] = values[":digest"]
            item["updatedAt"] = values[":now"]
        elif "#state=:state" in expression:
            item["state"] = values[":state"]
            item["updatedAt"] = values[":now"]
            if "verifiedAt=:now" in expression:
                item["verifiedAt"] = values[":now"]
            if ":code" in values:
                item["code"] = values[":code"]
            elif "REMOVE code" in expression:
                item.pop("code", None)
        else:
            raise AssertionError(f"unimplemented update: {expression}")
        return {}

    def transact_write_items(self, **kwargs):
        if self.before_next_transact is not None:
            callback = self.before_next_transact
            self.before_next_transact = None
            callback()
        if self.fail_next_transact:
            self.fail_next_transact = False
            raise FakeAwsError("InternalServerError")
        writes = kwargs["TransactItems"]
        first = writes[0]
        if "Put" in first:
            if "Put" in writes[1]:
                first_item = decode(first["Put"]["Item"])
                second_item = decode(writes[1]["Put"]["Item"])
                if first_item["pk"] in self.items or second_item["pk"] in self.items:
                    raise FakeAwsError("TransactionCanceledException")
                self.items[first_item["pk"]] = first_item
                self.items[second_item["pk"]] = second_item
                return {}
            send = decode(first["Put"]["Item"])
            if send["pk"] in self.items:
                raise FakeAwsError("TransactionCanceledException")
            resource_key = writes[1]["Update"]["Key"]["pk"]["S"]
            resource = self.items.get(resource_key)
            values = writes[1]["Update"]["ExpressionAttributeValues"]
            generation = int(values[":generation"]["N"])
            if not resource or resource.get("state") != "ready" or resource.get("generation") != generation:
                raise FakeAwsError("TransactionCanceledException")
            self.items[send["pk"]] = send
            resource["unsettledSendCount"] += 1
            attempt_at = int(values[":now"]["N"])
            resource["updatedAt"] = attempt_at
            resource["lastSendAttemptAt"] = attempt_at
            if len(writes) == 3:
                pacing_update = writes[2]["Update"]
                pacing_key = pacing_update["Key"]["pk"]["S"]
                pacing = self.items.setdefault(
                    pacing_key, {"pk": pacing_key, "kind": "pacing", "count": 0}
                )
                pacing["count"] += 1
                pacing["updatedAt"] = attempt_at
            return {}

        send_key = first["Update"]["Key"]["pk"]["S"]
        resource_key = writes[1]["Update"]["Key"]["pk"]["S"]
        send = self.items.get(send_key)
        resource = self.items.get(resource_key)
        if (
            not send
            or send.get("state") != "external_attempted"
            or not resource
            or resource.get("state") not in {"ready", "blocked"}
        ):
            raise FakeAwsError("TransactionCanceledException")
        values = first["Update"]["ExpressionAttributeValues"]
        resource_values = writes[1]["Update"]["ExpressionAttributeValues"]
        resource_condition = writes[1]["Update"].get("ConditionExpression", "")
        settled_days = resource.get("warmupSettledDayCount", 0)
        warmup_max = int(resource_values.get(":warmupMax", {"N": "14"})["N"])
        if (
            ":dayOne" in resource_values
            and settled_days >= warmup_max
        ) or (
            "warmupSettledDayCount >= :warmupMax" in resource_condition
            and settled_days < warmup_max
        ):
            raise FakeAwsError("TransactionCanceledException")
        marker_to_put = None
        if len(writes) == 3:
            warmup_guard = writes[2]
            if "Put" in warmup_guard:
                marker_to_put = decode(warmup_guard["Put"]["Item"])
                if marker_to_put["pk"] in self.items:
                    raise FakeAwsError("TransactionCanceledException")
            elif "ConditionCheck" in warmup_guard:
                check = warmup_guard["ConditionCheck"]
                marker = self.items.get(check["Key"]["pk"]["S"])
                expected = check["ExpressionAttributeValues"]
                if (
                    not marker
                    or marker.get("resourceOperationKey")
                    != expected[":resource"]["S"]
                    or marker.get("day") != expected[":day"]["S"]
                ):
                    raise FakeAwsError("TransactionCanceledException")
        state_value = values.get(":state") or values.get(":quarantined")
        if state_value is None:
            raise AssertionError("missing_terminal_state")
        send["state"] = state_value["S"]
        send["updatedAt"] = int(values[":now"]["N"])
        if ":messageDigest" in values:
            send["providerMessageIdDigest"] = values[":messageDigest"]["S"]
        if ":code" in values:
            send["code"] = values[":code"]["S"]
        if ":authorizedAt" in values:
            send["dispositionAuthorizedAt"] = int(values[":authorizedAt"]["N"])
        if ":receipt" in values:
            send["dispositionReceipt"] = values[":receipt"]["S"]
        resource["unsettledSendCount"] -= 1
        if ":dayOne" in resource_values:
            resource["warmupSettledDayCount"] = (
                resource.get("warmupSettledDayCount", 0) + 1
            )
        if marker_to_put is not None:
            self.items[marker_to_put["pk"]] = marker_to_put
        resource["updatedAt"] = int(
            writes[1]["Update"]["ExpressionAttributeValues"][":now"]["N"]
        )
        return {}


class FakeSes:
    def __init__(self, failure: Exception | None = None) -> None:
        self.failure = failure
        self.send_count = 0
        self.tenants = {}
        self.create_count = 0
        self.production_access_enabled = True
        self.sending_enabled = True
        self.missing_identity = False
        self.event_bus_arn = None

    def send_email(self, **_kwargs):
        self.send_count += 1
        if self.failure:
            raise self.failure
        return {"MessageId": "provider-message-0001"}

    def get_account(self):
        return {
            "ProductionAccessEnabled": self.production_access_enabled,
            "SendingEnabled": self.sending_enabled,
        }

    def get_email_identity(self, **_kwargs):
        if self.missing_identity:
            raise FakeAwsError("NotFoundException")
        return {
            "VerifiedForSendingStatus": True,
            "DkimAttributes": {"Status": "SUCCESS", "SigningEnabled": True},
        }

    def get_configuration_set(self, **_kwargs):
        return {"SendingOptions": {"SendingEnabled": True}}

    def get_configuration_set_event_destinations(self, **_kwargs):
        return {
            "EventDestinations": [
                {
                    "Name": adapter.EVENT_DESTINATION_NAME,
                    "Enabled": True,
                    "MatchingEventTypes": [
                        "SEND",
                        "DELIVERY",
                        "BOUNCE",
                        "COMPLAINT",
                        "DELIVERY_DELAY",
                        "REJECT",
                        "RENDERING_FAILURE",
                    ],
                    "EventBridgeDestination": {
                        "EventBusArn": self.event_bus_arn or adapter.EVENT_BUS_ARN
                    },
                }
            ]
        }

    def create_tenant(self, **kwargs):
        self.create_count += 1
        name = kwargs["TenantName"]
        if name in self.tenants:
            raise FakeAwsError("AlreadyExistsException")
        self.tenants[name] = {
            "TenantName": name,
            "SendingStatus": "ENABLED",
            "Tags": list(kwargs["Tags"]),
            "SuppressionAttributes": dict(kwargs["SuppressionAttributes"]),
            "resources": set(),
        }
        return {"TenantId": "tn-test"}

    def create_tenant_resource_association(self, **kwargs):
        tenant = self.tenants.get(kwargs["TenantName"])
        if not tenant:
            raise FakeAwsError("NotFoundException")
        if kwargs["ResourceArn"] in tenant["resources"]:
            raise FakeAwsError("AlreadyExistsException")
        tenant["resources"].add(kwargs["ResourceArn"])
        return {}

    def put_tenant_suppression_attributes(self, **kwargs):
        tenant = self.tenants[kwargs["TenantName"]]
        tenant["SuppressionAttributes"] = {
            "SuppressionScope": kwargs["SuppressionScope"],
            "SuppressedReasons": list(kwargs["SuppressedReasons"]),
        }
        return {}

    def list_tenant_resources(self, **kwargs):
        tenant = self.tenants[kwargs["TenantName"]]
        return {
            "TenantResources": [
                {"ResourceArn": arn, "ResourceType": "EMAIL_IDENTITY"}
                for arn in sorted(tenant["resources"])
            ]
        }

    def delete_tenant_resource_association(self, **kwargs):
        tenant = self.tenants.get(kwargs["TenantName"])
        if tenant:
            tenant["resources"].discard(kwargs["ResourceArn"])
        return {}

    def delete_tenant(self, **kwargs):
        self.tenants.pop(kwargs["TenantName"], None)
        return {}

    def get_tenant(self, **kwargs):
        tenant = self.tenants.get(kwargs["TenantName"])
        if not tenant:
            raise FakeAwsError("NotFoundException")
        return {
            "Tenant": {
                key: value
                for key, value in tenant.items()
                if key != "resources"
            }
        }


class FakeWebhookResponse:
    def __init__(self, status, body, headers):
        self.status = status
        self._body = body
        self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self._body


class FakeWebhookOpener:
    def __init__(self, response):
        self.response = response

    def open(self, _request, timeout):
        if timeout != 10:
            raise AssertionError("unexpected_timeout")
        return self.response


class NoReplayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ddb = FakeDynamoDb()
        self.ses = FakeSes()
        adapter._CLIENTS.clear()
        adapter._CLIENTS.update(
            {
                "dynamodb": self.ddb,
                "sesv2": self.ses,
                "sesv2_send_no_retry": self.ses,
            }
        )
        adapter.TABLE_NAME = "state"
        adapter.ADAPTER_VERSION = "managed-ses-v1"
        adapter.SENDER_DOMAIN = "mail.pentra.dev"
        adapter.RELAY_DOMAIN = "reply.pentra.dev"
        adapter.UNSUBSCRIBE_ORIGIN = "https://pentra.dev"
        adapter.IDENTITY_ARN = "arn:aws:ses:us-east-1:123456789012:identity/mail.pentra.dev"
        adapter.CONFIGURATION_SET_NAME = "pentra-events"
        adapter.CONFIGURATION_SET_ARN = "arn:aws:ses:us-east-1:123456789012:configuration-set/pentra-events"
        adapter.EVENT_DESTINATION_NAME = "pentra-managed-ses-v1-eventbridge"
        adapter.EVENT_BUS_ARN = (
            "arn:aws:events:us-east-1:123456789012:event-bus/default"
        )
        events.ADAPTER_VERSION = adapter.ADAPTER_VERSION
        events.TABLE_NAME = adapter.TABLE_NAME

        self.resource_operation = "r" * 40
        self.send_operation = "s" * 40
        self.secrets = {
            "current": "c" * 40,
            "signWith": "current",
            "resourceKey": "k" * 40,
        }
        self.message_binding = "b" * 64
        self.tenant_name = "pentra-" + "1" * 40
        self.ddb.items[adapter._resource_key(self.resource_operation)] = {
            "pk": adapter._resource_key(self.resource_operation),
            "kind": "resource",
            "state": "ready",
            "generation": 2,
            "adapterVersion": adapter.ADAPTER_VERSION,
            "senderDomain": adapter.SENDER_DOMAIN,
            "identityArn": adapter.IDENTITY_ARN,
            "configurationSetName": adapter.CONFIGURATION_SET_NAME,
            "configurationSetArn": adapter.CONFIGURATION_SET_ARN,
            "eventDestinationName": adapter.EVENT_DESTINATION_NAME,
            "eventBusArn": adapter.EVENT_BUS_ARN,
            "tenantName": self.tenant_name,
            "fromEmail": "outreach-abc123@mail.pentra.dev",
            "unsettledSendCount": 0,
            "verifiedAt": 1,
            "resourceReceipt": "a" * 64,
            "createdAt": 1,
            "updatedAt": 1,
        }
        self.ddb.items[
            adapter._sender_key("outreach-abc123@mail.pentra.dev")
        ] = {
            "pk": adapter._sender_key("outreach-abc123@mail.pentra.dev"),
            "kind": "sender_guard",
            "resourceOperationKey": self.resource_operation,
            "generation": 2,
            "createdAt": 1,
        }

    def payload(self):
        return {
            "version": 1,
            "adapterVersion": adapter.ADAPTER_VERSION,
            "operationKey": self.send_operation,
            "resourceOperationKey": self.resource_operation,
            "generation": 2,
            "toEmail": "prospect@example.com",
            "displayName": "Pentra customer",
            "subject": "Useful research",
            "text": "Hello.\n\nUnsubscribe any time.",
            "replyTo": "reply-" + "a" * 32 + "@reply.pentra.dev",
            "unsubscribeUrl": "https://pentra.dev/unsubscribe/opaque",
        }

    def test_send_client_explicitly_disables_sdk_retries(self) -> None:
        calls = []

        class CapturingConfig:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        class CapturingBoto3:
            @staticmethod
            def client(name, **kwargs):
                calls.append((name, kwargs))
                return object()

        original_boto3 = adapter.boto3
        original_config = adapter.BotoConfig
        original_clients = dict(adapter._CLIENTS)
        try:
            adapter.boto3 = CapturingBoto3()
            adapter.BotoConfig = CapturingConfig
            adapter._CLIENTS.pop("sesv2_send_no_retry", None)
            adapter._ses_send_client()
        finally:
            adapter.boto3 = original_boto3
            adapter.BotoConfig = original_config
            adapter._CLIENTS.clear()
            adapter._CLIENTS.update(original_clients)

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "sesv2")
        config = calls[0][1]["config"]
        self.assertEqual(
            config.kwargs["retries"],
            {"mode": "standard", "total_max_attempts": 1},
        )

    def test_successful_send_is_never_replayed(self) -> None:
        first = adapter._send(self.payload(), self.secrets, 100)
        second = adapter._send(self.payload(), self.secrets, 100)
        self.assertEqual(first["state"], "submitted")
        self.assertEqual(second["state"], "submitted")
        self.assertEqual(self.ses.send_count, 1)
        self.assertEqual(
            self.ddb.items[adapter._resource_key(self.resource_operation)][
                "unsettledSendCount"
            ],
            0,
        )
        persisted = json.dumps(self.ddb.items, sort_keys=True)
        for forbidden in (
            "prospect@example.com",
            "Useful research",
            "Unsubscribe any time",
            "reply-aaaaaaaa",
        ):
            self.assertNotIn(forbidden, persisted)

    def test_send_never_uses_the_retrying_general_ses_client(self) -> None:
        class RetryingClientMustNotBeUsed:
            @staticmethod
            def send_email(**_kwargs):
                raise AssertionError("retrying_general_ses_client_selected")

        adapter._CLIENTS["sesv2"] = RetryingClientMustNotBeUsed()
        adapter._CLIENTS["sesv2_send_no_retry"] = self.ses

        result = adapter._send(self.payload(), self.secrets, 100)

        self.assertEqual(result["state"], "submitted")
        self.assertEqual(self.ses.send_count, 1)

    def test_reused_operation_key_cannot_claim_a_different_message(self) -> None:
        first = adapter._send(self.payload(), self.secrets, 100)
        changed = self.payload()
        changed["text"] = "A different message must not adopt the old receipt."
        with self.assertRaisesRegex(
            AdapterInputError, "operation_binding_conflict"
        ):
            adapter._send(changed, self.secrets, 101)
        self.assertEqual(first["state"], "submitted")
        self.assertEqual(self.ses.send_count, 1)
        persisted = self.ddb.items[adapter._send_key(self.send_operation)]
        self.assertRegex(persisted["messageBinding"], r"^[a-f0-9]{64}$")
        self.assertNotIn("different", json.dumps(persisted).lower())

    def test_terminal_receipt_race_requires_exact_provider_digest(self) -> None:
        adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
        )
        send = self.ddb.items[adapter._send_key(self.send_operation)]
        send["state"] = "submitted"
        send["providerMessageIdDigest"] = "a" * 64
        self.ddb.items[adapter._resource_key(self.resource_operation)][
            "unsettledSendCount"
        ] = 0
        with self.assertRaisesRegex(
            AdapterInputError, "provider_receipt_mismatch"
        ):
            adapter._mark_send_terminal(
                self.send_operation,
                self.resource_operation,
                2,
                "event_confirmed",
                101,
                provider_message_id_digest="b" * 64,
            )
        matched = adapter._mark_send_terminal(
            self.send_operation,
            self.resource_operation,
            2,
            "event_confirmed",
            102,
            provider_message_id_digest="a" * 64,
        )
        self.assertEqual(matched["state"], "submitted")

    def test_warmup_day_ledger_stops_at_maximum_tier(self) -> None:
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        resource["warmupSettledDayCount"] = adapter.MAX_WARMUP_SETTLED_DAYS
        adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            15 * 86_400,
        )
        adapter._mark_send_terminal(
            self.send_operation,
            self.resource_operation,
            2,
            "submitted",
            15 * 86_400 + 1,
            provider_message_id_digest="a" * 64,
        )
        self.assertEqual(
            resource["warmupSettledDayCount"], adapter.MAX_WARMUP_SETTLED_DAYS
        )
        self.assertEqual(
            [row for row in self.ddb.items.values() if row.get("kind") == "warmup_day"],
            [],
        )

    def test_transient_send_marker_failure_is_retryable_not_terminal(self) -> None:
        self.ddb.fail_next_transact = True
        with self.assertRaisesRegex(
            AdapterRetryableError, "send_marker_unavailable"
        ):
            adapter._send(self.payload(), self.secrets, 100)
        self.assertEqual(self.ses.send_count, 0)
        self.assertNotIn(adapter._send_key(self.send_operation), self.ddb.items)

    def test_send_rejects_non_pentra_unsubscribe_origin_before_attempt(self) -> None:
        payload = self.payload()
        payload["unsubscribeUrl"] = "https://example.com/unsubscribe/opaque"
        with self.assertRaisesRegex(AdapterInputError, "invalid_unsubscribe_url"):
            adapter._send(payload, self.secrets, 100)
        self.assertEqual(self.ses.send_count, 0)
        self.assertNotIn(adapter._send_key(self.send_operation), self.ddb.items)

    def test_ambiguous_send_is_marked_and_never_replayed(self) -> None:
        self.ses.failure = OSError("network body must not persist")
        with self.assertRaisesRegex(AdapterRetryableError, "provider_attempt_ambiguous"):
            adapter._send(self.payload(), self.secrets, 100)
        self.ses.failure = None
        second = adapter._send(self.payload(), self.secrets, 101)
        self.assertEqual(second["state"], "external_attempted")
        self.assertTrue(second["noReplay"])
        self.assertEqual(self.ses.send_count, 1)
        self.assertEqual(
            self.ddb.items[adapter._resource_key(self.resource_operation)][
                "unsettledSendCount"
            ],
            1,
        )

    def test_distinct_send_is_paced_by_tenant_resource(self) -> None:
        adapter._send(self.payload(), self.secrets, 100)
        second_payload = self.payload()
        second_payload["operationKey"] = "t" * 40
        with self.assertRaisesRegex(AdapterRetryableError, "sender_pacing_wait"):
            adapter._send(second_payload, self.secrets, 101)
        accepted = adapter._send(
            second_payload, self.secrets, 100 + 30 * 60
        )
        self.assertEqual(accepted["state"], "submitted")
        self.assertEqual(self.ses.send_count, 2)
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        self.assertEqual(resource["warmupSettledDayCount"], 1)

    def test_out_of_order_settlement_counts_each_warmup_day_once(self) -> None:
        day_one = 86_400 + 100
        day_two = 2 * 86_400 + 100
        first_operation = "u" * 40
        second_operation = "v" * 40
        third_operation = "w" * 40
        adapter._begin_send(
            first_operation, self.resource_operation, 2, "1" * 64, day_one
        )
        adapter._begin_send(
            second_operation, self.resource_operation, 2, "2" * 64, day_two
        )
        adapter._mark_send_terminal(
            second_operation,
            self.resource_operation,
            2,
            "submitted",
            day_two + 1,
            provider_message_id_digest="b" * 64,
        )
        adapter._mark_send_terminal(
            first_operation,
            self.resource_operation,
            2,
            "submitted",
            day_two + 2,
            provider_message_id_digest="a" * 64,
        )
        adapter._begin_send(
            third_operation,
            self.resource_operation,
            2,
            "3" * 64,
            day_two + adapter.MIN_SEND_SPACING_SECONDS,
        )
        adapter._mark_send_terminal(
            third_operation,
            self.resource_operation,
            2,
            "submitted",
            day_two + adapter.MIN_SEND_SPACING_SECONDS + 1,
            provider_message_id_digest="c" * 64,
        )
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        self.assertEqual(resource["warmupSettledDayCount"], 2)
        warmup_rows = [
            row
            for row in self.ddb.items.values()
            if row.get("kind") == "warmup_day"
        ]
        self.assertEqual(len(warmup_rows), 2)

    def test_signed_event_can_settle_lost_send_response_without_replay(self) -> None:
        row, claimed = adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
        )
        self.assertTrue(claimed)
        self.assertEqual(row["state"], "external_attempted")
        envelope = {
            "operationKey": self.send_operation,
            "messageIdDigest": "d" * 64,
        }
        with self.assertRaisesRegex(
            AdapterRetryableError, "provider_receipt_settlement_wait"
        ):
            events._settle_ambiguous_send(envelope, row, 110)
        settled = events._settle_ambiguous_send(
            envelope,
            row,
            100 + events.SEND_RECEIPT_SETTLEMENT_GRACE_SECONDS,
        )
        self.assertEqual(settled["state"], "event_confirmed")
        self.assertEqual(settled["providerMessageIdDigest"], "d" * 64)
        self.assertEqual(
            self.ddb.items[adapter._resource_key(self.resource_operation)][
                "unsettledSendCount"
            ],
            0,
        )
        self.assertEqual(self.ses.send_count, 0)

    def test_event_redelivery_reuses_first_signed_body_and_semantic_receipt(self) -> None:
        self.ddb.items[adapter._send_key(self.send_operation)] = {
            "pk": adapter._send_key(self.send_operation),
            "kind": "send",
            "state": "submitted",
            "operationKey": self.send_operation,
            "resourceOperationKey": self.resource_operation,
            "generation": 2,
            "adapterVersion": adapter.ADAPTER_VERSION,
            "providerMessageIdDigest": adapter.sha256_hex("provider-message-0001"),
            "createdAt": 100,
            "updatedAt": 100,
        }
        first = {
            "eventType": "Email Delivered",
            "eventId": "12345678-1234-1234-1234-123456789abc",
            "eventTime": "2026-08-25T19:00:00Z",
            "messageId": "provider-message-0001",
            "attempt": [self.send_operation],
        }
        second = {
            **first,
            "eventId": "87654321-4321-4321-4321-cba987654321",
            "eventTime": "2026-08-25T19:00:03Z",
        }
        bodies = []
        original_post = events._post_event
        original_secrets = events._load_secrets
        try:
            def capture_retry(body, _secrets, _event_key, _event_receipt):
                bodies.append(body)
                raise AdapterRetryableError("webhook_retry")

            events._post_event = capture_retry
            events._load_secrets = lambda: {
                "current": "c" * 40,
                "signWith": "current",
                "resourceKey": "r" * 40,
                "dispositionKey": "d" * 40,
            }
            with self.assertRaisesRegex(AdapterRetryableError, "webhook_retry"):
                events.process_envelope(first, now=200)
            with self.assertRaisesRegex(AdapterRetryableError, "webhook_retry"):
                events.process_envelope(second, now=201)
        finally:
            events._post_event = original_post
            events._load_secrets = original_secrets
        self.assertEqual(len(bodies), 2)
        self.assertEqual(bodies[0], bodies[1])
        persisted = [
            item
            for item in self.ddb.items.values()
            if item.get("kind") == "event"
        ]
        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted[0]["eventTime"], first["eventTime"])

    def test_malformed_transformed_event_is_quarantined_not_discarded(self) -> None:
        actual = events.handler(
            {"Records": [{"messageId": "queue-message", "body": "{"}]}, None
        )
        self.assertEqual(
            actual,
            {"batchItemFailures": [{"itemIdentifier": "queue-message"}]},
        )

    def test_unexpected_event_failure_is_sanitized_and_retained(self) -> None:
        original = events.process_envelope
        output = io.StringIO()
        try:
            def fail_with_provider_detail(_envelope):
                raise RuntimeError("provider-error-detail")

            events.process_envelope = fail_with_provider_detail
            with contextlib.redirect_stdout(output):
                actual = events.handler(
                    {
                        "Records": [
                            {
                                "messageId": "queue-message",
                                "body": "{}",
                            }
                        ]
                    },
                    None,
                )
        finally:
            events.process_envelope = original

        self.assertEqual(
            actual,
            {"batchItemFailures": [{"itemIdentifier": "queue-message"}]},
        )
        self.assertNotIn("provider-error-detail", output.getvalue())

    def test_missing_queue_identifier_raises_only_a_finite_error(self) -> None:
        original = events.process_envelope
        try:
            def fail_with_provider_detail(_envelope):
                raise RuntimeError("provider-error-detail")

            events.process_envelope = fail_with_provider_detail
            with self.assertRaisesRegex(
                RuntimeError, "^event_batch_identifier_invalid$"
            ) as raised:
                events.handler({"Records": [{"body": "{}"}]}, None)
        finally:
            events.process_envelope = original

        self.assertTrue(raised.exception.__suppress_context__)
        self.assertNotIn("provider-error-detail", str(raised.exception))

    def test_webhook_requires_signed_exact_durable_acknowledgement(self) -> None:
        receipt = "e" * 64
        event_key = "f" * 64
        secret = "c" * 40
        acknowledgement = deterministic_json(
            {"version": 1, "ok": True, "eventReceipt": receipt}
        )
        timestamp = 1_000
        headers = {
            "X-Pentra-Response-Timestamp": str(timestamp),
            "X-Pentra-Response-Signature": response_signature(
                secret, event_key, timestamp, acknowledgement
            ),
        }
        original_opener = events._OPENER
        original_url = events.PENTRA_WEBHOOK_URL
        original_time = events.time.time
        try:
            events.PENTRA_WEBHOOK_URL = (
                "https://deployment.convex.site/webhooks/outreach-managed-ses"
            )
            events.time.time = lambda: timestamp
            events._OPENER = FakeWebhookOpener(
                FakeWebhookResponse(200, acknowledgement, headers)
            )
            self.assertEqual(
                events._post_event(
                    b'{"event":"reduced"}',
                    {"current": secret, "signWith": "current"},
                    event_key,
                    receipt,
                ),
                (200, None),
            )
            events._OPENER = FakeWebhookOpener(
                FakeWebhookResponse(200, acknowledgement, {})
            )
            with self.assertRaisesRegex(
                AdapterRetryableError, "webhook_ack_invalid"
            ):
                events._post_event(
                    b'{"event":"reduced"}',
                    {"current": secret, "signWith": "current"},
                    event_key,
                    receipt,
                )
        finally:
            events._OPENER = original_opener
            events.PENTRA_WEBHOOK_URL = original_url
            events.time.time = original_time

    def test_release_waits_for_ambiguous_send(self) -> None:
        adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
        )
        with self.assertRaisesRegex(AdapterRetryableError, "resource_has_unsettled_send"):
            adapter._release(
                {
                    "adapterVersion": adapter.ADAPTER_VERSION,
                    "operationKey": self.resource_operation,
                    "generation": 2,
                },
                120,
            )
        self.assertEqual(
            self.ddb.items[adapter._resource_key(self.resource_operation)]["state"],
            "ready",
        )

    def test_separately_authorized_disposition_preserves_no_replay_and_releases(self) -> None:
        self.ses.failure = OSError("ambiguous")
        with self.assertRaisesRegex(AdapterRetryableError, "provider_attempt_ambiguous"):
            adapter._send(self.payload(), self.secrets, 100)
        now = 100 + adapter.AMBIGUOUS_DISPOSITION_MIN_AGE_SECONDS
        disposition_key = "d" * 40
        payload = {
            "version": 1,
            "adapterVersion": adapter.ADAPTER_VERSION,
            "operationKey": self.send_operation,
            "resourceOperationKey": self.resource_operation,
            "generation": 2,
            "decision": "quarantine_no_replay",
            "authorizedAt": now,
            "authorizationReceipt": disposition_signature(
                disposition_key,
                self.send_operation,
                self.resource_operation,
                2,
                now,
            ),
        }
        disposition = adapter._disposition(
            payload,
            disposition_key,
            now,
        )
        self.assertEqual(disposition["state"], "quarantined_no_replay")
        self.assertTrue(disposition["noReplay"])
        self.assertEqual(
            self.ddb.items[adapter._resource_key(self.resource_operation)][
                "unsettledSendCount"
            ],
            0,
        )
        persisted = self.ddb.items[adapter._send_key(self.send_operation)]
        self.assertNotIn("expiresAt", persisted)
        self.assertRegex(persisted["dispositionReceipt"], r"^[a-f0-9]{64}$")
        late_event = events._settle_ambiguous_send(
            {
                "operationKey": self.send_operation,
                "messageIdDigest": "d" * 64,
            },
            persisted,
            now + 1,
        )
        self.assertEqual(
            late_event["state"], "event_confirmed_after_disposition"
        )
        repeated_event = events._settle_ambiguous_send(
            {
                "operationKey": self.send_operation,
                "messageIdDigest": "d" * 64,
            },
            late_event,
            now + 2,
        )
        self.assertEqual(
            repeated_event["state"], "event_confirmed_after_disposition"
        )
        self.assertEqual(
            self.ddb.items[adapter._resource_key(self.resource_operation)][
                "unsettledSendCount"
            ],
            0,
        )

    def test_ambiguous_disposition_cannot_run_before_review_window(self) -> None:
        adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
        )
        with self.assertRaisesRegex(AdapterRetryableError, "disposition_review_wait"):
            adapter._disposition(
                {
                    "adapterVersion": adapter.ADAPTER_VERSION,
                    "operationKey": self.send_operation,
                    "resourceOperationKey": self.resource_operation,
                    "generation": 2,
                    "decision": "quarantine_no_replay",
                },
                "d" * 40,
                101,
            )

    def test_provider_status_block_cannot_strand_inflight_send_settlement(self) -> None:
        row, claimed = adapter._begin_send(
            self.send_operation,
            self.resource_operation,
            2,
            self.message_binding,
            100,
        )
        self.assertTrue(claimed)
        self.assertEqual(row["state"], "external_attempted")
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        resource["state"] = "blocked"
        resource["code"] = "provider_resource_invalid"
        settled = adapter._mark_send_terminal(
            self.send_operation,
            self.resource_operation,
            2,
            "submitted",
            101,
            provider_message_id_digest="a" * 64,
        )
        self.assertEqual(settled["state"], "submitted")
        self.assertEqual(resource["unsettledSendCount"], 0)

    def test_release_requires_second_absence_check(self) -> None:
        self.ses.tenants[self.tenant_name] = {
            "TenantName": self.tenant_name,
            "SendingStatus": "ENABLED",
            "Tags": [],
            "SuppressionAttributes": {},
            "resources": set(),
        }
        first = adapter._release(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": self.resource_operation,
                "generation": 2,
            },
            200,
        )
        self.assertEqual(first["state"], "releasing")
        self.assertEqual(
            first["nextEligibleAt"], 200 + adapter.RELEASE_STABILITY_SECONDS
        )
        early = adapter._release(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": self.resource_operation,
                "generation": 2,
            },
            200 + adapter.RELEASE_STABILITY_SECONDS - 1,
        )
        self.assertEqual(early["state"], "releasing")
        final = adapter._release(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": self.resource_operation,
                "generation": 2,
            },
            200 + adapter.RELEASE_STABILITY_SECONDS,
        )
        self.assertEqual(final["state"], "released")
        released = self.ddb.items[adapter._resource_key(self.resource_operation)]
        self.assertNotIn("tenantName", released)
        self.assertNotIn("fromEmail", released)

    def test_release_before_provision_is_a_delete_wins_tombstone(self) -> None:
        operation = "q" * 40
        released = adapter._release(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": operation,
                "generation": 9,
            },
            200,
        )
        self.assertEqual(released["state"], "released")
        tombstone = self.ddb.items[adapter._resource_key(operation)]
        self.assertTrue(tombstone["releaseTombstone"])
        replayed_provision = adapter._provision(
            {
                "version": 1,
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": operation,
                "generation": 9,
            },
            self.secrets,
            201,
        )
        self.assertEqual(replayed_provision["state"], "released")
        self.assertEqual(self.ses.create_count, 0)
        self.assertNotIn("tenantName", tombstone)
        self.assertNotIn("fromEmail", tombstone)

    def test_release_winning_during_provision_is_idempotent_not_conflict(self) -> None:
        operation = "y" * 40
        self.ddb.before_next_transact = lambda: adapter._seal_missing_release(
            operation, 10, 200
        )
        result = adapter._provision(
            {
                "version": 1,
                "adapterVersion": adapter.ADAPTER_VERSION,
                "operationKey": operation,
                "generation": 10,
            },
            self.secrets,
            201,
        )
        self.assertEqual(result["state"], "released")
        self.assertEqual(self.ses.create_count, 0)

    def test_provision_is_tenant_suppressed_verified_and_idempotent(self) -> None:
        operation = "p" * 40
        secrets = {
            "current": "c" * 40,
            "signWith": "current",
            "resourceKey": "k" * 40,
        }
        payload = {
            "version": 1,
            "adapterVersion": adapter.ADAPTER_VERSION,
            "operationKey": operation,
            "generation": 7,
        }
        first = adapter._provision(payload, secrets, 1_000)
        second = adapter._provision(payload, secrets, 1_001)
        self.assertEqual(first["state"], "ready")
        self.assertEqual(second["state"], "ready")
        self.assertEqual(self.ses.create_count, 1)
        self.assertTrue(first["eventCanaryRequired"])
        self.assertRegex(first["resourceReceipt"], r"^[a-f0-9]{64}$")
        resource = self.ddb.items[adapter._resource_key(operation)]
        tenant = self.ses.tenants[resource["tenantName"]]
        self.assertEqual(
            tenant["SuppressionAttributes"],
            {
                "SuppressionScope": "TENANT",
                "SuppressedReasons": ["BOUNCE", "COMPLAINT"],
            },
        )
        self.assertEqual(
            tenant["resources"],
            {adapter.IDENTITY_ARN, adapter.CONFIGURATION_SET_ARN},
        )
        self.assertIn(adapter._sender_key(resource["fromEmail"]), self.ddb.items)

    def test_provision_never_reports_ready_before_ses_production_access(self) -> None:
        self.ses.production_access_enabled = False
        operation = "x" * 40
        with self.assertRaisesRegex(
            AdapterRetryableError, "provider_receipt_incomplete"
        ):
            adapter._provision(
                {
                    "version": 1,
                    "adapterVersion": adapter.ADAPTER_VERSION,
                    "operationKey": operation,
                    "generation": 1,
                },
                {
                    "current": "c" * 40,
                    "signWith": "current",
                    "resourceKey": "k" * 40,
                },
                1_000,
            )
        self.assertEqual(
            self.ddb.items[adapter._resource_key(operation)]["state"],
            "provisioning",
        )

    def test_transient_resource_marker_failure_is_retryable_not_conflict(self) -> None:
        operation = "z" * 40
        self.ddb.fail_next_transact = True
        with self.assertRaisesRegex(
            AdapterRetryableError, "resource_marker_unavailable"
        ):
            adapter._provision(
                {
                    "version": 1,
                    "adapterVersion": adapter.ADAPTER_VERSION,
                    "operationKey": operation,
                    "generation": 1,
                },
                self.secrets,
                1_000,
            )
        self.assertNotIn(adapter._resource_key(operation), self.ddb.items)

    def test_resource_status_reverifies_provider_and_recovers_only_when_exact(self) -> None:
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        self.ses.tenants[self.tenant_name] = {
            "TenantName": self.tenant_name,
            "SendingStatus": "ENABLED",
            "Tags": [
                {
                    "Key": "OperationDigest",
                    "Value": adapter.sha256_hex(self.resource_operation)[:32],
                }
            ],
            "SuppressionAttributes": {
                "SuppressionScope": "TENANT",
                "SuppressedReasons": ["BOUNCE", "COMPLAINT"],
            },
            "resources": {
                adapter.IDENTITY_ARN,
                adapter.CONFIGURATION_SET_ARN,
            },
        }
        ready = adapter._status(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "kind": "resource",
                "operationKey": self.resource_operation,
            },
            500,
        )
        self.assertEqual(ready["state"], "ready")
        self.assertEqual(ready["verifiedAt"], 500)
        self.ses.tenants.clear()
        blocked = adapter._status(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "kind": "resource",
                "operationKey": self.resource_operation,
            },
            600,
        )
        self.assertEqual(blocked["state"], "blocked")
        self.assertEqual(blocked["code"], "provider_resource_invalid")
        self.assertEqual(resource["verifiedAt"], 500)

    def test_missing_shared_identity_durably_blocks_resource(self) -> None:
        resource = self.ddb.items[adapter._resource_key(self.resource_operation)]
        self.ses.missing_identity = True
        blocked = adapter._status(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "kind": "resource",
                "operationKey": self.resource_operation,
            },
            700,
        )
        self.assertEqual(blocked["state"], "blocked")
        self.assertEqual(blocked["code"], "provider_resource_invalid")
        self.assertEqual(resource["state"], "blocked")

    def test_drifted_event_bus_durably_blocks_resource(self) -> None:
        self.ses.event_bus_arn = (
            "arn:aws:events:us-east-1:123456789012:event-bus/wrong"
        )
        blocked = adapter._status(
            {
                "adapterVersion": adapter.ADAPTER_VERSION,
                "kind": "resource",
                "operationKey": self.resource_operation,
            },
            701,
        )
        self.assertEqual(blocked["state"], "blocked")
        self.assertEqual(blocked["code"], "provider_resource_invalid")


if __name__ == "__main__":
    unittest.main()
