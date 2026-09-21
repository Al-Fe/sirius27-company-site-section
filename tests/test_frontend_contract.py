from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")

CORE_CODES = (
    "express_audit",
    "full_audit",
    "project_adaptation",
    "contractor_audit",
    "as_built_audit",
    "engineering_analysis",
)


class CommonFormFrameworkTests(unittest.TestCase):
    def test_new_page_uses_only_canonical_service_identities(self) -> None:
        self.assertNotIn("express_analysis", HTML)
        self.assertNotIn("value_engineering", HTML)

        card_codes = re.findall(
            r'class="[^"]*service-request[^"]*"[^>]*data-service-code="([^"]+)"',
            HTML,
        )
        self.assertEqual(tuple(card_codes), CORE_CODES)

    def test_selects_expose_expected_current_catalog(self) -> None:
        select_blocks = re.findall(
            r'<select[^>]+name="service_code"[^>]*>(.*?)</select>',
            HTML,
            flags=re.S,
        )
        self.assertEqual(len(select_blocks), 2)

        option_sets = []
        for block in select_blocks:
            values = tuple(
                value
                for value in re.findall(r'<option value="([^"]*)"', block)
                if value
            )
            option_sets.append(values)

        self.assertIn((*CORE_CODES, "recommendation"), option_sets)
        self.assertIn((*CORE_CODES, "other"), option_sets)

    def test_quick_report_uses_canonical_express_audit(self) -> None:
        quick = re.search(
            r'<form[^>]+id="quick-report-form"[^>]*>(.*?)</form>',
            HTML,
            flags=re.S,
        )
        self.assertIsNotNone(quick)
        self.assertIn(
            '<input type="hidden" name="service_code" value="express_audit">',
            quick.group(1),
        )

    def test_browser_does_not_submit_service_titles(self) -> None:
        self.assertNotIn('name="service_title"', HTML)
        self.assertNotIn("data-service-title=", HTML)
        self.assertIn("delete values.service_title;", HTML)

    def test_four_public_form_kinds_are_registered_once(self) -> None:
        form_kinds = re.findall(r'data-form-kind="([^"]+)"', HTML)
        self.assertEqual(
            tuple(form_kinds),
            ("cost_estimate", "quick_report", "consultation", "service_request"),
        )
        for form_kind in form_kinds:
            self.assertRegex(
                HTML,
                rf"\b{re.escape(form_kind)}:\s*Object\.freeze\(\{{",
            )

    def test_common_contract_enforces_server_side_business_rules_client_side(self) -> None:
        required_fragments = (
            "const validateFormContract = form =>",
            "requireEmail: true",
            "requireVolume: true",
            "requireMessage: true",
            "recommendationRequiresPhone: true",
            "serviceCodes: Object.freeze(['express_audit'])",
            "if (!serviceCatalog[serviceCode] || !contract.serviceCodes.includes(serviceCode))",
            "if (!phone && !email)",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, HTML)

    def test_intake_contract_and_idempotent_retry_mechanism_remain_v1(self) -> None:
        self.assertIn("schema_version: 'sirius.intake.v1'", HTML)
        self.assertIn("const endpoint = '/api/leads';", HTML)
        self.assertIn("'Idempotency-Key': pending.key", HTML)
        self.assertIn("public_request_number", HTML)
        self.assertIn("button.textContent = pending ? 'Повторить' : originalText;", HTML)

    def test_each_core_service_has_a_request_profile(self) -> None:
        for code in CORE_CODES:
            with self.subTest(code=code):
                self.assertRegex(
                    HTML,
                    rf"{re.escape(code)}:\s*Object\.freeze\(\{{[\s\S]*?request:\s*Object\.freeze\(\{{",
                )

        expected_goals = (
            "Что проверить в первую очередь?",
            "Цель полного аудита",
            "Причина адаптации",
            "Что проверить у подрядчика?",
            "Что требуется проверить?",
            "Основная цель анализа",
        )
        for label in expected_goals:
            with self.subTest(label=label):
                self.assertIn(label, HTML)

    def test_service_request_collects_structured_existing_api_fields(self) -> None:
        service_form = re.search(
            r'<form[^>]+id="service-form"[^>]*>(.*?)</form>',
            HTML,
            flags=re.S,
        )
        self.assertIsNotNone(service_form)
        block = service_form.group(1)
        self.assertIn('name="document_format"', block)
        self.assertIn('name="equipment_variety"', block)
        self.assertIn('id="modal-goal" data-request-detail required', block)
        self.assertIn('id="modal-scope" data-request-detail', block)
        self.assertNotIn('name="modal-goal"', block)
        self.assertNotIn('name="modal-scope"', block)

    def test_service_specific_details_are_folded_into_message_not_extra_json_keys(self) -> None:
        required_fragments = (
            "const requestDetails = Array.from(form.querySelectorAll('[data-request-detail]'))",
            "field.dataset.requestDetail",
            "values.message =",
            "Параметры заявки:",
            "Комментарий:",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, HTML)

    def test_unresolved_service_request_cannot_switch_to_another_service(self) -> None:
        self.assertIn("form.dataset.pendingRequest = 'true';", HTML)
        self.assertIn("delete form.dataset.pendingRequest;", HTML)
        self.assertIn("serviceForm.dataset.pendingRequest === 'true'", HTML)
        self.assertIn("Сначала подтвердите предыдущую отправку", HTML)

    def test_dynamic_disabled_state_survives_ambiguous_retry_edit(self) -> None:
        self.assertIn("let disabledBeforePending = null;", HTML)
        self.assertIn("disabledBeforePending = controls.map(control => control.disabled);", HTML)
        self.assertIn("const restoreDisabled = disabledBeforePending || initialDisabled;", HTML)
        self.assertIn("control.disabled = restoreDisabled[index]", HTML)
        self.assertIn('name="message" maxlength="9000" required', HTML)

if __name__ == "__main__":
    unittest.main()
