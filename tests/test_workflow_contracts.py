from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / ".github/workflows/reusable-autopilot-runner.yml"
UPSTREAM_SHA = "5538391970b1a6adcf66b7fb0c594f91853a3a83"


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


if __name__ == "__main__":
    unittest.main()
