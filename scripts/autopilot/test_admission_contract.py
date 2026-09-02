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
        self.assertIn("workflow_id: 'autopilot-runner.yml'", intake)
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

    def test_runner_publishes_attempt_run_bound_start_and_release(self):
        runner = self.text("reusable-autopilot-runner.yml")
        self.assertIn("praxis_attempt_id:", runner)
        self.assertIn("state=started conclusion=", runner)
        self.assertIn("state=released conclusion=${conclusion}", runner)
        self.assertIn("admission-release:", runner)
        self.assertIn("if: always()", runner)


if __name__ == "__main__":
    unittest.main()
