import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / ".github/workflows/reusable-autopilot-runner.yml"
VALIDATE = ROOT / ".github/workflows/reusable-validate.yml"
UPSTREAM_SHA = "e5fe345623f53cb07e15afdba661a9e77bbcdd0f"
SHARED_TOOLS_SHA = "8203521087a3dad5198f37c696d901f37cb485c2"
ARTIFACT_GUARD = ROOT / "scripts/autopilot/verify-app-test-artifacts.sh"


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

    def test_default_shared_tools_pin_contains_every_runtime_script(self):
        workflow = RUNNER.read_text()
        shared_tools_input = workflow.split("      shared_tools_ref:", 1)[1].split(
            "    secrets:", 1
        )[0]
        self.assertIn(f"default: '{SHARED_TOOLS_SHA}'", shared_tools_input)

        runtime_scripts = set(
            re.findall(r"/tmp/org-github/(scripts/[A-Za-z0-9_./-]+)", workflow)
        )
        self.assertTrue(runtime_scripts)
        for script in runtime_scripts:
            completed = subprocess.run(
                ["git", "cat-file", "-e", f"{SHARED_TOOLS_SHA}:{script}"],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(
                completed.returncode,
                0,
                f"{script} is absent from shared_tools_ref {SHARED_TOOLS_SHA}",
            )

    def test_publisher_is_bound_to_dev_issue_branch_before_write_authority(self):
        workflow = RUNNER.read_text()
        authorize = workflow.split("  authorize-target:", 1)[1].split(
            "\n  rlm-fix:", 1
        )[0]
        rlm_fix = workflow.split("  rlm-fix:", 1)[1].split(
            "\n  read-config:", 1
        )[0]
        deploy = workflow.split("  deploy-preview:", 1)[1].split(
            "\n  test:", 1
        )[0]

        self.assertIn('if [ "$BASE" != "dev" ]; then', authorize)
        self.assertIn("dev|main|master", authorize)
        self.assertIn('expected="autofix/issue-${ISSUE_NUM}"', authorize)
        self.assertIn('if [ "$HEAD" != "$expected" ]; then', authorize)
        self.assertIn("    needs: authorize-target", rlm_fix)
        self.assertIn("    environment: dev", deploy)
        self.assertNotIn("environment: production", deploy)
        self.assertNotIn("inputs.base == 'main'", deploy)

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

    def test_missing_optional_autopilot_label_cannot_block_pr_creation(self):
        workflow = RUNNER.read_text()
        create_pr = workflow.split("            PR_URL=$(gh pr create", 1)[1].split(
            '            PR_NUM=$(echo "$PR_URL"', 1
        )[0]
        ready_pr = workflow.split(
            '          if [ -z "$PR_NUM" ]; then', 1
        )[1].split("          PR_HEAD_SHA=", 1)[0]

        self.assertNotIn('--label "autopilot"', create_pr)
        self.assertIn('gh pr edit "$PR_NUM" --add-label "autopilot" ||', ready_pr)
        self.assertIn(
            "Could not add optional 'autopilot' label", ready_pr
        )

    def test_app_test_result_uses_expression_safe_step_id(self):
        workflow = RUNNER.read_text()
        app_tests = workflow.split("  app-tests:", 1)[1].split(
            "\n  finalize:", 1
        )[0]
        comparison = app_tests.split(
            "      - name: Compare against baseline", 1
        )[1].split("\n      - name: Upload app-test artifacts", 1)[0]

        self.assertIn("        id: app_tests", app_tests)
        self.assertIn("steps.app_tests.outcome", app_tests)
        self.assertNotIn("steps.app-tests.outcome", app_tests)
        self.assertNotIn("continue-on-error: true", comparison)
        self.assertIn("tr -d '\\r\\n' | base64 -d", comparison)
        self.assertIn(
            "Daily snapshot content is invalid — falling back to static baseline",
            comparison,
        )
        self.assertIn(
            "Required app-test artifacts are missing; refusing readiness",
            comparison,
        )
        self.assertIn(
            "No trusted app-test baseline found; refusing readiness",
            comparison,
        )
        self.assertGreaterEqual(comparison.count('echo "has_report=false"'), 2)
        self.assertGreaterEqual(comparison.count('echo "has_regressions=true"'), 2)
        self.assertIn("app_tests_has_report: ${{ steps.compare.outputs.has_report }}", app_tests)
        finalize = workflow.split("  finalize:", 1)[1]
        self.assertIn("app_tests_has_report == 'true'", finalize)
        self.assertIn("app_tests_has_regressions == 'false'", finalize)

    def test_app_tests_join_tailnet_after_dependency_installation(self):
        workflow = RUNNER.read_text()
        app_test_config = workflow.split("  app-test-config:", 1)[1].split(
            "\n  app-tests:", 1
        )[0]
        app_tests = workflow.split("  app-tests:", 1)[1].split(
            "\n  finalize:", 1
        )[0]
        finalize = workflow.split("  finalize:", 1)[1]
        resolve_index = app_test_config.index("      - name: Resolve trusted base SHA")
        config_checkout_index = app_test_config.index(
            "      - name: Checkout trusted base config"
        )
        config_read_index = app_test_config.index(
            "      - name: Read trusted App Tests config"
        )
        checkout_index = app_tests.index("      - name: Checkout trusted base tests")
        install_index = app_tests.index("      - name: Install Python dependencies")
        connect_index = app_tests.index("      - name: Connect to Tailscale")
        derive_index = app_tests.index(
            "      - name: Derive scoped preview throttle bypass"
        )
        run_index = app_tests.index("      - name: Run app test suite")
        parse_index = app_tests.index("      - name: Parse results")
        connect_step = app_tests[connect_index:derive_index]
        derive_step = app_tests[derive_index:run_index]
        checkout_step = app_tests[checkout_index:app_tests.index("      - name: Fetch shared scripts")]
        run_step = app_tests[run_index:app_tests.index("      - name: Parse results")]

        self.assertLess(resolve_index, config_checkout_index)
        self.assertLess(config_checkout_index, config_read_index)
        self.assertLess(install_index, connect_index)
        self.assertLess(connect_index, derive_index)
        self.assertLess(derive_index, run_index)
        self.assertLess(run_index, parse_index)
        self.assertIn("ref: ${{ steps.base.outputs.sha }}", app_test_config)
        self.assertIn(
            "app_test_command: ${{ steps.config.outputs.app_test_command }}",
            app_test_config,
        )
        self.assertIn(
            "ref: ${{ needs.app-test-config.outputs.base_sha }}", checkout_step
        )
        self.assertIn("token: ${{ github.token }}", checkout_step)
        self.assertNotIn("secrets.WORKFLOW_PAT", checkout_step)
        self.assertNotIn("needs.verify-fix-branch.outputs.head_sha", checkout_step)
        self.assertIn(
            'gh api "repos/${GITHUB_REPOSITORY}/commits/${ISSUE_BASE}"',
            app_test_config[resolve_index:config_checkout_index],
        )
        self.assertIn(
            "APP_TEST_CMD: ${{ needs.app-test-config.outputs.app_test_command }}",
            run_step,
        )
        self.assertNotIn("needs.read-config.outputs.app_test_command", app_tests)
        self.assertNotIn("needs.read-config.outputs.app_test_command", finalize)
        self.assertIn("needs.app-test-config.result == 'success'", finalize)
        self.assertIn("if: env.TS_OAUTH_CLIENT_ID != ''", connect_step)
        self.assertIn(
            "uses: tailscale/github-action@6cae46e2d796f265265cfcf628b72a32b4d7cade",
            connect_step,
        )
        self.assertIn("tags: tag:ci", connect_step)
        self.assertNotIn("run:", connect_step)
        self.assertIn(
            "PREVIEW_THROTTLE_BYPASS_KEY: ${{ secrets.PREVIEW_THROTTLE_BYPASS_KEY }}",
            derive_step,
        )
        self.assertIn(
            '"preview-throttle:${GITHUB_REPOSITORY}:${ISSUE_NUM}"', derive_step
        )
        self.assertIn("openssl dgst -sha256 -hmac", derive_step)
        self.assertIn("echo \"::add-mask::$derived\"", derive_step)
        self.assertIn(
            'printf \'%s\' "$derived" > "$RUNNER_TEMP/preview-throttle-bypass"',
            derive_step,
        )
        self.assertIn(
            ': > "$RUNNER_TEMP/preview-throttle-bypass-enabled"', derive_step
        )
        self.assertNotIn("GITHUB_ENV", derive_step)
        self.assertNotIn("PREVIEW_THROTTLE_BYPASS_KEY", run_step)
        self.assertIn('value_file="$RUNNER_TEMP/preview-throttle-bypass"', run_step)
        self.assertIn('THROTTLE_BYPASS_SECRET=$(cat "$value_file")', run_step)
        self.assertIn("export THROTTLE_BYPASS_SECRET", run_step)
        self.assertNotIn("GITHUB_ENV", run_step)

    def test_app_test_artifacts_fail_closed_on_credential_material(self):
        workflow = RUNNER.read_text()
        app_tests = workflow.split("  app-tests:", 1)[1].split(
            "\n  finalize:", 1
        )[0]
        compare_index = app_tests.index("      - name: Compare against baseline")
        safety_index = app_tests.index(
            "      - name: Verify app-test artifacts are credential-free"
        )
        upload_index = app_tests.index("      - name: Upload app-test artifacts")
        safety = app_tests[safety_index:upload_index]
        upload = app_tests[upload_index:]

        self.assertLess(compare_index, safety_index)
        self.assertLess(safety_index, upload_index)
        self.assertIn("        id: artifact_safety", safety)
        self.assertIn("        if: always()", safety)
        self.assertIn(
            "bash /tmp/org-github/scripts/autopilot/verify-app-test-artifacts.sh",
            safety,
        )
        self.assertIn(
            "if: always() && steps.artifact_safety.outcome == 'success'",
            upload,
        )

    def _run_artifact_guard(self, *, leak=False, archive=False, media=False):
        temp_dir = tempfile.TemporaryDirectory()
        root = Path(temp_dir.name)
        value_file = root / "value"
        marker = root / "enabled"
        app_tests = root / "app-tests"
        report = root / "playwright-report"
        results = root / "test-results"
        fake_value = "unit-test-scoped-value"

        for directory in (app_tests, report, results):
            directory.mkdir()
        value_file.write_text(fake_value)
        marker.touch()
        (app_tests / "run.log").write_text(
            f"request={fake_value}" if leak else "credential-free"
        )
        if archive:
            data = report / "data"
            data.mkdir()
            with zipfile.ZipFile(
                data / "custom-trace.zip", "w", compression=zipfile.ZIP_DEFLATED
            ) as bundle:
                bundle.writestr("network.log", f"request-header={fake_value}")
        if media:
            (results / "failure.png").write_bytes(b"not-a-real-image")

        env = os.environ.copy()
        env.update(
            {
                "PREVIEW_THROTTLE_VALUE_FILE": str(value_file),
                "PREVIEW_THROTTLE_ENABLED_MARKER": str(marker),
                "APP_TESTS_ARTIFACT_DIR": str(app_tests),
                "PLAYWRIGHT_REPORT_DIR": str(report),
                "PLAYWRIGHT_TEST_RESULTS_DIR": str(results),
            }
        )
        completed = subprocess.run(
            ["bash", str(ARTIFACT_GUARD)],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
        return temp_dir, completed, value_file, marker, app_tests, report, results

    def test_artifact_guard_accepts_clean_artifacts_and_erases_audit_files(self):
        temp_dir, completed, value_file, marker, app_tests, report, results = (
            self._run_artifact_guard()
        )
        with temp_dir:
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertFalse(value_file.exists())
            self.assertFalse(marker.exists())
            for directory in (app_tests, report, results):
                self.assertTrue(directory.exists())

    def test_artifact_guard_rejects_and_deletes_a_plaintext_match(self):
        temp_dir, completed, _, _, app_tests, report, results = (
            self._run_artifact_guard(leak=True)
        )
        with temp_dir:
            self.assertNotEqual(completed.returncode, 0)
            self.assertNotIn("unit-test-scoped-value", completed.stderr)
            for directory in (app_tests, report, results):
                self.assertFalse(directory.exists())

    def test_artifact_guard_rejects_compressed_trace_in_any_uploaded_root(self):
        temp_dir, completed, _, _, app_tests, report, results = (
            self._run_artifact_guard(archive=True)
        )
        with temp_dir:
            self.assertNotEqual(completed.returncode, 0)
            for directory in (app_tests, report, results):
                self.assertFalse(directory.exists())

    def test_artifact_guard_rejects_visual_browser_artifacts(self):
        temp_dir, completed, _, _, app_tests, report, results = (
            self._run_artifact_guard(media=True)
        )
        with temp_dir:
            self.assertNotEqual(completed.returncode, 0)
            for directory in (app_tests, report, results):
                self.assertFalse(directory.exists())

    def test_preview_receives_only_issue_scoped_throttle_bypass(self):
        workflow = RUNNER.read_text()
        deploy = workflow.split("  deploy-preview:", 1)[1].split("\n  test:", 1)[0]
        connect_index = deploy.index("      - name: Connect to Tailscale")
        derive_index = deploy.index(
            "      - name: Derive scoped preview throttle bypass"
        )
        first_attempt_index = deploy.index(
            "      - name: Deploy preview to VPS (attempt 1)"
        )
        expose_first_index = deploy.index(
            "      - name: Expose scoped preview throttle bypass (attempt 1)"
        )
        clear_first_index = deploy.index(
            "      - name: Clear scoped preview throttle bypass (attempt 1)"
        )
        wait_index = deploy.index("      - name: Wait before retry")
        expose_second_index = deploy.index(
            "      - name: Expose scoped preview throttle bypass (attempt 2)"
        )
        second_attempt_index = deploy.index(
            "      - name: Deploy preview to VPS (attempt 2)"
        )
        clear_second_index = deploy.index(
            "      - name: Clear scoped preview throttle bypass (attempt 2)"
        )
        remove_index = deploy.index(
            "      - name: Remove scoped preview throttle bypass audit value"
        )
        set_url_index = deploy.index("      - name: Set preview URL output")
        derive = deploy[derive_index:expose_first_index]
        expose_first = deploy[expose_first_index:first_attempt_index]
        wait = deploy[wait_index:expose_second_index]

        self.assertIn("PREVIEW_THROTTLE_BYPASS_KEY:", workflow)
        self.assertLess(connect_index, derive_index)
        self.assertLess(derive_index, expose_first_index)
        self.assertLess(expose_first_index, first_attempt_index)
        self.assertLess(first_attempt_index, clear_first_index)
        self.assertLess(clear_first_index, wait_index)
        self.assertLess(wait_index, expose_second_index)
        self.assertLess(expose_second_index, second_attempt_index)
        self.assertLess(second_attempt_index, clear_second_index)
        self.assertLess(clear_second_index, remove_index)
        self.assertLess(remove_index, set_url_index)
        self.assertIn(
            "PREVIEW_THROTTLE_BYPASS_KEY: ${{ secrets.PREVIEW_THROTTLE_BYPASS_KEY }}",
            derive,
        )
        self.assertIn(
            '"preview-throttle:${GITHUB_REPOSITORY}:${ISSUE_NUM}"', derive
        )
        self.assertIn("openssl dgst -sha256 -hmac", derive)
        self.assertIn(
            'printf \'%s\' "$derived" > "$RUNNER_TEMP/preview-deploy-throttle-bypass"',
            derive,
        )
        self.assertNotIn("GITHUB_ENV", derive)
        self.assertIn("PREVIEW_THROTTLE_BYPASS_SECRET=$derived", expose_first)
        self.assertNotIn("PREVIEW_THROTTLE_BYPASS_SECRET", wait)
        self.assertIn(
            'echo "PREVIEW_THROTTLE_BYPASS_SECRET=" >> "$GITHUB_ENV"',
            deploy[clear_first_index:wait_index],
        )
        self.assertNotIn(
            "PREVIEW_THROTTLE_BYPASS_KEY", deploy[expose_first_index:]
        )


if __name__ == "__main__":
    unittest.main()
