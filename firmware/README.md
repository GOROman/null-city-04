# NC-04 · Tab5単体のVF2ジョイスティック

Tab5背面の30ピンM5-Busから、レバー4方向とG・P・K・COIN・1Pを直接読み取ります。入力基板は不要です。VF2を動かすPCやエミュレーターに、Tab5をUSB Type-CまたはBLEの標準HIDジョイスティックとして接続します。

## 背面M5-Bus配線

| 入力 | M5-Busのピン番号 | ESP32-P4 GPIO | HID |
|---|---:|---:|---|
| レバー 上 | 2 | 16 | Y− |
| レバー 下 | 7 | 18 | Y＋ |
| レバー 左 | 9 | 19 | X− |
| レバー 右 | 11 | 5 | X＋ |
| G / GUARD | 19 | 3 | ボタン1 |
| P / PUNCH | 20 | 4 | ボタン2 |
| K / KICK | 21 | 2 | ボタン3 |
| COIN | 15 | 7 | ボタン4 |
| 1P / START | 16 | 6 | ボタン5 |
| スイッチ共通GND | 1、3、5のいずれか | — | — |

- 各マイクロスイッチの **NO** を個別のGPIOに、**COM** を共通GNDに接続します。入力は内部プルアップで、押すとLOWです。背面コネクターのピン1を公式の図と実物で照合してから配線してください。スイッチには電源を供給しません。
- GPIO5/18/19とGPIO6/7は拡張用SPI・COMの信号と共用です。この割り当てで使う間は、これらの信号を使う背面モジュールを付けないでください。
- この配線は **背面の30ピンM5-Bus** 用です。既存クレードルの下向き2×5 Ext.Port1用ハーネスとは別なので、背面M5-Busに合うコネクターでハーネスを作り、コネクターの厚みとチルト時の配線の逃げを現物で確認してください。

[M5Stack Tab5公式ピン表](https://docs.m5stack.com/en/core/Tab5#pinmap)

## 操作

- 画面左の円をタッチしてドラッグすると、物理レバーと同じ8方向を入力できます。中心にはデッドゾーンがあり、指を離すとニュートラルに戻ります。画面右の6ボタンをスティックと同時にタッチ操作できます。上段に小型のCOIN・1P・2P、下段に大型のG・P・Kを配置しています。G・P・Kは筐体パネルと同じくPが最も上で、K、Gの順に下がります。2Pはタッチ専用でHIDボタン6を送ります。
- 画面は60 Hz周期で、HIDへ送るレバー8方向＋ニュートラルと6つのボタンを表示します。マクロの出力も表示に反映します。ノブは表示側だけ滑らかに追従します。
- **INPUT LOG** は直近64件のHIDの方向入力とボタン押下をRAMに記録します。画面右の縦ログ欄に7件を表示します。新しい入力は下端に入り、古い入力は上へ移動し、起動からの時刻をミリ秒で表示します。レバーの方向は矢印、ボタンは丸の中のラベルで示します。レバーが中央に戻るだけの変化とボタンを離しただけの変化は記録しません。ボタンは新しく押したものを塗りつぶしで表示します。物理・タッチ・マクロの出力が対象です。**OLDER** と **NEWER** で移動し、**CLEAR** で消去します。
- レバーは上下・左右の反対方向を同時に押すと、その軸を中央に戻します。斜めとG・P・Kの同時押しに対応します。
- **RECORD** を押してレバーとG・P・Kを操作し、**STOP REC** で停止します。**PLAY** で1回再生、**STOP PLAY** で中止します。最大64区間、各区間20 ms〜5秒で、1件をRAMに保持します。COIN・1P・2Pは常に手動入力です。
- USBとBLEは同じ軸・ボタン番号を送ります。両方を同じホストに接続すると2台の入力機器に見えるため、VF2側では使うほうを割り当ててください。アーケード筐体のJAMMAや各ゲーム機専用の認証プロトコルは対象外です。

## VF2マクロプリセット

| Tab5のボタン | 動作 |
|---|---|
| DOPPO | 独歩頂膝。G＋Kを約1フレーム送ってGだけ離す |
| AKIRA SPECIAL | 崩撃雲身双虎掌。中央＋P＋K＋G → 中央 → 4 → 3＋P＋K → 中央 → 2 → 4＋P。2段目はF0+7付近、3段目はF0+22付近。 [VF2 2.1の入力検証](https://gist.github.com/GOROman/8352505984b88a74981f474c0f3af482) |
| 1000 PUNCH | 押している間だけP → K → 待機 → G → 待機を繰り返す。指を離すかボタンの外へ移すと停止 |
| FACE RIGHT / LEFT | 対戦中のキャラクターの向き。左向きでは方向コマンドを左右反転 |
| PKG TUNE | Kを離してからGまで、Gを離してから次のPまでをそれぞれ5 ms刻みで調整。再タップでログに戻る |

技プリセットは1回ずつ送ります。マクロ録画中は手動入力を記録します。独歩頂膝の最初の入力は約17 msです。技が成立するかはゲーム側の入力ポーリングや、対戦中の距離・タイミングにも依存します。 [セガのコマンド表（メガドライブ版）](https://vc.sega.jp/vc_vf2/w_akira.html)

千本パンチの初期値はP 100 ms、K 35 ms、無入力70 ms、G 18 ms、無入力80 msの一周303 msです。調整値は再起動で初期値に戻ります。動画から各ボタンの正確な時刻は確認できず、ゲーム内での成立タイミングは未確認です。 [VF2.0 千本パンチ実演](https://www.youtube.com/watch?v=vesM_U9XENw) · [VF2 FAQ実演](https://www.youtube.com/watch?v=R-faQgcEC74) [セガ開発者インタビュー](https://www.sega.jp/fb/segavoice/041014/01_2.html) · [P→K→Gの解説](https://blog.ja.playstation.com/?p=50)

## ビルド・書き込み

Arduino-ESP32 4.0.0、M5Unified 0.3.0、M5GFX 0.3.0を使用します。C145/K145のESP32-P4がv3.00より前の個体向けのコマンドです。v3.00以降は `ChipVariant=postv3` に置き換えます。

```sh
arduino-cli core install esp32:esp32@4.0.0 \
  --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install M5GFX@0.3.0 M5Unified@0.3.0
arduino-cli compile \
  --fqbn esp32:esp32:m5stack_tab5:ChipVariant=prev3,USBMode=tinyusb_fs,CDCOnBoot=default \
  firmware/NC04_Tab5
```

Tab5のUSB-Cをデータケーブルで接続し、Reset/Bootを緑LEDが点滅するまで押してダウンロードモードに入ります。`arduino-cli board list` でポートを確認し、ビルド時と同じFQBNを使って `arduino-cli upload -p <PORT> --fqbn <FQBN> firmware/NC04_Tab5` を実行します。書き込むのはP4側です。BLEはTab5内蔵C6のESP-Hosted HCIを使います。ペアリング名は **NULL CITY NC-04** です。

[M5Stackのダウンロードモード](https://docs.m5stack.com/en/core/Tab5#download-mode) · [EspressifのHosted BLE仕様](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ble.html)

## macOSでのUSB入力チェック

リポジトリのルートで `npm --prefix web run dev` を実行し、Chromeで [USB Joy Check](http://127.0.0.1:4173/joy-check.html) を開きます。開発中はWebUIを保存するとViteがページを自動で再読み込みします。MacとTab5をUSB-Cでつなぎ、レバーかボタンを操作するとブラウザーが入力を認識します。自動認識しない場合は「USBデバイスを選択」で **NULL CITY NC-04** を選びます。

Tab5画面はアンチエイリアス付きのNULL FONTを使用します。元のTTFとライセンスは [fonts/null-font](../fonts/null-font/) にあります。ビットマップを再生成するにはPillowを入れて `python firmware/build_null_font.py` を実行します。

### HIDで書き込みモードへ移行

ChromeのUSB Joy CheckでUSBデバイスを選択し、**Enter download mode** を押すと、USB HID Feature Report `0x7E` にASCII 8バイトの `NC04BOOT` を送ります。対応版のTab5が再起動すると、ESP32-P4のROMダウンロード用USB Serial/JTAGポートが現れ、esptoolで書き込めます。BLEやGamepad APIではこのコマンドを送信できません。初回は本体のReset/Boot操作で対応版を書き込んでください。
