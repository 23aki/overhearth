import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

export interface OverhearthProps extends StackProps {
  /** Warm instances of the API function, so the first call stays under Alexa+'s 500 ms. 0 saves money. */
  provisionedConcurrency: number;
  /** Turn on the "Advance town time" button (POST /dev/tick, linked homes only, rate limited). */
  demoTick: boolean;
  /** Version of the public AWS Lambda Web Adapter layer. */
  lambdaAdapterLayerVersion: number;
  /** Bedrock model or inference profile id. */
  bedrockModel: string;
  /** Verified SES sender for emails to linked homes. Empty: emails are only shown (dry run). */
  mailFrom: string;
  /**
   * While in development: Basic authentication on the web client and an access key for the API.
   * Passed on the command line, never stored in the repository. Empty: the demo is open.
   */
  previewPassword: string;
  accessKey: string;
}

const PREVIEW_USER = "overhearth";

/**
 * Overhearth on AWS:
 * - API Gateway HTTP API → Lambda (the ASGI app via the Lambda Web Adapter): MCP server,
 *   OAuth, and the simulated Alexa+ layer.
 * - EventBridge rule → Lambda: one town tick every 30 minutes.
 * - DynamoDB: one table for everything.
 * - S3 + CloudFront: the simulated Alexa+ web client.
 */
export class OverhearthStack extends Stack {
  constructor(scope: Construct, id: string, props: OverhearthProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "Town", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // The web client goes first: the API needs its address for CORS and OAuth redirects.
    const site = new s3.Bucket(this, "Web", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const basicAuth = props.previewPassword
      ? new cloudfront.Function(this, "PreviewAuth", {
          runtime: cloudfront.FunctionRuntime.JS_2_0,
          comment: "Basic authentication while Overhearth is in development",
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var auth = event.request.headers.authorization;
  if (auth && auth.value === "Basic ${Buffer.from(`${PREVIEW_USER}:${props.previewPassword}`).toString("base64")}") {
    return event.request;
  }
  return {
    statusCode: 401,
    statusDescription: "Unauthorized",
    headers: { "www-authenticate": { value: 'Basic realm="Overhearth preview"' } },
  };
}`),
        })
      : undefined;
    const distribution = new cloudfront.Distribution(this, "WebDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: basicAuth
          ? [{ function: basicAuth, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }]
          : [],
      },
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    const webOrigin = `https://${distribution.distributionDomainName}`;

    const code = lambda.Code.fromAsset(path.join(repo, "backend/build/lambda.zip"));
    const bedrock = new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    });
    const shared: Record<string, string> = {
      OVERHEARTH_STORE: "dynamo",
      OVERHEARTH_TABLE: table.tableName,
      OVERHEARTH_DIALOGUE: "bedrock",
      OVERHEARTH_ASSISTANT: "bedrock",
      OVERHEARTH_BEDROCK_MODEL: props.bedrockModel,
      ...(props.mailFrom ? { OVERHEARTH_MAILER: "ses", OVERHEARTH_MAIL_FROM: props.mailFrom } : {}),
    };
    const sendEmail = new iam.PolicyStatement({
      actions: ["ses:SendEmail"],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
    });

    const adapter = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "WebAdapter",
      `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:${props.lambdaAdapterLayerVersion}`,
    );
    const api = new lambda.Function(this, "Api", {
      runtime: lambda.Runtime.PYTHON_3_11,
      architecture: lambda.Architecture.X86_64,
      code,
      handler: "run.sh",
      layers: [adapter],
      memorySize: 1024,
      timeout: Duration.seconds(29),
      environment: {
        ...shared,
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        AWS_LWA_READINESS_CHECK_PATH: "/health",
        PORT: "8080",
        OVERHEARTH_ALLOWED_ORIGINS: webOrigin,
        OVERHEARTH_WEB_REDIRECTS: `${webOrigin}/`,
        OVERHEARTH_DEV_ENDPOINTS: props.demoTick ? "1" : "0",
        ...(props.accessKey ? { OVERHEARTH_ACCESS_KEY: props.accessKey } : {}),
      },
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(api);
    api.addToRolePolicy(bedrock);
    if (props.mailFrom) api.addToRolePolicy(sendEmail);

    const alias = new lambda.Alias(this, "ApiLive", {
      aliasName: "live",
      version: api.currentVersion,
      provisionedConcurrentExecutions: props.provisionedConcurrency || undefined,
    });
    const http = new apigwv2.HttpApi(this, "Http", {
      defaultIntegration: new HttpLambdaIntegration("ApiIntegration", alias),
    });
    // OAuth metadata must name the public URL exactly, whatever Host header reaches the function.
    api.addEnvironment("OVERHEARTH_PUBLIC_URL", http.apiEndpoint);
    // A ceiling for the whole API, so nobody can run up the model bill.
    const stage = http.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 10, throttlingBurstLimit: 20 };

    const tick = new lambda.Function(this, "Tick", {
      runtime: lambda.Runtime.PYTHON_3_11,
      architecture: lambda.Architecture.X86_64,
      code,
      handler: "overhearth.lambda_tick.handler",
      memorySize: 1024,
      timeout: Duration.minutes(5),
      environment: shared,
      logGroup: new logs.LogGroup(this, "TickLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(tick);
    tick.addToRolePolicy(bedrock);
    if (props.mailFrom) tick.addToRolePolicy(sendEmail);
    new events.Rule(this, "EveryHalfHour", {
      schedule: events.Schedule.rate(Duration.minutes(30)),
      targets: [new targets.LambdaFunction(tick, { retryAttempts: 0 })],
    });

    new s3deploy.BucketDeployment(this, "WebFiles", {
      destinationBucket: site,
      distribution,
      sources: [
        s3deploy.Source.asset(path.join(repo, "web/dist"), { exclude: ["config.js"] }),
        s3deploy.Source.data(
          "config.js",
          `window.__OVERHEARTH__ = ${JSON.stringify({
            backendUrl: http.apiEndpoint,
            devTick: props.demoTick,
            ...(props.accessKey ? { accessKey: props.accessKey } : {}),
          })};
`,
        ),
      ],
    });

    new CfnOutput(this, "McpUrl", { value: `${http.apiEndpoint}/mcp` });
    new CfnOutput(this, "ApiUrl", { value: http.apiEndpoint });
    new CfnOutput(this, "WebUrl", { value: webOrigin });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
