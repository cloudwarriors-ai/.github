import os
from pathlib import Path
import subprocess
import textwrap
import unittest

RUNNER = (
    Path(__file__).resolve().parents[1]
    / ".github/workflows/reusable-autopilot-runner.yml"
)


class ReviewOnlyTests(unittest.TestCase):
    def test_target_authority_matrix(self):
        source = RUNNER.read_text().split(
            "      - name: Enforce dev-only issue branch\n", 1
        )[1]
        script = textwrap.dedent(
            source.split("        run: |\n", 1)[1].split("\n  # ", 1)[0]
        )
        for repo, mode, base, head, allowed in [
            ("macd_agent", "true", "main", "autofix/issue-604", True),
            ("macd_agent", "false", "main", "autofix/issue-604", False),
            ("macd_agent", "false", "dev", "autofix/issue-604", False),
            ("other", "true", "main", "autofix/issue-604", False),
            ("other", "false", "dev", "autofix/issue-604", True),
            ("other", "false", "main", "autofix/issue-604", False),
            ("macd_agent", "true", "main", "main", False),
            ("macd_agent", "true", "main", "autofix/issue-605", False),
        ]:
            with self.subTest(repo=repo, mode=mode, base=base, head=head):
                result = subprocess.run(
                    ["bash", "-c", script],
                    capture_output=True,
                    env={
                        **os.environ,
                        "GITHUB_REPOSITORY": "cloudwarriors-ai/" + repo,
                        "REVIEW_ONLY": mode,
                        "BASE": base,
                        "HEAD": head,
                        "ISSUE_NUM": "604",
                    },
                )
                self.assertEqual(result.returncode == 0, allowed, result.stderr)

    def test_effect_boundaries_refuse_review_only(self):
        workflow = RUNNER.read_text()
        for job in ["deploy-preview", "teardown-preview", "validate-api", "app-tests"]:
            condition = (
                workflow.split("  " + job + ":\n", 1)[1]
                .split("    if: |\n", 1)[1]
                .split("    runs-on:", 1)[0]
                .split("    uses:", 1)[0]
            )
            self.assertTrue(
                condition.lstrip().startswith("!inputs.review_only &&"), job
            )
        for step in [
            "Auto-merge",
            '"On hold: label Preview Ready"',
            '"On success: label In QA"',
            '"On already fixed: mark no PR needed"',
        ]:
            condition = workflow.split("      - name: " + step + "\n", 1)[1].split(
                "        if: |\n", 1
            )[1]
            self.assertTrue(
                condition.lstrip().startswith("!inputs.review_only &&"), step
            )
        pr = workflow.split("      - name: Upsert PR\n", 1)[1]
        self.assertIn(
            "(!inputs.review_only || needs.test.outputs.tests_passed == 'true') &&", pr
        )
        self.assertIn("review_only: ${{ inputs.review_only }}", workflow)

    def test_config_cannot_restore_release_authority(self):
        workflow = RUNNER.read_text()
        code = workflow.split('            if [ "$REVIEW_ONLY" = "true" ]; then\n', 1)[
            1
        ].split("\n            fi", 1)[0]
        script = "set -e\n" + code + '\nprintf "%s" "$CONFIG"\n'
        for config, success in [
            ("{}", False),
            ('{"testCommand":""}', False),
            (
                '{"testCommand":"pytest", "previewDeploy":true,"previewGate":true,"mergeRequirements":{"autoMerge":true},"appTestCommand":"deploy","dbMigrateCommand":"migrate"}',
                True,
            ),
        ]:
            result = subprocess.run(
                ["bash", "-c", script],
                env={**os.environ, "CONFIG": config},
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode == 0, success, result.stderr)
            if success:
                import json

                actual = json.loads(result.stdout)
                self.assertFalse(actual["previewDeploy"])
                self.assertFalse(actual["previewGate"])
                self.assertFalse(actual["mergeRequirements"]["autoMerge"])
                self.assertEqual(actual["appTestCommand"], "")
                self.assertEqual(actual["dbMigrateCommand"], "")

    def test_review_only_no_pr_cannot_succeed(self):
        condition = RUNNER.read_text().split(
            "      - name: Fail workflow when no reviewable, gate-passing PR was produced",
            1,
        )[1]
        self.assertIn(
            "(inputs.review_only || needs.verify-fix-branch.outputs.already_fixed != 'true') &&",
            condition,
        )
        self.assertIn("steps.pr.outputs.pr_ready != 'true'", condition)
