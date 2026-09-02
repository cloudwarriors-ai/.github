"""Static regression contract for exact Autopilot occupancy and Praxis lineage."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"


class AdmissionContractTests(unittest.TestCase):
    def text(self, name: str) -> str:
        return (WORKFLOWS / name).read_text()

    def test_intake_counts_only_exact_runner(self):
        intake = self.text("reusable-autopilot-intake.yml")
        self.assertNotIn("listWorkflowRunsForRepo", intake)
        self.assertNotIn(".includes('autopilot')", intake)
        self.assertIn("github.paginate(github.rest.actions.listWorkflowRuns", intake)
        self.assertIn("workflow_id: 'autopilot-runner.yml'", intake)
        self.assertIn("run.status !== 'completed'", intake)
        self.assertIn("|| 'legacy'", intake)
        self.assertIn("Admission unavailable: runner occupancy read failed", intake)
        self.assertNotIn("core.warning(`Rate limit check failed", intake)
        self.assertIn("praxis_attempt_id: '${{ inputs.praxis_attempt_id }}'", intake)

    def test_queue_helpers_count_only_exact_runner(self):
        for name in (
            "reusable-autopilot-queue-agent.yml",
            "reusable-autopilot-queue-drain.yml",
        ):
            workflow = self.text(name)
            self.assertNotIn("listWorkflowRunsForRepo", workflow, name)
            self.assertNotIn(".includes('autopilot')", workflow, name)
            self.assertIn("workflow_id: 'autopilot-runner.yml'", workflow, name)
            self.assertIn("github.paginate(github.rest.actions.listWorkflowRuns", workflow, name)

    def test_runner_publishes_attempt_run_bound_start_and_release(self):
        runner = self.text("reusable-autopilot-runner.yml")
        self.assertIn("praxis_attempt_id:", runner)
        self.assertIn("state=started conclusion=", runner)
        self.assertIn("state=released conclusion=${conclusion}", runner)
        self.assertIn("admission-release:", runner)
        self.assertIn("if: always()", runner)
        self.assertIn("users.getAuthenticated()", runner)
        self.assertIn("comment.user?.login", runner)
        self.assertIn("lifecyclePattern = /^<!-- praxis:autofix-runner", runner)
        self.assertIn("firstLine === marker", runner)
        self.assertIn("const hasAdmissionIntent = comments.some", runner)
        self.assertIn("process.env.PRAXIS_ATTEMPT_ID", runner)
        self.assertIn("const intentMaxAgeMs = 180 * 60 * 1000", runner)
        self.assertIn("String(intent.attempt_id) === attempt", runner)
        self.assertIn("String(intent.repo) === expectedRepo", runner)
        self.assertIn("No live trusted Praxis admission intent binds attempt", runner)
        self.assertIn("state=(started|released)", runner)
        self.assertNotIn("praxis_claim_url:", runner)
        self.assertIn(
            "const claimUrl = 'https://molty-dev.cloudwarriors.ai/praxis/webhooks/autofix-claim'",
            runner,
        )
        self.assertIn("redirect: 'error'", runner)
        self.assertIn("await fetch(claimUrl", runner)
        self.assertIn("claim.accepted !== true", runner)
        self.assertLess(runner.index("await fetch(claimUrl"), runner.index("state=started conclusion="))
        release_header = runner.split("\n  admission-release:", 1)[1].split("\n    runs-on:", 1)[0]
        self.assertIn("if: always() && inputs.praxis_attempt_id != ''", release_header)
        self.assertNotIn("needs.admission-start.outputs.accepted", release_header)


if __name__ == "__main__":
    unittest.main()
