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
| `web/` | Alexa+ を再現する Web クライアントと町の表示（作成予定） |

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
| `OVERHEARTH_DEV_ENDPOINTS` | 未設定 | `1` にすると `POST /dev/tick` が使える |
| `AWS_REGION` | `us-east-1` | Bedrock のリージョン |

## データとプライバシー

- 家の外に出るのは、本人が共有に同意したものだけです。保存する前に、連絡先などの情報は取り除きます。
- 同梱しているデータの家は、すべて模擬のものです。
