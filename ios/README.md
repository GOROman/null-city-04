# NC-04 Joy Check

iOS 17以降で、Game Controllerフレームワークが認識したコントローラを調べるアプリです。認識名とカテゴリ、Dパッドと軸、ボタン値、直近64件の押下・方向ログを表示します。

1. iPhoneのBluetooth設定で `NULL CITY NC-04` をペアリングします。
2. Xcodeで `NC04JoystickCheck.xcodeproj` を開き、ターゲットの **Signing & Capabilities** で開発チームを選びます。
3. 接続済みのiPhoneを選んでRunし、レバーの8方向と各ボタンを確認します。

Bluetooth設定で接続できても一覧に出ない場合、iOSのGame Controllerには公開されていません。iPhoneの設定にあるゲームコントローラ一覧と照合してください。 [Appleの接続ガイド](https://support.apple.com/ja-jp/111099)

NC-04の現行ファームウェアはBLEとUSBでJoystickのHID記述子を共有します。Espressifの公式例はBLEの最上位用途をGame Padとしています。NC-04が一覧に出ない場合、BLE側の用途とAppearanceをGame Padに変えた検証版で切り分けます。ファームウェアの変更や実機互換性の検証は、このアプリのビルドとは別に行います。 [EspressifのBLE Gamepad例](https://github.com/espressif/arduino-esp32/blob/master/libraries/BLE/examples/Server_Gamepad/Server_Gamepad.ino)
