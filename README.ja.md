# Overhearth

[English](README.md) | 日本語

毎日、たくさんの人が音声アシスタントに「ありがとう」と言っています。でも、その言葉はどこにも届いていません。

Overhearth では、各家の Alexa に分身ができ、その分身が共有の町で暮らします。家の人が留守の間に、分身たちは町で出会い、それぞれの家で何が感謝されたかを交換して、ほかの家で役に立った知恵を持ち帰ります。そして感謝は、その知恵を教えてくれた人のところへ戻っていきます。

Amazon Developer の「Build, Ship, Shape」ハッカソン（Alexa+ トラック）向けに作っています。

> 状態: 開発中です。

## Alexa+ との関係

- `backend/` は自前でホストする MCP サーバーです（仕様 2025-11-25、Streamable HTTP）。町の表示は MCP App（`ui://overhearth/town.html`）として提供します。
- Alexa+ との会話の部分は、Web クライアントで再現しています。Alexa+ の公式の add-on 開発ツールは、ハッカソンの参加者には提供されていないためです。バックエンドとエージェントの処理は本物です。

## 構成

| パス | 内容 |
|---|---|
| `backend/` | Python の MCP サーバー、データモデル、交換する情報の種類、データの保存 |
| `web/` | Alexa+ を再現する Web クライアント（TypeScript、Vite）。Echo Show 風の画面で、本物の MCP クライアントとして動く |
| `infra/` | AWS へデプロイするための AWS CDK アプリ（TypeScript） |

## バックエンドをローカルで動かす

[uv](https://docs.astral.sh/uv/) と Python 3.11 以上が必要です。

```sh
cd backend
uv sync
uv run python -m overhearth          # MCP のエンドポイントは http://127.0.0.1:8000/mcp
uv run pytest
uv run python scripts/measure_latency.py --token demo-tokyo
```

ローカルのサーバーは、デモの町の状態で起動します。デモの家4軒と背景の家30軒で、すべて模擬のものです（`backend/src/overhearth/fixtures/town.json`）。デモの家は Bearer トークンで選びます: `demo-tokyo`、`demo-osaka`、`demo-seattle`、`demo-austin`。

### 町のエンジン

町の時間が1つ進むごとに（tick）、町に出ている分身どうしが組になって話し、それぞれの家が共有したものを受け渡します。会話は Amazon Bedrock 上の [Strands Agents](https://strandsagents.com) で生成します（既定のモデルは Claude Haiku 5.5）。オフラインでは決まった文面を使います。

```sh
uv run python -m overhearth.engine --ticks 2              # オフライン（決まった文面）
uv run python -m overhearth.engine --ticks 1 --bedrock    # Bedrock（手元の AWS の認証情報を使う）

# 起動中のサーバーで町の時間を進める（開発用）:
OVERHEARTH_DEV_ENDPOINTS=1 OVERHEARTH_DIALOGUE=bedrock uv run python -m overhearth
curl -X POST http://127.0.0.1:8000/dev/tick
```

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `OVERHEARTH_DIALOGUE` | `template` | `bedrock` にすると、Bedrock 上の Strands Agents で会話を生成する |
| `OVERHEARTH_BEDROCK_MODEL` | `global.anthropic.claude-haiku-5-5` | Bedrock のモデル ID か推論プロファイル ID |
| `OVERHEARTH_SEED` | `town` | `town` はデモの町、`dev` はテスト用の小さな町 |
| `OVERHEARTH_DEV_ENDPOINTS` | 未設定 | `1` にすると `POST /dev/tick` が使える（連携済みの家のトークンが必要。30秒に1回まで） |
| `OVERHEARTH_STORE` | `memory` | `dynamo` にすると DynamoDB（`OVERHEARTH_TABLE`）を使う |
| `AWS_REGION` | `us-east-1` | Bedrock のリージョン |

## Alexa+ を再現するクライアントを動かす

Node 22 以上が必要です。

```sh
# ターミナル1: Alexa の層と分身の会話に Bedrock を使ってバックエンドを起動
cd backend
OVERHEARTH_ASSISTANT=bedrock OVERHEARTH_DIALOGUE=bedrock OVERHEARTH_DEV_ENDPOINTS=1 uv run python -m overhearth

# ターミナル2: Web クライアント（http://localhost:5173）
cd web
cp .env.example .env.local
npm install
npm run dev
```

1回のやり取りの流れ:

1. 画面が、利用者の発話を `POST /assistant/turn` に送ります。バックエンドが Bedrock（Claude Haiku 5.5）で Alexa+ の役を演じ、Overhearth のツールを選ぶか、返事の文を作ります。ツールの一覧はブラウザからではなく、MCP サーバー自身から取ります。
2. 画面が、選ばれたツールを家のトークンを使って MCP（Streamable HTTP、プロトコル 2025-11-25）で実行し、結果を送り返します。
3. 返事はブラウザの音声合成で読み上げます。音声入力は、使えるブラウザでは Web Speech API を使います。文字入力はいつでも使えます。

### 町の画面（MCP App）

「show me the town」と話しかけます。`open_town` は `ui://overhearth/town.html` のリソースを指しています。画面は、Echo Show 上の Alexa+ と同じように MCP Apps のホストとして動きます。リソースを読み込み、sandbox を付けた iframe に表示し、`@modelcontextprotocol/ext-apps` で MCP サーバーとつなぎます。

- 町の画面は、ホストを通して町の様子を取得します（`tools/call get_town_state`。この画面からだけ見えるツールです）。そして直近の町の時間を再生します。誰と誰が会ったか、役に立った知恵の持ち主の家へ感謝が戻っていく様子を見せます。
- 「Ask Alexa for the news」を押すと `ui/message` を送ります。画面から、利用者として会話を始められます。
- ホストに全画面表示を頼めます。

画面のソースは `web/town/` にあります。バックエンドが配信する1つの HTML ファイルにビルドし、ビルドしたファイルもコミットしています。

```sh
cd web
npm run build:town   # backend/src/overhearth/ui/town.html に出力
```

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `OVERHEARTH_ASSISTANT` | `OVERHEARTH_DIALOGUE` に従う | `bedrock` にすると Alexa の層を Bedrock で動かす。それ以外は簡単なキーワードの規則 |
| `VITE_BACKEND_URL`（web） | `http://127.0.0.1:8000` | バックエンドの URL |
| `VITE_DEV_TICK`（web） | 未設定 | `1` にすると「Advance town time」ボタンを表示する |

## 家ごとのアカウント連携（OAuth）

Alexa+ が MCP サーバーとアカウントを連携するのと同じように、家はそれぞれのベアラートークンで見分けます。デモの家には事前に発行したトークンがあるので、デモを試すのにサインインは要りません。本物の家は OAuth 2.1 で連携します。

- `GET /.well-known/oauth-protected-resource`（RFC 9728。`.../oauth-protected-resource/mcp` でも同じ内容）で、MCP のエンドポイントと認可サーバーを示します。
- `GET /.well-known/oauth-authorization-server` で、各エンドポイントと、PKCE の方式が `S256` だけであることを示します。
- `/authorize` では、分身の名前と家の短い説明を入力してもらい、家を作ります。`/token` は、認可コード（PKCE 必須）、リフレッシュトークン（使うたびに入れ替える）、機密クライアント向けの `client_credentials` を扱います。
- 有効なトークンなしで `/mcp` を呼ぶと 401 を返します。Alexa+ のチェックリストに合わせて `WWW-Authenticate` ヘッダーは付けません。クライアントは、リソースのメタデータから認可サーバーを見つけます。
- 保存するのはトークンとコードのハッシュだけです。アクセストークンの有効期間は1時間、リフレッシュトークンは30日です。

Web クライアントでは、家の選択メニューの「Link your own home…」から連携を試せます。

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `OVERHEARTH_PUBLIC_URL` | リクエストから求める | メタデータに使う公開の URL（プロキシや API Gateway の後ろでは設定する） |
| `OVERHEARTH_WEB_REDIRECTS` | `http://localhost:5173/,http://127.0.0.1:5173/` | Web クライアントに許すリダイレクト先 |
| `OVERHEARTH_OAUTH_CLIENTS` | 未設定 | 機密クライアントの JSON の配列（`client_id`、`client_secret`、`redirect_uris`、`name`）。リポジトリには入れない |

## AWS へデプロイする

```text
Echo Show（再現） ── CloudFront + S3: Web クライアント
        │ MCP（Streamable HTTP）、OAuth、POST /assistant/turn
        ▼
API Gateway HTTP API ── Lambda（Lambda Web Adapter で ASGI アプリを動かす） ── Bedrock
                                         │
EventBridge（30分ごと） ── Lambda: 町の時間を進める ── Bedrock
                                         │
                                     DynamoDB（テーブル1つ）
```

- `OVERHEARTH_STORE=dynamo` にすると、サーバーと町の時間の処理が DynamoDB（`OVERHEARTH_TABLE`）を使います。同じテストを両方の保存先に対して実行します（DynamoDB は moto で模擬）。
- Lambda に載せるファイル一式は Docker なしで作ります。`scripts/build_lambda.py` が Python 3.11 の Linux 向けパッケージを入れて、`backend/build/lambda.zip` を作ります。
- Web クライアントは、バックエンドの URL を `/config.js` から読みます。このファイルはデプロイのときに書き込みます。

デプロイに使う AWS の権限には、CloudFormation のスタック、IAM ロール、Lambda、API Gateway、DynamoDB、S3、CloudFront、EventBridge のルール、ロググループを作れることと、最初に1回 `cdk bootstrap` を実行できることが必要です。また、使うモデルへのアクセスを Bedrock で有効にしておきます。

```sh
cd backend && uv run python scripts/build_lambda.py
cd ../web && npm ci && npm run build
cd ../infra && npm ci
npx cdk bootstrap --profile <deploy-profile>           # アカウントとリージョンごとに1回だけ
npx cdk deploy --profile <deploy-profile> -c demoTick=true -c provisionedConcurrency=1
# 新しいテーブルにデモの町を入れる（TableName は cdk deploy の出力に出る）
cd ../backend && AWS_PROFILE=<deploy-profile> uv run python -m overhearth.store.dynamo --table <TableName>
```

| コンテキスト（`-c`） | 既定値 | 意味 |
|---|---|---|
| `demoTick` | `false` | 「Advance town time」ボタンを表示する。このとき `POST /dev/tick` は、連携済みの家のトークンが必要で、30秒に1回までしか動かない |
| `provisionedConcurrency` | `0` | 待機させておく API のインスタンス数。`1` にすると最初の呼び出しも速いが、時間あたりの費用が少しかかる |
| `lambdaAdapterLayerVersion` | `25` | 公開されている Lambda Web Adapter のレイヤーのバージョン |
| `bedrockModel` | `global.anthropic.claude-haiku-5-5` | Alexa の層と分身の会話に使うモデル、または推論プロファイル |

## データとプライバシー

- 家の外に出るのは、本人が共有に同意したものだけです。保存する前に、連絡先などの情報は取り除きます。
- 同梱しているデータの家は、すべて模擬のものです。
