from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / ".github/workflows/reusable-autopilot-runner.yml"
VALIDATE = ROOT / ".github/workflows/reusable-validate.yml"
UPSTREAM_SHA = "e5fe345623f53cb07e15afdba661a9e77bbcdd0f"


class RunnerFailurePathContractTests(unittest.TestCase):
    def test_branch_verifier_uses_ambient_read_only_token(self):
        workflow = RUNNER.read_text()
        verifier = workflow.split("  verify-fix-branch:", 1)[1].split(
            "\n  validate:", 1
        )[0]

        self.assertIn("github-token: ${{ github.token }}", verifier)
        self.assertNotIn("secrets.WORKFLOW_PAT", verifier)
        self.assertIn("contents: read", workflow.split("jobs:", 1)[0])

    def test_runner_pins_reviewed_autofix_workflow(self):
        workflow = RUNNER.read_text()

        self.assertIn(
            "cloudwarriors-ai/workflows/.github/workflows/"
            f"reusable-claude-autofix-rlm.yml@{UPSTREAM_SHA}",
            workflow,
        )

    def test_api_validation_joins_tailnet_with_forwarded_optional_secrets(self):
        runner = RUNNER.read_text()
        validate = VALIDATE.read_text()
        validate_call = runner.split("  validate-api:", 1)[1].split(
            "\n  app-tests:", 1
        )[0]
        declared_secrets = validate.split("    secrets:", 1)[1].split(
            "    outputs:", 1
        )[0]
        connect_step = validate.split("      - name: Connect to Tailscale", 1)[1].split(
            "\n      - name: Setup Python", 1
        )[0]

        for secret in ("TS_OAUTH_CLIENT_ID", "TS_OAUTH_SECRET"):
            self.assertIn(f"      {secret}:\n        required: false", declared_secrets)
            self.assertIn(
                f"      {secret}: ${{{{ secrets.{secret} }}}}", validate_call
            )

        self.assertIn(
            "if: steps.state.outputs.run == 'true' && env.TS_OAUTH_CLIENT_ID != ''",
            connect_step,
        )
        self.assertIn(
            "uses: tailscale/github-action@6cae46e2d796f265265cfcf628b72a32b4d7cade",
            connect_step,
        )
        self.assertIn("tags: tag:ci", connect_step)
        self.assertNotIn("run:", connect_step)

    def test_default_validation_checkout_honors_authorized_manifest_ref(self):
        validate = VALIDATE.read_text()
        default_checkout = validate.split(
            "      - name: Checkout caller repo (default)", 1
        )[1].split("\n      - name: Checkout manifest repo (override)", 1)[0]

        self.assertIn("ref: ${{ inputs.manifest_ref }}", default_checkout)
        self.assertIn("persist-credentials: false", default_checkout)


if __name__ == "__main__":
    unittest.main()
