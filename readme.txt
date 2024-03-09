◆ nokakoi.exe

Nostrのリレーサーバーに接続してグローバルタイムラインをリアルタイムに表示するアプリケーションです。

規定では、やぶみリレー（wss://yabu.me）に接続します。

リレー入力欄の右にある『リレー接続アイコン』、その右にある『購読開始ボタン』を順に押してください。
購読開始からのグローバルタイムラインが流れます。（過去の投稿は取得しません）

『購読開始ボタン』の右にある『停止ボタン』で購読の中止とリレーの切断を行います。

投稿機能を使うには、右下の『設定ボタン』からnokakoiキーとパスワードの入力が必要です。
nokakoiキーは後述するnokakoienc.exeで作成します。

※その他の設定項目はさわって確かめてみてください。

履歴

2024/02/11 ver. 0.2.4
日本語フィルタ追加。同梱の Core14.profile.xml が必要です。

2024/02/15 ver. 0.2.5
設定を保存するように。エンドタグをemojiに変更。

2024/02/17 ver. 0.2.6
エンドタグをshortcode専用に変更。emoji URLを設定可能に。

2024/02/20 ver. 0.2.7
サイズを保存するように。clientタグとemojiタグを必要時のみ付けるように修正。

2024/03/02 ver. 0.2.8
リアクション表示を追加。

2024/03/02 ver. 0.2.9
DirectSSTP送信を試験的に追加。SSPゴーストにタイムラインとリアクション通知を送信します。

2024/03/09 ver. 0.2.9.1
SSPゴーストに送る文章も本体設定文字数でカットするように変更。SSTPLib更新。

2024/03/02 ver. 0.2.10
投稿特化のポストバーを追加。


◆ nokakoienc.exe

Nostr秘密鍵（nsec1...）と自分で決めたパスワードからnokakoiキー（nokakoi:...）を作成するアプリケーションです。

nokakoiキーはNostr秘密鍵をパスワードを使ってAES暗号化したもので、noskoi独自仕様なので多少は安全ですが、Nostr秘密鍵を完全に含むものなので公開は控えてください。
nokakoiキーとパスワードが漏れると、他者によるnoskoiでの投稿が可能となってしまいます。
パスワード変更して新しいnokakoiキーを作成したとしても、以前のnokakoiキーとパスワードの組み合わせは有効です。


◆利用NuGetパッケージ

NNostr.Client
https://raw.githubusercontent.com/Kukks/NNostr/master/LICENSE

NTextCat
https://licenses.nuget.org/MIT


◆DirectSSTP送信ライブラリ

DirectSSTPTester
https://github.com/nikolat/DirectSSTPTester
内のSSTPLib Ver4.0.0を利用しています。
