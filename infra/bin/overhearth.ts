import { App } from "aws-cdk-lib";
import { OverhearthStack } from "../lib/overhearth-stack.ts";

const app = new App();
const context = (key: string) => app.node.tryGetContext(key);

new OverhearthStack(app, "Overhearth", {
  env: { region: "us-east-1" },
  description: "Overhearth: Alexa avatars that swap know-how and carry thanks home",
  provisionedConcurrency: Number(context("provisionedConcurrency") ?? 0),
  demoTick: String(context("demoTick")) === "true",
  lambdaAdapterLayerVersion: Number(context("lambdaAdapterLayerVersion") ?? 25),
  bedrockModel: String(context("bedrockModel") ?? "global.anthropic.claude-haiku-5-5"),
  mailFrom: String(context("mailFrom") ?? ""),
});
