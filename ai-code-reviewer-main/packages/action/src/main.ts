import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';

import { GitHubClient } from './github';
import type { OctokitClient } from './github';
import { readInputs } from './inputs';
import { run } from './run';

/** Composition root: wire the real Actions runtime into the pure `run`. */
async function main(): Promise<void> {
  const inputs = readInputs();
  const octokit = getOctokit(inputs.githubToken) as unknown as OctokitClient;
  const prContext = GitHubClient.getPRContext(context);
  const client = new GitHubClient(octokit, prContext);
  await run({
    inputs,
    client,
    log: { info: core.info, warning: core.warning, error: core.error },
    setOutput: core.setOutput,
    setFailed: core.setFailed,
    writeSummary: async (markdown: string) => {
      await core.summary.addRaw(markdown).write();
    },
  });
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
