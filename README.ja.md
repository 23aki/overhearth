# Overhearth

[English](README.md) | 日本語

毎日、たくさんの人が音声アシスタントに「ありがとう」と言っています。でも、その言葉はどこにも届いていません。

Overhearth では、各家の Alexa に分身ができ、その分身が共有の町で暮らします。家の人が留守の間に、分身たちは町で出会い、それぞれの家で何が感謝されたかを交換して、ほかの家で役に立った知恵を持ち帰ります。そして感謝は、その知恵を教えてくれた人のところへ戻っていきます。

Amazon Developer の「Build, Ship, Shape」ハッカソン（Alexa+ トラック）向けに作っています。

> 状態: 開発中です。

**試す:** <https://do7sfung0ly8x.cloudfront.net>。デモの家を選ぶだけで、サインインは要りません。MCP のエンドポイントは `https://lb45tdkpz4.execute-api.us-east-1.amazonaws.com/mcp` です（Bearer トークンは `demo-tokyo`、`demo-osaka`、`demo-seattle`、`demo-austin`）。

## Alexa+ との関係

- `backend/` は自前でホストする MCP サーバーです（仕様 2025-11-25、Streamable HTTP）。町の表示は MCP App（`ui://overhearth/town.html`）として提供します。
- Alexa+ との会話の部分は、Web クライアントで再現しています。Alexa+ の公式の add-on 開発ツールは、ハッカソンの参加者には提供されていないためです。バックエンドとエージェントの処理は本物です。

![Overhearth の構成図](docs/architecture.svg)

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

### Claude API で開発する

デプロイ版は Amazon Bedrock を使います。開発中は、Alexa の層と分身の会話の両方を Claude API に切り替えられます。

```sh
cd backend
cp .env.example .env        # ANTHROPIC_API_KEY にキーを書く
uv run --env-file .env python -m overhearth
uv run --env-file .env python -m overhearth.engine --ticks 1 --anthropic
```

### 町のエンジン

町の時間が1つ進むごとに（tick）、町に出ている分身どうしが組になって話し、それぞれの家が共有したものを受け渡します。会話は Amazon Bedrock 上の [Strands Agents](https://strandsagents.com) で生成します（既定のモデルは Claude Haiku 5.5）。オフラインでは決まった文面を使います。

背景の家の住人も模擬の人で、町の時間の合間にも暮らしています。ときどき、分身が持ち帰った知恵や、いつも感謝していることについて Alexa にお礼を言います。頻度は町の時間1時間あたりで決めていて（町全体で1日に40回ほど）、何週間たっても感謝の戻りや流行が途切れません。デモの家と連携した家は、人がお礼を言ったときだけ感謝を記録します。まだ聞いていない報告では、戻ってきた感謝を知恵ごとに1回だけ、最後に聞いたとき以降の合計で伝えます。

```sh
uv run python -m overhearth.engine --ticks 2              # オフライン（決まった文面）
uv run python -m overhearth.engine --ticks 1 --bedrock    # Bedrock（手元の AWS の認証情報を使う）

# 起動中のサーバーで町の時間を進める（開発用）:
OVERHEARTH_DEV_ENDPOINTS=1 OVERHEARTH_DIALOGUE=bedrock uv run python -m overhearth
curl -X POST -H "Authorization: Bearer demo-tokyo" http://127.0.0.1:8000/dev/tick
```

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `OVERHEARTH_DIALOGUE` | `template` | `bedrock` にすると、Bedrock 上の Strands Agents で会話を生成する。`anthropic` にすると Claude API を使う（開発用） |
| `OVERHEARTH_DIALOGUE_SCOPE` | `featured` | `bedrock` のとき、デモの家か連携した家が関わる出会いだけモデルで会話を作る（それ以外は決まった文面にして費用を抑える）。`all` にするとすべての出会いでモデルを使う |
| `OVERHEARTH_BEDROCK_MODEL` | `global.anthropic.claude-haiku-5-5` | Bedrock のモデル ID か推論プロファイル ID |
| `OVERHEARTH_ANTHROPIC_MODEL` | `claude-haiku-5-5` | `anthropic` のときに使う Claude API のモデル ID |
| `ANTHROPIC_API_KEY` | 未設定 | `anthropic` のときの Claude API のキー。`backend/.env`（git の管理外）に置く |
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

### それぞれの家の言語で

家ごとに言語があります。連携のときに選べます。デモの家は、東京と大阪が日本語、シアトルとオースティンが英語です。町の住人は、日本語・スペイン語・フランス語・韓国語・ポルトガル語・ドイツ語・中国語を話します。

- **町では**、各分身が自分の家の言語で話し、相手の言葉も理解します。英語の分身が尋ね、日本語の分身が日本語で答えて、そのまま会話が成り立ちます。各台詞には英語の訳が付き、吹き出しの下に小さく表示します。
- **知恵は原文のまま持ちます。** 家が聞く報告は、その家の言語のひな形（`backend/src/overhearth/i18n.py`）で組み立てます。中身は、分身の会話と同じモデルでその家の言語に訳します。訳は保存して、言語ごとに1回だけ作ります。よく感謝される知恵は町の時間の処理で前もって訳しておくので、`ask_town` はツールの中でモデルを呼ばずに家の言語で答えられます。
- **検索は言語に依存しません。** 知恵の話題名とキーワードは英語で持ち、Alexa の層は `ask_town` に英語で質問を渡します。
- **Alexa は、直近の発言の言語で返事をします**（家の言語と違う言語で話すお客さんもいるため）。読み上げの声と音声入力も、その言語に合わせます。

### ゲームの世界のような町

町は、three.js で描いたブロックの 3D の世界で、小さなジオラマのように見えます（`web/townkit/scene3d.ts`、`voxel.ts`）。ブロックも模様もすべてコードで描いています。噴水のある広場を囲む道に沿って家が並びます。各家の分身は、頭に Echo の光の輪をのせた小さなブロックの生き物です。名前・吹き出し・字幕・HUD は画面の上に重ねた HTML なので、文字はくっきり読めます。観覧ページではジオラマを回したりズームしたりでき、Alexa の画面ではカメラは固定で自分の分身を追います。以前の 2D のドット絵の表示（PixiJS）も `?view=2d` で使えます。WebGL 2 が使えない環境でもこちらになります。道を歩いて相手の分身と途中で会い、吹き出しで話し、知恵や質問を手渡します。そのあと感謝がハートになって元の家へ飛び、受け取った家が光ります。窓の明かりは、その家の知恵が感謝された回数に応じて明るくなります。町には昼と夜があります。

- **家の人と話している間**：家の人が Alexa と話していると、その家の分身はドアまで歩いて家に入ります。家の上の吹き出しに話の種類（感謝はハート、質問は電球、メールは封筒、それ以外は点の点滅）が出て、窓の明かりが脈打ちます。90秒ほど静かになると、また外に出てきます。サーバーが残すのは最後のやり取りの種類と時刻だけで、話の中身は残しません（`GET /town/activity`。観覧ページが数秒ごとに読みます）。
- **観覧ページ**（`/watch.html`）：Alexa を通さずに、町全体をリアルタイムで眺められます。新しい町の時間が来ると、すぐに再生します。家を選ぶと、その分身を追いかけます（`/watch.html?follow=hh_osaka` のように開くこともできます）。「Stop following」（または Esc）で町全体の視点に戻ります。家のトークンなしで読める `GET /town` を使います。
- **Alexa の中**：下の MCP App も同じ描画を使い、自分の分身を追いかけます。

### 絵日記

毎日夕方（その家の現地時刻の18時以降）、デモの家と連携した家の分身が、その日の町での出来事を家の言語で絵日記にします。町全体の日記も1日1枚書きます。文章は分身の会話と同じモデルで書き（その日に町で起きたことだけを使います）、絵は画像生成のモデルで描きます（既定は `gpt-image-2.5`。`OPENAI_API_KEY` が必要）。

- 次の報告で Alexa が「今日の絵日記を描いたよ。見る？」と切り出します。`town_diary` ツールで、MCP App（`ui://overhearth/diary.html`）として画面に出します。罫線のノートに日付・絵・文章を並べ、町の日記のタブもあります。
- 観覧ページでは「Town diary」で町の日記を見られます。
- デモ用に、Echo Show 風の画面の「Draw diary」で今日の日記をすぐに描けます（`POST /dev/diary`。絵に時間がかかるので、AWS では町の時間用の Lambda が非同期で描きます）。
- 絵は、ローカルではバックエンドが配信し、AWS では S3 に置いて CloudFront の `/diary/` から配信します。画像のキーがなければ、文章だけの日記になります。

### 感謝で育つ町

町は、そこで起きたことから経験値を得ます。感謝（×2）、共有された知恵（×3）、質問（×1）、分身同士のおしゃべり（×1）です。レベルが上がるたびに、広場の近くに用意した区画に施設が1つ建ちます。どの施設が建つかは、町でいちばん感謝されている話題で決まります。料理のコツへの感謝が多ければパン屋、子育てのコツなら公園の遊び場です。施設は11種類（パン屋、遊び場、図書館、庭園、診療所、カフェ、銭湯、野外ステージ、市場、工房、ドッグラン）で、最後に広場にお祭りの提灯が灯ります。その後は、レベルが上がるたびに施設が1つずつ大きくなります（図書館に時計塔、庭園に温室、診療所に2階など）。これもいちばん感謝されている話題から順に進み、レベル24で完成です。町ごとに、住む人が何に助けられたかが町並みに表れます。デモの町（数十軒）では、約1週間ですべての施設が建ち、その後約4週間かけてすべての施設が大きくなります。

- 地図の HUD に、町のレベル、次の施設までの進み具合、町でいちばん感謝されている話題を出します。次に建つ区画には足場が組まれています。
- 施設が建った回や大きくなった回の町の時間を再生すると、最後にカメラがその区画へ移り、お祝いの演出とともに施設が現れます。大きくなった施設は名前に ★ が付きます。
- デモの家と連携した家には、Alexa が家の言語で知らせます（「町にパン屋ができました！料理のコツへの感謝がきっかけです。」）。届いた感謝の報告のすぐ後に伝えます。その日の絵日記にも出てきます。
- すでに動いている町は、それまでの履歴に見合ったレベルから静かに始まります（`backend/src/overhearth/growth.py`）。

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
| `OVERHEARTH_ASSISTANT` | `OVERHEARTH_DIALOGUE` に従う | `bedrock` にすると Alexa の層を Bedrock で、`anthropic` にすると Claude API で動かす。それ以外は簡単なキーワードの規則 |
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

## 書面で届ける（メール）

会話の外で何かをする操作は、すべて「読み上げて確認 → 実行 → 書面で確認」の順にします。

- 「それをメールして」と言うと、`email_report` が送り先（`t***@example.com`）を読み上げ、了承を待ちます。了承の後に町の知らせを送り、同じメールを画面にも出して書面での確認にします。
- 連携した家は「自分が共有した知恵に感謝が届いたらメールする」を選べます。町の時間の処理が送るのは、1日に1通までです。
- デモの家は送信しません。送るはずのメールを画面に出すだけなので、審査員はアカウントを用意する必要がありません。
- メールアドレスは任意で、家を連携するときにだけ尋ねます。その家の非公開の設定として保存し、町のデータには入れません。読み上げるときは一部を伏せます。
- 送信には Amazon SES を使います。設定しない限り送信はせず、すべてのメールを画面に出すだけにします。

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `OVERHEARTH_MAILER` | 未設定（送信しない） | `ses` にすると Amazon SES で送る |
| `OVERHEARTH_MAIL_FROM` | 未設定 | SES で検証済みの送信元アドレス（CDK では `-c mailFrom=...`） |

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
npx cdk deploy --profile <deploy-profile>
# 新しいテーブルにデモの町を入れる（TableName は cdk deploy の出力に出る）
cd ../backend && AWS_PROFILE=<deploy-profile> uv run python -m overhearth.store.dynamo --table <TableName>
```

| コンテキスト（`-c`） | 既定値 | 意味 |
|---|---|---|
| `demoTick` | `true` | 「Advance town time」ボタンを表示する。このとき `POST /dev/tick` は、連携済みの家のトークンが必要で、30秒に1回までしか動かない |
| `provisionedConcurrency` | `1` | 待機させておく API のインスタンス数。`1` にすると最初の呼び出しも速い（コールドスタートは約4秒）が、時間あたりの費用が少しかかる。費用を抑えるなら `0` |
| `lambdaAdapterLayerVersion` | `25` | 公開されている Lambda Web Adapter のレイヤーのバージョン |
| `bedrockModel` | `global.anthropic.claude-haiku-5-5` | Alexa の層と分身の会話に使うモデル、または推論プロファイル |
| `mailFrom` | 空（送信しない） | SES で検証済みの送信元。設定すると、連携した家にメールを送る |
| `llm` | `bedrock` | 試行錯誤の間だけ `anthropic` にすると、Bedrock の代わりに Claude API を使う（`anthropicApiKey` を渡す。例えば `backend/.env` から読む。キーは Lambda の環境変数に入る）。`anthropicModel` も指定できる |
| `openaiApiKey` | 空（文章だけの日記） | 絵日記の絵に使う OpenAI のキー（Lambda の環境変数に入る）。`imageModel` も指定できる |
| `previewPassword` | 空（公開） | 開発中だけ、Web クライアントに Basic 認証をかける（ユーザー名は `overhearth`） |
| `accessKey` | 空（公開） | 開発中だけ、API（`/mcp`、`/assistant/turn`、`/token`、`/dev/tick`）に、このキーを `X-Overhearth-Access` ヘッダーで求める。Web クライアントは、Basic 認証の内側にある `config.js` からキーを受け取る |

`previewPassword` と `accessKey` はコマンドラインでだけ渡し、リポジトリには入れません。指定せずにデプロイすれば、デモは再び公開されます。

## データとプライバシー

- 家の外に出るのは、本人が共有に同意したものだけです。保存する前に、連絡先などの情報は取り除きます。
- 同梱しているデータの家は、すべて模擬のものです。
- 絵日記の文章と絵は、その日に町で起きたこと（つまり、本人が共有に同意したもの）だけから作ります。絵は AI が描いたもので、文字や実在の人物は描きません。

## ライセンス

[MIT](LICENSE)
