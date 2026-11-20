# NULL CITY IV / NC-04

![白い一体型上フレーム、Tab5、シアンとグラファイトの天板](preview-nc04.jpg)

**[NC-04 の3D動作ビューアー](https://goroman.github.io/null-city-04/)** · [操作・開発手順](web/README.md)

NC-03 の 300 × 190 mm 筐体と 6 ボタン配列をベースに、天板奥へ M5Stack Tab5 を横向きで差し込めるようにしました。白い上フレームと左右の軸受けは一体成形を想定しています。[Blender モデル](NULL_CITY_NC04.blend) · [背面レンダー](preview-nc04-rear.jpg)

### Tab5 の取り付け

- 上から短い左右ガイドに差し込み、下端を受け棚で支えます。メーカーの組み立て済み STL を使って、本体の幅 128 mm、厚さ 12 mm に対して左右各 0.7 mm、前後各 0.8 mm のすき間を設定しました。背面写真を CAD に UV 投影し、前面ガラスは薄いレンダリング用部品で補っています。[Tab5 参照データ](docs/references/tab5/)
- 左右から M3 × 40 mm の全ねじを通し、可動クレードル両端の M3 熱圧入インサートに固定します。固定側は Ø3.4 mm の通し穴、可動側は Ø4.0 mm の下穴を仮設定しています。下穴寸法は採用するインサートの指定に合わせます。ねじ先用に可動クレードルの両端から約 32 mm の逃げ穴を設けています。
- Blender のフレーム 1〜3 は、垂直から後方へ 15°・30°・45° の姿勢です。CAD 上ではこの 3 姿勢で Tab5・クレードルと筐体・操作部の干渉がなく、差し込み経路も確認しました。45° では Tab5 が筐体後端より約 50 mm 張り出します。
- バッテリー装着時の厚み、端子へ挿したプラグの逃げ、角度保持トルクと差し込み具合は実機合わせが必要です。

### 天板とデカール

白い天板にグラファイトのロゴとシアンの細線を配置しました。天板の旧ロゴの彫り込みを埋め、前面・左右の「NULL CITY IV」もフラットな面に配置しています。 LED 用には NC-03 と同じ **4 × 4 mm の角穴を 16 個**貫通させ、裏面に LED モジュールの受け座を残しています。

### 入力の構成

Tab5 クレードルの下側に **2 × 5 ピン・2.54 mm ピッチ**の GPIO ヘッダーを配置します。ハーネス側のメスコネクターは下から差し込みます。ヘッダーから Tab5 の拡張ポートまでは短い変換ハーネスでつなぐ想定です。上フレーム後壁に角丸 18 × 8 mm の配線口を設けています。15 × 7 × 8 mm のメスプラグを想定し、15〜45° の範囲で下方に 6 mm 抜く際の干渉を CAD で確認しました。変換ハーネスのピン割り当てと採用コネクターの現物合わせは未確定です。[M5Stack Tab5 公式仕様](https://docs.m5stack.com/en/core/Tab5#schematics)

Tab5 のタッチ画面でボタン割り当てやマクロを作成する構成を想定しています。レバーとボタンの入力に加え、USB HID と BLE HID のジョイスティック出力を計画しています。NC-04 の今回の成果物は筐体検討モデルです。接続方式、回路、ファームウェアは未実装です。

### 造形と NC-03 の流用

手持ちのレバー・ボタンに加え、NC-03 の下ケース、USB 押さえ、脚、ライトカバーを流用できます。下ケースと上フレームの接合面と 4 か所の M3 固定位置は CAD で照合しました。下ケースがライトカバー対応版か、手元の部品で確認してください。NC-03 の天板を仮組みに流用するなら、新規造形は **上フレームとクレードルの2プレート**です。フラットなロゴ面と LED 穴の面取りも反映する場合は、NC-04 天板を加えて3プレートです。

| NC-04 の造形データ | 内容 |
|---|---|
| [下ケース](STL/NC04_01_lower_tray.stl) | 広い床面を 5.0 → 2.2 mm。脚、四隅のボス、USB ガイドの周辺は厚みを確保 |
| [上フレーム](STL/NC04_02_upper_frame.stl) | 一体型チルト支持部と GPIO 配線口。外周の接合縁に丸みのある面取り |
| [天板](STL/NC04_03_control_panel.stl) | 外周上端 C0.9。LED の角穴16個は 4 mm 貫通、入口 C0.4 で 4.8 mm |
| [Tab5 クレードル](STL/NC04_04_tab5_cradle.stl) | M3 インサート部と下向き GPIO 端子の逃げ |

全て新規造形する場合は 6 プレート（上記4部品、小物は同載、脚、ライトカバー）を想定しています。本体と脚は PLA、ライトカバーは乳白・半透明 PLA です。

H3C・0.4 mm・PLA、積層 0.28 mm、流量上限 12 mm³/s で比較しました。従来設定のまま下ケースだけ薄肉化すると、USB 押さえ込みのスライス見積もりが **6時間43分30秒 → 6時間23分52秒**になりました。下ケースと天板を流用し、上下各3層・外壁145 mm/s・上面120 mm/s の試作設定で上フレームとクレードルだけ造形する場合、通常速度では合計 **3時間20分42秒**です。166% で単純換算すると約 **2時間01分**。166% での実測時間と造形品質は未確認です。

### モデルの再生成

```sh
blender --background --factory-startup --python-exit-code 1 --python NULL_CITY_NC04.py
```

下記の製作データと印刷手順は NC-03 用です。NC-04 のブラケットとクレードルは造形前の検討段階です。

## ベース設計 NC-03

![NULL CITY NC-03 実機：白い筐体、紫のレバー、緑と透明のボタン、天板・前面デカール](docs/images/nc03-built.jpg)

Bambu H3Cで製作する、交換式天板の6ボタンアーケードスティック。白い面取りケースに、NULL FONTのロゴとネイビー・マゼンタのデカールを組み合わせています。写真は2026-11-16の実機です。

**[ブラウザーで3Dプレビュー ↗](https://goroman.github.io/null-city/)** · [制作日記・設計記録](docs/development-diary.md) · [部品表](BOM.md)

## 仕様と構成

| 項目 | 内容 |
|---|---|
| 外形 | 公称300 × 190 mm、脚込み高さ約55 mm（レバー・ボタンを除く） |
| 筐体 | 下ケース・上フレーム・交換式天板。天板288 × 178 × 4 mm |
| レバー | セイミツ製のゲーセンバッグ実物に合わせた直接固定。40 × 40 mmピッチ、逃げ穴φ4.5 mm × 4 |
| ボタン | Blast City 1Pの6ボタン配列。メインφ30 × 6（緑3・透明3）、1P／STARTはφ24 |
| 表示LED | レバー8方向＋各ボタン、計16個の4 × 4 mm角窓。裏面にWS2812互換モジュール用受け座 |
| 筐体照明 | 前面・左右のLED収容溝と別体の乳白カバー |
| USB配線 | 背面ケーブル出口、外径4 mm想定のS字ガイドと押さえ |

実機写真で筐体・天板・操作部・デカールの組立を確認できます。レバーは試験片でねじ4本の固定と8方向動作を確認済み。通信、LED点灯、接続済み配線の干渉、耐久性は引き続き確認が必要です。写真だけで電気的な動作確認済みとはしていません。

## 製作データ

| 作りたいもの | データ・手順 |
|---|---|
| 本体一式 | [H3C用6プレート3MF](print/h3c/NC03_H3C_6plates_lighting_sliced.3mf) ／ [造形設定](PRINT_SETTINGS.md) |
| 天板 | [標準3MF](print/h3c/03_control_panel.3mf) ／ [時短試作3MF](print/h3c/03_control_panel_fast.3mf) |
| 表面マルチカラー天板 | [3MF](print/h3c/03_control_panel_multicolor_sliced.3mf) ／ [3色印刷・角LED窓の手順](print/h3c/PANEL_MULTICOLOR.md) |
| 下ケース・照明カバー | [下ケース時短3MF](print/h3c/01_lower_tray_fast.3mf) ／ [カバー3MF](print/h3c/06_light_diffusers.3mf) ／ [照明構成](LIGHTING.md) |
| デカール | [全4枚をA4一枚に配置したPDF](artwork/decal/NC03_all_decals_A4_versioned.pdf) ／ [印刷・Bambu Suiteカット手順](artwork/decal/README.md) |
| 部品の購入 | [機構BOM](BOM.md) ／ [CSV](BOM.csv) ／ [メーカー寸法図PDF](docs/references/README.md) |
| 嵌合確認 | [レバー取付・測定](docs/fit/README.md) ／ [照明試験片](print/lighting-fit/README.md) ／ [USBガイド試験片](print/usb-relief/README.md) |
| コントローラー基板 | [KiCad設計・回路図・電子部品BOM](hardware/nc03-controller/README.md) |
| NULL FONT | [フォントパッケージ](fonts/null-font/) ／ [ベクターロゴ](artwork/logo/null-city.svg) |

マルチカラー天板は凹ロゴの底面だけ白、`///`をマゼンタにする一体造形です。写真のデカール仕上げとは別の仕上げ方法で、3色印刷・LED保持は実物確認待ちです。

コントローラー基板はXIAO nRF52840 Plusを使うA0試作。USB／BLEの通信ファームウェア、Switch／PS互換性は未実装・未検証です。[基板の制約と対応範囲](hardware/nc03-controller/README.md)を確認してください。

## 3Dプリント

Bambu Studioの **H3C／0.4 mm Standard・Textured PEI Plate** を使用し、実際の材料と装着ノズルに合わせて再スライスします。

| 設定 | 本体の標準試作 | 同梱6プレート版の時短試作 |
|---|---|---|
| 積層／初層 | 0.20／0.20 mm | 0.28／0.20 mm |
| 壁 | 4周 | 3周 |
| 上面／底面 | 各5層 | 各4層 |
| 充填 | Gyroid 15% | Gyroid 10% |
| ブリム | 外周5 mm、隙間0.15 mm | 同左 |
| サポート | なし | なし |
| 外壁／天面 | 100／80 mm/s | 同左 |

PLAの開始値はノズル220℃、ベッド55℃、最大体積流量12 mm³/s。材料メーカーの指定を優先してください。脚は別プレートでTPU、カバーは半透明PLA。各専用ジョブの設定と見積は[PRINT_SETTINGS.md](PRINT_SETTINGS.md)を参照。

## デカールの印刷とカット

実機では天板・前面・左右の4枚を、[A4横一枚のベクターPDF](artwork/decal/NC03_all_decals_A4_versioned.pdf)から印刷しました。

- Canon XK130、A4写真用紙 光沢ゴールド（GL-101）、後トレイ、高品質・カラー・片面。
- 倍率100%、フチなしOFF、用紙に合わせるOFF。
- [Suite用カットデータ](artwork/decal/NC03_all_decals_A4_CUT_ONLY_NOMINAL.lac)は33穴＋4外周の計37閉輪郭。用紙を貼るたびにカメラで位置・角度を合わせます。
- 余白・塗り足しが必要な場合は[余白付きA4二枚版](artwork/decal/NC03_decals_A4_2sheets.pdf)を使用。

材料設定、刃、位置合わせと試し切りの注意点は[デカールREADME](artwork/decal/README.md)にまとめています。

## 設計図と3Dビューアー

![上面・正面・右側面の三面図（Blenderレンダリング）](docs/images/three-views.jpg)

[制作日記・設計記録](docs/development-diary.md)に、分解図・ワイヤーフレーム・照明構造・寸法・試作の経緯をまとめています。レンダリングの発光表現は完成イメージです。

[PBR Webビューアー](https://goroman.github.io/null-city/)では回転・ズーム・分解表示、HDR IBL、SSAO、露出・背景色、RGB LEDアニメーション、レバーとボタンの操作を試せます。[ローカル実行・GitHub Pages公開手順](web/README.md)。

## モデルと画像の再生成

`NULL_CITY_NC03.blend` が組立モデル、`NULL_CITY_NC03.py` が生成スクリプト、`STL/` が部品別の造形データです。リポジトリ直下で実行します。

```sh
blender --background --factory-startup --python-exit-code 1 --python NULL_CITY_NC03.py
python3 scripts/render_all.py
```

実機のトップ写真は `docs/images/nc03-built.jpg`。Blenderの再レンダリングでは更新されません。照明・デカールなどの生成手順は各リンク先を参照してください。

## ライセンス

Copyright © 2026 GOROman。適用範囲は[LICENSE](LICENSE)を参照。

| 対象 | ライセンス |
|---|---|
| スクリプト（フォントパッケージを除く） | [MIT](LICENSES/MIT.txt) |
| 造形・デカール・オリジナル画像・設計設定・ドキュメント | [CC BY 4.0](LICENSES/CC-BY-4.0.txt) |
| NULL FONT（字形ソース・生成スクリプトを含む） | [SIL OFL 1.1](fonts/null-font/OFL.txt) |

メーカー寸法図など第三者資料は、それぞれの権利・ライセンスに従います。
