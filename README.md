# release-check-skills

**機能の設計意図を復元し、実装内部に潜む機能不全（未配線・握りつぶし・契約ズレ・状態破壊・非同期競合）と互換性・リグレッションを、網羅性台帳と独立検証に基づいて監査するAIエージェント用スキル**です。

[Cloudflare security-audit-skill](https://github.com/cloudflare/security-audit-skill) のアーキテクチャ（Phase別マルチエージェント分離・決定的な網羅性台帳・カバレッジ批評波・敵対的反証検証・最終レコード再検証・ゼロ依存バリデーター・親エージェントによる書き込み分離）を参考に、セキュリティ監査ではなく **リリース前の機能品質・隠れた不具合・設計意図・互換性の徹底監査** 用に再構築しています。

## なぜ従来より強固になったか

単なる「テストが通ったか」「6観点のチェック表を埋めたか」ではなく、実装の奥に隠れた機能不全を構造的に炙り出す設計になっています。

1. **テストの盲点と配線切れ（Wiring）を直接狙う偵察（Phase 1）**
   - 既存テストがモックで本番配線を迂回していないか、アサーションが甘くないか、エラー/境界/ライフサイクルがテスト漏れしていないかを最初に棚卸しします。
   - フラグ・UI操作・設定値が末端処理まで本当に届いているか、エラーが握りつぶされていないか、仕様・ドキュメント・テスト間の矛盾がないかを `feature-catalog.json` と `system-map.md` に記録します。
2. **10のコア欠陥クラス + 8つのドメイン別コンパニオンによる深い探索（Phase 2）**
   - 空実装・未配線・サイレントフェイル・ビジネスロジック境界・レイヤー間の契約ズレ・状態整合性・非同期/並行競合・後方互換性・機能間干渉・明らかな壊れ方まで、具体的な探索手順と検証ルールで独立ハンターを動かします。
3. **「HEAD単体の不具合（`confirmed_defect`）」と「リグレッション（`confirmed_regression`）」を分離**
   - 比較用のBASEコミットがない場合でも、HEAD実装に潜む隠れた不具合を証拠付きで `confirmed_defect` として確定できます。
   - 比較用のBASEがある場合は、同条件での BASE/HEAD 観測に基づいて `confirmed_regression`（意図しない破壊）と `confirmed_change`（仕様変更・意図不明の変更）を厳密に分けます。
4. **「監査の完了」と「リリース可否」を混同しない**
   - 重大なリグレッションや不具合が見つかっても、全フェーズと独立検証をやり切れば監査としては `complete`（完了）となり、リリース判断としては `hold`（保留勧告）を出します。逆にテスト不能や予算不足で未確認が残れば `incomplete` として隠さず開示します。
5. **敵対的検証（Phase 3）＋ 新規エージェントによる最終記録チェック（Phase 5）**
   - 発見したハンターとは別のエージェントが「反証する視点」で再検証し、さらに確定レコードと要検証リードを別のフレッシュな検証エージェントが再監査します。
   - 決定的な証拠ファイルもサンドボックスの `scratch/` から親の安全な昇格手順（Promotion procedure）でのみ `artifacts/` へ移し、未実行・未確認事項は `needs_validation` に留めます。

## 6フェーズの監査フロー

| フェーズ | 内容 | 主な成果物 |
|---|---|---|
| **1. Reconnaissance** | 製品構造・ビルド/配布物・機能意図・エンドツーエンド配線・テストの盲点・実テスト環境/仮想テスト境界・BASE→HEAD影響範囲を並列調査し、決定的台帳を初期化 | `run-metadata.json`, `system-map.md`, `feature-catalog.json`, `coverage-ledger.json` |
| **2. Coverage-led Hunting** | 優先度順に分離されたハンターへ台帳ユニットを割り当て、ソース追跡＋隔離テスト環境での実テスト（`real_env_test`）＋`scratch/`内の仮想テスト（`virtual_test`）を実行。各波の直後にCriticが漏れ・モック依存・浅い閉鎖を再割り当て | 更新された `coverage-ledger.json`（`attempts` 履歴・`test_kind`・`virtualized_boundaries` 付き） |
| **3. Adversarial Validation** | すべての候補（および過去ランの引継ぎ候補）を、発見者とは別のフレッシュな検証エージェントが反証視点で再検証。仮想テストの過剰モック・トートロジーも監査し、独立にローカル再現 | 検証済み判定と根拠チェック |
| **4. Structured Output** | 5種類の厳密な判定を `findings.json` へ出力し、4つのゼロ依存Node.jsスクリプトで構造・相互参照・完了ゲートを検査 | `findings.json` |
| **5. Final Record Verification** | 確定レコードおよび `needs_validation` を別の新規エージェントが原典・再検証結果と照合。重要な差し替えがあればさらに別エージェントで再検証 | 最終確定済み `findings.json` と `run-metadata.json` |
| **6. Target-Neutral Reporting** | 検証済みJSONのみを根拠として、`test_kind`別の検証内訳・再現手順・要検証レシピを含む人間向けレポートを生成 | `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` |

## テスト環境での「実テスト」と動的「仮想テスト」

既存テストがすべて緑でも、モックで本番配線が飛ばされていたり、アサーションが甘かったり、`src/` しかテストしていなかったりすると隠れた機能不全はすり抜けます。本スキルでは [TESTING-AND-HARNESSES.md](skills/release-check/TESTING-AND-HARNESSES.md) に基づき、**対象リポジトリを変更せず**、隔離サンドボックス内の `scratch/` を使って4段階の動的テストを組み合わせて検証します。

| `test_kind` | 実行するテスト | 証明できること |
|---|---|---|
| `existing_test` | リポジトリ既存の単体・結合・E2Eテスト（**アサーション内容とモック範囲を監査した上で**実行） | 既存テストが実際に検査している契約のみ（内部配線をモックしている場合はカバレッジ閉鎖不可） |
| `real_env_test` | **テスト環境での実テスト**: ビルド済みCLI/パッケージ、隔離ループバックサーバー、一時DB/ファイル、ヘッドレスUIなど、内部モジュールをモックせず実コンポーネントを組み上げてE2E実行 | 実配線、コールドスタート、永続化、再起動、配布成果物（`dist/`・`bin`）の整合性 |
| `virtual_test` | **仮想テスト（動的ハーネス作成・実行）**: 監査エージェントが `scratch/` に使い捨ての検証ハーネスを作成し、外部境界のみを仮想化して対象の実コードを直接叩くテスト | 既存テストが覆っていない未配線、エラー握りつぶし、境界値、非同期競合、移行破損などの隠れた機能不全 |
| `base_head_differential` | 使い捨ての `scratch/base/` と `scratch/head/` に同一の実テストまたは仮想テストを同条件で流し込む差分検証 | BASE成立→HEAD破損の `confirmed_regression` と、既存バグ（`confirmed_defect`）・仕様変更（`confirmed_change`）の切り分け |

### 仮想テストの7つの標準パターン

1. **未配線・空実装 A/B差分プローブ**: 公開入口に対しオプション・フラグ・設定を ON/OFF（値Aと値B）で2回呼び出し、出力や副作用が仕様どおりに変化することを検証。
2. **外部境界限定フォルトインジェクション**: 対象内部はすべて実コードのまま、外部端（ローカルループバックのHTTP 500/429/破損JSON/途中切断、読み取り専用ディレクトリ、3段階書き込みの2段階目失敗など）に障害を注入し、エラー伝播とロールバックを検証。
3. **境界値・性質・ラウンドトリップ検証**: 空・`0`・`""`・`false`・Unicode/CRLF・ページ境界・`serialize/deserialize` や `export/import` の往復整合性、UI/API/CLIなど並列経路間の契約一致を検証。
4. **決定論的並行・順序・キャンセル検証**: 遅延バリアで「リクエスト1がリクエスト2より遅く返る」順序を確定再現して古い応答による上書きを検出、並列バーストでのロストアップデート検出、途中中断・`SIGTERM` 時の後始末を検証。
5. **コールドスタート・再起動・アップグレード/ロールバック検証**: 空環境での初回起動、前バージョンデータ/設定からの移行、論理削除後の同名再作成、再起動後のキャッシュ/DB整合を検証。
6. **ビルド済み成果物・パッケージ消費者テスト**: `scratch/` の中立ディレクトリからビルド済みパッケージやCLIバイナリを実際に呼び出し、`devDependencies`漏れ、同梱アセット欠落、`--json` 時の標準出力汚染、非TTYパイプ入力を検証。
7. **決定論的プロトコル/LLM/MCPスタブ検証**: 本番APIや課金LLMを一切呼ばず、ローカルスタブから壊れたJSON・Markdown囲みJSON・未知ツール呼び出し・複数ページ応答・重複Webhookを流して実ループとパーサーの耐性を検証。

### 過剰モック・トートロジー防止ルール

- **外部境界のみ仮想化・内部配線は実コード必須**: すべてのチェックと確定Findingに `virtualized_boundaries`（仮想化した外部境界の明示リスト。完全実テストなら `[]`）の記録を義務づけ、対象自身のパーサー・ルーター・ビジネスロジック・ORM等をモックした検証は確定や閉鎖に認めません。
- **反証監査（Phase 3）とCritic再割り当て**: カバレッジCriticは「実テストや仮想テストが可能だったのに静的確認やモック依存テストだけで閉じたユニット」を再割り当てし、Phase 3検証者はハンターが作成した仮想テスト自体の妥当性（到達可能な入力か、仕様に基づいたオラクルか、過剰モックがないか）を反証監査した上で独立再現します。
- **ローカル再現できない外部テスト環境**: OS差異・ステージング専用サービス・実外部API等が必要な場合は勝手に本番/外部へアクセスせず、`needs_validation` に正確なブロッカーとオーナーがそのままテスト環境で実行できる手順（`validation_plan.environment`）を残します。

## 欠陥クラスとドメインコンパニオン

- **コア欠陥クラス**: [DEFECT-CLASSES.md](skills/release-check/DEFECT-CLASSES.md)
  - Hollow, stubbed, and unwired implementations（空実装・スタブ・未配線オプション/UI）
  - Silent failures and swallowed errors（エラー握りつぶし・偽の成功応答）
  - Business logic, invariants, and edge-case defects（業務ロジック・境界値・状態遷移）
  - Contract drift and cross-layer disagreement（レイヤー間・スキーマ間の契約ズレ）
  - State consistency, side effects, and lifecycle defects（部分書き込み・キャッシュ/インデックス不整合・初期化/破棄）
  - Concurrency, async, and ordering defects（非同期レース・二重実行・キャンセル不備）
  - Backward compatibility and revision regressions（後方互換性・BASE→HEAD破壊）
  - Chained malfunctions and cross-feature interference（機能連結・共有状態による干渉）
  - Wildcard（違和感・テスト盲点・環境仮定・履歴からの異常追跡）
  - Obvious broken things（到達可能なTODO/NotImplemented・配布設定ミス・嘘のヘルスチェック等の総点検）
- **ドメイン別コンパニオン**:
  - [UI-AND-FRONTEND.md](skills/release-check/UI-AND-FRONTEND.md) — Stale closure、非同期競合、楽観的UIロールバック、SSR/Hydration、ルーティング、マルチタブ状態
  - [API-AND-PROTOCOLS.md](skills/release-check/API-AND-PROTOCOLS.md) — OpenAPI/Schemaズレ、ページネーション、ステータスコード、冪等性、Webhook、バージョニング
  - [STATE-AND-PERSISTENCE.md](skills/release-check/STATE-AND-PERSISTENCE.md) — トランザクション漏れ、キャッシュ無効化、SQL NULL/JOIN/タイムゾーン、マイグレーション、論理削除、ファイル原子性
  - [ASYNC-JOBS-AND-INTEGRATIONS.md](skills/release-check/ASYNC-JOBS-AND-INTEGRATIONS.md) — 重複配信、順不同イベント、Ack順序/ゾンビジョブ、DLQ、Cron、外部API連携、Graceful Shutdown
  - [CLI-LIBRARY-AND-PACKAGING.md](skills/release-check/CLI-LIBRARY-AND-PACKAGING.md) — フラグ/環境/設定優先順位、終了コード、stdout/stderr、クロスプラットフォームパス、exports/型定義、devとビルド成果物の乖離
  - [CONFIG-BUILD-AND-LIFECYCLE.md](skills/release-check/CONFIG-BUILD-AND-LIFECYCLE.md) — 設定優先順位、Feature Flag半実装、起動順序、アップグレード/ダウングレード、ヘルスチェック、コンテナ/マニフェスト
  - [AI-AGENT-AND-LLM-WORKFLOWS.md](skills/release-check/AI-AGENT-AND-LLM-WORKFLOWS.md) — Toolスキーマとディスパッチのズレ、プロンプト構築/切り詰め、JSONパース失敗、無限ループ、RAG同期、MCPプロトコル
  - [NATIVE-DESKTOP-AND-SYSTEMS.md](skills/release-check/NATIVE-DESKTOP-AND-SYSTEMS.md) — リソースリーク、スレッド/ロック競合、FFI/ABI不整合、ローカルIPCフレーミング、OS差異、インストーラ/自動更新

## 5つの判定（Verdict）

| 判定 | 意味 | severity |
|---|---|---|
| `confirmed_defect` | HEAD実装に存在する確定済みの機能不全（新規・既存を問わない） | あり（`overall_severity <= impact`） |
| `confirmed_regression` | 比較可能なBASEでは動作していた契約がHEADで意図せず壊れた確定済み回帰 | あり（`overall_severity <= impact`） |
| `confirmed_change` | BASE→HEADで確認された振る舞いの変化（`intended` または `unknown`） | なし |
| `needs_validation` | ソース上の根拠はあるが、サンドボックス制限・外部環境・OS差異・オーナー意図確認が未解決のリード | なし |
| `rejected` | 検証で反証された候補（同じ誤認を今後のランで繰り返さないために記録） | なし |

## インストール（npx skills）

Node.js・npm が利用できる環境で、スキルを使いたいプロジェクトのディレクトリから実行します。

### プロジェクト単位でインストール

```bash
npx skills add https://github.com/Rumia-Channel/release-check-skills --skill release-check
```

### ユーザー全体で利用（グローバル）

```bash
npx skills add https://github.com/Rumia-Channel/release-check-skills --skill release-check --global
```

### インストール後の確認と更新

```bash
npx skills list
npx skills list --global
npx skills update
```

GitHub URLの代わりに `npx skills add Rumia-Channel/release-check-skills --skill release-check` も使用できます。CLIのオプションは [Skills CLI公式ドキュメント](https://www.skills.sh/docs/cli) を参照してください。

### 手動インストール

Skills CLIに対応していない環境では、`skills/release-check/` ディレクトリ全体（`SKILL.md`、各参照Markdown、JSONスキーマ、`scripts/`）を利用中のエージェントのスキルディレクトリにコピーしてください。

## 使い方

質問や部分的な調査では **guidance mode**、リポジトリ全体または指定スコープの包括監査・レポート生成を依頼した場合は **full audit mode** で動作します。プロファイルは `quick`・`standard`（既定）・`deep` から選択でき、full audit の成果物は既定で対象リポジトリ外の `~/release-check-skills/<repo-name>/run-<N>/` に出力されます。

```text
このリポジトリに実装されている機能を洗い出し、
それぞれの目的・期待動作・仕様やテストとの矛盾を整理して。
```

```text
このリポジトリの包括的な機能品質監査（release-check）を実行して。
既存テストの盲点（過剰モック・弱いアサーション）を確認した上で、
隔離テスト環境での実テストや scratch 内の仮想テスト（未配線プローブ・障害注入・境界値・並行レース）も
組み合わせて隠れた不具合を調査し、レポートと検証用成果物を出力して。
```

```text
前回リリースの v1.2.0 を BASE、HEAD を比較対象として、
機能の破壊・互換性問題・隠れた不具合がないか deep プロファイルで回帰監査して。
```

## 検証スクリプト（外部依存なし・クロスプラットフォーム）

Node.js 18以降（POSIX / Windows 両対応）で動作する4種類のバリデーターが付属しています。**次のコマンドは、このリポジトリをクローンした場所から実行する例**です。

```bash
# 個別成果物の構造・意味整合性チェック
node skills/release-check/scripts/validate-feature-catalog.cjs /path/to/output-dir/feature-catalog.json
node skills/release-check/scripts/validate-coverage-ledger.cjs /path/to/output-dir/coverage-ledger.json
node skills/release-check/scripts/validate-findings.cjs /path/to/output-dir/findings.json

# 出力ディレクトリ全体のクロスファイル整合性・完了ゲート検査
node skills/release-check/scripts/validate-run.cjs /path/to/output-dir

# バリデーター自身のユニットテスト一式
node --test \
  skills/release-check/scripts/validate-feature-catalog.test.cjs \
  skills/release-check/scripts/validate-coverage-ledger.test.cjs \
  skills/release-check/scripts/validate-findings.test.cjs \
  skills/release-check/scripts/validate-run.test.cjs
```

**注意:** バリデーターの `PASS` は JSON 構造・ID決定性・所有権・相互参照の整合性を保証するものであり、テスト出力やソース解釈の事実性を保証するものではありません。

## 安全性・制約

- 対象リポジトリのビルド・テスト・スクリプトは、外部ネットワーク遮断、最小許可リスト環境変数、対象読み取り専用化、エージェント専用 `scratch/` への書き込み制限、CPU/メモリ/プロセス/ファイルサイズ/時間制限を備えた **OSレベルのサンドボックス** が利用できる場合にのみ実行します。
- ターゲットコードの編集、依存パッケージの勝手なインストール、本番・外部サービスへの通信、リリース公開は行いません。
- 独立検証エージェントやサンドボックス要件を満たせない場合は、偽って確定せず `needs_validation` や `incomplete` として正確な理由と安全な検証手順を残します。

## スキルの内部仕様

| ファイル | 役割 |
|---|---|
| [SKILL.md](skills/release-check/SKILL.md) | 動作モード、実行安全、書き込み分離、プロファイル、予算ゲート、判定基準、アンチパターン |
| [RECONNAISSANCE.md](skills/release-check/RECONNAISSANCE.md) | Phase 1 並列偵察プロンプト、`system-map.md`、`feature-catalog.json`、RFC 3986 台帳仕様 |
| [HUNTING.md](skills/release-check/HUNTING.md) | Phase 2 ハンター必須プロンプト、Artifact昇格手順、カバレッジ批評波（Critic）手順 |
| [TESTING-AND-HARNESSES.md](skills/release-check/TESTING-AND-HARNESSES.md) | 隔離テスト環境での実テスト（`real_env_test`）、7種類の仮想テスト作成手順、過剰モック・トートロジー防止規則 |
| [VALIDATION-AND-REPORTING.md](skills/release-check/VALIDATION-AND-REPORTING.md) | Phase 3 敵対的検証、Phase 4 バリデーション、Phase 5 最終再検証、Phase 6 レポート生成 |
| [DEFECT-CLASSES.md](skills/release-check/DEFECT-CLASSES.md) | 10種類のコア欠陥クラス定義 |
| [UI-AND-FRONTEND.md](skills/release-check/UI-AND-FRONTEND.md) | UI・フロントエンド用欠陥クラス |
| [API-AND-PROTOCOLS.md](skills/release-check/API-AND-PROTOCOLS.md) | API・プロトコル用欠陥クラス |
| [STATE-AND-PERSISTENCE.md](skills/release-check/STATE-AND-PERSISTENCE.md) | 状態・永続化・マイグレーション用欠陥クラス |
| [ASYNC-JOBS-AND-INTEGRATIONS.md](skills/release-check/ASYNC-JOBS-AND-INTEGRATIONS.md) | 非同期ジョブ・キュー・外部連携用欠陥クラス |
| [CLI-LIBRARY-AND-PACKAGING.md](skills/release-check/CLI-LIBRARY-AND-PACKAGING.md) | CLI・ライブラリ・パッケージング用欠陥クラス |
| [CONFIG-BUILD-AND-LIFECYCLE.md](skills/release-check/CONFIG-BUILD-AND-LIFECYCLE.md) | 設定・ビルド・ライフサイクル用欠陥クラス |
| [AI-AGENT-AND-LLM-WORKFLOWS.md](skills/release-check/AI-AGENT-AND-LLM-WORKFLOWS.md) | AIエージェント・LLMワークフロー用欠陥クラス |
| [NATIVE-DESKTOP-AND-SYSTEMS.md](skills/release-check/NATIVE-DESKTOP-AND-SYSTEMS.md) | ネイティブ・デスクトップ・ローカルIPC用欠陥クラス |
| [feature-catalog-schema.json](skills/release-check/feature-catalog-schema.json) | `feature-catalog.json` のJSONスキーマ |
| [report-schema.json](skills/release-check/report-schema.json) | `findings.json`（5判定）のJSONスキーマ |

ライセンス: [BSD 2-Clause](LICENSE)
