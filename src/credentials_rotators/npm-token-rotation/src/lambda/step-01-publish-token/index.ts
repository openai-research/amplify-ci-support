import config from "../../../config.json";
import assert from "assert";
import { updateGitHubActionsSecrets } from "../utils/github-utils";
import * as utils from "../utils/utils";
import { TokenRotationStepFnEvent, UpdateGitHubSecretsParam } from "../types";
import { NPMTokenRotationConfig } from "../../config-types";

export const handler = async (event: TokenRotationStepFnEvent) => {
  const tokenDetails = utils.getTokenConfigForArn(
    config as NPMTokenRotationConfig,
    event.secretArn
  );
  const webhookUrl = tokenDetails.slackWebHookConfig
    ? await utils.getSecret(
        tokenDetails.slackWebHookConfig.arn,
        tokenDetails.slackWebHookConfig.secretKey,
        tokenDetails.slackWebHookConfig.roleArn
      )
    : undefined;
  if (tokenDetails) {
    try {
      const { publishConfig } = tokenDetails;
      const tokenConfig = publishConfig.githubToken;
      if (!tokenConfig || !tokenConfig.arn || !tokenConfig.secretKey) {
        throw Error(
          `Invalid rotation configuration. Expected arn and token key, got ${JSON.stringify(
            tokenConfig
          )}`
        );
      }
      const githubToken = await utils.getSecret(
        tokenConfig.arn,
        tokenConfig.secretKey,
        tokenConfig.roleArn
      );
      if (!githubToken) {
        throw new Error("Could not get the GitHub access token");
      }
      const newNPMToken = await utils.getSecret(
        event.secretArn,
        tokenDetails.secretKey,
        tokenDetails.roleArn
      );
      assert(newNPMToken, "Secrets manager should have newNPMToken");

      const { type, owner, repo } = publishConfig;
      let updateConfig: UpdateGitHubSecretsParam;

      if (type === "Repository") {
        updateConfig = {
          type,
          owner,
          repo,
          githubToken,
          secrets: {
            [publishConfig.secretName]: newNPMToken,
          },
        };
      } else if (type === "Environment") {
        const { environmentName } = publishConfig;
        assert(environmentName, "Environment name is missing");

        updateConfig = {
          type,
          owner,
          repo,
          githubToken,
          environmentName,
          secrets: {
            [publishConfig.secretName]: newNPMToken,
          },
        };
      } else {
        throw new Error("Invalid publishConfig");
      }

      await updateGitHubActionsSecrets(updateConfig);

      if (webhookUrl) {
        const { secretName } = publishConfig;
        const message =
          type === "Repository"
            ? `NPM Publish Token has been rotated and pushed to GitHub repository secret.\nDetails:\n ${JSON.stringify(
                {
                  owner,
                  repo,
                  secretName,
                }
              )}`
            : `NPM Publish Token has been rotated and Stored in GitHub environment secret. \nDetails: \n ${JSON.stringify(
                {
                  owner,
                  repo,
                  secretName,
                  environmentName: publishConfig.environmentName,
                }
              )}`;
        await utils.sendSlackMessage(webhookUrl, message);
      }
    } catch (e) {
      if (webhookUrl) {
        await utils.sendSlackMessage(
          webhookUrl,
          "NPM Access token has been rotation failed"
        );
      }
      throw e;
    }
  }
  return event;
};
